import { Keymap, setIcon } from "obsidian";
import { inLayerAbove } from "./layer-order";
import { keyedOpening, overlayFor, registerOverlay, unregisterOverlay } from "./overlay-registry";
import { HotkeyShield } from "./hotkey-shield";
import { holdHistoryBack } from "./history-back";
import { KeyboardAwareContainer } from "./keyboard-aware-container";

/** What the first focus goes to: an element of the body. */
export interface Focusable {
    focus(options?: FocusOptions): void;
}

export interface OverlayOpenOptions {
    /**
     * What the dialog is, for a screen reader (the panel's aria-label). No
     * title is shown: the dialog's own fields say what it is for.
     */
    label: string;
    /**
     * The window's document the overlay opens in (host-document.ts picks
     * it): the window of the note or of the workspace the dialog is for.
     */
    hostDocument: Document;
    /**
     * Makes the overlay the one open overlay of this key: a dialog that must
     * not open twice asks keepOverlay(key, hostDocument) before opening.
     */
    key?: string;
    /** Added to the panel: the dialog's own styles hang from it */
    panelClass?: string;
    /**
     * Fills the body and the footer once, as the overlay opens. The footer
     * holds the row of buttons that stays at the bottom of the panel while
     * the body scrolls above it; left empty, it is not shown.
     */
    build(bodyEl: HTMLElement, footerEl: HTMLElement): void;
    /**
     * Obsidian's keymap (`app.keymap`): its hotkeys are kept out while the
     * focus is in the overlay (HotkeyShield). Escape and the keys of the
     * fields still work.
     */
    keymap: Keymap;
    /**
     * What the focus goes to a frame after the overlay opens. Not given, or
     * naming nothing, the panel itself takes the focus, which raises no
     * on-screen keyboard.
     */
    initialFocus?: () => Focusable | null;
    /** Called once, when the overlay closes for any reason */
    onClose?: () => void;
}

/**
 * The window our dialogs are shown in, in place of Obsidian's Modal: a
 * dialog in the middle of the window, and on a phone a bottom sheet. The
 * DOM is put on the body (root > backdrop + panel > handle, close button,
 * body, footer), and CSS alone switches the two presentations by the
 * `.is-phone` class Obsidian gives the body, so an iPad shows the dialog.
 * Only the body scrolls; the footer with the buttons stays at the bottom
 * of the dialog and of the sheet.
 *
 * What a Modal does by itself, the shell does on its own: Escape and a
 * press outside close it, the focus in it keeps Obsidian's hotkeys out
 * (HotkeyShield), and the user's "back" (Android's back gesture, the mouse's
 * back button) closes it (holdHistoryBack). On a phone, the sheet is closed
 * by pulling it down by its handle or from the top of its body, and the
 * field the on-screen keyboard would cover is scrolled above it in the body
 * (KeyboardAwareContainer). The sheet does not move up with the keyboard,
 * as Obsidian's own sheets do not: the footer stays under the keyboard
 * while it is open.
 *
 * The surface of the overlay is its panel and what Obsidian opens on top of
 * it while it is open (an input suggest's list on the body: inLayerAbove).
 *
 * The plugin closes what is still open when it unloads
 * (overlay-registry.ts), as no teardown of Obsidian's reaches the body.
 *
 * Ported from obsidian-task-viewer's OverlayShell, without its anchored
 * mode, its child popovers and its close gate.
 */
export class OverlayShell {
    private rootEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private hostDoc: Document | null = null;
    private hostWin: Window | null = null;
    private onCloseCb: (() => void) | null = null;
    private closing = false;
    /** What had the focus when the overlay opened, given it back on close */
    private focusBefore: Element | null = null;
    private kbAware: KeyboardAwareContainer | null = null;
    private hotkeys: HotkeyShield | null = null;
    private releaseBack: (() => void) | null = null;
    private outsideHandler: ((e: PointerEvent) => void) | null = null;
    private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
    private pageHideHandler: (() => void) | null = null;

