import { EncodeSettings, ImageFormat } from "../settings";
import { SizePredictionResult } from "./size-predictor";
import { encodeImage } from "../converters/encode";

// Pixel exponent of the power-law extrapolation, per format
// (docs/size-prediction-experiment-2026-07-10.md)
const ALPHA: Record<ImageFormat, number> = {
  webp: 0.75,
  jpeg: 0.8,
  png: 0.75,
  avif: 0.65,
};

/**
 * AVIF encoding is much slower than the others; a smaller sample keeps the
 * dialog responsive even on weak hardware (~0.7s at 6x CPU throttling).
 */
function sampleEdge(format: ImageFormat): number {
  return format === "avif" ? 200 : 400;
}

/**
 * Predicts the converted size by actually encoding a downscaled sample and
 * extrapolating along bytes ∝ pixels^α. Quality/grayscale effects are exact
 * (the sample uses the real settings); only the pixel scaling is modeled.
 */
export async function predictBySampleEncode(
  file: File,
  options: EncodeSettings
): Promise<SizePredictionResult | null> {
  try {
    const bmp = await createImageBitmap(file);
    const width = bmp.width, height = bmp.height;
    bmp.close();

    // Dimensions the real conversion would produce
    const targetScale = options.resize.enabled
      ? Math.min(1, options.resize.maxWidth / width, options.resize.maxHeight / height)
      : 1;
    const targetPx = Math.max(1, Math.round(width * targetScale))
      * Math.max(1, Math.round(height * targetScale));

    const edge = sampleEdge(options.format);
    const sampleScale = Math.min(1, edge / width, edge / height);
    const samplePx = Math.max(1, Math.round(width * sampleScale))
      * Math.max(1, Math.round(height * sampleScale));

    if (targetPx <= samplePx) {
      // Output is no bigger than the sample: encode at the real output size
      const { blob } = await encodeImage(file, options);
      return { predictedSize: blob.size, confidence: 1, method: "sample-encode-exact" };
    }

    const { blob } = await encodeImage(file, {
      ...options,
      resize: { enabled: true, maxWidth: edge, maxHeight: edge },
    });
    const alpha = ALPHA[options.format];
    const predictedSize = Math.round(blob.size * Math.pow(targetPx / samplePx, alpha));
    return { predictedSize, confidence: 0.9, method: "sample-encode" };
  } catch (e) {
    console.warn("Sampled size prediction failed:", e);
    return null;
  }
}
