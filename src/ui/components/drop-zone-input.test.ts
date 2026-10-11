import { describe, expect, it } from "vitest";
import { dropZoneHint, pastedFiles } from "./drop-zone-input";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function item(kind: string, f: File | null) {
  return { kind, getAsFile: () => f };
}

describe("pastedFiles", () => {
  it("takes the files of the paste", () => {
    const a = file("image.png", "image/png");
    const b = file("notes.pdf", "application/pdf");
    expect(pastedFiles({ files: [a, b], items: [] })).toEqual([a, b]);
  });

  it("prefers files over items, not to take the same file twice", () => {
    const a = file("image.png", "image/png");
    expect(pastedFiles({ files: [a], items: [item("file", a)] })).toEqual([a]);
  });

  it("falls back to the file items when files is empty", () => {
    const a = file("123.png", "image/png");
    const got = pastedFiles({ files: [], items: [item("string", null), item("file", a), item("file", null)] });
    expect(got).toEqual([a]);
  });

  it("returns nothing for a paste of text", () => {
    expect(pastedFiles({ files: [], items: [item("string", null)] })).toEqual([]);
  });

  it("returns nothing when there is no clipboard data", () => {
    expect(pastedFiles(null)).toEqual([]);
    expect(pastedFiles(undefined)).toEqual([]);
    expect(pastedFiles({})).toEqual([]);
  });
});

describe("dropZoneHint", () => {
  it("tells Android users to long-press, as a phone has no drag & drop", () => {
    expect(dropZoneHint("android")).toEqual({ heading: "Long-press here and tap Paste", paste: null });
  });

  it("names the paste key of the desktop", () => {
    expect(dropZoneHint("mac").paste).toContain("Cmd+V");
    expect(dropZoneHint("desktop").paste).toContain("Ctrl+V");
  });

  it("keeps iOS as it was", () => {
    expect(dropZoneHint("ios")).toEqual({ heading: "Drag & drop images here", paste: null });
  });
});
