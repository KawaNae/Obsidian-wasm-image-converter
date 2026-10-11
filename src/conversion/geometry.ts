// Pure helpers of the conversion layer: output dimensions and quality
// mapping. Must not import "obsidian" or the codecs (unit-tested with vitest).

import { EncodeSettings } from "../settings";

export interface Size {
  width: number;
  height: number;
}

/**
 * Scales width x height down (never up) to fit inside maxWidth x maxHeight,
 * keeping the aspect ratio. Each side is at least 1px.
 */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): Size {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Dimensions the conversion produces for a source of width x height. */
export function outputSize(width: number, height: number, resize: EncodeSettings["resize"]): Size {
  return resize.enabled
    ? fitWithin(width, height, resize.maxWidth, resize.maxHeight)
    : { width, height };
}

/** Maps quality 0.1 - 1.0 (settings) to the 0 - 100 integer the jSquash codecs take. */
export function toPercentQuality(quality: number): number {
  return Math.max(0, Math.min(100, Math.round(quality * 100)));
}
