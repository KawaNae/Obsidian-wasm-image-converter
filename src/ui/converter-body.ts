import { App, Modal, Notice, setIcon, TFile } from "obsidian";
import { EncodeSettings, PluginSettings, SaveSettings } from "../settings";
import { embedLink, replaceExisting, saveNew } from "../save/save";
import { convertBlob } from "../conversion/convert";
import { encoderFor } from "../conversion/encoders";
import { decode, DecodedImage } from "../conversion/decode";
import { analyze, estimateByHeuristic, estimateBySample, ImageStats, SizePrediction } from "../conversion/predict";

import { isAnimatedGif } from "../utils/gif-check";
import { DropZone } from "./components/drop-zone";
import { SettingsPanel } from "./components/settings-panel";

/**
 * @param sourcePath - note the links are for ("" when none): decides the
 *   attachment folder in the "obsidian" mode, {note} and the link paths
 */
export async function openImageConverterModal(app: App, settings: PluginSettings, sourcePath: string, initialFile: File | null = null, targetTFile: TFile | null = null): Promise<string | undefined> {
    return new Promise((resolve) => {
        new ImageConverterModal(app, settings, sourcePath, initialFile, targetTFile, resolve).open();
    });
}

/** Save destination as shown in the dialog. */
function describeDestination(save: SaveSettings, targetTFile: TFile | null): string {
    if (targetTFile) return `${targetTFile.parent?.path ?? "/"} (in place)`;
    if (save.destination.mode === "obsidian") return "Obsidian's attachment folder";
    return `${save.destination.folder.replace(/\/+$/, "")}/`;
}

/** The single selected file, decoded once and reused by every prediction. */
interface PredictionSource {
    file: File;
    /** null when decoding failed or the source was released before it finished */
    ready: Promise<{ decoded: DecodedImage; stats: ImageStats } | null>;
}

class ImageConverterModal extends Modal {
    private settings: PluginSettings;
    private sourcePath: string;
    private initialFile: File | null;
    private targetTFile: TFile | null;
    private onResult: (value?: string) => void;

    private selectedFiles: File[] = [];
    private converting = false;
    private cancelRequested = false;
    private closedFlag = false;
    private delivered = false;
    private result: string | undefined;

    private dropZone!: DropZone;
    private settingsPanel!: SettingsPanel;
    private infoDiv!: HTMLElement;
    private progressContainer!: HTMLElement;
    private progressFill!: HTMLElement;
    private progressText!: HTMLElement;
    private convertBtn!: HTMLButtonElement;
    private pasteBtn!: HTMLButtonElement;
    private importBtn!: HTMLButtonElement;
    private predictionGeneration = 0;
    private predictionSource: PredictionSource | null = null;

    constructor(app: App, settings: PluginSettings, sourcePath: string, initialFile: File | null, targetTFile: TFile | null, onResult: (value?: string) => void) {
        super(app);
        // Read-only here: the panel edits its own copy of the encoding parameters
        this.settings = settings;
        this.sourcePath = sourcePath;
        this.initialFile = initialFile;
        this.targetTFile = targetTFile;
        this.onResult = onResult;
    }

    /** Resolves the caller's promise exactly once. */
    private deliver(value?: string) {
        if (this.delivered) return;
        this.delivered = true;
        this.onResult(value);
    }

