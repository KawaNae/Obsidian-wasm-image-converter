import { App, ButtonComponent, Notice, Setting, TFile, TFolder } from "obsidian";
import { EncodeSettings, PluginSettings, Preset, resolvePreset } from "../settings";
import { convertBlob } from "../conversion/convert";
import { encoderFor } from "../conversion/encoders";
import { replaceExisting } from "../save/save";
import { isAnimatedGif } from "../utils/gif-check";
import { OverlayShell } from "../ui/overlay/overlay-shell";
import { batchSummary, batchTargets, countByExtension, emptyTally, isLargerAfterConversion } from "./targets";

/**
 * Converts the target images of the vault, or of one folder and its
 * subfolders, in place (replaceExisting: same folder and name, new
 * extension). The preset is chosen in a confirmation dialog. Images whose
 * result would be larger are left alone, as are animated GIFs unless the
 * settings ask to convert them. One notice shows the progress and can
 * cancel the run between two files.
 */
export async function runBatchConvert(app: App, settings: PluginSettings, folder: TFolder | null): Promise<void> {
  const scope = folder && !folder.isRoot() ? folder.path : "";
  const scopeLabel = scope === "" ? "the vault" : `"${scope}"`;
  const targets = batchTargets(app.vault.getFiles(), settings.batchConvertExtensions, scope);
  if (targets.length === 0) {
    new Notice(`No images to convert in ${scopeLabel}`);
    return;
  }

  const preset = await chooseBatchPreset(app, settings, scopeLabel, targets);
  if (!preset) return;

  const tally = emptyTally(targets.length);
  const progress = new ProgressNotice();

  for (const file of targets) {
    if (progress.cancelled) {
      tally.cancelled = true;
      break;
    }
    progress.update(`Batch converting (${preset.name}) ${tally.processed + 1}/${tally.total}: ${file.name}`);
    try {
      const data = await app.vault.readBinary(file);
      const source = new Blob([data], { type: `image/${file.extension.toLowerCase() === "jpg" ? "jpeg" : file.extension.toLowerCase()}` });
      if (file.extension.toLowerCase() === "gif" && !settings.processAnimatedGifs && await isAnimatedGif(source)) {
        tally.skippedAnimated++;
        continue;
      }
      const converted = await convertBlob(source, preset.encode);
      if (isLargerAfterConversion(data.byteLength, converted.size)) {
        tally.skippedLarger++;
        continue;
      }
      await replaceExisting(app, file, converted, encoderFor(preset.encode.format).extension);
      tally.converted++;
      tally.originalBytes += data.byteLength;
      tally.convertedBytes += converted.size;
    } catch (error) {
      console.error(`Batch convert failed for ${file.path}:`, error);
      tally.failed++;
    } finally {
      tally.processed++;
    }
  }

  progress.hide();
  new Notice(batchSummary(tally), 10000);
}

/** "WASM WebP, quality 80%, resize to fit 1920×1080" */
export function describeEncode(encode: EncodeSettings): string {
  const encoder = encoderFor(encode.format);
  const parts = [encoder.label];
  parts.push(encoder.lossy ? `quality ${Math.round(encode.quality * 100)}%` : "lossless");
  parts.push(encode.resize.enabled ? `resize to fit ${encode.resize.maxWidth}×${encode.resize.maxHeight}` : "no resize");
  if (encode.grayscale) parts.push("grayscale");
  return parts.join(", ");
}

/** A notice that stays until hidden, with a cancel button; clicking it does not dismiss it. */
class ProgressNotice {
  cancelled = false;
  private notice: Notice;
  private textEl!: HTMLElement;

  constructor() {
    const fragment = createFragment(f => {
      const wrap = f.createDiv({ cls: "wasm-image-batch-progress" });
      // A click on a notice dismisses it; keep the progress on screen
      wrap.addEventListener("click", e => e.stopPropagation());
      this.textEl = wrap.createDiv({ cls: "wasm-image-batch-progress__text" });
      const button = wrap.createEl("button", { cls: "wasm-image-batch-progress__cancel", text: "Cancel" });
      button.addEventListener("click", () => {
        this.cancelled = true;
        button.disabled = true;
        button.setText("Cancelling after this file...");
      });
    });
    this.notice = new Notice(fragment, 0);
  }

  update(text: string) {
    this.textEl.setText(text);
  }

  hide() {
    this.notice.hide();
  }
}

/**
 * Confirms a batch convert and chooses its preset, in the same window as
 * the converter dialog (a bottom sheet on a phone). Resolves with the
 * preset, or null when the dialog was closed otherwise.
 */
function chooseBatchPreset(app: App, settings: PluginSettings, scopeLabel: string, targets: TFile[]): Promise<Preset | null> {
  return new Promise(resolve => {
    const shell = new OverlayShell();
    let chosen: Preset | null = null;
    shell.open({
      label: "Batch Convert Images",
      panelClass: "wasm-image-batch-dialog",
      keymap: app.keymap,
      onClose: () => resolve(chosen),
      build: (contentEl, footerEl) => {
        const counts = countByExtension(targets).map(([ext, n]) => `${n} × ${ext}`).join(", ");
        contentEl.createEl("p", { text: `${targets.length} images in ${scopeLabel}: ${counts}` });

        let preset = resolvePreset(settings, settings.autoConvertPresetId) ?? null;
        const setting = new Setting(contentEl)
          .setName("Preset")
          .addDropdown(dropdown => {
            for (const p of settings.presets) dropdown.addOption(p.id, p.name);
            if (preset) dropdown.setValue(preset.id);
            dropdown.onChange(id => {
              preset = settings.presets.find(p => p.id === id) ?? null;
              describe();
            });
          });
        const describe = () => setting.setDesc(preset ? describeEncode(preset.encode) : "");
        describe();

        const notes = contentEl.createEl("ul", { cls: "wasm-image-batch-dialog__notes" });
        notes.createEl("li", { text: "Each image is replaced in place: same folder and name, new extension. Images that would get larger are skipped." });
        if (!settings.processAnimatedGifs && targets.some(f => f.extension.toLowerCase() === "gif")) {
          notes.createEl("li", { text: "Animated GIFs are skipped." });
        }
        notes.createEl("li", {
          text: "If \"Automatically update internal links\" is off in Obsidian's Files and links settings, " +
            "Obsidian asks for every renamed image whether to update its links.",
        });

        const buttons = footerEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(buttons)
          .setButtonText("Cancel")
          .onClick(() => shell.close());
        new ButtonComponent(buttons)
          .setButtonText("Convert")
          .setCta()
          .onClick(() => {
            chosen = preset;
            shell.close();
          });
      },
    });
  });
}
