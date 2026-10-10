import { EncodeSettings, ImageFormat } from "../settings";

export interface SizePredictionResult {
  predictedSize: number; // bytes
  confidence: number; // 0-1, prediction confidence level
  method: string; // prediction method used
}

export interface SizePredictor {
  predict(
    originalFile: File, 
    options: EncodeSettings
  ): Promise<SizePredictionResult>;
  
  supportedType: ImageFormat;
}

export class SizePredictionService {
  private predictors: Map<ImageFormat, SizePredictor> = new Map();

  registerPredictor(predictor: SizePredictor) {
    this.predictors.set(predictor.supportedType, predictor);
  }

  async predictSize(
    originalFile: File,
    options: EncodeSettings
  ): Promise<SizePredictionResult | null> {
    const predictor = this.predictors.get(options.format);
    if (!predictor) {
      return null;
    }

    try {
      return await predictor.predict(originalFile, options);
    } catch (error) {
      console.warn('Size prediction failed:', error);
      return null;
    }
  }

  getSupportedTypes(): ImageFormat[] {
    return Array.from(this.predictors.keys());
  }
}

// Global service instance
export const sizePredictionService = new SizePredictionService();