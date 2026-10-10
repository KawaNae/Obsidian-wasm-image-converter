import { EncodeSettings, ImageFormat } from "../settings";
import { SizePredictor, SizePredictionResult } from "./size-predictor";

/**
 * Base class for Canvas API-based format predictors.
 * Shares image analysis logic with WebPSizePredictor but uses format-specific formulas.
 */
abstract class CanvasSizePredictor implements SizePredictor {
  abstract supportedType: ImageFormat;
  abstract predict(originalFile: File, options: EncodeSettings): Promise<SizePredictionResult>;

  protected async analyzeImage(file: File): Promise<{
    width: number;
    height: number;
    complexity: number;
  }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        canvas.width = Math.min(img.width, 200);
        canvas.height = Math.min(img.height, 200);

        if (!ctx) {
          resolve({ width: img.width, height: img.height, complexity: 0.5 });
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          let totalVariance = 0;
          let sampleCount = 0;

          for (let i = 40; i < data.length; i += 40) {
            const variance = Math.abs(data[i] - data[i - 40]) +
              Math.abs(data[i + 1] - data[i - 39]) +
              Math.abs(data[i + 2] - data[i - 38]);
            totalVariance += variance;
            sampleCount++;
          }

          const complexity = sampleCount > 0
            ? Math.min((totalVariance / sampleCount) / 255, 1)
            : 0.5;

          resolve({ width: img.width, height: img.height, complexity });
        } catch {
          resolve({ width: img.width, height: img.height, complexity: 0.5 });
        }

        URL.revokeObjectURL(img.src);
      };

      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image for analysis'));
      };

      img.src = URL.createObjectURL(file);
    });
  }

  protected calculateEffectiveDimensions(
    originalWidth: number,
    originalHeight: number,
    options: EncodeSettings
  ): { width: number; height: number } {
    if (!options.resize.enabled) {
      return { width: originalWidth, height: originalHeight };
    }

    if (originalWidth <= options.resize.maxWidth && originalHeight <= options.resize.maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    const scaleByWidth = options.resize.maxWidth / originalWidth;
    const scaleByHeight = options.resize.maxHeight / originalHeight;
    const scale = Math.min(scaleByWidth, scaleByHeight);

    return {
      width: Math.round(originalWidth * scale),
      height: Math.round(originalHeight * scale)
    };
  }
}

/**
 * JPEG size predictor. JPEG is lossy, so size depends heavily on quality and image complexity.
 * Typically ~30% larger than WebP at the same visual quality.
 */
export class JPEGSizePredictor extends CanvasSizePredictor {
  supportedType: ImageFormat = "jpeg";

  async predict(originalFile: File, options: EncodeSettings): Promise<SizePredictionResult> {
    const imageData = await this.analyzeImage(originalFile);
    const dims = this.calculateEffectiveDimensions(imageData.width, imageData.height, options);

    // Power-law model: bytes ≈ pixels^0.8 × 3.0 × complexity^0.42,
    // calibrated at q=0.8 against real encodes
    // (docs/size-prediction-experiment-2026-07-10.md)
    const pixels = dims.width * dims.height;
    const contentFactor = 3.0 * Math.pow(imageData.complexity, 0.42);
    const qualityFactor = Math.pow(options.quality / 0.8, 0.7);
    const grayFactor = options.grayscale ? 0.7 : 1;
    const predictedSize = Math.round(Math.pow(pixels, 0.8) * contentFactor * qualityFactor * grayFactor);

    let confidence = 0.65;
    const fileType = originalFile.type.toLowerCase();
    if (fileType.includes('jpeg') || fileType.includes('jpg')) confidence += 0.1;
    else if (fileType.includes('png')) confidence += 0.05;

    const sizeMB = originalFile.size / (1024 * 1024);
    if (sizeMB < 0.1 || sizeMB > 50) confidence -= 0.2;
    if (options.quality < 0.3 || options.quality > 0.95) confidence -= 0.1;

    return {
      predictedSize: Math.max(predictedSize, 1024),
      confidence: Math.max(0.3, Math.min(0.85, confidence)),
      method: 'jpeg-heuristic'
    };
  }
}

