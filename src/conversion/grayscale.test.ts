import { describe, expect, it } from "vitest";
import { grayscaleInPlace } from "./grayscale";

describe("grayscaleInPlace", () => {
  it("replaces RGB by the luminance and keeps alpha", () => {
    const px = new Uint8ClampedArray([
      255, 0, 0, 255,   // red   -> 76
      0, 255, 0, 128,   // green -> 150
      0, 0, 255, 0,     // blue  -> 29
      10, 20, 30, 7,    // mixed -> round(2.99 + 11.74 + 3.42) = 18
    ]);
    grayscaleInPlace(px);
    expect(Array.from(px)).toEqual([
      76, 76, 76, 255,
      150, 150, 150, 128,
      29, 29, 29, 0,
      18, 18, 18, 7,
    ]);
  });
});
