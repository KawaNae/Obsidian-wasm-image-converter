import { describe, expect, it } from "vitest";
import { keepSingleLine, withoutLineBreaks } from "./single-line";

const LS = String.fromCharCode(0x2028);

describe("withoutLineBreaks", () => {
  it("removes line feeds, carriage returns and line separators", () => {
    expect(withoutLineBreaks(`a\nb\r\nc${LS}d`, 0).value).toBe("abcd");
  });

  it("moves the caret back by the breaks before it", () => {
    // "IMG-\n{size}" with the caret after "{s"
    expect(withoutLineBreaks("IMG-\n{size}", 7)).toEqual({ value: "IMG-{size}", caret: 6 });
  });

  it("keeps the caret where no break stood before it", () => {
    expect(withoutLineBreaks("ab\ncd", 1)).toEqual({ value: "abcd", caret: 1 });
  });

  it("leaves a value without breaks as it is", () => {
    expect(withoutLineBreaks("{note}-{size}", 3)).toEqual({ value: "{note}-{size}", caret: 3 });
  });
});

/** A textarea that records its listeners and fires them. */
class FakeTextarea {
  value = "";
  selectionStart: number | null = 0;
  private listeners = new Map<string, ((e?: any) => void)[]>();
  addEventListener(type: string, fn: (e?: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  setSelectionRange(start: number): void {
    this.selectionStart = start;
  }
  fire(type: string, e?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function inputEvent(inputType: string) {
  return { inputType, prevented: false, preventDefault() { this.prevented = true; } };
}

describe("keepSingleLine", () => {
  it("stops the inputs that insert a line break", () => {
    const field = new FakeTextarea();
    keepSingleLine(field);
    for (const type of ["insertLineBreak", "insertParagraph"]) {
      const e = inputEvent(type);
      field.fire("beforeinput", e);
      expect(e.prevented).toBe(true);
    }
  });

  it("lets typing and pasting through", () => {
    const field = new FakeTextarea();
    keepSingleLine(field);
    for (const type of ["insertText", "insertFromPaste", "insertCompositionText"]) {
      const e = inputEvent(type);
      field.fire("beforeinput", e);
      expect(e.prevented).toBe(false);
    }
  });

  it("removes the breaks a paste brought, keeping the caret after the pasted text", () => {
    const field = new FakeTextarea();
    keepSingleLine(field);
    field.value = "aX\nY\r\nZbc";
    field.selectionStart = 7;
    field.fire("input");
    expect(field.value).toBe("aXYZbc");
    expect(field.selectionStart).toBe(4);
  });

  it("does not touch the caret when there is no break", () => {
    const field = new FakeTextarea();
    keepSingleLine(field);
    field.value = "abc";
    field.selectionStart = 1;
    field.fire("input");
    expect(field.value).toBe("abc");
    expect(field.selectionStart).toBe(1);
  });
});
