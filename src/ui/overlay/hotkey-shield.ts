import { Keymap, Scope } from "obsidian";

/**
 * Keeps Obsidian's hotkeys out of an overlay of ours while the focus is in
 * it, as Obsidian's own modals do: a scope with no parent is pushed, so no
 * hotkey is looked up, and the keys go on to what has the focus and to the
 * overlay's own listeners (its Escape). Without it, a hotkey pressed in a
 * field of ours acts on the note behind (Mod+B makes its text bold, Mod+W
 * closes its tab).
 *
 * "In it" is where the focus last went: a focus that moves into the
 * overlay pushes the scope, one that moves to an element outside pops it.
 * A focus that goes to no element (a click on blank space) moves nothing.
 *
 * The focus is followed in the capture phase of `focus`, which reaches the
 * document before `focusin` fires: an input suggest that opens its list as
 * its field takes the focus pushes its own scope there, and that scope has
 * to be above this one, or the list's keys (the arrows, Enter) would stop
 * here. Ported from obsidian-task-viewer's HotkeyShield.
 */
export class HotkeyShield {
    private readonly scope = new Scope();
    private pushed = false;
    private readonly onFocus = (e: FocusEvent) => this.keepOut(this.holds(e.target as Node | null));

    /**
     * @param keymap - Obsidian's keymap (`app.keymap`)
     * @param doc - the document the overlay is in
     * @param holds - whether a node is in the overlay
     */
    constructor(
        private readonly keymap: Keymap,
        private readonly doc: Document,
        private readonly holds: (node: Node | null) => boolean
    ) {
        doc.addEventListener("focus", this.onFocus, true);
        this.keepOut(holds(doc.activeElement));
    }

    /** Pops the scope, if pushed, and stops following the focus. */
    detach(): void {
        this.doc.removeEventListener("focus", this.onFocus, true);
        this.keepOut(false);
    }

    private keepOut(on: boolean): void {
        if (this.pushed === on) return;
        this.pushed = on;
        if (on) this.keymap.pushScope(this.scope);
        else this.keymap.popScope(this.scope);
    }
}
