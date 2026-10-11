import { describe, expect, it } from "vitest";
import { DIALOG_EXTENSIONS } from "../../settings";
import { dropZoneHint, formatNames, isImageFile, pastedFiles, pastedImages } from "./drop-zone-input";

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

describe("pastedImages", () => {
  it("keeps the images among the pasted files", () => {
    const a = file("image.png", "image/png");
    const b = file("notes.pdf", "application/pdf");
    const c = file("photo.jpg", "image/jpeg");
    expect(pastedImages({ files: [a, b, c] })).toEqual([a, c]);
  });

  it("returns nothing for a paste of text, which then tells there is no image", () => {
    expect(pastedImages({ files: [], items: [item("string", null)] })).toEqual([]);
  });

  it("returns nothing for a paste of files none of which is an image", () => {
    expect(pastedImages({ files: [file("notes.pdf", "application/pdf")] })).toEqual([]);
  });

  it("finds the images among the file items too", () => {
    const a = file("123.png", "image/png");
    expect(pastedImages({ files: [], items: [item("string", null), item("file", a)] })).toEqual([a]);
  });
});

describe("isImageFile", () => {
  it("takes any image type and nothing else", () => {
    expect(isImageFile({ type: "image/webp" })).toBe(true);
    expect(isImageFile({ type: "application/pdf" })).toBe(false);
    expect(isImageFile({ type: "" })).toBe(false);
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

describe("formatNames", () => {
  it("names jpg and jpeg once, and WebP as it is written", () => {
    expect(formatNames(["jpg", "jpeg", "png", "webp"])).toBe("JPG, PNG, WebP");
  });

  it("names the formats of the dialog, without TIFF", () => {
    expect(formatNames(DIALOG_EXTENSIONS)).toBe("JPG, PNG, GIF, BMP, WebP");
  });
});
