import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { KeyboardAwareContainer } from './keyboard-aware-container';
import { untrackAllKeyboards } from './keyboard-state';

/**
 * KeyboardAwareContainer's `activeInput()`/focus handler do
 * `instanceof HTMLInputElement` / `instanceof HTMLTextAreaElement` checks.
 * Vitest's `node` environment has no DOM, so those globals don't exist —
 * defining them only for this file (restored in afterAll) avoids touching
 * the shared vitest setup or any other test file.
 */
class MockInputElement {}
class MockTextAreaElement {}
let savedHTMLInputElement: unknown;
let savedHTMLTextAreaElement: unknown;

beforeAll(() => {
    savedHTMLInputElement = (globalThis as any).HTMLInputElement;
    savedHTMLTextAreaElement = (globalThis as any).HTMLTextAreaElement;
    (globalThis as any).HTMLInputElement = MockInputElement;
    (globalThis as any).HTMLTextAreaElement = MockTextAreaElement;
});
afterAll(() => {
    (globalThis as any).HTMLInputElement = savedHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = savedHTMLTextAreaElement;
});

// --- Minimal DOM shims (plain-object pattern, mirrors ScheduleGridRenderer.test.ts) ---

class MiniEventTarget {
    private listeners = new Map<string, Set<(e?: any) => void>>();
    addEventListener(type: string, fn: (e?: any) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: (e?: any) => void) {
        this.listeners.get(type)?.delete(fn);
    }
    listenerCount(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
    dispatch(type: string, e?: any) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }
}

class MockPanel extends MiniEventTarget {
    style: { height: string; paddingBottom: string } = { height: '', paddingBottom: '' };
    scrollTop = 0;
    /** No scroll room beyond what is shown, unless a test gives some. */
    scrollHeight = 400;
    clientHeight = 400;
    rectHeight = 400;
    computedPaddingBottom = 0;
    lastScrollBy: { top: number } | null = null;
    lastScrollTo: { top: number } | null = null;
    getBoundingClientRect() { return { height: this.rectHeight, bottom: 0, top: 0 } as DOMRect; }
    scrollBy(opts: { top: number; behavior?: string }) { this.scrollTop += opts.top; this.lastScrollBy = opts; }
    scrollTo(opts: { top: number; behavior?: string }) { this.scrollTop = opts.top; this.lastScrollTo = opts; }
}

class MockInput extends MockInputElement {
    bottom: number;
    constructor(bottom: number) { super(); this.bottom = bottom; }
    getBoundingClientRect() { return { bottom: this.bottom, top: 0, height: 0 } as DOMRect; }
}

class MockVisualViewport extends MiniEventTarget {
    height: number;
    offsetTop: number;
    constructor(height: number, offsetTop = 0) { super(); this.height = height; this.offsetTop = offsetTop; }
}

/** A text node in an editable field, and where its caret stands when the selection's focus is in it. */
class MockText {
    nodeType = 3;
    constructor(public parentElement: MockEditable, public caretBottom: number | null) {}
}

/** An editable element (a CodeMirror editor's content), much taller than the caret line in it. */
class MockEditable {
    nodeType = 1;
    isContentEditable = true;
    ownerDocument: MockDocument;
    parentElement = null;
    constructor(doc: MockDocument, public bottom: number) { this.ownerDocument = doc; }
    contains(node: any) { return node === this || node?.parentElement === this; }
    getBoundingClientRect() { return { bottom: this.bottom, top: 0, height: this.bottom } as DOMRect; }
}

class MockDocument extends MiniEventTarget {
    activeElement: any = null;
    selection: { focusNode: any; focusOffset: number } | null = null;
    getSelection() { return this.selection; }
    createRange() {
        let node: any = null;
        return {
            setStart(n: any) { node = n; },
            collapse() {},
            getClientRects() {
                const bottom = node?.caretBottom ?? null;
                return bottom === null ? [] : [{ bottom, top: bottom - 20, height: 20 }];
            },
        };
    }
}

class MockContainer extends MiniEventTarget {
    ownerDocument = new MockDocument();
    private children = new Set<any>();
    adopt(el: any) { this.children.add(el); }
    contains(el: any) { return this.children.has(el); }
}

/** An animation in the container (the sheet sliding up), ended or cancelled by the test. */
class MockAnimation {
    playState: string;
    finished: Promise<MockAnimation>;
    private settle!: { end: () => void; cancel: () => void };
    constructor(private endTime = 150, playState = 'running') {
        this.playState = playState;
        this.finished = new Promise((resolve, reject) => {
            this.settle = {
                end: () => { this.playState = 'finished'; resolve(this); },
                cancel: () => { this.playState = 'idle'; reject(new Error('AbortError')); },
            };
        });
        this.finished.catch(() => {});
    }
    effect = { getComputedTiming: () => ({ endTime: this.endTime }) };
    end() { this.settle.end(); }
    cancel() { this.settle.cancel(); }
}

