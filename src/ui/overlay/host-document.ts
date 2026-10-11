// The window a dialog of the workspace opens in. Pure module: must not import "obsidian" (types only).
import type { App } from "obsidian";

/**
 * The document a dialog opens in: `preferred` when given (the window of
 * the note the dialog is for); else the window the user works in, when it
 * shows the workspace; else the main window. A window that shows no leaf
 * of the workspace, as the settings window of Obsidian 1.13, hosts none of
 * our dialogs: what they do belongs to the workspace.
 */
export function pickHostDocument<D>(preferred: D | null, active: D | null, main: D, showsWorkspace: (doc: D) => boolean): D {
    if (preferred !== null) return preferred;
    if (active !== null && showsWorkspace(active)) return active;
    return main;
}

/**
 * pickHostDocument for this app: the main window and every popout window
 * that holds a leaf show the workspace.
 */
export function workspaceDocument(app: App, preferred: Document | null): Document {
    const showsWorkspace = (doc: Document) => {
        if (doc === document) return true;
        let found = false;
        app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view.containerEl.ownerDocument === doc) found = true;
        });
        return found;
    };
    return pickHostDocument(preferred, activeDocument ?? null, document, showsWorkspace);
}
