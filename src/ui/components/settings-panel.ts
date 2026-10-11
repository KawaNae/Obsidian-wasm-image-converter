import { ToggleComponent } from "obsidian";
import { EncodeSettings, ImageFormat, Preset, cloneEncode, encodeEquals, presetLabel, resolvePreset } from "../../settings";
import { ENCODER_LIST, encoderFor } from "../../conversion/encoders";
import { listenFormEnter } from "./form-enter";

/**
 * The encoding inputs of the converter dialog. Choosing a preset loads its
 * values; changing a value afterwards keeps the preset selected and marks it
 * "(modified)" until the values equal the preset's again. An Enter in a
 * number field takes the value typed in it, then submits the dialog.
 *
 * Grayscale and Resize are Obsidian's toggles. The largest width and
 * height share one row, "Max size", shown while Resize is on.
 */
export class SettingsPanel {
    element: HTMLDivElement;
    private presets: Preset[];
    private defaultPresetId: string;
    /** Preset whose values were loaded last */
    private selectedPresetId: string;
    /** Working copy edited by the inputs; presets themselves are never mutated. */
    private encode: EncodeSettings;
    private onChange: () => void;
    private onSubmit: () => void;

    private presetSelect!: HTMLSelectElement;
    private formatSelect!: HTMLSelectElement;
    private qualityInput!: HTMLInputElement;
    private qualityRow!: HTMLDivElement;
    private resizeToggle!: ToggleComponent;
    private sizeRow!: HTMLDivElement;
    private maxWInput!: HTMLInputElement;
    private maxHInput!: HTMLInputElement;
    private grayscaleToggle!: ToggleComponent;
    /** A preset's values are being loaded into the inputs: their callbacks stay quiet */
    private loading = false;

    /**
     * @param presets - presets to choose from
     * @param defaultPresetId - preset selected initially
     * @param onSubmit - an Enter in a number field: convert, as the button does
     */
    constructor(presets: Preset[], defaultPresetId: string, onChange: () => void, onSubmit: () => void) {
        this.presets = presets;
        const initial = resolvePreset({ presets, defaultPresetId }, defaultPresetId);
        this.defaultPresetId = initial?.id ?? defaultPresetId;
        this.selectedPresetId = this.defaultPresetId;
        this.encode = cloneEncode(initial?.encode ?? presets[0].encode);
        this.onChange = onChange;
        this.onSubmit = onSubmit;
        this.element = document.createElement("div");
        this.render();
    }

    private render() {
        this.element.className = "wasm-image-modal__right-col";

        // Preset (the default preset first, then the others in order)
        this.presetSelect = this.createSelect("Preset:", (val) => this.handlePresetChange(val));
        const ordered = [
            ...this.presets.filter(p => p.id === this.defaultPresetId),
            ...this.presets.filter(p => p.id !== this.defaultPresetId),
        ];
        ordered.forEach(preset => {
            const option = document.createElement("option");
            option.value = preset.id;
            option.textContent = preset.name;
            this.presetSelect.appendChild(option);
        });
        this.presetSelect.value = this.defaultPresetId;

        // Format
        this.formatSelect = this.createSelect("Converter:", (val) => {
            this.encode.format = val as ImageFormat;
            this.updateQualityState();
            this.notifyChange();
        });
        ENCODER_LIST.forEach(encoder => {
            const opt = document.createElement("option");
            opt.value = encoder.format;
            opt.textContent = encoder.label;
            this.formatSelect.appendChild(opt);
        });
        this.formatSelect.value = this.encode.format;

        // Quality (disabled for PNG since it's lossless)
        this.qualityInput = this.createNumberInput("Quality:", 0.1, 1.0, 0.1, this.encode.quality, (val) => {
            this.encode.quality = val;
            this.notifyChange();
        });
        // Store the quality row for toggling visibility
        this.qualityRow = this.qualityInput.parentElement as HTMLDivElement;

        // Grayscale
        this.grayscaleToggle = this.createToggle("Grayscale", this.encode.grayscale, (on) => {
            this.encode.grayscale = on;
            this.notifyChange();
        });

        // Resize, and the largest size while it is on
        this.resizeToggle = this.createToggle("Resize", this.encode.resize.enabled, (on) => {
            this.encode.resize.enabled = on;
            this.updateSizeRow();
            this.notifyChange();
        });
        this.createSizeRow();
        this.updateSizeRow();

        // Set initial quality state based on format
        this.updateQualityState();
    }

    /** Disable quality input for lossless formats (PNG) */
    private updateQualityState() {
        const isLossless = !encoderFor(this.encode.format).lossy;
        this.qualityInput.disabled = isLossless;
        this.qualityRow?.toggleClass("wasm-image-modal__setting-row--disabled", isLossless);
    }

    private createSelect(label: string, onChange: (val: string) => void): HTMLSelectElement {
        const row = document.createElement("div");
        row.className = "wasm-image-modal__setting-row";

        const lbl = document.createElement("label");
        lbl.className = "wasm-image-modal__setting-label";
        lbl.textContent = label;

        // "dropdown" gives Obsidian's look, with its chevron
        const select = document.createElement("select");
        select.className = "dropdown wasm-image-modal__setting-control";
        select.addEventListener("change", () => onChange(select.value));

        row.appendChild(lbl);
        row.appendChild(select);
        this.element.appendChild(row);
        return select;
    }

