import { PopoverSuggest } from "obsidian";

/**
 * Takes the user's "back" for an overlay of ours while it is open, as
 * Obsidian's modals, menus and suggestions take it: Android's back gesture
 * or button, and on the desktop the mouse's back button (`history.back()`).
 *
 * Obsidian keeps, per window, a stack of what is open over the workspace,
 * each with an `onHistoryBack`. Android's back comes to the app as
 * Capacitor's `backButton` event; Obsidian's one listener to it calls the
 * top of the stack's `onHistoryBack` when the stack has anything, and only
 * otherwise folds a sidebar, goes back in the tab's history, or offers to
 * leave the app. `history.back()` is patched to call the same top, and the
 * desktop's mouse back button calls `history.back()`. A surface outside the
 * stack gets none of these: the back folds the sidebar behind it instead.
 * (Obsidian 1.13.7's `app.js`, read on the Android emulator.)
 *
 * Ported from obsidian-task-viewer's HistoryBack.
 *
 * The stack is not published. What stands in it is opened and closed by
 * Obsidian's own classes, and the smallest of them is `PopoverSuggest`,
 * which is published: its `open` pushes the suggestion onto the stack after
 * pushing its scope and attaching its DOM, and its `close` pops it after
 * popping the scope, clearing its suggestions and detaching the DOM. Those
 * two are run here on a stand-in that has no scope to push and no DOM to
 * attach, so what is left of them is the stack. Being unpublished, this may
 * go: then nothing is pushed and the back does what it did before, the
 * surface working otherwise as ever. Every reliance on it is here.
 *
 * @param onBack what the back does while the surface is open
 * @returns what lets go of the back, once the surface closes; calling it
 *   again does nothing
 */
export function holdHistoryBack(onBack: () => void): () => void {
    const suggest = PopoverSuggest?.prototype as unknown as Partial<SuggestMethods> | undefined;
    if (typeof suggest?.open !== "function" || typeof suggest.close !== "function") return () => {};
    const { open, close } = suggest as SuggestMethods;
    const noScope = { pushScope: () => {}, popScope: () => {} };
    const standIn: StandIn = {
        app: { keymap: noScope },
        scope: null,
        isOpen: false,
        win: null,
        autoDestroy: null,
        suggestions: { setSuggestions: () => {} },
        attachDom: () => {},
        detachDom: () => {},
        onHistoryBack: () => onBack(),
    };
    try {
        open.call(standIn);
    } catch {
        return () => {};
    }
    let held = true;
    return () => {
        if (!held) return;
        held = false;
        try {
            close.call(standIn);
        } catch {
            // Nothing else to let go of.
        }
    };
}

/** What `PopoverSuggest`'s `open` and `close` touch of the suggestion they run on. */
interface StandIn {
    app: { keymap: { pushScope(scope: unknown): void; popScope(scope: unknown): void } };
    scope: null;
    isOpen: boolean;
    win: Window | null;
    autoDestroy: (() => void) | null;
    suggestions: { setSuggestions(values: unknown[]): void };
    attachDom(): void;
    detachDom(): void;
    onHistoryBack(): void;
}

interface SuggestMethods {
    open(this: StandIn): void;
    close(this: StandIn): void;
}
