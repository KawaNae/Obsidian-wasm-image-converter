import { describe, expect, it } from "vitest";
import { composingIn, EnterKey, isFormEnter, listenFormEnter } from "./form-enter";

function key(init: Partial<EnterKey> = {}): EnterKey {
  return { key: "Enter", isComposing: false, keyCode: 13, ...init };
}

/** A field that records its listeners and fires them. */
class FakeField {
  private listeners = new Map<string, ((e?: any) => void)[]>();
  addEventListener(type: string, fn: (e?: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  count(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

describe("isFormEnter", () => {
  const table: [string, Partial<EnterKey>, boolean][] = [
    ["Chromium on macOS: the Enter that commits a conversion carries isComposing", { isComposing: true, keyCode: 229 }, false],
    ["WebKit (iPad): the composition has ended, the Enter still carries keyCode 229", { keyCode: 229 }, false],
    ["Chromium on Windows: a key pressed while composing is Process", { key: "Process", keyCode: 229 }, false],
    ["the Enter after the conversion", {}, true],
    ["an Enter dispatched by a script with no keyCode", { keyCode: 0 }, true],
    ["another key", { key: "a", keyCode: 65 }, false],
  ];
  it.each(table)("%s", (_name, init, expected) => {
    expect(isFormEnter(key(init))).toBe(expected);
  });

  it("holds the Enter back while the field's own flag says it composes", () => {
    expect(isFormEnter(key(), true)).toBe(false);
  });
});

describe("composingIn", () => {
  it("follows compositionstart and compositionend of the field", () => {
    const field = new FakeField();
    expect(composingIn(field)).toBe(false);
    field.fire("compositionstart");
    expect(composingIn(field)).toBe(true);
    field.fire("compositionend");
    expect(composingIn(field)).toBe(false);
  });

  it("listens to a field once however often it is asked", () => {
    const field = new FakeField();
    composingIn(field);
    composingIn(field);
    expect(field.count("compositionstart")).toBe(1);
    expect(field.count("compositionend")).toBe(1);
  });
});

describe("listenFormEnter", () => {
  function keydown(init: Partial<EnterKey> & { defaultPrevented?: boolean } = {}) {
    const e = { ...key(init), defaultPrevented: init.defaultPrevented ?? false, preventDefault() { e.defaultPrevented = true; } };
    return e;
  }

  it("submits on the form's Enter and keeps it from doing anything else", () => {
    const field = new FakeField();
    let submitted = 0;
    listenFormEnter(field, () => submitted++);
    const e = keydown();
    field.fire("keydown", e);
    expect(submitted).toBe(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("does not submit on an IME's Enter, during a composition, or on another key", () => {
    const field = new FakeField();
    let submitted = 0;
    listenFormEnter(field, () => submitted++);
    field.fire("keydown", keydown({ isComposing: true, keyCode: 229 }));
    field.fire("keydown", keydown({ keyCode: 229 }));
    field.fire("keydown", keydown({ key: "a", keyCode: 65 }));
    field.fire("compositionstart");
    field.fire("keydown", keydown());
    field.fire("compositionend");
    expect(submitted).toBe(0);
    field.fire("keydown", keydown());
    expect(submitted).toBe(1);
  });

  it("does not submit on an Enter a list of candidates took", () => {
    const field = new FakeField();
    let submitted = 0;
    let listShown = true;
    listenFormEnter(field, () => submitted++, () => listShown);
    field.fire("keydown", keydown());
    field.fire("keydown", keydown({ defaultPrevented: true }));
    listShown = false;
    field.fire("keydown", keydown({ defaultPrevented: true }));
    expect(submitted).toBe(0);
  });
});
