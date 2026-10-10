import { App, TFolder } from "obsidian";
import { ShownSuggest } from "./shown-suggest";

/**
 * The vault's folders under a text field, suggested by their path ("/" for
 * the root). Picking one puts its path in the field and fires "input".
 * Modeled on obsidian-task-viewer's FolderSuggest; it lists folders with
 * getAllLoadedFiles because Vault.getAllFolders needs Obsidian 1.6.6.
 */
export class FolderSuggest extends ShownSuggest<TFolder> {
    constructor(app: App, private readonly inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    protected getSuggestions(query: string): TFolder[] {
        const lowerQuery = query.toLowerCase();
        return this.app.vault.getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder && f.path.toLowerCase().includes(lowerQuery))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    protected pick(folder: TFolder): void {
        this.inputEl.value = folder.path;
        this.inputEl.trigger("input");
        this.close();
    }
}