/**
 * AVIF size predictor. AVIF is lossy (by default), ~20% more efficient than WebP.
 */
export class AVIFSizePredictor extends CanvasSizePredictor {
  supportedType: ImageFormat = "avif";

  async predict(originalFile: File, options: EncodeSettings): Promise<SizePredictionResult> {
    const imageData = await this.analyzeImage(originalFile);
    const dims = this.calculateEffectiveDimensions(imageData.width, imageData.height, options);

    // Power-law model: bytes ≈ pixels^0.65 × 18.3 × complexity^0.76,
    // calibrated at q=0.75 against real encodes. AVIF flattens detail more
    // aggressively at scale, hence the lower pixel exponent.
    // (docs/size-prediction-experiment-2026-07-10.md)
    const pixels = dims.width * dims.height;
    const contentFactor = 18.3 * Math.pow(imageData.complexity, 0.76);
    const qualityFactor = Math.pow(options.quality / 0.75, 0.8);
    const grayFactor = options.grayscale ? 0.7 : 1;
    const predictedSize = Math.round(Math.pow(pixels, 0.65) * contentFactor * qualityFactor * grayFactor);

    let confidence = 0.55;
    const fileType = originalFile.type.toLowerCase();
    if (fileType.includes('jpeg') || fileType.includes('jpg')) confidence += 0.1;
    else if (fileType.includes('png')) confidence += 0.05;

    const sizeMB = originalFile.size / (1024 * 1024);
    if (sizeMB < 0.1 || sizeMB > 50) confidence -= 0.2;
    if (options.quality < 0.3 || options.quality > 0.95) confidence -= 0.1;

    return {
      predictedSize: Math.max(predictedSize, 1024),
      confidence: Math.max(0.25, Math.min(0.75, confidence)),
      method: 'avif-heuristic'
    };
  }
}

/**
 * PNG size predictor. PNG is lossless, so quality setting has no effect.
 * Size depends mainly on image dimensions, color depth, and how compressible the data is.
 */
export class PNGSizePredictor extends CanvasSizePredictor {
  supportedType: ImageFormat = "png";

  async predict(originalFile: File, options: EncodeSettings): Promise<SizePredictionResult> {
    const imageData = await this.analyzeImage(originalFile);
    const dims = this.calculateEffectiveDimensions(imageData.width, imageData.height, options);

    // Power-law model: bytes ≈ pixels^0.75 × 302 × complexity^1.7 with a
    // pixels×0.02 floor (PNG filter/entropy overhead). Lossless, so no
    // quality factor. PNG scales the least regularly of all formats; expect
    // roughly ±40% on real content — still far better than the old linear
    // model, which was ~17x off on screenshots.
    // (docs/size-prediction-experiment-2026-07-10.md)
    const pixels = dims.width * dims.height;
    const contentFactor = 302 * Math.pow(imageData.complexity, 1.7);
    const grayFactor = options.grayscale ? 0.7 : 1;
    const predictedSize = Math.round(Math.max(
      Math.pow(pixels, 0.75) * contentFactor * grayFactor,
      pixels * 0.02
    ));

    // PNG predictions are less reliable than lossy formats
    let confidence = 0.5;
    const fileType = originalFile.type.toLowerCase();
    if (fileType.includes('png')) confidence += 0.1;

    const sizeMB = originalFile.size / (1024 * 1024);
    if (sizeMB < 0.1 || sizeMB > 50) confidence -= 0.15;

    return {
      predictedSize: Math.max(predictedSize, 1024),
      confidence: Math.max(0.25, Math.min(0.7, confidence)),
      method: 'png-heuristic'
    };
  }
}
