// Pure: unit-tested with vitest.

/**
 * Converts RGBA pixels to grayscale in place using the luminance formula
 * Y = 0.299 R + 0.587 G + 0.114 B. Alpha is kept.
 */
export function grayscaleInPlace(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const gray = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    rgba[i] = gray;
    rgba[i + 1] = gray;
    rgba[i + 2] = gray;
  }
}
