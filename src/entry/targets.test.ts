import { describe, expect, it } from "vitest";
import {
  batchSummary, batchTargets, countByExtension, emptyTally, isAutoConvertTarget,
  isGifFile, isInFolder, isLargerAfterConversion, joinLinks, planIncoming,
} from "./targets";

const EXTS = ["jpg", "jpeg", "png", "gif", "bmp"];

describe("isAutoConvertTarget", () => {
  it("needs both an image type and a target extension", () => {
    expect(isAutoConvertTarget({ name: "a.PNG", type: "image/png" }, EXTS)).toBe(true);
    expect(isAutoConvertTarget({ name: "image.png", type: "image/png" }, EXTS)).toBe(true);
    expect(isAutoConvertTarget({ name: "a.webp", type: "image/webp" }, EXTS)).toBe(false);
    expect(isAutoConvertTarget({ name: "a.png", type: "" }, EXTS)).toBe(false);
    expect(isAutoConvertTarget({ name: "a.pdf", type: "application/pdf" }, EXTS)).toBe(false);
  });

  it("follows the configured extensions", () => {
    expect(isAutoConvertTarget({ name: "a.gif", type: "image/gif" }, ["png"])).toBe(false);
  });
});

describe("planIncoming", () => {
  const png = { name: "a.png", type: "image/png" };
  const pdf = { name: "doc.pdf", type: "application/pdf" };
  const webp = { name: "b.webp", type: "image/webp" };

  it("leaves the event to Obsidian without a target image", () => {
    expect(planIncoming([pdf, webp], EXTS)).toBeNull();
    expect(planIncoming([], EXTS)).toBeNull();
  });

  it("attaches the other files, keeping the order", () => {
    expect(planIncoming([pdf, png, webp], EXTS)).toEqual([
      { file: pdf, action: "attach" },
      { file: png, action: "convert" },
      { file: webp, action: "attach" },
    ]);
  });
});

describe("isGifFile", () => {
  it("looks at the type or the name", () => {
    expect(isGifFile({ name: "x", type: "image/gif" })).toBe(true);
    expect(isGifFile({ name: "x.GIF", type: "" })).toBe(true);
    expect(isGifFile({ name: "x.png", type: "image/png" })).toBe(false);
  });
});

describe("joinLinks", () => {
  it("keeps the order and puts each link on its own line", () => {
    expect(joinLinks(["![[a.webp]]", "![[b.webp]]", "![[c.webp]]"])).toBe("![[a.webp]]\n![[b.webp]]\n![[c.webp]]");
    expect(joinLinks(["![[a.webp]]"])).toBe("![[a.webp]]");
    expect(joinLinks([])).toBe("");
  });
});

describe("isInFolder / batchTargets", () => {
  const files = [
    { path: "a.png", extension: "png" },
    { path: "Notes/b.JPG", extension: "JPG" },
    { path: "Notes/旅行/c.gif", extension: "gif" },
    { path: "Notes2/d.png", extension: "png" },
    { path: "Notes/e.webp", extension: "webp" },
    { path: "Notes/f.md", extension: "md" },
  ];

  it("treats the root as the whole vault", () => {
    expect(isInFolder("a.png", "")).toBe(true);
    expect(isInFolder("Notes/b.png", "/")).toBe(true);
  });

  it("does not take a folder with a longer name as a subfolder", () => {
    expect(isInFolder("Notes2/d.png", "Notes")).toBe(false);
    expect(isInFolder("Notes/旅行/c.gif", "Notes/")).toBe(true);
  });

  it("selects the target extensions of a folder and its subfolders", () => {
    expect(batchTargets(files, EXTS, "").map(f => f.path)).toEqual(["a.png", "Notes/b.JPG", "Notes/旅行/c.gif", "Notes2/d.png"]);
    expect(batchTargets(files, EXTS, "Notes").map(f => f.path)).toEqual(["Notes/b.JPG", "Notes/旅行/c.gif"]);
    expect(batchTargets(files, ["png"], "Notes")).toEqual([]);
  });
});

describe("countByExtension", () => {
  it("counts lower-cased extensions, the most frequent first", () => {
    const files = [{ extension: "png" }, { extension: "JPG" }, { extension: "jpg" }, { extension: "bmp" }, { extension: "PNG" }, { extension: "jpg" }];
    expect(countByExtension(files)).toEqual([["jpg", 3], ["png", 2], ["bmp", 1]]);
  });
});

describe("isLargerAfterConversion", () => {
  it("skips only results that are larger", () => {
    expect(isLargerAfterConversion(1000, 1001)).toBe(true);
    expect(isLargerAfterConversion(1000, 1000)).toBe(false);
    expect(isLargerAfterConversion(1000, 10)).toBe(false);
  });
});

describe("batchSummary", () => {
  it("reports conversions, skips and savings", () => {
    const t = { ...emptyTally(5), converted: 2, skippedLarger: 1, skippedAnimated: 1, failed: 1, originalBytes: 2 * 1024 * 1024, convertedBytes: 1024 * 1024, processed: 5 };
    expect(batchSummary(t)).toBe([
      "Batch conversion complete",
      "Converted: 2",
      "Skipped (would be larger): 1",
      "Skipped (animated GIF): 1",
      "Failed: 1",
      "Saved: 1.00 MB (50.0%)",
    ].join("\n"));
  });

  it("says where a cancel stopped", () => {
    expect(batchSummary({ ...emptyTally(10), processed: 3, cancelled: true })).toBe("Batch conversion cancelled (3/10)\nConverted: 0");
  });
});
