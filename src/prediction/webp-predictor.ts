import { EncodeSettings, ImageFormat } from "../settings";
import { SizePredictor, SizePredictionResult } from "./size-predictor";

export class WebPSizePredictor implements SizePredictor {
  supportedType: ImageFormat = "webp";

  async predict(
    originalFile: File,
    options: EncodeSettings
  ): Promise<SizePredictionResult> {
    // Get image dimensions and analyze content
    const imageData = await this.analyzeImage(originalFile);
    
    // Calculate effective dimensions after resize
    const effectiveDimensions = this.calculateEffectiveDimensions(
      imageData.width,
      imageData.height,
      options
    );

    // Predict WebP size based on various factors
    const predictedSize = this.calculateWebPSize(
      originalFile.size,
      imageData,
      effectiveDimensions,
      options
    );

    return {
      predictedSize: Math.round(predictedSize),
      confidence: this.calculateConfidence(originalFile, options),
      method: 'webp-heuristic'
    };
  }

  private async analyzeImage(file: File): Promise<{
    width: number;
    height: number;
    hasTransparency: boolean;
    complexity: number; // 0-1, image complexity estimate
  }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        canvas.width = Math.min(img.width, 200);
        canvas.height = Math.min(img.height, 200);

        if (!ctx) {
          URL.revokeObjectURL(img.src);
          resolve({
            width: img.width,
            height: img.height,
            hasTransparency: false,
            complexity: 0.5
          });
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const analysis = this.analyzeImageData(imageData);

          resolve({
            width: img.width,
            height: img.height,
            hasTransparency: analysis.hasTransparency,
            complexity: analysis.complexity
          });
        } catch (error) {
          resolve({
            width: img.width,
            height: img.height,
            hasTransparency: false,
            complexity: 0.5
          });
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

  private analyzeImageData(imageData: ImageData): {
    hasTransparency: boolean;
    complexity: number;
  } {
    const data = imageData.data;
    const pixels = data.length / 4;
    let hasTransparency = false;
    let totalVariance = 0;
    let sampleCount = 0;

    // Sample every 10th pixel for performance
    for (let i = 0; i < data.length; i += 40) { // 40 = 4 channels * 10 pixels
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 255) {
        hasTransparency = true;
      }

      // Calculate local variance as complexity measure
      if (i > 40) {
        const prevR = data[i - 40];
        const prevG = data[i - 39];
        const prevB = data[i - 38];
        
        const variance = Math.abs(r - prevR) + Math.abs(g - prevG) + Math.abs(b - prevB);
        totalVariance += variance;
        sampleCount++;
      }
    }

    const avgVariance = sampleCount > 0 ? totalVariance / sampleCount : 0;
    const complexity = Math.min(avgVariance / 255, 1); // Normalize to 0-1

    return {
      hasTransparency,
      complexity
    };
  }

  private calculateEffectiveDimensions(
    originalWidth: number,
    originalHeight: number,
    options: EncodeSettings
  ): { width: number; height: number } {
    if (!options.resize.enabled) {
      return { width: originalWidth, height: originalHeight };
    }

    const aspectRatio = originalWidth / originalHeight;
    const maxWidth = options.resize.maxWidth;
    const maxHeight = options.resize.maxHeight;

    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    // Calculate resize dimensions maintaining aspect ratio
    const scaleByWidth = maxWidth / originalWidth;
    const scaleByHeight = maxHeight / originalHeight;
    const scale = Math.min(scaleByWidth, scaleByHeight);

    return {
      width: Math.round(originalWidth * scale),
      height: Math.round(originalHeight * scale)
    };
  }

  private calculateWebPSize(
    originalSize: number,
    imageData: { width: number; height: number; hasTransparency: boolean; complexity: number },
    effectiveDimensions: { width: number; height: number },
    options: EncodeSettings
  ): number {
    // Use the provided WebP size prediction algorithm
    const predictedSize = this.webpSizePredict(
      effectiveDimensions.width,
      effectiveDimensions.height,
      options.quality * 100, // Convert 0-1 to 0-100
      options.grayscale,
      imageData.complexity
    );

    // Apply minimum size constraint (WebP header + minimal data)
    const minimumSize = 1024; // 1KB minimum
    
    return Math.max(predictedSize, minimumSize);
  }

  private webpSizePredict(width: number, height: number, quality: number, isGray: boolean, colorComplexity: number): number {
    // Power-law model: bytes ≈ pixels^0.75 × 3.0 × complexity^0.42,
    // calibrated at q=0.8 against real encodes
    // (docs/size-prediction-experiment-2026-07-10.md)
    const pixels = width * height;
    const contentFactor = 3.0 * Math.pow(colorComplexity, 0.42);
    const qualityFactor = Math.pow((quality / 100) / 0.8, 0.75);
    const grayFactor = isGray ? 0.7 : 1;

    return Math.round(Math.pow(pixels, 0.75) * contentFactor * qualityFactor * grayFactor);
  }


  private calculateConfidence(file: File, options: EncodeSettings): number {
    let confidence = 0.7; // Base confidence

    // Higher confidence for common image types
    const fileType = file.type.toLowerCase();
    if (fileType.includes('jpeg') || fileType.includes('jpg')) {
      confidence += 0.1;
    } else if (fileType.includes('png')) {
      confidence += 0.05;
    }

    // Lower confidence for very small or very large files
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB < 0.1 || sizeMB > 50) {
      confidence -= 0.2;
    }

    // Lower confidence for extreme quality settings
    if (options.quality < 0.3 || options.quality > 0.95) {
      confidence -= 0.1;
    }

    return Math.max(0.3, Math.min(0.9, confidence));
  }
}