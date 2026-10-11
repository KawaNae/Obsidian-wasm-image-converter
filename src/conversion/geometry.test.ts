import { describe, expect, it } from "vitest";
import { fitWithin, outputSize, toPercentQuality } from "./geometry";

describe("fitWithin", () => {
  it("keeps images that already fit", () => {
    expect(fitWithin(800, 600, 1920, 1080)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1920, 1080, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("never scales up", () => {
    expect(fitWithin(100, 50, 4000, 4000)).toEqual({ width: 100, height: 50 });
  });

  it("scales by the tighter side and keeps the aspect ratio", () => {
    // width-bound
    expect(fitWithin(4000, 2000, 1920, 1080)).toEqual({ width: 1920, height: 960 });
    // height-bound (portrait)
    expect(fitWithin(3000, 4000, 1920, 1080)).toEqual({ width: 810, height: 1080 });
  });

  it("rounds and keeps every side at least 1px", () => {
    expect(fitWithin(3264, 2448, 400, 400)).toEqual({ width: 400, height: 300 });
    expect(fitWithin(10000, 10, 100, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe("outputSize", () => {
  it("ignores the limits when resizing is off", () => {
    expect(outputSize(6000, 4000, { enabled: false, maxWidth: 100, maxHeight: 100 })).toEqual({ width: 6000, height: 4000 });
  });

  it("applies the limits when resizing is on", () => {
    expect(outputSize(6000, 4000, { enabled: true, maxWidth: 1920, maxHeight: 1080 })).toEqual({ width: 1620, height: 1080 });
  });
});

describe("toPercentQuality", () => {
  it("maps 0.1 - 1.0 to integer percent", () => {
    expect(toPercentQuality(0.8)).toBe(80);
    expect(toPercentQuality(0.75)).toBe(75);
    expect(toPercentQuality(1)).toBe(100);
    expect(toPercentQuality(0.1)).toBe(10);
    expect(toPercentQuality(0.555)).toBe(56);
  });

  it("clamps out-of-range values", () => {
    expect(toPercentQuality(1.5)).toBe(100);
    expect(toPercentQuality(-0.2)).toBe(0);
  });
});
