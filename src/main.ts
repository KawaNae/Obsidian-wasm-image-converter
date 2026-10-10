import { Notice, Plugin, Editor, Platform, MarkdownView, TFile, Modal, normalizePath } from "obsidian";
import { PluginSettings, Preset, createDefaultSettings, resolvePreset } from "./settings";
import { migrateSettings } from "./settings-migration";
import { openImageConverterModal } from "./ui/image-converter-modal";
import { WasmImageConverterSettingTab } from "./settings-tab";
import { initWasmLoaderContext } from "./conversion/wasm-loader";
import { encoderFor } from "./conversion/encoders";
import { saveImageAndInsert, saveOriginalFile, convertAndReplaceFile, resolveSaveFolder } from "./file-service";
import { isAnimatedGif } from "./utils/gif-check";

export default class WasmImageConverterPlugin extends Plugin {
  settings: PluginSettings = createDefaultSettings();

  async onload() {
    await this.loadSettings();

    // Initialize remote WASM loaders (stores references only, no download yet)
    initWasmLoaderContext(this.app, this.manifest.dir!);

    this.addSettingTab(new WasmImageConverterSettingTab(this.app, this));

    // Register auto-convert events if enabled
    this.registerAutoConvertEvents();

    this.addCommand({
      id: "wasm-webp-open-converter",
      name: "Convert Image",
      icon: "image-plus", // 他のオプション: "image", "convert", "camera", "file-image"
      callback: async () => {
        try {
          const link = await openImageConverterModal(this.app, this.settings);
          if (!link) return;

          const active = this.app.workspace.getActiveFile();
          if (active) {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            const editor = view?.editor;
            if (editor) {
              const cursor = editor.getCursor();
              editor.replaceRange(link, cursor);
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
      },
    });

    // Batch convert command
    this.addCommand({
      id: "batch-convert-images",
      name: "Batch Convert Images",
      callback: async () => {
        await this.runBatchConvert();
      }
    });

    // File menu event
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;

        const supportedExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'];
        if (supportedExtensions.includes(file.extension.toLowerCase())) {
          menu.addItem((item) => {
            const preset = resolvePreset(this.settings, this.settings.defaultPresetId);
            const ext = encoderFor(preset?.encode.format ?? "webp").extension.toUpperCase();
            item
              .setTitle(`Convert to ${ext}...`)
              .setIcon("image-file")
              .onClick(async () => {
                try {
                  const arrayBuffer = await this.app.vault.readBinary(file);
                  // Create a File object from the TFile content
                  const imageFile = new File([arrayBuffer], file.name, {
                    type: 'image/' + (file.extension === 'jpg' ? 'jpeg' : file.extension)
                  });

                  const link = await openImageConverterModal(this.app, this.settings, imageFile, file);

                  if (link) {
                    new Notice("✅ Image converted successfully");
                    // Copy link to clipboard since we might not have an active editor
                    await navigator.clipboard.writeText(link);
                    new Notice("📋 Link copied to clipboard");
                  }
                } catch (e) {
                  console.error("Conversion failed:", e);
                  new Notice("❌ Failed to load image for conversion");
                }
              });
          });
        }
      })
    );
  }

