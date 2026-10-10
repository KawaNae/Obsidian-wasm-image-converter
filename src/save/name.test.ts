import { describe, expect, it } from "vitest";
import moment from "moment";
import { DEFAULT_NAME_TEMPLATE } from "../settings";
import {
  DateFormatter,
  MAX_BASENAME_BYTES,
  NameContext,
  resolveName,
  sanitizeValue,
  stripPathAndExtension,
  truncateUtf8,
} from "./name";

const formatDate: DateFormatter = (date, format) => moment(date).format(format);

// 2026-03-04 05:06:07.089 local time
const date = new Date(2026, 2, 4, 5, 6, 7, 89);

function ctx(extra: Partial<NameContext> = {}): NameContext {
  return { date, ...extra };
}

/** The naming of v0.6.0 (generateFileName), without the extension. */
function legacyBasename(when: Date, sizeBytes: number): string {
  const timestamp = moment(when).format("YYYYMMDD[T]HHmmssSSS");
  const sizeKB = (sizeBytes / 1024).toFixed(2);
  return `IMG-${timestamp}-${sizeKB}`;
}

describe("default template", () => {
  it("matches the v0.6.0 file names", () => {
    expect(resolveName(DEFAULT_NAME_TEMPLATE, ctx({ sizeBytes: 123456 }), formatDate))
      .toBe("IMG-20260304T050607089-120.56");
  });

  it("matches v0.6.0 over many dates and sizes", () => {
    const sizes = [0, 1, 511, 512, 1023, 1024, 1536, 99999, 10 * 1024 * 1024 + 7];
    for (let i = 0; i < 200; i++) {
      const when = new Date(Date.UTC(2020, 0, 1) + i * 7_654_321_987);
      const size = sizes[i % sizes.length] + i;
      expect(resolveName(DEFAULT_NAME_TEMPLATE, ctx({ date: when, sizeBytes: size }), formatDate))
        .toBe(legacyBasename(when, size));
    }
  });
});

describe("variables", () => {
  it("expands {original} without its extension", () => {
    expect(resolveName("{original}", ctx({ original: "IMG_0123.PNG" }), formatDate)).toBe("IMG_0123");
    expect(resolveName("{original}", ctx({ original: "photo.final.jpg" }), formatDate)).toBe("photo.final");
    expect(resolveName("{original}", ctx({ original: "noext" }), formatDate)).toBe("noext");
  });

  it("expands {note} from a note path", () => {
    expect(resolveName("{note}", ctx({ note: "Notes/旅行/京都.md" }), formatDate)).toBe("京都");
    expect(resolveName("{note}", ctx({ note: "Top.md" }), formatDate)).toBe("Top");
  });

  it("expands {date:format} with the injected formatter", () => {
    expect(resolveName("{date:YYYY-MM-DD}", ctx(), formatDate)).toBe("2026-03-04");
    expect(resolveName("x-{date:HHmm}", ctx(), (_, f) => `<${f}>`)).toBe("x-HHmm");
  });

  it("expands {size} in KB with two decimals", () => {
    expect(resolveName("{size}", ctx({ sizeBytes: 2048 }), formatDate)).toBe("2.00");
    expect(resolveName("{size}", ctx({ sizeBytes: 0 }), formatDate)).toBe("0.00");
  });

  it("combines several variables with literal text", () => {
    expect(resolveName("{note}_{original}_{date:YYYYMMDD}", ctx({ note: "日記.md", original: "a.png" }), formatDate))
      .toBe("日記_a_20260304");
  });

  it("keeps unknown variables as literal text", () => {
    expect(resolveName("IMG-{n}-{date}", ctx(), formatDate)).toBe("IMG-{n}-{date}");
  });
});

