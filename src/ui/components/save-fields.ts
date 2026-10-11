import { App } from "obsidian";
import { FieldValues } from "../save-plan";
import { FolderSuggest } from "./folder-suggest";
import { listenFormEnter } from "./form-enter";
import { keepSingleLine } from "./single-line";

/**
 * The name and folder fields of the converter dialog, with an example of
 * the expanded name under the name field. Both start with a value the
 * caller resolved; save-plan.ts decides what the edited values mean. An
 * Enter in either submits the dialog, except one an IME commits with and
 * one that picks a folder from the list of candidates.
 *
 * The name field is a textarea kept to one line of text: a long template
 * wraps and is read whole, the field growing with it (field-sizing:
 * content, or its scrollHeight where that is not supported). No key
 * inserts a line break, and a pasted one is removed.
 */
export class SaveFields {
    readonly element: HTMLDivElement;
    private nameInput: HTMLTextAreaElement;
    private folderInput: HTMLInputElement;
    private exampleEl: HTMLDivElement;

    /**
     * @param initialName - name template, or a plain name
     * @param initialFolder - folder shown first ("/" for the root); "" shows
     *   `folderPlaceholder` instead
     * @param onSubmit - an Enter in a field: convert, as the button does
     */
    constructor(
        app: App,
        private readonly initialName: string,
        private readonly initialFolder: string,
        folderPlaceholder: string,
        onChange: () => void,
        onSubmit: () => void
    ) {
        this.element = document.createElement("div");
        this.element.className = "wasm-image-save-fields";

        this.nameInput = this.createNameRow(initialName);
        this.nameInput.addEventListener("input", onChange);
        listenFormEnter(this.nameInput, onSubmit);

        this.exampleEl = this.element.createDiv({ cls: "wasm-image-save-fields__example" });

        this.folderInput = this.createRow("Folder:", initialFolder);
        this.folderInput.placeholder = initialFolder || folderPlaceholder;
        this.folderInput.addEventListener("input", onChange);
        const suggest = new FolderSuggest(app, this.folderInput);
        listenFormEnter(this.folderInput, onSubmit, () => suggest.listShown);
    }

    /** Long values: the name above, the field the whole width under it. */
    private createStackedRow(label: string): HTMLDivElement {
        const row = this.element.createDiv({ cls: "wasm-image-modal__setting-row wasm-image-modal__setting-row--stacked" });
        row.createEl("label", { cls: "wasm-image-modal__setting-label", text: label });
        return row;
    }

    private createRow(label: string, value: string): HTMLInputElement {
        const input = this.createStackedRow(label).createEl("input", { cls: "wasm-image-modal__setting-control", type: "text" });
        input.value = value;
        input.spellcheck = false;
        return input;
    }

    private createNameRow(value: string): HTMLTextAreaElement {
        const field = this.createStackedRow("Name:").createEl("textarea", {
            cls: "wasm-image-modal__setting-control wasm-image-save-fields__name",
        });
        field.rows = 1;
        field.value = value;
        field.placeholder = value;
        field.spellcheck = false;
        // Enter converts (listenFormEnter); the key says so where the keyboard listens
        field.enterKeyHint = "go";
        keepSingleLine(field);
        fitHeightToContent(field);
        return field;
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

/**
 * Where CSS cannot size the textarea to its content (field-sizing, from
 * Chromium 123), its height follows its scrollHeight: on input, and when
 * its width changes the wrapping.
 */
function fitHeightToContent(field: HTMLTextAreaElement) {
    if (CSS.supports("field-sizing", "content")) return;
    const fit = () => {
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
    };
    field.addEventListener("input", fit);
    new ResizeObserver(() => window.requestAnimationFrame(fit)).observe(field);
}