  async onunload() {
    // 何もしない
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

  /** Preset used by auto-convert and batch convert. */
  private getAutoConvertPreset(): Preset | undefined {
    return resolvePreset(this.settings, this.settings.autoConvertPresetId);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ===== Batch Convert =====

  private async runBatchConvert() {
    try {
      // Find all target images
      const allFiles = this.app.vault.getFiles();
      const targetImages = allFiles.filter(file => this.isBatchConvertTarget(file));

      if (targetImages.length === 0) {
        new Notice('No images found for conversion');
        return;
      }

      // Count by extension
      const counts: Record<string, number> = {};
      targetImages.forEach(file => {
        const ext = file.extension.toLowerCase();
        counts[ext] = (counts[ext] || 0) + 1;
      });

      // Create confirmation message
      const countLines = Object.entries(counts)
        .map(([ext, count]) => `  - ${count} × ${ext}`)
        .join('\n');

      const confirmed = await this.showBatchConvertConfirmation(
        `Found ${targetImages.length} images to convert:\n${countLines}\n\nContinue?`
      );

      if (!confirmed) {
        return;
      }

      // Process images
      let totalOriginalSize = 0;
      let totalConvertedSize = 0;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < targetImages.length; i++) {
        const image = targetImages[i];

        // Check Animated GIFs
        if (image.extension.toLowerCase() === 'gif') {
          const arrayBuffer = await this.app.vault.readBinary(image);
          const blob = new Blob([arrayBuffer]);
          if (await isAnimatedGif(blob)) {
            if (!this.settings.processAnimatedGifs) {
              new Notice(`Skipping animated GIF: ${image.name}`);
              continue;
            }
            // If allowed, it will be converted (flattened to static)
          }
        }

        new Notice(`Converting ${i + 1}/${targetImages.length}: ${image.name}`);

        try {
          const result = await this.convertImage(image);
          totalOriginalSize += result.originalSize;
          totalConvertedSize += result.convertedSize;
          successCount++;
        } catch (error) {
          console.error(`Failed to convert ${image.name}:`, error);
          errorCount++;
        }
      }

      // Show completion notice
      const savedMB = ((totalOriginalSize - totalConvertedSize) / (1024 * 1024)).toFixed(2);
      const ratio = totalOriginalSize > 0
        ? (((totalOriginalSize - totalConvertedSize) / totalOriginalSize) * 100).toFixed(1)
        : '0';

      new Notice(
        `✅ Batch conversion complete!\n` +
        `Converted: ${successCount} images\n` +
        `Failed: ${errorCount} images\n` +
        `Total saved: ${savedMB} MB (${ratio}% reduction)`
      );
    } catch (error) {
      console.error('Batch convert failed:', error);
      new Notice('❌ Batch conversion failed');
    }
  }

  private showBatchConvertConfirmation(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: any) {
          super(app);
        }

        onOpen() {
          const { contentEl } = this;
          contentEl.empty();

          contentEl.createEl('h3', { text: 'Batch Convert Images' });
          contentEl.createEl('pre', { text: message });

          const buttonContainer = contentEl.createDiv('modal-button-container');

          const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
          cancelButton.onclick = () => {
            this.close();
            resolve(false);
          };

          const confirmButton = buttonContainer.createEl('button', {
            text: 'Convert',
            cls: 'mod-cta'
          });
          confirmButton.onclick = () => {
            this.close();
            resolve(true);
          };
        }

        onClose() {
          const { contentEl } = this;
          contentEl.empty();
        }
      })(this.app);

      modal.open();
    });
  }

  private isBatchConvertTarget(file: TFile): boolean {
    return this.settings.batchConvertExtensions.includes(file.extension.toLowerCase());
  }

  private async convertImage(imageFile: TFile): Promise<{ originalSize: number, convertedSize: number }> {
    const selectedPreset = this.getAutoConvertPreset();

    if (!selectedPreset) {
      throw new Error('No preset found');
    }

    // Read the original file
    const arrayBuffer = await this.app.vault.readBinary(imageFile);
    const blob = new Blob([arrayBuffer], { type: `image/${imageFile.extension}` });
    const file = new File([blob], imageFile.name, { type: blob.type });

    const result = await convertAndReplaceFile(
      this.app,
      imageFile,
      file,
      selectedPreset.encode,
      resolveSaveFolder(this.settings.save)
    );

    return {
      originalSize: result.originalSize,
      convertedSize: result.convertedSize
    };
  }

  // ===== Auto-Convert Events =====

  private registerAutoConvertEvents() {
    // Auto-convert is desktop-only (platform never changes at runtime)
    if (Platform.isMobile) return;

    this.registerEvent(
      this.app.workspace.on("editor-drop", async (evt: DragEvent, editor: Editor) => {
        // Check at event time so settings changes take effect without reload
        if (!this.settings.enableAutoConvert) return;

        if (!evt.dataTransfer) {
          console.warn("DataTransfer object is null. Cannot process drop event.");
          return;
        }

        // Get the actual drop position from the mouse event
        const pos = (editor as any).posAtMouse(evt);
        if (!pos) {
          console.warn("Could not determine drop position");
          return;
        }

        // Extract file data
        const fileData: { name: string, type: string, file: File }[] = [];
        for (let i = 0; i < evt.dataTransfer.files.length; i++) {
          const file = evt.dataTransfer.files[i];
          fileData.push({ name: file.name, type: file.type, file });
        }

        // Check if we should process these files
        const hasSupportedFiles = fileData.some(data => {
          return data.type.startsWith('image/') &&
            this.settings.batchConvertExtensions.some(ext =>
              data.name.toLowerCase().endsWith(`.${ext}`)
            );
        });

        if (hasSupportedFiles) {
          evt.preventDefault(); // Prevent default behavior
          await this.handleAutoConvert(fileData, editor, pos);
        }
      })
    );

    // Register paste event handler
    this.registerEvent(
      this.app.workspace.on("editor-paste", async (evt: ClipboardEvent, editor: Editor) => {
        // Check at event time so settings changes take effect without reload
        if (!this.settings.enableAutoConvert) return;

        if (!evt.clipboardData) {
          console.warn("ClipboardData object is null. Cannot process paste event.");
          return;
        }

        const cursor = editor.getCursor();

        // Extract clipboard item information
        const itemData: { kind: string, type: string, file: File | null }[] = [];
        for (let i = 0; i < evt.clipboardData.items.length; i++) {
          const item = evt.clipboardData.items[i];
          const file = item.kind === "file" ? item.getAsFile() : null;
          itemData.push({ kind: item.kind, type: item.type, file });
        }

        // Check if we should process these items
        const hasSupportedItems = itemData.some(data =>
          data.kind === "file" &&
          data.file &&
          data.type.startsWith('image/') &&
          this.settings.batchConvertExtensions.some(ext =>
            data.file!.name.toLowerCase().endsWith(`.${ext}`)
          )
        );

        if (hasSupportedItems) {
          evt.preventDefault();
          await this.handleAutoPaste(itemData, editor, cursor);
        }
      })
    );
  }

  private async handleAutoConvert(
    fileData: { name: string; type: string; file: File }[],
    editor: Editor,
    pos: any
  ) {
    // Filter supported image files
    const supportedFiles = fileData
      .filter(data => {
        return data.type.startsWith('image/') &&
          this.settings.batchConvertExtensions.some(ext =>
            data.name.toLowerCase().endsWith(`.${ext}`)
          );
      })
      .map(data => data.file);

    if (supportedFiles.length === 0) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file detected.');
      return;
    }

    // Get the selected preset for auto-conversion
    const selectedPreset = this.getAutoConvertPreset();

    if (!selectedPreset) {
      new Notice('❌ No preset found for auto-conversion');
      return;
    }

    // Process each file sequentially
    for (const file of supportedFiles) {
      try {
        const folder = resolveSaveFolder(this.settings.save);

        // Skip animated GIF
        if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
          if (await isAnimatedGif(file)) {
            if (!this.settings.processAnimatedGifs) {
              new Notice(`⚠️ Skipped animated GIF conversion: ${file.name}`);
              try {
                const savedPath = await saveOriginalFile(this.app, file, folder);
                const fileName = savedPath.split("/").pop()!;
                const markdownLink = `![[${fileName}]]`;
                editor.replaceRange(markdownLink, pos);
              } catch (err) {
                console.error("Failed to save original GIF:", err);
                new Notice(`❌ Failed to save original GIF: ${file.name}`);
              }
              continue;
            }
          }
        }

        const result = await saveImageAndInsert(
          this.app,
          file,
          selectedPreset.encode,
          folder
        );

        const fileName = result.path.split("/").pop()!;
        const markdownLink = `![[${fileName}]]`;

        // Insert link at drop position
        editor.replaceRange(markdownLink, pos);

        // Show success notification with preset info
        const originalKB = (result.originalSize / 1024).toFixed(2);
        const convertedKB = (result.convertedSize / 1024).toFixed(2);
        const ratio = (((result.originalSize - result.convertedSize) / result.originalSize) * 100).toFixed(1);
        new Notice(`✅ Auto-converted (${selectedPreset.name}): ${file.name} → ${originalKB}KB → ${convertedKB}KB (${ratio}% compressed)`);

      } catch (error) {
        console.error("Auto-conversion failed:", error);
        new Notice(`❌ Auto-conversion failed for ${file.name}`);
      }
    }
  }

  private async handleAutoPaste(
    itemData: { kind: string; type: string; file: File | null }[],
    editor: Editor,
    cursor: any
  ) {
    // Filter supported image files
    const supportedFiles = itemData
      .filter(data =>
        data.kind === "file" &&
        data.file &&
        data.type.startsWith('image/') &&
        this.settings.batchConvertExtensions.some(ext =>
          data.file!.name.toLowerCase().endsWith(`.${ext}`)
        )
      )
      .map(data => data.file!)
      .filter((file): file is File => file !== null);

    if (supportedFiles.length === 0) return;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('No active file detected.');
      return;
    }

    // Get the selected preset for auto-conversion
    const selectedPreset = this.getAutoConvertPreset();

    if (!selectedPreset) {
      new Notice('❌ No preset found for auto-conversion');
      return;
    }

    // Process each file sequentially
    for (const file of supportedFiles) {
      try {
        const folder = resolveSaveFolder(this.settings.save);

        // Skip animated GIF
        if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
          if (await isAnimatedGif(file)) {
            if (!this.settings.processAnimatedGifs) {
              new Notice(`⚠️ Skipped animated GIF conversion: ${file.name}`);
              try {
                const savedPath = await saveOriginalFile(this.app, file, folder);
                const fileName = savedPath.split("/").pop()!;
                const markdownLink = `![[${fileName}]]`;
                editor.replaceRange(markdownLink, cursor);
              } catch (err) {
                console.error("Failed to save original GIF:", err);
                new Notice(`❌ Failed to save original GIF: ${file.name}`);
              }
              continue;
            }
          }
        }

        const result = await saveImageAndInsert(
          this.app,
          file,
          selectedPreset.encode,
          folder
        );

        const fileName = result.path.split("/").pop()!;
        const markdownLink = `![[${fileName}]]`;

        // Insert link at cursor position
        editor.replaceRange(markdownLink, cursor);

        // Show success notification with preset info
        const originalKB = (result.originalSize / 1024).toFixed(2);
        const convertedKB = (result.convertedSize / 1024).toFixed(2);
        const ratio = (((result.originalSize - result.convertedSize) / result.originalSize) * 100).toFixed(1);
        new Notice(`✅ Auto-converted (${selectedPreset.name}): ${file.name} → ${originalKB}KB → ${convertedKB}KB (${ratio}% compressed)`);

      } catch (error) {
        console.error("Auto-conversion failed:", error);
        new Notice(`❌ Auto-conversion failed for ${file.name}`);
      }
    }
  }

}