    onOpen() {
        this.modalEl.addClass("wasm-image-modal");
        this.titleEl.setText("Image Converter");
        const { contentEl } = this;
        contentEl.empty();

        // Info line (file name, size prediction)
        this.infoDiv = document.createElement("div");
        this.infoDiv.className = "wasm-image-preview__info";
        this.infoDiv.style.marginTop = "10px";
        this.infoDiv.style.marginBottom = "10px";
        this.infoDiv.style.textAlign = "center";

        // Progress bar (hidden by default)
        this.progressContainer = document.createElement("div");
        this.progressContainer.className = "wasm-image-progress";
        this.progressContainer.style.display = "none";
        const progressBar = document.createElement("div");
        progressBar.className = "wasm-image-progress__bar";
        this.progressFill = document.createElement("div");
        this.progressFill.className = "wasm-image-progress__fill";
        progressBar.appendChild(this.progressFill);
        this.progressText = document.createElement("div");
        this.progressText.className = "wasm-image-progress__text";
        this.progressContainer.appendChild(progressBar);
        this.progressContainer.appendChild(this.progressText);

        this.dropZone = new DropZone((files) => this.handleFilesSelect(files));

        // Source buttons (Paste / Import)
        const sourceBtnRow = document.createElement("div");
        sourceBtnRow.className = "wasm-image-drop-zone__buttons";
        sourceBtnRow.style.marginTop = "15px";
        sourceBtnRow.style.marginBottom = "0px";

        this.pasteBtn = document.createElement("button");
        this.pasteBtn.className = "wasm-image-modal__btn wasm-image-drop-zone__btn";
        this.pasteBtn.style.flex = "1";
        this.pasteBtn.onclick = () => this.dropZone.handleClipboardPaste();
        const pasteIcon = document.createElement("span");
        pasteIcon.className = "wasm-image-modal__btn-icon";
        setIcon(pasteIcon, "clipboard-paste");
        const pasteText = document.createElement("span");
        pasteText.textContent = " Paste from Clipboard";
        this.pasteBtn.appendChild(pasteIcon);
        this.pasteBtn.appendChild(pasteText);

        this.importBtn = document.createElement("button");
        this.importBtn.className = "wasm-image-modal__btn wasm-image-drop-zone__btn";
        this.importBtn.style.flex = "1";
        this.importBtn.onclick = () => this.dropZone.triggerFileInput();
        const importIcon = document.createElement("span");
        importIcon.className = "wasm-image-modal__btn-icon";
        setIcon(importIcon, "download");
        const importText = document.createElement("span");
        importText.textContent = " Import from system";
        this.importBtn.appendChild(importIcon);
        this.importBtn.appendChild(importText);

        sourceBtnRow.appendChild(this.pasteBtn);
        sourceBtnRow.appendChild(this.importBtn);

        this.settingsPanel = new SettingsPanel(
            this.settings.presets,
            this.settings.defaultPresetId,
            describeDestination(this.settings.save, this.targetTFile),
            () => this.updatePrediction()
        );

        // ===== Layout assembly (vertical stack) =====
        contentEl.appendChild(this.settingsPanel.getElement());

        if (!this.initialFile) {
            contentEl.appendChild(sourceBtnRow);
        } else {
            this.dropZone.setDisabled(true);
        }

        this.dropZone.getElement().style.marginTop = this.initialFile ? "15px" : "8px";
        contentEl.appendChild(this.dropZone.getElement());

        contentEl.appendChild(this.infoDiv);
        contentEl.appendChild(this.progressContainer);

        const btnRow = document.createElement("div");
        btnRow.className = "wasm-image-modal__btn-row";
        btnRow.style.justifyContent = "center";
        this.convertBtn = document.createElement("button");
        this.convertBtn.textContent = this.targetTFile ? "Convert" : "Convert & Insert";
        this.convertBtn.className = "wasm-image-modal__btn mod-cta";
        this.convertBtn.style.width = "100%";
        this.convertBtn.style.justifyContent = "center";
        this.convertBtn.disabled = true;
        this.convertBtn.addEventListener("click", () => this.runConversion());
        btnRow.appendChild(this.convertBtn);
        contentEl.appendChild(btnRow);

        // Initialize with file if provided
        if (this.initialFile) {
            this.handleFilesSelect([this.initialFile]);
            this.dropZone.showPreview(this.initialFile);
        }

        // Auto read clipboard (only if no initial file)
        if (this.settings.autoReadClipboard && !this.initialFile) {
            this.autoReadClipboard();
        }
    }

    onClose() {
        this.closedFlag = true;
        this.releasePredictionSource();
        this.dropZone?.dispose();
        this.contentEl.empty();
        if (this.converting) {
            // The conversion loop notices this, stops after the current file
            // and delivers the links converted so far.
            this.cancelRequested = true;
        } else {
            this.deliver(this.result);
        }
    }

    private setInputsDisabled(disabled: boolean) {
        this.pasteBtn.disabled = disabled;
        this.importBtn.disabled = disabled;
        this.convertBtn.disabled = disabled;
        if (!this.initialFile) {
            this.dropZone.setDisabled(disabled);
        }
    }

    private async handleFilesSelect(files: File[]) {
        // Ignore new inputs while a conversion is running (they would
        // swap selectedFiles out from under the conversion loop)
        if (this.converting || this.closedFlag) return;

        const validFiles = files.filter(f => f.type.startsWith("image/"));
        if (validFiles.length === 0) {
            new Notice("❌ Please select valid image files");
            return;
        }

        for (const file of validFiles) {
            if (file.type === 'image/gif' && await isAnimatedGif(file)) {
                new Notice("⚠️ Animated GIF detected. Conversion will result in a static image (first frame only).");
                break;
            }
        }

        this.selectedFiles = validFiles;
        this.updateConvertButton();
        this.updatePrediction();
    }

    private updateConvertButton() {
        if (this.selectedFiles.length === 0) {
            this.convertBtn.disabled = true;
            this.convertBtn.textContent = this.targetTFile ? "Convert" : "Convert & Insert";
        } else if (this.targetTFile) {
            this.convertBtn.disabled = false;
            this.convertBtn.textContent = "Convert";
        } else if (this.selectedFiles.length === 1) {
            this.convertBtn.disabled = false;
            this.convertBtn.textContent = "Convert & Insert";
        } else {
            this.convertBtn.disabled = false;
            this.convertBtn.textContent = `Convert & Insert (${this.selectedFiles.length} images)`;
        }
    }

