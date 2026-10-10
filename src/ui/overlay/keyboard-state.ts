// The on-screen keyboard of each window. Pure module: must not import "obsidian".

/**
 * Two sources tell of the keyboard (see KeyboardAwareContainer):
 * - visualViewport: Windows and Safari shrink it. Read on demand.
 * - Capacitor's keyboard events on the window (`keyboardWillShow` and the
 *   like, with `keyboardHeight`): Obsidian mobile, whose WebView does not
 *   shrink. The height comes only with the event, so one listener per
 *   window keeps it (trackKeyboard), until the plugin unloads.
 * Ported from obsidian-task-viewer's KeyboardState.
 */

interface TrackedHandlers {
    show: (e: Event) => void;
    hide: () => void;
}

const nativeHeights = new WeakMap<Window, number>();
const tracked = new Map<Window, TrackedHandlers>();

/** Starts following Capacitor's keyboard events of `win`; once per window. */
export function trackKeyboard(win: Window): void {
    if (tracked.has(win)) return;
    const show = (e: Event) => {
        const h = (e as Event & { keyboardHeight?: number }).keyboardHeight;
        if (typeof h === "number" && h > 0) nativeHeights.set(win, h);
    };
    const hide = () => {
        nativeHeights.set(win, 0);
    };
    win.addEventListener("keyboardWillShow", show);
    win.addEventListener("keyboardDidShow", show);
    win.addEventListener("keyboardWillHide", hide);
    win.addEventListener("keyboardDidHide", hide);
    tracked.set(win, { show, hide });
}

/** Stops following every window's keyboard (the plugin unloading). */
export function untrackAllKeyboards(): void {
    for (const [win, h] of tracked) {
        win.removeEventListener("keyboardWillShow", h.show);
        win.removeEventListener("keyboardDidShow", h.show);
        win.removeEventListener("keyboardWillHide", h.hide);
        win.removeEventListener("keyboardDidHide", h.hide);
    }
    tracked.clear();
}

/** The keyboard height Capacitor last reported (px); 0 when closed or unknown. */
export function nativeKeyboardHeight(win: Window): number {
    return nativeHeights.get(win) ?? 0;
}

/**
 * The client Y of the keyboard's top edge: the higher of the two sources,
 * or the window's bottom when there is no keyboard.
 */
export function keyboardTop(win: Window): number {
    const vv = win.visualViewport;
    const vvTop = vv ? vv.offsetTop + vv.height : Infinity;
    const native = nativeHeights.get(win) ?? 0;
    const nativeTop = native > 0 ? win.innerHeight - native : Infinity;
    const top = Math.min(vvTop, nativeTop);
    return top === Infinity ? win.innerHeight : top;
}
