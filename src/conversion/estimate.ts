// Pure part of the size prediction: the calibrated power-law heuristics and
// the sample-encode extrapolation (docs/size-prediction-experiment-2026-07-10.md).
// Must not import "obsidian" or the codecs (unit-tested with vitest).

import { EncodeSettings, ImageFormat } from "../settings";
import { fitWithin, outputSize, Size } from "./geometry";

export interface SizePrediction {
  predictedSize: number; // bytes
  method: "heuristic" | "sample-encode" | "sample-encode-exact";
}

/** Settings-independent features of a source image, computed once per decode. */
export interface ImageStats {
  width: number;
  height: number;
  /** 0 - 1, mean neighbor difference on the analysis thumbnail */
  complexity: number;
}

/**
 * Size of the analysis thumbnail. Each side is capped at 200px without
 * keeping the aspect ratio; the heuristics were calibrated on this.
 */
export function analysisSize(width: number, height: number): Size {
  return { width: Math.min(width, 200), height: Math.min(height, 200) };
}

/**
 * Complexity of RGBA pixels: the mean absolute RGB difference between every
 * 10th pixel and the pixel 10 before it, normalized to 0 - 1.
 */
export function complexity(rgba: ArrayLike<number>): number {
  let total = 0;
  let count = 0;
  for (let i = 40; i < rgba.length; i += 40) {
    total += Math.abs(rgba[i] - rgba[i - 40])
      + Math.abs(rgba[i + 1] - rgba[i - 39])
      + Math.abs(rgba[i + 2] - rgba[i - 38]);
    count++;
  }
  return count > 0 ? Math.min(total / count / 255, 1) : 0.5;
}

// bytes ≈ pixels^pixelExp × scale × complexity^complexityExp × quality factor × gray factor,
// calibrated at qualityRef against real encodes.
interface PowerLawModel {
  scale: number;
  pixelExp: number;
  complexityExp: number;
  /** lossy only: quality factor (q / qualityRef)^qualityExp */
  quality?: { ref: number; exp: number };
  /** lower bound in bytes per pixel (PNG filter/entropy overhead) */
  floorPerPixel?: number;
}

const HEURISTICS: Record<ImageFormat, PowerLawModel> = {
  webp: { scale: 3.0, pixelExp: 0.75, complexityExp: 0.42, quality: { ref: 0.8, exp: 0.75 } },
  jpeg: { scale: 3.0, pixelExp: 0.8, complexityExp: 0.42, quality: { ref: 0.8, exp: 0.7 } },
  // AVIF flattens detail more aggressively at scale, hence the lower pixel exponent
  avif: { scale: 18.3, pixelExp: 0.65, complexityExp: 0.76, quality: { ref: 0.75, exp: 0.8 } },
  // Lossless. PNG scales the least regularly; expect roughly ±40% on real content
  png: { scale: 302, pixelExp: 0.75, complexityExp: 1.7, floorPerPixel: 0.02 },
};

const GRAY_FACTOR = 0.7;
const MIN_PREDICTION = 1024; // container header + minimal data

/** Instant estimate from the image statistics alone. */
export function estimateByHeuristic(stats: ImageStats, encode: EncodeSettings): SizePrediction {
  const model = HEURISTICS[encode.format];
  const { width, height } = outputSize(stats.width, stats.height, encode.resize);
  const pixels = width * height;
  const qualityFactor = model.quality ? Math.pow(encode.quality / model.quality.ref, model.quality.exp) : 1;
  const grayFactor = encode.grayscale ? GRAY_FACTOR : 1;
  const bytes = Math.pow(pixels, model.pixelExp)
    * model.scale * Math.pow(stats.complexity, model.complexityExp)
    * qualityFactor * grayFactor;
  const floored = Math.max(bytes, pixels * (model.floorPerPixel ?? 0));
  return { predictedSize: Math.max(Math.round(floored), MIN_PREDICTION), method: "heuristic" };
}

// Pixel exponent of the sample-encode extrapolation, per format
const SAMPLE_ALPHA: Record<ImageFormat, number> = {
  webp: 0.75,
  jpeg: 0.8,
  png: 0.75,
  avif: 0.65,
};

/**
 * Longest sample edge. AVIF encoding is much slower than the others; a
 * smaller sample keeps the dialog responsive even on weak hardware
 * (~0.7s at 6x CPU throttling).
 */
const SAMPLE_EDGE: Record<ImageFormat, number> = {
  webp: 400,
  jpeg: 400,
  png: 400,
  avif: 200,
};

export type SamplePlan =
  /** the output is no bigger than a sample: encode it for real */
  | { kind: "exact" }
  /** encode at `sample` and scale the size up to `targetPixels` */
  | { kind: "sample"; sample: Size; targetPixels: number };

export function planSample(width: number, height: number, encode: EncodeSettings): SamplePlan {
  const target = outputSize(width, height, encode.resize);
  const edge = SAMPLE_EDGE[encode.format];
  const sample = fitWithin(width, height, edge, edge);
  const targetPixels = target.width * target.height;
  if (targetPixels <= sample.width * sample.height) return { kind: "exact" };
  return { kind: "sample", sample, targetPixels };
}

/** bytes ∝ pixels^α: scales the sample's encoded size to the output's pixel count. */
export function extrapolate(sampleBytes: number, sample: Size, targetPixels: number, format: ImageFormat): number {
  const ratio = targetPixels / (sample.width * sample.height);
  return Math.round(sampleBytes * Math.pow(ratio, SAMPLE_ALPHA[format]));
}
