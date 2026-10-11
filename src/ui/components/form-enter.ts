// Whether an Enter is the form's. Pure module: must not import "obsidian".

/**
 * An Enter an IME uses to commit a conversion is not the form's: the next
 * Enter is. Browsers send that Enter in three ways:
 *
 * - Chromium on macOS: `key` "Enter" with `isComposing` true
 * - Safari and WebKit (iPad, iPhone): the composition ends first
 *   (`compositionend`), then `key` "Enter" with `isComposing` false and
 *   `keyCode` 229
 * - Chromium on Windows: `key` "Process" while composing
 *
 * Ported from obsidian-task-viewer's formEnter.
 */

/** The parts of a keydown the answer reads. */
export type EnterKey = Pick<KeyboardEvent, "key" | "isComposing" | "keyCode">;

/**
 * Whether a keydown is an Enter the form should act on. `composing` is the
 * field's own composition flag (composingIn).
 */
export function isFormEnter(e: EnterKey, composing = false): boolean {
    return e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && !composing;
}

/** The part of a field the composition flag listens to. */
interface CompositionSource {
    addEventListener(type: "compositionstart" | "compositionend", listener: () => void): void;
}

/** Whether a field is between compositionstart and compositionend; one per field. */
const compositions = new WeakMap<CompositionSource, { composing: boolean }>();

/**
 * Whether the IME is composing in `field` now. The first call starts
 * following the field's composition, so call it once when the field is made.
 */
export function composingIn(field: CompositionSource): boolean {
    let state = compositions.get(field);
    if (!state) {
        const made = { composing: false };
        field.addEventListener("compositionstart", () => { made.composing = true; });
        field.addEventListener("compositionend", () => { made.composing = false; });
        compositions.set(field, made);
        state = made;
    }
    return state.composing;
}

/** The part of a keydown a form's Enter reads and stops. */
type EnterEvent = EnterKey & Pick<KeyboardEvent, "defaultPrevented" | "preventDefault">;

/** The part of a field an Enter is listened for on. */
interface EnterSource {
    addEventListener(type: "compositionstart" | "compositionend", listener: () => void): void;
    addEventListener(type: "keydown", listener: (e: EnterEvent) => void): void;
}

/**
 * Calls `submit` on an Enter in `field` that is the form's: not an IME's
 * (isFormEnter), not one something else took first (an open list of
 * candidates picks an item with it and prevents its default), and not
 * while `taken` says the field's own list of candidates is open.
 */
export function listenFormEnter(field: EnterSource, submit: () => void, taken: () => boolean = () => false): void {
    composingIn(field);
    field.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || taken() || !isFormEnter(e, composingIn(field))) return;
        e.preventDefault();
        submit();
    });
}