/** A container whose DOM lists its animations (`getAnimations`). */
class AnimatedContainer extends MockContainer {
    animations: MockAnimation[] = [];
    subtreeAsked: boolean | undefined;
    getAnimations(opts?: { subtree?: boolean }) {
        this.subtreeAsked = opts?.subtree;
        return this.animations.filter((a) => a.playState !== 'finished' && a.playState !== 'idle');
    }
}

/** Let the promises the container waits on settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class MockWindow extends MiniEventTarget {
    innerHeight = 800;
    visualViewport: MockVisualViewport | undefined;
    getComputedStyle(panel: MockPanel) {
        return { paddingBottom: `${panel.computedPaddingBottom}px` } as CSSStyleDeclaration;
    }
}

function setup(opts: { withVisualViewport?: boolean; vvHeight?: number } = {}) {
    const win = new MockWindow();
    if (opts.withVisualViewport !== false) {
        win.visualViewport = new MockVisualViewport(opts.vvHeight ?? win.innerHeight);
    }
    const container = new MockContainer();
    const panel = new MockPanel();
    const kac = new KeyboardAwareContainer(container as any, win as any);
    kac.scrollTarget = panel as any;
    return { win, container, panel, kac };
}

/** A container whose sheet is sliding up (one animation running), with a field focused in it. */
function setupAnimated(fieldBottom: number, ...animations: MockAnimation[]) {
    const win = new MockWindow();
    win.visualViewport = new MockVisualViewport(800);
    const container = new AnimatedContainer();
    container.animations = animations;
    const panel = new MockPanel();
    const scrolls: number[] = [];
    const scrollBy = panel.scrollBy.bind(panel);
    panel.scrollBy = (o) => { scrolls.push(o.top); scrollBy(o); };
    const input = new MockInput(fieldBottom);
    container.adopt(input);
    container.ownerDocument.activeElement = input;
    const kac = new KeyboardAwareContainer(container as any, win as any);
    kac.scrollTarget = panel as any;
    kac.attach();
    const openKeyboard = () => {
        win.visualViewport!.height = 500; // keyboardTop 500
        win.visualViewport!.dispatch('resize');
    };
    return { win, container, panel, scrolls, input, kac, openKeyboard };
}

