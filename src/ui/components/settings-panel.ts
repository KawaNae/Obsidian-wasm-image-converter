import { EncodeSettings, ImageFormat, Preset, cloneEncode, encodeEquals, presetLabel, resolvePreset } from "../../settings";
import { ENCODER_LIST, encoderFor } from "../../conversion/encoders";
import { listenFormEnter } from "./form-enter";

/**
 * The encoding inputs of the converter dialog. Choosing a preset loads its
 * values; changing a value afterwards keeps the preset selected and marks it
 * "(modified)" until the values equal the preset's again. An Enter in a
 * number field takes the value typed in it, then submits the dialog.
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
    private resizeCheckbox!: HTMLInputElement;
    private maxWInput!: HTMLInputElement;
    private maxHInput!: HTMLInputElement;
    private grayscaleCheckbox!: HTMLInputElement;

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
        this.grayscaleCheckbox = this.createCheckbox("Grayscale", this.encode.grayscale, (checked) => {
            this.encode.grayscale = checked;
            this.notifyChange();
        });

        // Resize
        this.resizeCheckbox = this.createCheckbox("Resize", this.encode.resize.enabled, (checked) => {
            this.encode.resize.enabled = checked;
            this.notifyChange();
        });

        // Max Width
        this.maxWInput = this.createNumberInput("Max Width:", 100, 5000, 1, this.encode.resize.maxWidth, (val) => {
            const clamped = Number.isFinite(val) && val >= 1 ? Math.round(val) : 1;
            this.maxWInput.value = String(clamped);
            this.encode.resize.maxWidth = clamped;
            this.notifyChange();
        });
        this.maxWInput.placeholder = "1920";

        // Max Height
        this.maxHInput = this.createNumberInput("Max Height:", 100, 5000, 1, this.encode.resize.maxHeight, (val) => {
            const clamped = Number.isFinite(val) && val >= 1 ? Math.round(val) : 1;
            this.maxHInput.value = String(clamped);
            this.encode.resize.maxHeight = clamped;
            this.notifyChange();
        });
        this.maxHInput.placeholder = "1080";

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

    private createNumberInput(label: string, min: number, max: number, step: number, initial: number, onChange: (val: number) => void): HTMLInputElement {
        const row = document.createElement("div");
        row.className = "wasm-image-modal__setting-row";

        const lbl = document.createElement("label");
        lbl.className = "wasm-image-modal__setting-label";
        lbl.textContent = label;

        const input = document.createElement("input");
        input.type = "number";
        input.className = "wasm-image-modal__setting-control";
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

        row.appendChild(lbl);
        row.appendChild(input);
        this.element.appendChild(row);
        return input;
    }

    private createCheckbox(label: string, initial: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
        const row = document.createElement("div");
        row.className = "wasm-image-modal__setting-row wasm-image-modal__setting-row--checkbox";

        const text = document.createElement("label");
        text.className = "wasm-image-modal__setting-label wasm-image-modal__checkbox-label";
        text.textContent = label;

        const container = document.createElement("div");
        container.className = "wasm-image-modal__checkbox-container";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = initial;

        // Allow clicking label to toggle
        const id = `cb-${label}-${Math.random().toString(36).substr(2, 9)}`;
        checkbox.id = id;
        text.htmlFor = id;

        checkbox.addEventListener("change", () => onChange(checkbox.checked));

        container.appendChild(checkbox);
        row.appendChild(text);
        row.appendChild(container);
        this.element.appendChild(row);
        return checkbox;
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
        this.resizeCheckbox.checked = this.encode.resize.enabled;
        this.grayscaleCheckbox.checked = this.encode.grayscale;
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