    private createRow(label: string): HTMLDivElement {
        const row = this.element.createDiv({ cls: "wasm-image-modal__setting-row" });
        row.createEl("label", { cls: "wasm-image-modal__setting-label", text: label });
        return row;
    }

    private createNumberInput(label: string, min: number, max: number, step: number, initial: number, onChange: (val: number) => void): HTMLInputElement {
        const row = this.createRow(label);
        const input = this.createNumberField(row, min, max, step, initial, onChange);
        input.addClass("wasm-image-modal__setting-control");
        return input;
    }

    private createNumberField(parent: HTMLElement, min: number, max: number, step: number, initial: number, onChange: (val: number) => void): HTMLInputElement {
        const input = parent.createEl("input", { type: "number" });
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(initial);

        // The value is taken on "change", which an Enter does not fire
        // before its keydown: the Enter takes the value typed so far itself.
        const take = () => onChange(parseFloat(input.value) || 0);
        input.addEventListener("change", take);
        listenFormEnter(input, () => {
            take();
            this.onSubmit();
        });
        return input;
    }

    /** "Max size: [1920] × [1080]": the width and the height side by side, at any width. */
    private createSizeRow() {
        this.sizeRow = this.createRow("Max size:");
        this.sizeRow.addClass("wasm-image-modal__setting-row--size");
        const fields = this.sizeRow.createDiv({ cls: "wasm-image-modal__setting-control wasm-image-modal__size" });
        const take = (val: number) => Number.isFinite(val) && val >= 1 ? Math.round(val) : 1;

        this.maxWInput = this.createNumberField(fields, 100, 5000, 1, this.encode.resize.maxWidth, (val) => {
            const clamped = take(val);
            this.maxWInput.value = String(clamped);
            this.encode.resize.maxWidth = clamped;
            this.notifyChange();
        });
        this.maxWInput.placeholder = "1920";
        this.maxWInput.setAttribute("aria-label", "Max width");

        fields.createSpan({ cls: "wasm-image-modal__size-x", text: "×" });

        this.maxHInput = this.createNumberField(fields, 100, 5000, 1, this.encode.resize.maxHeight, (val) => {
            const clamped = take(val);
            this.maxHInput.value = String(clamped);
            this.encode.resize.maxHeight = clamped;
            this.notifyChange();
        });
        this.maxHInput.placeholder = "1080";
        this.maxHInput.setAttribute("aria-label", "Max height");
    }

    /** The size row is shown while Resize is on. */
    private updateSizeRow() {
        this.sizeRow.toggle(this.encode.resize.enabled);
    }

    /** Obsidian's toggle after the name; a click on the name toggles it too. */
    private createToggle(label: string, initial: boolean, onChange: (on: boolean) => void): ToggleComponent {
        const row = this.createRow(label);
        row.addClass("wasm-image-modal__setting-row--toggle");
        const toggle = new ToggleComponent(row)
            .setValue(initial)
            .onChange((on) => {
                if (!this.loading) onChange(on);
            });
        row.querySelector("label")?.addEventListener("click", () => toggle.setValue(!toggle.getValue()));
        return toggle;
    }

    private handlePresetChange(id: string) {
        const preset = this.presets.find(p => p.id === id);
        if (preset) {
            this.selectedPresetId = preset.id;
            this.applyPreset(preset);
        }
        this.notifyChange();
    }

    private applyPreset(preset: Preset) {
        this.encode = cloneEncode(preset.encode);

        // Update UI
        this.formatSelect.value = this.encode.format;
        this.qualityInput.value = String(this.encode.quality);
        this.maxWInput.value = String(this.encode.resize.maxWidth);
        this.maxHInput.value = String(this.encode.resize.maxHeight);
        this.loading = true;
        this.resizeToggle.setValue(this.encode.resize.enabled);
        this.grayscaleToggle.setValue(this.encode.grayscale);
        this.loading = false;
        this.updateSizeRow();
        this.updateQualityState();
    }

    private notifyChange() {
        this.updatePresetLabels();
        this.onChange();
    }

    /** Whether the values differ from those of the selected preset. */
    public isModified(): boolean {
        const preset = this.presets.find(p => p.id === this.selectedPresetId);
        return preset ? !encodeEquals(this.encode, preset.encode) : false;
    }

    /** Marks the selected preset "(modified)" while the values differ from it. */
    private updatePresetLabels() {
        for (const option of Array.from(this.presetSelect.options)) {
            const preset = this.presets.find(p => p.id === option.value);
            if (!preset) continue;
            option.textContent = presetLabel(preset.name, preset.id === this.selectedPresetId && this.isModified());
        }
        this.presetSelect.value = this.selectedPresetId;
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    /** The encoding parameters currently shown in the panel. */
    public getEncode(): EncodeSettings {
        return cloneEncode(this.encode);
    }
}