    open(opts: OverlayOpenOptions): void {
        if (this.rootEl) this.close();

        this.onCloseCb = opts.onClose ?? null;
        this.closing = false;

        // The window the dialog is for (a popout's own document)
        const hostDoc = opts.hostDocument;
        const hostWin = hostDoc.defaultView ?? window;
        this.hostDoc = hostDoc;
        this.hostWin = hostWin;
        this.focusBefore = hostDoc.activeElement;

        const root = hostDoc.body.createDiv({ cls: "wasm-image-overlay" });
        this.rootEl = root;

        const backdrop = root.createDiv({ cls: "wasm-image-overlay__backdrop" });
        // The close starts on pointerdown (capture); the touchend and the
        // click synthesized after it must not reach what is behind.
        // preventDefault on touchend stops the synthesized mouse events.
        backdrop.addEventListener("touchend", (e) => e.preventDefault(), { passive: false });
        backdrop.addEventListener("mousedown", (e) => e.preventDefault());
        backdrop.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        const panel = root.createDiv({ cls: "wasm-image-overlay__panel" });
        if (opts.panelClass) panel.addClass(opts.panelClass);
        // Focusable by script only: the focus held when the body names no field
        panel.tabIndex = -1;
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", opts.label);
        this.panelEl = panel;

        const handle = panel.createDiv({ cls: "wasm-image-overlay__handle" });

        const closeBtn = panel.createDiv({ cls: "clickable-icon wasm-image-overlay__close" });
        setIcon(closeBtn, "x");
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.addEventListener("click", () => this.close());

        const body = panel.createDiv({ cls: "wasm-image-overlay__body" });
        const footer = panel.createDiv({ cls: "wasm-image-overlay__footer" });
        opts.build(body, footer);

        // On-screen keyboard (mobile)
        this.kbAware = new KeyboardAwareContainer(root, hostWin);
        this.kbAware.attach();
        this.kbAware.scrollTarget = body;

        this.setupSwipeToDismiss(handle, panel, backdrop, body);

        this.escapeHandler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            this.close();
        };
        hostDoc.addEventListener("keydown", this.escapeHandler, true);

        this.releaseBack = holdHistoryBack(() => this.close());

        this.outsideHandler = (e: PointerEvent) => {
            if (this.holds(e.target as Node | null)) return;
            this.close();
        };
        hostDoc.addEventListener("pointerdown", this.outsideHandler, true);

        this.hotkeys = new HotkeyShield(opts.keymap, hostDoc, (node) => this.holds(node));

        // The first focus, a frame later: one put during the open animation can be lost
        const initialFocus = opts.initialFocus;
        hostWin.requestAnimationFrame(() => {
            if (this.panelEl !== panel) return;
            this.focusFirst(panel, hostDoc, initialFocus?.() ?? null);
        });

        // A popout window closing
        this.pageHideHandler = () => this.close();
        hostWin.addEventListener("pagehide", this.pageHideHandler);

