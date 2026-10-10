import { describe, expect, it } from "vitest";
import { EncodeSettings } from "../settings";
import { analysisSize, complexity, estimateByHeuristic, extrapolate, planSample } from "./estimate";

const base: EncodeSettings = {
  format: "webp",
  quality: 0.8,
  resize: { enabled: false, maxWidth: 1920, maxHeight: 1080 },
  grayscale: false,
};
const withFormat = (format: EncodeSettings["format"], over: Partial<EncodeSettings> = {}): EncodeSettings =>
  ({ ...base, format, ...over });

/** RGBA pixels, `n` of them, where pixel i has gray value f(i). */
function pixels(n: number, f: (i: number) => number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) a.set([f(i), f(i), f(i), 255], i * 4);
  return a;
}

describe("complexity", () => {
  it("is 0 for a flat image", () => {
    expect(complexity(pixels(1000, () => 128))).toBe(0);
  });

  it("compares every 10th pixel with the one 10 before", () => {
    // Pixels 0, 10, 20, ... alternate between 0 and 255: each compared pair
    // differs by 255 on all three channels -> 3 * 255 / 255, capped at 1
    expect(complexity(pixels(1000, i => (Math.floor(i / 10) % 2) * 255))).toBe(1);
    // A difference of 17 per channel -> 51 / 255 = 0.2
    expect(complexity(pixels(1000, i => (Math.floor(i / 10) % 2) * 17))).toBeCloseTo(0.2, 10);
  });

  it("skips the 9 pixels in between", () => {
    // Only pixels 10, 30, 50, ... are bright: each sampled pair differs fully,
    // whereas comparing every pixel with the one 10 before would see a
    // difference in only 1 of 10 pairs.
    expect(complexity(pixels(1000, i => (i % 10 === 0 && Math.floor(i / 10) % 2 === 1) ? 255 : 0))).toBe(1);
  });

  it("falls back to 0.5 when there are not enough pixels", () => {
    expect(complexity(pixels(5, () => 0))).toBe(0.5);
  });
});

describe("analysisSize", () => {
  it("caps each side at 200px without keeping the aspect ratio", () => {
    expect(analysisSize(3264, 2448)).toEqual({ width: 200, height: 200 });
    expect(analysisSize(150, 900)).toEqual({ width: 150, height: 200 });
  });
});

describe("estimateByHeuristic", () => {
  const stats = { width: 4000, height: 3000, complexity: 0.3 };

  it("predicts on the resized dimensions", () => {
    const full = estimateByHeuristic(stats, base).predictedSize;
    const resized = estimateByHeuristic(stats, { ...base, resize: { enabled: true, maxWidth: 2000, maxHeight: 2000 } }).predictedSize;
    // 4x fewer pixels, pixel exponent 0.75 for WebP
    expect(resized / full).toBeCloseTo(Math.pow(0.25, 0.75), 3);
  });

  it("matches the calibrated WebP power law", () => {
    // pixels^0.75 * 3.0 * complexity^0.42 at the reference quality 0.8
    const expected = Math.round(Math.pow(12e6, 0.75) * 3.0 * Math.pow(0.3, 0.42));
    expect(estimateByHeuristic(stats, base)).toEqual({ predictedSize: expected, method: "heuristic" });
  });

  it("scales lossy formats with quality and ignores quality for PNG", () => {
    const lo = estimateByHeuristic(stats, withFormat("jpeg", { quality: 0.4 })).predictedSize;
    const hi = estimateByHeuristic(stats, withFormat("jpeg", { quality: 0.8 })).predictedSize;
    expect(lo).toBeLessThan(hi);
    expect(estimateByHeuristic(stats, withFormat("png", { quality: 0.1 })).predictedSize)
      .toBe(estimateByHeuristic(stats, withFormat("png", { quality: 1 })).predictedSize);
  });

  it("shrinks grayscale output by the gray factor", () => {
    const color = estimateByHeuristic(stats, withFormat("avif", { quality: 0.75 })).predictedSize;
    const gray = estimateByHeuristic(stats, withFormat("avif", { quality: 0.75, grayscale: true })).predictedSize;
    expect(gray / color).toBeCloseTo(0.7, 3);
  });

  it("applies the PNG per-pixel floor and the 1 KiB minimum", () => {
    // complexity 0 -> the power law gives 0; PNG falls back to pixels * 0.02
    expect(estimateByHeuristic({ ...stats, complexity: 0 }, withFormat("png")).predictedSize).toBe(240000);
    expect(estimateByHeuristic({ ...stats, complexity: 0 }, base).predictedSize).toBe(1024);
  });
});

describe("planSample", () => {
  it("encodes for real when the output is no bigger than the sample", () => {
    expect(planSample(300, 200, base)).toEqual({ kind: "exact" });
    // resized down below the 400px sample
    expect(planSample(4000, 3000, { ...base, resize: { enabled: true, maxWidth: 400, maxHeight: 300 } })).toEqual({ kind: "exact" });
  });

  it("samples at 400px, or 200px for AVIF, and targets the output pixel count", () => {
    expect(planSample(3264, 2448, base)).toEqual({ kind: "sample", sample: { width: 400, height: 300 }, targetPixels: 3264 * 2448 });
    expect(planSample(3264, 2448, withFormat("avif", { resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 } })))
      .toEqual({ kind: "sample", sample: { width: 200, height: 150 }, targetPixels: 1440 * 1080 });
  });
});

describe("extrapolate", () => {
  it("scales by the pixel ratio to the format's exponent", () => {
    const sample = { width: 400, height: 300 };
    expect(extrapolate(10000, sample, 120000, "webp")).toBe(10000);
    expect(extrapolate(10000, sample, 120000 * 16, "webp")).toBe(80000); // 16^0.75 = 8
    expect(extrapolate(10000, sample, 120000 * 16, "avif")).toBe(Math.round(10000 * Math.pow(16, 0.65)));
  });
});