    private async updatePrediction() {
        const generation = ++this.predictionGeneration;

        if (this.selectedFiles.length !== 1) {
            this.releasePredictionSource();
            if (this.selectedFiles.length === 0) {
                this.infoDiv.textContent = "";
            } else {
                const totalSizeKB = (this.selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1);
                this.infoDiv.textContent = `${this.selectedFiles.length} images selected (${totalSizeKB}kB total)`;
            }
            return;
        }

        const file = this.selectedFiles[0];
        const encode = this.settingsPanel.getEncode();

        const source = await this.loadPredictionSource(file);
        if (generation !== this.predictionGeneration) return;
        if (!source) {
            this.renderPredictionLine(file, null, false);
            return;
        }

        // Phase 1: instant heuristic estimate
        const heuristic = estimateByHeuristic(source.stats, encode);

        if (!this.settings.enableSampledPrediction) {
            this.renderPredictionLine(file, heuristic, false);
            return;
        }

        // Two-phase mode: show the heuristic with a spinner immediately,
        // then replace with the sampled result. A minimum display time of
        // 300ms prevents the spinner from flickering too fast to read.
        this.renderPredictionLine(file, heuristic, true);
        const shownAt = performance.now();
        // The sample encode blocks the main thread; let the heuristic paint first
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        if (generation !== this.predictionGeneration) return;

        const refined = await estimateBySample(source.decoded, encode);
        if (generation !== this.predictionGeneration) return;

        const elapsed = performance.now() - shownAt;
        if (elapsed < 300) {
            await new Promise(r => setTimeout(r, 300 - elapsed));
            if (generation !== this.predictionGeneration) return;
        }

        this.renderPredictionLine(file, refined ?? heuristic, false);
    }

    /** Decodes `file` once; later calls for the same file share the result. */
    private loadPredictionSource(file: File): PredictionSource["ready"] {
        if (this.predictionSource?.file === file) return this.predictionSource.ready;
        this.releasePredictionSource();

        const source: PredictionSource = {
            file,
            ready: decode(file).then(
                decoded => {
                    if (this.predictionSource !== source) {
                        // Released (other selection, modal closed) while decoding
                        decoded.close();
                        return null;
                    }
                    return { decoded, stats: analyze(decoded) };
                },
                error => {
                    console.warn("Failed to decode image for size prediction:", error);
                    return null;
                }
            ),
        };
        this.predictionSource = source;
        return source.ready;
    }

    /** Closes the decoded image of the current prediction source. */
    private releasePredictionSource() {
        const source = this.predictionSource;
        if (!source) return;
        this.predictionSource = null;
        source.ready.then(result => result?.decoded.close());
    }

    /**
     * @param loading - when true, shows a spinner and uses a rounded
     *   approximate value to signal "still refining"
     */
    private renderPredictionLine(file: File, prediction: SizePrediction | null, loading: boolean) {
        const originalKB = (file.size / 1024).toFixed(1);
        this.infoDiv.textContent = '';
        this.infoDiv.appendChild(document.createTextNode(`${file.name}: ${originalKB}kB`));
        if (prediction) {
            const predictedKB = loading
                ? `~${Math.round(prediction.predictedSize / 1024)}`
                : (prediction.predictedSize / 1024).toFixed(1);
            const delta = Math.round((prediction.predictedSize - file.size) / file.size * 100);
            const deltaText = delta <= 0 ? `-${-delta}%` : `+${delta}%`;
            const span = document.createElement('span');
            span.style.color = loading ? 'var(--text-muted)' : 'var(--text-accent)';
            span.textContent = ` → Expected: ${predictedKB}kB (${deltaText})`;
            this.infoDiv.appendChild(span);
            if (loading) {
                const spinner = document.createElement('span');
                spinner.className = 'wasm-image-prediction-spinner';
                this.infoDiv.appendChild(spinner);
            }
        }
    }

    private async runConversion() {
        if (this.selectedFiles.length === 0 || this.converting) return;
        this.converting = true;
        this.setInputsDisabled(true);

        try {
            const encode = this.settingsPanel.getEncode();

            if (this.targetTFile) {
                await this.runReplaceConversion(encode);
            } else {
                await this.runInsertConversion(encode);
            }
        } catch (error) {
            console.error("Image conversion failed:", error);
            new Notice("❌ Image conversion failed");
            this.converting = false;
            if (this.cancelRequested) {
                this.deliver(undefined);
            } else {
                this.setInputsDisabled(false);
                this.updateConvertButton();
                this.progressContainer.style.display = "none";
            }
        }
    }

