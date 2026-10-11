import { App, Notice, setIcon, TFile } from "obsidian";
import { EncodeSettings, PluginSettings } from "../settings";
import { embedLink, formatDateWithMoment, replaceExisting, ReplaceTarget, saveNew } from "../save/save";
import { resolveName } from "../save/name";
import { convert, convertBlob } from "../conversion/convert";
import { encoderFor } from "../conversion/encoders";
import { decode, DecodedImage } from "../conversion/decode";
import { analyze, estimateByHeuristic, estimateBySample, ImageStats, SizePrediction } from "../conversion/predict";
import { isAnimatedGif } from "../utils/gif-check";
import { DropZone } from "./components/drop-zone";
import { SettingsPanel } from "./components/settings-panel";
import { SaveFields } from "./components/save-fields";
import { canonicalFolder, displayFolder, planNewFile, planReplacement } from "./save-plan";
import { joinLinks, sizeChange } from "../entry/targets";
import { canAutoReadClipboard } from "./clipboard";

/** What the dialog converts, and for which note. */
export interface ConverterRequest {
    /** Note the links are for ("" when none): the attachment folder in the "obsidian" mode, {note}, link paths */
    sourcePath: string;
    /** File shown from the start; the user cannot pick others */
    initialFile?: File | null;
    /** Replace mode: the vault file whose content initialFile is */
    target?: TFile | null;
}

/** The window the body sits in (OverlayShell). */
export interface ConverterHost {
    close(): void;
}

/** {size} in the name example before anything is selected. */
const EXAMPLE_SIZE = 123456;

/** The single selected file, decoded once and reused by every prediction and the conversion. */
interface DecodeSource {
    file: File;
    /** null when decoding failed or the source was released before it finished */
    ready: Promise<{ decoded: DecodedImage; stats: ImageStats } | null>;
}

/**
 * Content of the converter dialog, independent of the window it is shown
 * in. The host calls build() once with its body element and dispose() when
 * it closes; the body asks the host to close after a conversion.
 *
 * The result (embed links of the saved images, separated by an empty line, or undefined)
 * is delivered exactly once, after the window closed.
 */
export class ConverterBody {
    private readonly sourcePath: string;
    private readonly initialFile: File | null;
    private readonly target: TFile | null;

    private selectedFiles: File[] = [];
    private converting = false;
    private cancelRequested = false;
    private closedFlag = false;
    private delivered = false;
    private result: string | undefined;

    private dropZone!: DropZone;
    private settingsPanel!: SettingsPanel;
    private saveFields!: SaveFields;
    private infoDiv!: HTMLElement;
    private progressContainer!: HTMLElement;
    private progressFill!: HTMLElement;
    private progressText!: HTMLElement;
    private convertBtn!: HTMLButtonElement;
    private pasteBtn: HTMLButtonElement | null = null;
    private importBtn: HTMLButtonElement | null = null;
    private predictionGeneration = 0;
    private decodeSource: DecodeSource | null = null;
    /** Latest size prediction of the single selected file, for the name example */
    private predictedSize: number | null = null;

    constructor(
        private readonly app: App,
        /** Read-only here: the panel edits its own copy of the encoding parameters */
        private readonly settings: PluginSettings,
        request: ConverterRequest,
        private readonly host: ConverterHost,
        private readonly onResult: (value?: string) => void
    ) {
        this.sourcePath = request.sourcePath;
        this.initialFile = request.initialFile ?? null;
        this.target = request.target ?? null;
    }

    /** Resolves the caller's promise exactly once. */
    private deliver(value?: string) {
        if (this.delivered) return;
        this.delivered = true;
        this.onResult(value);
    }

    build(bodyEl: HTMLElement) {
        this.settingsPanel = new SettingsPanel(
            this.settings.presets,
            this.settings.defaultPresetId,
            () => this.updatePrediction()
        );
        bodyEl.appendChild(this.settingsPanel.getElement());

        this.saveFields = this.createSaveFields();
        bodyEl.appendChild(this.saveFields.element);

        this.dropZone = new DropZone((files) => this.handleFilesSelect(files));

        if (!this.initialFile) {
            const sourceBtnRow = bodyEl.createDiv({ cls: "wasm-image-drop-zone__buttons" });
            sourceBtnRow.style.marginTop = "15px";
            this.pasteBtn = this.createSourceButton(sourceBtnRow, "clipboard-paste", " Paste from Clipboard", () => this.dropZone.handleClipboardPaste());
            this.importBtn = this.createSourceButton(sourceBtnRow, "download", " Import from system", () => this.dropZone.triggerFileInput());
        } else {
            this.dropZone.setDisabled(true);
        }

        this.dropZone.getElement().style.marginTop = this.initialFile ? "15px" : "8px";
        bodyEl.appendChild(this.dropZone.getElement());

        // Info line (file name, size prediction)
        this.infoDiv = bodyEl.createDiv({ cls: "wasm-image-preview__info" });
        this.infoDiv.style.margin = "10px 0";
        this.infoDiv.style.textAlign = "center";

        // Progress bar (shown for several files)
        this.progressContainer = bodyEl.createDiv({ cls: "wasm-image-progress" });
        this.progressContainer.style.display = "none";
        const progressBar = this.progressContainer.createDiv({ cls: "wasm-image-progress__bar" });
        this.progressFill = progressBar.createDiv({ cls: "wasm-image-progress__fill" });
        this.progressText = this.progressContainer.createDiv({ cls: "wasm-image-progress__text" });

        const btnRow = bodyEl.createDiv({ cls: "wasm-image-modal__btn-row" });
        btnRow.style.justifyContent = "center";
        this.convertBtn = btnRow.createEl("button", { cls: "wasm-image-modal__btn mod-cta" });
        this.convertBtn.style.width = "100%";
        this.convertBtn.style.justifyContent = "center";
        this.convertBtn.addEventListener("click", () => this.runConversion());
        this.updateConvertButton();

        this.updateExample();

        if (this.initialFile) {
            this.handleFilesSelect([this.initialFile]);
            this.dropZone.showPreview(this.initialFile);
        } else if (this.settings.autoReadClipboard && canAutoReadClipboard()) {
            this.autoReadClipboard();
        }
    }