describe("empty variables", () => {
  it("drops the separator left before or after an empty variable", () => {
    expect(resolveName("IMG-{note}-{size}", ctx({ sizeBytes: 1024 }), formatDate)).toBe("IMG-1.00");
    expect(resolveName("{note}-{original}", ctx({ original: "a.png" }), formatDate)).toBe("a");
    expect(resolveName("{original}-{note}", ctx({ original: "a.png" }), formatDate)).toBe("a");
    expect(resolveName("{original}_{note}.{size}", ctx({ original: "a.png", sizeBytes: 1024 }), formatDate))
      .toBe("a_1.00");
  });

  it("keeps the separator before when both sides have one", () => {
    expect(resolveName("{original} - {note}_{size}", ctx({ original: "a.png", sizeBytes: 1024 }), formatDate))
      .toBe("a - 1.00");
  });

  it("handles several empty variables in a row", () => {
    expect(resolveName("a-{note}-{original}-{size}-b", ctx(), formatDate)).toBe("a-b");
    expect(resolveName("a{note}{original}b", ctx(), formatDate)).toBe("ab");
  });

  it("keeps separators the template writes between filled variables", () => {
    expect(resolveName("{original}--{note}", ctx({ original: "a.png", note: "n.md" }), formatDate)).toBe("a--n");
  });

  it("trims separators at the start and the end of the name", () => {
    expect(resolveName(" -_{original}_- ", ctx({ original: "a.png" }), formatDate)).toBe("a");
    expect(resolveName(".{original}", ctx({ original: "a.png" }), formatDate)).toBe("a");
    expect(resolveName("{original}.", ctx({ original: "a.png" }), formatDate)).toBe("a");
  });

  it("falls back to the default template when nothing is left", () => {
    const expected = legacyBasename(date, 2048);
    expect(resolveName("{note}", ctx({ sizeBytes: 2048 }), formatDate)).toBe(expected);
    expect(resolveName("", ctx({ sizeBytes: 2048 }), formatDate)).toBe(expected);
    expect(resolveName(" - ", ctx({ sizeBytes: 2048 }), formatDate)).toBe(expected);
    expect(resolveName("{original}", ctx({ original: "[[]].png", sizeBytes: 2048 }), formatDate)).toBe(expected);
  });

  it("returns the default template's name even without a size", () => {
    expect(resolveName("{note}", ctx(), formatDate)).toBe("IMG-20260304T050607089");
  });
});

describe("forbidden characters", () => {
  it("replaces them inside values with one dash", () => {
    expect(resolveName("{date:HH:mm}", ctx(), formatDate)).toBe("05-06");
    expect(resolveName("{date:YYYY/MM/DD}", ctx(), formatDate)).toBe("2026-03-04");
    expect(resolveName("{note}", ctx({ note: "a|b#c^d.md" }), formatDate)).toBe("a-b-c-d");
    expect(resolveName("{original}", ctx({ original: 'a*?"<>b.png' }), formatDate)).toBe("a-b");
  });

  it("drops them at the edges of values", () => {
    expect(resolveName("{note}", ctx({ note: "[[会議]].md" }), formatDate)).toBe("会議");
    expect(resolveName("IMG-{note}-x", ctx({ note: "[x].md" }), formatDate)).toBe("IMG-x-x");
  });

  it("replaces them in literal text", () => {
    expect(resolveName("a:b/c\\d", ctx(), formatDate)).toBe("a-b-c-d");
    expect(resolveName("a[b]c", ctx(), formatDate)).toBe("a-b-c");
  });

  it("removes control characters", () => {
    expect(resolveName("{original}", ctx({ original: "a\u0001\nb.png" }), formatDate)).toBe("a-b");
  });

  it("never leaves a forbidden character in the result", () => {
    // "/" is left out: {note} and {original} take the last path segment
    const nasty = '\\:*?"<>|#^[]';
    for (const ch of nasty) {
      const name = resolveName(`x${ch}{note}${ch}{original}${ch}`, ctx({ note: `${ch}n${ch}m${ch}`, original: `o${ch}p.png` }), formatDate);
      expect(name).not.toMatch(/[\\/:*?"<>|#^[\]]/);
      expect(name).toBe("x-n-m-o-p");
    }
  });
});

describe("helpers", () => {
  it("sanitizeValue", () => {
    expect(sanitizeValue("##a##b##")).toBe("a-b");
    expect(sanitizeValue("plain")).toBe("plain");
  });

  it("stripPathAndExtension", () => {
    expect(stripPathAndExtension("a/b/c.d.md")).toBe("c.d");
    expect(stripPathAndExtension(".hidden")).toBe(".hidden");
  });

  it("truncateUtf8 keeps whole characters", () => {
    expect(truncateUtf8("あいう", 7)).toBe("あい");
    expect(truncateUtf8("ab😀c", 5)).toBe("ab");
    expect(truncateUtf8("ab😀c", 6)).toBe("ab😀");
    expect(truncateUtf8("short", 100)).toBe("short");
  });

  it("limits long names", () => {
    const longNote = "長".repeat(300) + ".md";
    const name = resolveName("{note}-{size}", ctx({ note: longNote, sizeBytes: 1 }), formatDate);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(MAX_BASENAME_BYTES);
    expect(name.startsWith("長長長")).toBe(true);
  });

  it("trims a separator left at the end by the cut", () => {
    const original = "a".repeat(MAX_BASENAME_BYTES - 1) + "-bbb.png";
    expect(resolveName("{original}", ctx({ original }), formatDate)).toBe("a".repeat(MAX_BASENAME_BYTES - 1));
  });
});
