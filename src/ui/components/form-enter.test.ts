import { describe, expect, it } from "vitest";
import { composingIn, EnterKey, isFormEnter } from "./form-enter";

function key(init: Partial<EnterKey> = {}): EnterKey {
  return { key: "Enter", isComposing: false, keyCode: 13, ...init };
}

/** A field that records its listeners and fires them. */
class FakeField {
  private listeners = new Map<string, (() => void)[]>();
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
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
