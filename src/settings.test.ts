import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, builtinEncode, cloneEncode, DEFAULT_ENCODE, encodeEquals, presetLabel } from "./settings";

describe("encodeEquals", () => {
  it("is true for a copy", () => {
    expect(encodeEquals(DEFAULT_ENCODE, cloneEncode(DEFAULT_ENCODE))).toBe(true);
  });

  it("notices a change of any field", () => {
    const changes: ((e: ReturnType<typeof cloneEncode>) => void)[] = [
      e => { e.format = "avif"; },
      e => { e.quality = 0.7; },
      e => { e.grayscale = !e.grayscale; },
      e => { e.resize.enabled = !e.resize.enabled; },
      e => { e.resize.maxWidth += 1; },
      e => { e.resize.maxHeight += 1; },
    ];
    for (const change of changes) {
      const changed = cloneEncode(DEFAULT_ENCODE);
      change(changed);
      expect(encodeEquals(DEFAULT_ENCODE, changed)).toBe(false);
    }
  });
});

describe("builtinEncode", () => {
  it("returns a copy of the factory encoding of a built-in preset", () => {
    const encode = builtinEncode("photo");
    expect(encode).toEqual(BUILTIN_PRESETS.find(p => p.id === "photo")!.encode);
    encode!.resize.maxWidth = 1;
    expect(BUILTIN_PRESETS.find(p => p.id === "photo")!.encode.resize.maxWidth).toBe(1920);
  });

  it("returns undefined for user presets", () => {
    expect(builtinEncode("p-abc")).toBeUndefined();
  });
});

describe("presetLabel", () => {
  it("marks a modified preset", () => {
    expect(presetLabel("Default", false)).toBe("Default");
    expect(presetLabel("Default", true)).toBe("Default (modified)");
  });
});
