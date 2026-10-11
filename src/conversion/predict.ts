import { EncodeSettings } from "../settings";
import { DecodedImage } from "./decode";
import { convert } from "./convert";
import { encoderFor } from "./encoders";
import { drawPixels, render } from "./render";
import { analysisSize, complexity, extrapolate, ImageStats, planSample, SizePrediction } from "./estimate";

export type { ImageStats, SizePrediction } from "./estimate";
export { estimateByHeuristic } from "./estimate";

/**
 * Computes the statistics the heuristic needs. Once per decode; independent
 * of the settings. Draws with the default ("low") smoothing, which is what
 * the heuristics were calibrated on.
 */
export function analyze(decoded: DecodedImage): ImageStats {
  const size = analysisSize(decoded.width, decoded.height);
  const thumb = drawPixels(decoded, size, { grayscale: false, smoothing: "low" });
  return { width: decoded.width, height: decoded.height, complexity: complexity(thumb.data) };
}

/**
 * Predicts the converted size by actually encoding a downscaled sample and
 * extrapolating along bytes ∝ pixels^α. Quality/grayscale effects are exact
 * (the sample uses the real settings); only the pixel scaling is modeled.
 * Returns null when encoding fails.
 */
export async function estimateBySample(decoded: DecodedImage, encode: EncodeSettings): Promise<SizePrediction | null> {
  try {
    const plan = planSample(decoded.width, decoded.height, encode);
    if (plan.kind === "exact") {
      const blob = await convert(decoded, encode);
      return { predictedSize: blob.size, method: "sample-encode-exact" };
    }
    const { data, width, height } = render(decoded, encode, plan.sample);
    const blob = await encoderFor(encode.format).encode(data, width, height, encode.quality);
    return { predictedSize: extrapolate(blob.size, plan.sample, plan.targetPixels, encode.format), method: "sample-encode" };
  } catch (e) {
    console.warn("Sampled size prediction failed:", e);
    return null;
  }
}
