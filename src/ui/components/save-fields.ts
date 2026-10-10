import { App } from "obsidian";
import { FieldValues } from "../save-plan";
import { FolderSuggest } from "./folder-suggest";

/**
 * The name and folder fields of the converter dialog, with an example of
 * the expanded name under the name field. Both start with a value the
 * caller resolved; save-plan.ts decides what the edited values mean.
 */
export class SaveFields {
    readonly element: HTMLDivElement;
    private nameInput: HTMLInputElement;
    private folderInput: HTMLInputElement;
    private exampleEl: HTMLDivElement;

    /**
     * @param initialName - name template, or a plain name
     * @param initialFolder - folder shown first ("/" for the root); "" shows
     *   `folderPlaceholder` instead
     */
    constructor(
        app: App,
        private readonly initialName: string,
        private readonly initialFolder: string,
        folderPlaceholder: string,
        onChange: () => void
    ) {
        this.element = document.createElement("div");
        this.element.className = "wasm-image-save-fields";

        this.nameInput = this.createRow("Name:", initialName);
        this.nameInput.placeholder = initialName;
        this.nameInput.addEventListener("input", onChange);

        this.exampleEl = this.element.createDiv({ cls: "wasm-image-save-fields__example" });

        this.folderInput = this.createRow("Folder:", initialFolder);
        this.folderInput.placeholder = initialFolder || folderPlaceholder;
        this.folderInput.addEventListener("input", onChange);
        new FolderSuggest(app, this.folderInput);
    }

    private createRow(label: string, value: string): HTMLInputElement {
        const row = this.element.createDiv({ cls: "wasm-image-modal__setting-row" });
        row.createEl("label", { cls: "wasm-image-modal__setting-label", text: label });
        const input = row.createEl("input", { cls: "wasm-image-modal__setting-control", type: "text" });
        input.value = value;
        input.spellcheck = false;
        return input;
    }

    values(): FieldValues {
        return {
            name: this.nameInput.value,
            initialName: this.initialName,
            folder: this.folderInput.value,
            initialFolder: this.initialFolder,
        };
    }

    setExample(text: string) {
        this.exampleEl.setText(text);
    }

    setDisabled(disabled: boolean) {
        this.nameInput.disabled = disabled;
        this.folderInput.disabled = disabled;
    }
}