    /** The host closed: stop or deliver, and release what the body holds. */
    dispose() {
        this.closedFlag = true;
        this.dropZone?.dispose();
        if (this.converting) {
            // The conversion notices this, stops after the current file,
            // releases the decode and delivers the links converted so far.
            this.cancelRequested = true;
        } else {
            this.releaseDecodeSource();
            this.deliver(this.result);
        }
    }

    private createSourceButton(row: HTMLElement, icon: string, text: string, onClick: () => void): HTMLButtonElement {
        const btn = row.createEl("button", { cls: "wasm-image-modal__btn wasm-image-drop-zone__btn" });
        btn.style.flex = "1";
        btn.onclick = onClick;
        setIcon(btn.createSpan({ cls: "wasm-image-modal__btn-icon" }), icon);
        btn.createSpan({ text });
        return btn;
    }

    /**
     * Initial values: the replaced file's own name and folder, or the name
     * template and the configured fixed folder. In the "obsidian" mode the
     * folder field stays empty: getAvailablePathForAttachment decides the
     * folder when saving, which also lets attachment plugins take part.
     */
    private createSaveFields(): SaveFields {
        const onChange = () => this.updateExample();
        if (this.target) {
            return new SaveFields(this.app, this.target.basename, displayFolder(this.target.parent?.path ?? ""), "", onChange);
        }
        const { destination, nameTemplate } = this.settings.save;
        const folder = destination.mode === "folder" ? displayFolder(destination.folder) : "";
        return new SaveFields(this.app, nameTemplate, folder, "Obsidian's attachment folder", onChange);
    }

    private setInputsDisabled(disabled: boolean) {
        if (this.pasteBtn) this.pasteBtn.disabled = disabled;
        if (this.importBtn) this.importBtn.disabled = disabled;
        this.convertBtn.disabled = disabled;
        this.saveFields.setDisabled(disabled);
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
        this.predictedSize = null;
        this.updateConvertButton();
        this.updatePrediction();
    }

    private updateConvertButton() {
        const count = this.selectedFiles.length;
        this.convertBtn.disabled = count === 0;
        if (this.target) {
            this.convertBtn.textContent = "Convert";
        } else if (count > 1) {
            this.convertBtn.textContent = `Convert & Insert (${count} images)`;
        } else {
            this.convertBtn.textContent = "Convert & Insert";
        }
    }

    /**
     * Base name of a converted file. The replaced file keeps its own unless
     * the name field was changed; otherwise the field is a name template.
     */
    private basenameFor(originalName: string | undefined, sizeBytes: number, date = new Date()): string {
        const fields = this.saveFields.values();
        let template: string;
        if (this.target) {
            const plan = planReplacement(fields, { folder: this.targetFolder() });
            if (plan?.nameTemplate == null) return this.target.basename;
            template = plan.nameTemplate;
        } else {
            template = planNewFile(fields, this.settings.save).nameTemplate;
        }
        return resolveName(template, { original: originalName, note: this.sourcePath || undefined, date, sizeBytes }, formatDateWithMoment);
    }

    private targetFolder(): string {
        return canonicalFolder(this.target?.parent?.path ?? "") ?? "";
    }

    /**
     * The expanded name under the name field. {size} uses the size
     * prediction when there is one, else the source size, else a sample
     * value; the date is now. Saving expands the name again with the real size.
     */
    private updateExample() {
        const extension = encoderFor(this.settingsPanel.getEncode().format).extension;
        const file = this.selectedFiles[0];
        const size = this.predictedSize ?? file?.size ?? EXAMPLE_SIZE;
        const name = `${this.basenameFor(file?.name ?? "image.png", size)}.${extension}`;
        const more = this.selectedFiles.length > 1 ? `, and likewise for the other ${this.selectedFiles.length - 1}` : "";
        this.saveFields.setExample(`Example: ${name}${more}`);
    }

