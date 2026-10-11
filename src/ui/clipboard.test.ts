import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isIosApp: false, isAndroidApp: false }));
vi.mock("obsidian", () => ({ Platform: platform }));

import { autoReadClipboardBlock, canAutoReadClipboard, canPasteByButton } from "./clipboard";

describe("reading the clipboard per device", () => {
  beforeEach(() => {
    platform.isIosApp = false;
    platform.isAndroidApp = false;
  });

  it("reads it as the dialog opens, and by the button, on a desktop", () => {
    expect(autoReadClipboardBlock()).toBeNull();
    expect(canAutoReadClipboard()).toBe(true);
    expect(canPasteByButton()).toBe(true);
  });

  it("does not read it as the dialog opens on iOS, and tells why", () => {
    platform.isIosApp = true;
    expect(canAutoReadClipboard()).toBe(false);
    expect(autoReadClipboardBlock()).toContain("Not available on iOS");
    expect(canPasteByButton()).toBe(true);
  });

  it("reads it neither as the dialog opens nor by the button on Android", () => {
    platform.isAndroidApp = true;
    expect(canAutoReadClipboard()).toBe(false);
    expect(autoReadClipboardBlock()).toContain("Not available on Android");
    expect(canPasteByButton()).toBe(false);
  });
});
