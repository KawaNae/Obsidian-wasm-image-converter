import { describe, expect, it } from "vitest";
import { attachmentFolderFor, availableName, joinPath, nameSet, parentPath, replacementName } from "./paths";

describe("joinPath / parentPath", () => {
  it("joins with the root and with folders", () => {
    expect(joinPath("", "a.webp")).toBe("a.webp");
    expect(joinPath("/", "a.webp")).toBe("a.webp");
    expect(joinPath("Attachments", "a.webp")).toBe("Attachments/a.webp");
    expect(joinPath("Notes/旅行/", "a.webp")).toBe("Notes/旅行/a.webp");
  });

  it("returns the folder of a path", () => {
    expect(parentPath("a.webp")).toBe("");
    expect(parentPath("Notes/旅行/a.webp")).toBe("Notes/旅行");
  });
});

describe("availableName", () => {
  it("uses the name as is when free", () => {
    expect(availableName("IMG", "webp", nameSet([]))).toBe("IMG.webp");
  });

  it("adds \" 1\", \" 2\", ... as Obsidian does, beyond 9 without limit", () => {
    const taken = ["IMG.webp"];
    for (let i = 1; i <= 25; i++) taken.push(`IMG ${i}.webp`);
    expect(availableName("IMG", "webp", nameSet(taken))).toBe("IMG 26.webp");
  });

  it("fills the first gap", () => {
    expect(availableName("IMG", "webp", nameSet(["IMG.webp", "IMG 1.webp", "IMG 3.webp"]))).toBe("IMG 2.webp");
  });

  it("compares names without regard to case", () => {
    expect(availableName("img", "webp", nameSet(["IMG.WEBP"]))).toBe("img 1.webp");
  });

  it("only counts names with the same extension", () => {
    expect(availableName("IMG", "webp", nameSet(["IMG.png"]))).toBe("IMG.webp");
  });
});

describe("replacementName", () => {
  it("keeps the base name and changes the extension", () => {
    expect(replacementName("IMG_0123", "png", "webp", nameSet([]))).toBe("IMG_0123.webp");
  });

  it("returns null when the extension does not change", () => {
    expect(replacementName("IMG_0123", "webp", "webp", nameSet([]))).toBeNull();
    expect(replacementName("IMG_0123", "JPG", "jpg", nameSet([]))).toBeNull();
  });

  it("adds a number when another file has the new name", () => {
    expect(replacementName("IMG_0123", "png", "webp", nameSet(["IMG_0123.webp"]))).toBe("IMG_0123 1.webp");
    expect(replacementName("IMG_0123", "png", "webp", nameSet(["img_0123.WEBP", "IMG_0123 1.webp"]))).toBe("IMG_0123 2.webp");
  });
});

describe("attachmentFolderFor", () => {
  it("uses a vault path as is", () => {
    expect(attachmentFolderFor("Attachments", "Notes/a.md")).toBe("Attachments");
    expect(attachmentFolderFor("Assets/img/", null)).toBe("Assets/img");
  });

  it("returns \"\" for the vault root", () => {
    expect(attachmentFolderFor("/", "Notes/a.md")).toBe("");
    expect(attachmentFolderFor("", "Notes/a.md")).toBe("");
  });

  it("resolves the note's folder and its subfolders", () => {
    expect(attachmentFolderFor("./", "Notes/旅行/a.md")).toBe("Notes/旅行");
    expect(attachmentFolderFor(".", "a.md")).toBe("");
    expect(attachmentFolderFor("./assets", "Notes/a.md")).toBe("Notes/assets");
    expect(attachmentFolderFor("./assets", "a.md")).toBe("assets");
  });

  it("treats a missing note as one in the root", () => {
    expect(attachmentFolderFor("./", null)).toBe("");
    expect(attachmentFolderFor("./assets", null)).toBe("assets");
  });
});
