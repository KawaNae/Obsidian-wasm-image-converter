import { App, Editor, EditorPosition, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { PluginSettings, Preset, resolvePreset } from "../settings";
import { convertBlob } from "../conversion/convert";
import { encoderFor } from "../conversion/encoders";
import { embedLink, saveAsAttachment, saveNew } from "../save/save";
import { isAnimatedGif } from "../utils/gif-check";
import { dropPosition } from "./drop-position";
import { IncomingAction, isGifFile, joinLinks, planIncoming, sizeChange, vaultFilesOf } from "./targets";
import { vaultFileLocator } from "./vault-file";

/**
 * Converts images dropped or pasted into the editor (the "auto-convert"
 * setting) and inserts their links at the drop position or the cursor: all
 * links at once, in the order of the files, separated by an empty line.
 * Other files of the same drop or paste (PDFs, non-target images) are saved
 * as they are, as Obsidian saves attachments, and linked in their place
 * among the others. Files of a desktop drop or paste that are already in
 * the vault (a file copied in Finder or Explorer) are linked where they
 * are, neither copied nor converted, as Obsidian links them; a drop or a
 * paste of such files only is left to Obsidian. An image copied to the
 * clipboard has no path: it comes from outside.
 *
 * Drop and paste differ only in where the files come from and where the
 * links go. Animated GIFs are saved as they are unless the settings ask to
 * convert them. On mobile, pasted files are always named "image.png".
 */
export class AutoConverter {
  constructor(private readonly app: App, private readonly settings: () => PluginSettings) {}

  register(plugin: Plugin) {
    plugin.registerEvent(this.app.workspace.on("editor-drop", (evt, editor, info) => {
      if (!this.wants(evt)) return;
      const files = Array.from(evt.dataTransfer?.files ?? []);
      const vaultFiles = vaultFilesOf(files, vaultFileLocator(this.app));
      this.handle(evt, files, vaultFiles, editor, info, () => dropPosition(evt, editor));
    }));

    plugin.registerEvent(this.app.workspace.on("editor-paste", (evt, editor, info) => {
      if (!this.wants(evt)) return;
      const files = Array.from(evt.clipboardData?.items ?? [])
        .filter(item => item.kind === "file")
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      const vaultFiles = vaultFilesOf(files, vaultFileLocator(this.app));
      this.handle(evt, files, vaultFiles, editor, info, () => {
        // A paste replaces the selection, at once as Obsidian's own does
        if (editor.somethingSelected()) editor.replaceSelection("");
        return editor.getCursor();
      });
    }));
  }

  /** Checked at event time so settings changes take effect without reload. */
  private wants(evt: Event): boolean {
    return this.settings().enableAutoConvert && !evt.defaultPrevented;
  }

  /**
   * Takes the event over when it carries target images from outside the
   * vault and belongs to a note; otherwise Obsidian handles it as usual.
   * Once taken over, every file of the event is handled here: see planIncoming.
   *
   * @param vaultFiles - the files of the event that are files of the vault
   * @param position - where the links go; called before anything async.
   *   null leaves the event to Obsidian
   */
  private handle(
    evt: Event,
    files: File[],
    vaultFiles: ReadonlyMap<File, TFile>,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
    position: () => EditorPosition | null
  ) {
    const settings = this.settings();
    const plan = planIncoming(files, settings.batchConvertExtensions, file => vaultFiles.has(file));
    if (!plan) return;

    const sourcePath = info.file?.path;
    const preset = resolvePreset(settings, settings.autoConvertPresetId);
    if (!sourcePath || !preset) return;

    const pos = position();
    if (!pos) {
      console.warn("Auto-convert: could not determine the drop position");
      return;
    }

    evt.preventDefault();
    void this.convertAndInsert(plan, vaultFiles, editor, pos, sourcePath, preset);
  }

  private async convertAndInsert(
    plan: { file: File; action: IncomingAction }[],
    vaultFiles: ReadonlyMap<File, TFile>,
    editor: Editor,
    pos: EditorPosition,
    sourcePath: string,
    preset: Preset
  ) {
    const settings = this.settings();
    const extension = encoderFor(preset.encode.format).extension;
    const links: string[] = [];
    const convertedNames: string[] = [];
    const keptGifs: string[] = [];
    const failed: string[] = [];
    let originalBytes = 0;
    let convertedBytes = 0;

    for (const { file, action } of plan) {
      try {
        if (action === "link") {
          links.push(embedLink(this.app, vaultFiles.get(file)!, sourcePath));
          continue;
        }
        if (action === "attach") {
          const saved = await saveAsAttachment(this.app, file, file.name, sourcePath);
          links.push(embedLink(this.app, saved, sourcePath));
          continue;
        }
        if (isGifFile(file) && !settings.processAnimatedGifs && await isAnimatedGif(file)) {
          const gifExtension = file.name.match(/\.([^.]+)$/)?.[1] ?? "gif";
          links.push(await this.save(file, file, gifExtension, sourcePath));
          keptGifs.push(file.name);
          continue;
        }
        const converted = await convertBlob(file, preset.encode);
        links.push(await this.save(file, converted, extension, sourcePath));
        convertedNames.push(file.name);
        originalBytes += file.size;
        convertedBytes += converted.size;
      } catch (error) {
        console.error(`Auto-convert: failed to save ${file.name}:`, error);
        failed.push(file.name);
      }
    }

    if (links.length > 0) {
      const text = joinLinks(links);
      const offset = editor.posToOffset(pos);
      const cursorStayed = editor.posToOffset(editor.getCursor()) === offset;
      editor.replaceRange(text, pos);
      // Behind the links, as after a paste, unless the user moved on meanwhile
      if (cursorStayed) editor.setCursor(editor.offsetToPos(offset + text.length));
    }

    if (convertedNames.length > 0) {
      const what = convertedNames.length === 1 ? convertedNames[0] : `${convertedNames.length} images`;
      new Notice(`✅ Auto-converted (${preset.name}): ${what} ${sizeChange(originalBytes, convertedBytes)}`);
    }
    if (keptGifs.length > 0) {
      new Notice(`⚠️ Kept animated GIF as is: ${keptGifs.join(", ")}`);
    }
    if (failed.length > 0) {
      new Notice(`❌ Failed to save ${failed.join(", ")}`);
    }
  }

  /** Saves `blob` as a new file for the note and returns its embed link. */
  private async save(source: File, blob: Blob, extension: string, sourcePath: string): Promise<string> {
    const saved = await saveNew(this.app, blob, extension, {
      ...this.settings().save,
      sourcePath,
      originalName: source.name,
    });
    return embedLink(this.app, saved, sourcePath);
  }
}