    private async updatePrediction() {
        const generation = ++this.predictionGeneration;
        this.updateExample();

        if (this.selectedFiles.length !== 1) {
            this.releaseDecodeSource();
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

        const source = await this.loadDecodeSource(file);
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
    private loadDecodeSource(file: File): DecodeSource["ready"] {
        if (this.decodeSource?.file === file) return this.decodeSource.ready;
        this.releaseDecodeSource();

        const source: DecodeSource = {
            file,
            ready: decode(file).then(
                decoded => {
                    if (this.decodeSource !== source) {
                        // Released (other selection, window closed) while decoding
                        decoded.close();
                        return null;
                    }
                    return { decoded, stats: analyze(decoded) };
                },
                error => {
                    console.warn("Failed to decode image:", error);
                    return null;
                }
            ),
        };
        this.decodeSource = source;
        return source.ready;
    }

    /** Closes the decoded image of the current source. */
    private releaseDecodeSource() {
        const source = this.decodeSource;
        if (!source) return;
        this.decodeSource = null;
        source.ready.then(result => result?.decoded.close());
    }

    /** Converts with the decode the prediction holds when it is of `file`; decodes anew otherwise. */
    private async convertFile(file: File, encode: EncodeSettings): Promise<Blob> {
        if (this.decodeSource?.file === file) {
            const source = await this.decodeSource.ready;
            if (source) return convert(source.decoded, encode);
        }
        return convertBlob(file, encode);
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
            this.predictedSize = prediction.predictedSize;
            this.updateExample();
        }
    }

    private async runConversion() {
        if (this.selectedFiles.length === 0 || this.converting) return;
        this.converting = true;
        this.setInputsDisabled(true);

        try {
            const encode = this.settingsPanel.getEncode();

            if (this.target) {
                await this.runReplaceConversion(this.target, encode);
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
        } finally {
            // dispose() left the decode alone while the conversion used it
            if (this.closedFlag) this.releaseDecodeSource();
        }
    }

    /**
     * Replace mode (file menu): overwrites the target. Unchanged fields keep
     * its name and folder; edited ones move or rename it.
     */
    private async runReplaceConversion(target: TFile, encode: EncodeSettings) {
        const file = this.selectedFiles[0];
        this.convertBtn.textContent = "Converting...";

        const blob = await this.convertFile(file, encode);
        const plan = planReplacement(this.saveFields.values(), { folder: this.targetFolder() });
        const destination: ReplaceTarget | undefined = plan
            ? { folder: plan.folder, basename: this.basenameFor(target.name, blob.size) }
            : undefined;
        const result = await replaceExisting(this.app, target, blob, encoderFor(encode.format).extension, destination);

        new Notice(`✅ Image replaced: ${result.file.path}\n${sizeChange(result.originalSize, result.convertedSize)}`);

        this.converting = false;
        this.result = embedLink(this.app, result.file, this.sourcePath);
        if (this.cancelRequested) {
            // Closed mid-conversion; the file was replaced anyway, so hand
            // the link back to the caller.
            this.deliver(this.result);
        } else {
            this.host.close();
        }
    }

    /** Insert mode: converts each selected file into a new file. */
    private async runInsertConversion(encode: EncodeSettings) {
        const extension = encoderFor(encode.format).extension;
        const plan = planNewFile(this.saveFields.values(), this.settings.save);
        const links: string[] = [];
        const errors: string[] = [];
        let totalOriginalSize = 0;
        let totalConvertedSize = 0;
        const total = this.selectedFiles.length;

        if (total > 1) {
            this.progressContainer.style.display = "block";
        }

        for (let i = 0; i < this.selectedFiles.length; i++) {
            // Closed by the user: stop before starting the next file
            if (this.cancelRequested) break;

            const file = this.selectedFiles[i];
            if (total > 1) {
                this.progressFill.style.width = `${(i / total) * 100}%`;
                this.progressText.textContent = `Converting ${i + 1}/${total}: ${file.name}`;
            } else {
                this.convertBtn.textContent = "Converting...";
            }

            try {
                const blob = await this.convertFile(file, encode);
                const saved = await saveNew(this.app, blob, extension, {
                    ...plan,
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
            this.deliver(links.length > 0 ? joinLinks(links) : undefined);
            return;
        }

        if (total > 1) {
            this.progressFill.style.width = "100%";
            this.progressText.textContent = "Done!";
        }

        if (links.length > 0) {
            const sizes = sizeChange(totalOriginalSize, totalConvertedSize);
            if (total === 1) {
                new Notice(`✅ Image converted: ${sizes}`);
            } else {
                new Notice(`✅ ${links.length} images converted: ${sizes}`);
            }
            if (errors.length > 0) {
                new Notice(`❌ Failed to convert: ${errors.join(", ")}`);
            }

            this.result = joinLinks(links);
            this.host.close();
        } else {
            new Notice("❌ All conversions failed");
            this.setInputsDisabled(false);
            this.updateConvertButton();
            this.progressContainer.style.display = "none";
        }
    }

    private async autoReadClipboard() {
        try {
            const items = await navigator.clipboard.read();
            if (this.closedFlag) return;
            for (const it of items) {
                for (const t of it.types) {
                    if (t.startsWith("image/")) {
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
