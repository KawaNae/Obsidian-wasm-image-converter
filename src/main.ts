import { Notice, Plugin, MarkdownView, TFile, TFolder, Menu } from "obsidian";
import { PluginSettings, createDefaultSettings, resolvePreset } from "./settings";
import { migrateSettings } from "./settings-migration";
import { openConverterDialog } from "./ui/converter-dialog";
import { WasmImageConverterSettingTab } from "./settings-tab";
import { initWasmLoaderContext } from "./conversion/wasm-loader";
import { encoderFor } from "./conversion/encoders";
import { AutoConverter } from "./entry/auto-convert";
import { runBatchConvert } from "./entry/batch-convert";
import { closeAllOverlays } from "./ui/overlay/overlay-registry";
import { untrackAllKeyboards } from "./ui/overlay/keyboard-state";
import { workspaceDocument } from "./ui/overlay/host-document";

/** Extensions the file menu offers to convert. */
const FILE_MENU_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

export default class WasmImageConverterPlugin extends Plugin {
  settings: PluginSettings = createDefaultSettings();

  async onload() {
    await this.loadSettings();

    // Initialize remote WASM loaders (stores references only, no download yet)
    initWasmLoaderContext(this.app, this.manifest.dir!);

    this.addSettingTab(new WasmImageConverterSettingTab(this.app, this));

    new AutoConverter(this.app, () => this.settings).register(this);

    this.addCommand({
      id: "wasm-webp-open-converter",
      name: "Convert Image",
      icon: "image-plus",
      callback: () => this.openConverterForActiveNote(),
    });

    this.addCommand({
      id: "batch-convert-images",
      name: "Batch Convert Images",
      callback: () => runBatchConvert(this.app, this.settings, null),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) this.addFolderMenuItem(menu, file);
        else if (file instanceof TFile) this.addFileMenuItem(menu, file);
      })
    );
  }

  /**
   * Our dialogs live on the document's body, which no teardown of
   * Obsidian's reaches: close what is still open, and stop following the
   * on-screen keyboard.
   */
  onunload() {
    closeAllOverlays();
    untrackAllKeyboards();
  }

  async loadSettings() {
    const result = migrateSettings(await this.loadData());
    this.settings = result.settings;

    if (result.discardedFolders.length > 0) {
      const folder = this.settings.save.destination.folder;
      const lines = result.discardedFolders.map(d => `  - ${d.presetName}: "${d.folder}"`).join("\n");
      new Notice(
        `WASM Image Converter: presets no longer have their own save folder. ` +
        `Converted images are now saved to "${folder}". ` +
        `These preset folders were removed:\n${lines}`,
        0
      );
    }

    if (result.changed) await this.saveSettings();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * The dialog for new images, in the window of the active note (the main
   * window when there is none); the links go to that note's cursor.
   */
  private async openConverterForActiveNote() {
    try {
      const active = this.app.workspace.getActiveFile();
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const hostDocument = workspaceDocument(this.app, view?.containerEl.ownerDocument ?? null);
      const link = await openConverterDialog(this.app, this.settings, { sourcePath: active?.path ?? "" }, hostDocument);
      if (!link) return;

      if (active) {
        // The note the dialog opened for, while its view still shows it
        const editor = view?.file === active ? view.editor : undefined;
        if (editor) {
          const offset = editor.posToOffset(editor.getCursor());
          editor.replaceRange(link, editor.offsetToPos(offset));
          editor.setCursor(editor.offsetToPos(offset + link.length));
        } else {
          const content = await this.app.vault.read(active);
          await this.app.vault.modify(active, content + "\n" + link);
        }
      } else {
        new Notice("📋 Image link: " + link);
      }
    } catch (e) {
      console.error(e);
      new Notice("❌ Image conversion failed");
    }
  }

  /** The dialog in replace mode: name and folder start as the file's own. */
  private addFileMenuItem(menu: Menu, file: TFile) {
    if (!FILE_MENU_EXTENSIONS.includes(file.extension.toLowerCase())) return;
    const preset = resolvePreset(this.settings, this.settings.defaultPresetId);
    const ext = encoderFor(preset?.encode.format ?? "webp").extension.toUpperCase();
    menu.addItem(item => item
      .setTitle(`Convert to ${ext}...`)
      .setIcon("image-file")
      .onClick(async () => {
        try {
          const data = await this.app.vault.readBinary(file);
          const extension = file.extension.toLowerCase();
          const imageFile = new File([data], file.name, { type: `image/${extension === "jpg" ? "jpeg" : extension}` });
          const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
          const link = await openConverterDialog(this.app, this.settings, { sourcePath, initialFile: imageFile, target: file }, workspaceDocument(this.app, null));
          if (link) {
            // There may be no editor to insert into; offer the link instead
            await navigator.clipboard.writeText(link);
            new Notice("📋 Link copied to clipboard");
          }
        } catch (e) {
          console.error("Conversion failed:", e);
          new Notice("❌ Failed to load image for conversion");
        }
      }));
  }

  private addFolderMenuItem(menu: Menu, folder: TFolder) {
    menu.addItem(item => item
      .setTitle("Batch convert images in this folder")
      .setIcon("images")
      .onClick(() => runBatchConvert(this.app, this.settings, folder)));
  }
}
