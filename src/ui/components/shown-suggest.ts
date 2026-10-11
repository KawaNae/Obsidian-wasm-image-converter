import { AbstractInputSuggest, App } from "obsidian";
import { composingIn, isFormEnter } from "./form-enter";

/**
 * Obsidian's input suggest, as every list of candidates under a field of
 * ours is shown. Over Obsidian's, it does three things:
 *
 * - Says whether the list is open (`listShown`). Not `isOpen`, which
 *   Obsidian's PopoverSuggest sets as its own untyped field.
 * - Keeps the note's hotkeys out while the list is open. The list's scope
 *   has Obsidian's app scope as its parent, so a key the list does not
 *   take (Mod+B) would fall through to the hotkeys and act on the note
 *   behind, past the scope our overlay pushes (HotkeyShield). A last
 *   handler takes every other key: it answers true, which stops the lookup
 *   without preventing the key's default, so the key still types.
 * - Picks nothing on an Enter an IME commits a conversion with
 *   (isFormEnter): Obsidian's list skips only an Enter with `isComposing`,
 *   and WebKit (iPad, iPhone) sends the committing Enter after the
 *   composition ended, with `keyCode` 229.
 *
 * A subclass says what picking an item does in `pick`.
 * Ported from obsidian-task-viewer's ShownSuggest.
 */
export abstract class ShownSuggest<T> extends AbstractInputSuggest<T> {
    private shown = false;

    constructor(app: App, private readonly listField: HTMLInputElement | HTMLDivElement) {
        super(app, listField);
        // Start following the field's composition before its first key
        composingIn(listField);
        // After Obsidian's own keys (the arrows, Enter, Escape): the rest
        this.scope.register(null, null, () => true);
    }

    /** Whether the list is open. */
    get listShown(): boolean {
        return this.shown;
    }

    open(): void {
        super.open();
        this.shown = true;
    }

    close(): void {
        super.close();
        this.shown = false;
    }

    /** Obsidian's pick, by a click or by an Enter that is not an IME's. */
    selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
        // Not `instanceof KeyboardEvent`: a popout window has its own
        if (evt.type === "keydown" && !isFormEnter(evt as KeyboardEvent, composingIn(this.listField))) return;
        this.pick(value, evt);
    }

    /** An item was picked. */
    protected abstract pick(value: T, evt: MouseEvent | KeyboardEvent): void;
}