    /** Replace mode (context menu) - single file, overwrites targetTFile. */
    private async runReplaceConversion(encode: EncodeSettings) {
        const file = this.selectedFiles[0];
        this.convertBtn.textContent = "Converting...";

        const blob = await convertBlob(file, encode);
        const result = await replaceExisting(this.app, this.targetTFile!, blob, encoderFor(encode.format).extension);

        const originalKB = (result.originalSize / 1024).toFixed(2);
        const convertedKB = (result.convertedSize / 1024).toFixed(2);
        const ratio = (((result.originalSize - result.convertedSize) / result.originalSize) * 100).toFixed(1);
        new Notice(`✅ Image replaced: ${result.file.path}\n${originalKB}KB → ${convertedKB}KB (${ratio}% compressed)`);

        this.converting = false;
        this.result = embedLink(this.app, result.file, this.sourcePath);
        if (this.cancelRequested) {
            // Modal already closed mid-conversion; the file was replaced
            // anyway, so hand the link back to the caller.
            this.deliver(this.result);
        } else {
            this.close();
        }
    }

    /** Insert mode - converts each selected file into a new file. */
    private async runInsertConversion(encode: EncodeSettings) {
        const extension = encoderFor(encode.format).extension;
        const links: string[] = [];
        const errors: string[] = [];
        let totalOriginalSize = 0;
        let totalConvertedSize = 0;
        const total = this.selectedFiles.length;

        if (total > 1) {
            this.progressContainer.style.display = "block";
        }

        for (let i = 0; i < this.selectedFiles.length; i++) {
            // User closed the modal: stop before starting the next file
            if (this.cancelRequested) break;

            const file = this.selectedFiles[i];
            if (total > 1) {
                this.progressFill.style.width = `${(i / total) * 100}%`;
                this.progressText.textContent = `Converting ${i + 1}/${total}: ${file.name}`;
            } else {
                this.convertBtn.textContent = "Converting...";
            }

            try {
                const blob = await convertBlob(file, encode);
                const saved = await saveNew(this.app, blob, extension, {
                    ...this.settings.save,
                    sourcePath: this.sourcePath,
                    originalName: file.name,
                });

                links.push(embedLink(this.app, saved, this.sourcePath));
                totalOriginalSize += file.size;
                totalConvertedSize += blob.size;
            } catch (error) {
                console.error(`Failed to convert ${file.name}:`, error);
                errors.push(file.name);
            }
        }

        this.converting = false;

        if (this.cancelRequested) {
            // Deliver whatever finished before the cancel; already-written
            // files stay in the vault and their links still get inserted.
            new Notice(`⚠️ Conversion cancelled: ${links.length}/${total} images converted`);
            this.deliver(links.length > 0 ? links.join("\n") : undefined);
            return;
        }

        if (total > 1) {
            this.progressFill.style.width = "100%";
            this.progressText.textContent = "Done!";
        }

        if (links.length > 0) {
            const originalKB = (totalOriginalSize / 1024).toFixed(2);
            const convertedKB = (totalConvertedSize / 1024).toFixed(2);
            const ratio = totalOriginalSize > 0
                ? (((totalOriginalSize - totalConvertedSize) / totalOriginalSize) * 100).toFixed(1)
                : "0";

            if (total === 1) {
                new Notice(`✅ Image converted: ${originalKB}KB → ${convertedKB}KB (${ratio}% compressed)`);
            } else {
                new Notice(`✅ ${links.length} images converted: ${originalKB}KB → ${convertedKB}KB (${ratio}% compressed)`);
            }
            if (errors.length > 0) {
                new Notice(`❌ Failed to convert: ${errors.join(", ")}`);
            }

            this.result = links.join("\n");
            this.close();
        } else {
            new Notice("❌ All conversions failed");
            this.setInputsDisabled(false);
            this.updateConvertButton();
            this.progressContainer.style.display = "none";
        }
    }

    private async autoReadClipboard() {
        try {
            // @ts-ignore
            const items = await navigator.clipboard.read();
            if (this.closedFlag) return;
            for (const it of items) {
                // @ts-ignore
                for (const t of it.types) {
                    if (t.startsWith("image/")) {
                        // @ts-ignore
                        const blob = await it.getType(t);
                        if (this.closedFlag) return;
                        const file = new File([blob], `clipboard-${Date.now()}.${t.split("/")[1]}`, { type: t });
                        this.handleFilesSelect([file]);
                        this.dropZone.showPreview(file);
                        new Notice("✅ Clipboard image detected");
                        return;
                    }
                }
            }
        } catch (err) {
            // Silent fail
        }
    }
}