describe('KeyboardAwareContainer', () => {
    afterEach(() => {
        untrackAllKeyboards(); // KeyboardState's tracked-window map is not GC'd between tests
        vi.useRealTimers();
    });

    describe('visualViewport-based detection', () => {
        it('scrolls the panel and injects padding when the keyboard covers the focused input', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750); // near the bottom of an 800px-tall screen
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // 300px keyboard
            win.visualViewport!.dispatch('resize');

            // keyboardTop = offsetTop(0) + height(500) = 500; overshoot = 750 - 500 + 10 = 260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('260px');
            expect(panel.style.height).toBe('400px'); // locked at rectHeight captured on first correction
        });

        it('does nothing when the focused input does not overlap the keyboard', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(100); // well above where the keyboard will sit
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
            expect(panel.style.paddingBottom).toBe('');
        });

        it('does not treat a small viewport shrink (<=50px) as the keyboard opening', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 750; // exactly 50px shrink — boundary, not open
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('treats a >50px shrink as the keyboard opening', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 749; // 51px shrink — just over the threshold
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).not.toBeNull();
        });

        it('restores height/padding/scrollTop when the keyboard closes', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.style.height = 'auto';
            panel.style.paddingBottom = '8px';
            panel.scrollTop = 5;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens, saves 'auto'/'8px'/5 as the pre-correction snapshot

            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize'); // closes

            expect(panel.style.height).toBe('auto');
            expect(panel.style.paddingBottom).toBe('8px');
            expect(panel.lastScrollTo).toEqual({ top: 5, behavior: 'instant' });
        });

        it('pads only what the panel lacks of the scroll room', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollHeight = 500; // 100px left to scroll
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
            expect(panel.style.paddingBottom).toBe('160px');
        });

        it('accumulates extraPad across repeated corrections without re-locking the panel height', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.visualViewport!.height = 500; // overshoot 260, extraPad=260
            win.visualViewport!.dispatch('resize');
            const heightAfterFirst = panel.style.height;

            input.bottom = 900; // input moved further down (e.g. new field below)
            win.visualViewport!.dispatch('resize'); // same vv.height, re-evaluates via scroll listener path too — trigger via resize again

            // second correction should add on top of the first, not reset it
            expect(panel.style.height).toBe(heightAfterFirst); // height stays locked, not recomputed
        });
    });

    describe('editable fields (contenteditable)', () => {
        function editable(fieldBottom: number, caretBottom: number | null) {
            const env = setup({ vvHeight: 800 });
            const doc = env.container.ownerDocument;
            const field = new MockEditable(doc, fieldBottom);
            const text = new MockText(field, caretBottom);
            doc.activeElement = field;
            doc.selection = { focusNode: text, focusOffset: 0 };
            env.container.adopt(field);
            return { ...env, doc, field, text };
        }

        it('keeps the caret above the keyboard, not the field\'s bottom', () => {
            const { win, panel, kac } = editable(1400, 700);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            // caret 700 - keyboardTop 500 + 10 = 210 (the field's bottom would give 910)
            expect(panel.lastScrollBy).toEqual({ top: 210, behavior: 'instant' });
        });

        it('does nothing while the caret is above the keyboard, however far the field runs below it', () => {
            const { win, panel, kac } = editable(1400, 300);
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('follows the caret as the selection moves while the keyboard is open', () => {
            const { win, doc, panel, text, kac } = editable(1400, 300);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).toBeNull();

            text.caretBottom = 560; // typed on to a line under the keyboard's edge
            doc.dispatch('selectionchange');

            expect(panel.lastScrollBy).toEqual({ top: 70, behavior: 'instant' });
        });

        it('does not follow the selection while the keyboard is closed', () => {
            const { doc, panel, text, kac } = editable(1400, 300);
            kac.attach();

            text.caretBottom = 900;
            doc.dispatch('selectionchange');

            expect(panel.lastScrollBy).toBeNull();
        });

        it('takes the line the caret is in where the caret has no box of its own (an empty line)', () => {
            const { win, doc, field, panel, kac } = editable(650, null);
            doc.selection = { focusNode: field, focusOffset: 0 };
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');

            expect(panel.lastScrollBy).toEqual({ top: 160, behavior: 'instant' });
        });

        it('stops following the selection once detached', () => {
            const { doc, kac } = editable(1400, 300);
            kac.attach();
            expect(doc.listenerCount('selectionchange')).toBe(1);

            kac.detach();

            expect(doc.listenerCount('selectionchange')).toBe(0);
        });
    });

    describe('native (Capacitor) keyboard events', () => {
        it('opens on keyboardWillShow with a keyboardHeight and reacts even with no visualViewport', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });

            // keyboardTop = innerHeight(800) - native(300) = 500; overshoot = 750-500+10=260
            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('closes and restores on keyboardWillHide', () => {
            const { win, container, panel, kac } = setup({ withVisualViewport: false });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            panel.scrollTop = 3;
            kac.attach();

            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            win.dispatch('keyboardWillHide');

            expect(panel.lastScrollTo).toEqual({ top: 3, behavior: 'instant' });
        });
    });

    describe('focus/blur debouncing', () => {
        beforeEach(() => vi.useFakeTimers());

        it('re-corrects for a newly focused input while the keyboard is already open (after the 50ms debounce)', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(200); // does not overlap
            const inputB = new MockInput(750); // overlaps
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();

            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // keyboard opens, inputA doesn't need correction
            expect(panel.lastScrollBy).toBeNull();

            container.ownerDocument.activeElement = inputB;
            container.dispatch('focusin', { target: inputB });
            vi.advanceTimersByTime(50);

            expect(panel.lastScrollBy).toEqual({ top: 260, behavior: 'instant' });
        });

        it('restores 200ms after focus leaves the container with no input focused', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize'); // opens + corrects

            container.ownerDocument.activeElement = null;
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.style.height).toBe(''); // restored to the pre-correction empty string
        });

        it('does not restore on focusout if focus moved to another input inside the container', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const inputA = new MockInput(750);
            const inputB = new MockInput(750);
            container.adopt(inputA);
            container.adopt(inputB);
            container.ownerDocument.activeElement = inputA;
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            const lockedHeight = panel.style.height;

            container.ownerDocument.activeElement = inputB; // focus moved before the blur timer fires
            container.dispatch('focusout');
            vi.advanceTimersByTime(200);

            expect(panel.style.height).toBe(lockedHeight); // still corrected, not restored
        });
    });

    describe('measuring once the container has settled', () => {
        it('does not measure while the sheet slides up, and measures where the field comes to rest once it ends', async () => {
            const slide = new MockAnimation();
            const { container, panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard(); // midway the field is still below the window
            expect(container.subtreeAsked).toBe(true);
            await flush();
            expect(panel.lastScrollBy).toBeNull();

            input.bottom = 557; // the sheet in place
            slide.end();
            await flush();

            // 557 - 500 + 10 = 67, not the 381 the field midway would give
            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

        it('measures once for every ask made during the wait (the keyboard\'s events, a focus, the caret)', async () => {
            vi.useFakeTimers();
            const slide = new MockAnimation();
            const { win, container, scrolls, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            win.dispatch('keyboardWillShow', { keyboardHeight: 300 });
            container.dispatch('focusin', { target: input });
            vi.advanceTimersByTime(50);
            container.ownerDocument.dispatch('selectionchange');
            input.bottom = 557;
            slide.end();
            await vi.runAllTimersAsync();

            expect(scrolls).toEqual([67]);
        });

        it('waits for every animation running in the container (the backdrop fading, the panel sliding)', async () => {
            const fade = new MockAnimation();
            const slide = new MockAnimation();
            const { panel, input, openKeyboard } = setupAnimated(871, fade, slide);

            openKeyboard();
            fade.end();
            await flush();
            expect(panel.lastScrollBy).toBeNull();

            input.bottom = 557;
            slide.end();
            await flush();
            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

        it('measures after an animation cancelled (the sheet dragged by its handle)', async () => {
            const slide = new MockAnimation();
            const { panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            input.bottom = 557;
            slide.cancel();
            await flush();

            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });

        it('measures nothing when the keyboard closed during the wait', async () => {
            const slide = new MockAnimation();
            const { win, panel, input, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            win.visualViewport!.height = 800;
            win.visualViewport!.dispatch('resize');
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toBeNull();
        });

        it('measures nothing when the container was detached (closed) during the wait', async () => {
            const slide = new MockAnimation();
            const { panel, input, kac, openKeyboard } = setupAnimated(871, slide);

            openKeyboard();
            kac.detach();
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toBeNull();
        });

        it('measures the field focused when the wait ends, not the one focused when it began', async () => {
            const slide = new MockAnimation();
            const { container, panel, input, openKeyboard } = setupAnimated(871, slide);
            const other = new MockInput(600);
            container.adopt(other);

            openKeyboard();
            container.ownerDocument.activeElement = other;
            input.bottom = 557;
            slide.end();
            await flush();

            expect(panel.lastScrollBy).toEqual({ top: 110, behavior: 'instant' });
        });

        it('measures at once when no animation runs, an endless one among them', () => {
            const spinner = new MockAnimation(Infinity);
            const paused = new MockAnimation(150, 'paused');
            const { panel, openKeyboard } = setupAnimated(557, spinner, paused);

            openKeyboard();

            expect(panel.lastScrollBy).toEqual({ top: 67, behavior: 'instant' });
        });
    });

    describe('detach', () => {
        it('stops reacting to visualViewport/native events and restores state', () => {
            const { win, container, panel, kac } = setup({ vvHeight: 800 });
            const input = new MockInput(750);
            container.ownerDocument.activeElement = input;
            container.adopt(input);
            kac.attach();
            win.visualViewport!.height = 500;
            win.visualViewport!.dispatch('resize');
            expect(panel.style.height).not.toBe('');

            kac.detach();

            expect(panel.style.height).toBe(''); // restore() ran as part of detach
            expect(kac.scrollTarget).toBeNull();

            // Further events must not reach the (now-detached) handlers.
            panel.lastScrollBy = null;
            win.visualViewport!.height = 300;
            win.visualViewport!.dispatch('resize');
            expect(panel.lastScrollBy).toBeNull();
        });

        it('removes every listener it registered in attach()', () => {
            const { win, container, kac } = setup({ vvHeight: 800 });
            kac.attach();
            expect(win.visualViewport!.listenerCount('resize')).toBe(1);
            // 2, not 1: KeyboardState.trackKeyboard() (called from attach()) adds its
            // own resident listener on the same event, independent of kbHandler.
            expect(win.listenerCount('keyboardWillShow')).toBe(2);
            expect(container.listenerCount('focusin')).toBe(1);
            expect(container.listenerCount('focusout')).toBe(1);

            kac.detach();

            expect(win.visualViewport!.listenerCount('resize')).toBe(0);
            // detach() only removes KeyboardAwareContainer's own kbHandler — trackKeyboard's
            // listener is process-lifetime (removed only via untrackAllKeyboards()).
            expect(win.listenerCount('keyboardWillShow')).toBe(1);
            expect(container.listenerCount('focusin')).toBe(0);
            expect(container.listenerCount('focusout')).toBe(0);
        });
    });
});