        registerOverlay(this, opts.key);
    }

    /** The focus to the panel, unless it is already in the overlay. */
    takeFocus(): void {
        if (!this.isOpen() || !this.hostDoc || !this.panelEl) return;
        if (!this.holds(this.hostDoc.activeElement)) this.panelEl.focus({ preventScroll: true });
    }

    /** The window's document the overlay is open in, or null when it is not open. */
    openDocument(): Document | null {
        return this.isOpen() ? this.hostDoc : null;
    }

    /** Whether the overlay is open and not closing. */
    isOpen(): boolean {
        return this.rootEl !== null && !this.closing;
    }

    /**
     * Puts the focus on `target`, selecting a text field's text, and on the
     * panel when there is no target or the focus did not go into the
     * overlay (an element hidden, or disabled).
     */
    private focusFirst(panel: HTMLElement, doc: Document, target: Focusable | null): void {
        if (target) {
            target.focus({ preventScroll: true });
            const field = target as Partial<HTMLInputElement>;
            if (doc.activeElement === (target as unknown) && typeof field.select === "function") field.select();
        }
        if (!this.holds(doc.activeElement)) panel.focus({ preventScroll: true });
    }

    /**
     * Whether `node` is in the overlay: in its panel, or in a layer opened on
     * top of it (an input suggest's list). Its backdrop is outside.
     */
    private holds(node: Node | null): boolean {
        if (node === null || !this.rootEl) return false;
        return (this.panelEl?.contains(node) ?? false) || inLayerAbove(this.rootEl, node);
    }

    /** Closes the overlay; calling it again does nothing. */
    close(): void {
        if (!this.rootEl || this.closing) return;
        this.closing = true;
        unregisterOverlay(this);
        this.giveFocusBack();

        // Logical teardown: the overlay is inert from here
        this.kbAware?.detach();
        this.kbAware = null;
        this.hotkeys?.detach();
        this.hotkeys = null;
        this.releaseBack?.();
        this.releaseBack = null;
        if (this.hostDoc) {
            if (this.escapeHandler) this.hostDoc.removeEventListener("keydown", this.escapeHandler, true);
            if (this.outsideHandler) this.hostDoc.removeEventListener("pointerdown", this.outsideHandler, true);
        }
        if (this.hostWin && this.pageHideHandler) {
            this.hostWin.removeEventListener("pagehide", this.pageHideHandler);
        }
        this.escapeHandler = null;
        this.outsideHandler = null;
        this.pageHideHandler = null;

        const cb = this.onCloseCb;
        this.onCloseCb = null;
        this.focusBefore = null;
        this.hostDoc = null;
        this.hostWin = null;
        this.panelEl = null;

        cb?.();

        // Visual teardown: the close animation, then the DOM goes
        const root = this.rootEl;
        this.rootEl = null;
        const panel = root.querySelector<HTMLElement>(".wasm-image-overlay__panel");
        root.addClass("is-closing");
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            root.remove();
        };
        panel?.addEventListener("animationend", finish);
        window.setTimeout(finish, 200);
    }

    /**
     * Gives the focus back to what had it when the overlay opened, if the
     * focus is still the overlay's (in it, or lost to the body) and that
     * element is still there.
     */
    private giveFocusBack(): void {
        const doc = this.hostDoc;
        const before = this.focusBefore as (Element & Partial<HTMLElement>) | null;
        if (!doc || !before || !before.isConnected || typeof before.focus !== "function") return;
        const active = doc.activeElement;
        if (active !== null && active !== doc.body && !this.holds(active)) return;
        before.focus({ preventScroll: true });
    }

    /**
     * On a phone (the handle shown), pulling the sheet down far enough
     * closes it: by the handle, or by the body from its top unless the
     * touch began in a field (there it is the field's, to select text).
     */
    private setupSwipeToDismiss(handle: HTMLElement, panel: HTMLElement, backdrop: HTMLElement, body: HTMLElement): void {
        let startY = 0;
        let dy = 0;
        let dragging = false;

        const beginDrag = (clientY: number) => {
            startY = clientY;
            dy = 0;
            dragging = true;
            panel.style.transition = "none";
            panel.style.animation = "none";
            backdrop.style.transition = "none";
        };

        const moveDrag = (clientY: number) => {
            dy = Math.max(0, clientY - startY);
            panel.style.transform = `translateY(${dy}px)`;
            backdrop.style.opacity = String(1 - Math.min(dy / 300, 0.6));
        };

        const slideOut = () => {
            panel.style.transition = "transform 150ms ease-in";
            panel.style.transform = "translateY(100%)";
            backdrop.style.transition = "opacity 150ms ease-in";
            backdrop.style.opacity = "0";
            window.setTimeout(() => this.close(), 160);
        };

        const snapBack = () => {
            panel.style.transition = "transform 150ms ease-out";
            panel.style.transform = "";
            backdrop.style.transition = "opacity 150ms ease-out";
            backdrop.style.opacity = "";
        };

        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            if (dy > 80) slideOut();
            else snapBack();
        };

        handle.addEventListener("pointerdown", (e: PointerEvent) => {
            if (e.button !== 0) return;
            beginDrag(e.clientY);
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener("pointermove", (e: PointerEvent) => {
            if (dragging) moveDrag(e.clientY);
        });
        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);

        let touchStartY = 0;
        let overscrolling = false;
        let isBottomSheet = false;
        let inField = false;

        body.addEventListener("touchstart", (e) => {
            touchStartY = e.touches[0].clientY;
            overscrolling = false;
            isBottomSheet = handle.offsetHeight > 0;
            inField = isInField(e.target);
        }, { passive: true });

        body.addEventListener("touchmove", (e) => {
            if (!isBottomSheet || inField) return;
            const currentY = e.touches[0].clientY;
            if (overscrolling) {
                e.preventDefault();
                moveDrag(currentY);
                return;
            }
            if (body.scrollTop <= 0 && currentY - touchStartY > 5) {
                overscrolling = true;
                beginDrag(currentY);
                e.preventDefault();
            }
        }, { passive: false });

        const onTouchEnd = () => {
            if (overscrolling) {
                endDrag();
                overscrolling = false;
            }
        };
        body.addEventListener("touchend", onTouchEnd);
        body.addEventListener("touchcancel", onTouchEnd);
    }
}

/**
 * Whether the open overlay of `key` stays in place of a new one in
 * `hostDocument` (keyedOpening): a dialog that must not open twice calls it
 * before opening, and opens only on false.
 *
 * - In the same window, the open overlay stays and takes the focus unless
 *   it has it: true
 * - In another window, it closes, dropping what was put in it, so the new
 *   one opens in this window: false. Its close is done before this returns:
 *   it is out of the registry and has let go of the back
 * - None open: false
 */
export function keepOverlay(key: string, hostDocument: Document): boolean {
    const overlay = overlayFor(key);
    const open = overlay instanceof OverlayShell ? overlay : null;
    switch (keyedOpening(open?.openDocument() ?? null, hostDocument)) {
        case "keep":
            open?.takeFocus();
            return true;
        case "reopen":
            open?.close();
            return false;
        case "open":
            return false;
    }
}

/** Whether a touch began in a field: an input, a textarea, a select, or an editable element. */
function isInField(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return false;
    return el.isContentEditable || el.closest("input, textarea, select") !== null;
}
