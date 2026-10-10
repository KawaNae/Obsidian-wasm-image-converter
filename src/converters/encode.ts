import { EncodeSettings, getExtensionForFormat } from "../settings";
import { convertImageToWebP, ImageProcessingOptions } from "./webp-converter";
import { convertImageWithCanvas } from "./canvas-converter";
import { convertImageToAVIF } from "./avif-converter";

// Single entry from EncodeSettings into the format-specific converters.
// Interim: the conversion layer (decode once, encoder registry) replaces this.

function toProcessingOptions(encode: EncodeSettings): ImageProcessingOptions {
  return {
    quality: encode.quality,
    enableResize: encode.resize.enabled,
    maxWidth: encode.resize.maxWidth,
    maxHeight: encode.resize.maxHeight,
    enableGrayscale: encode.grayscale,
  };
}

export async function encodeImage(file: Blob, encode: EncodeSettings): Promise<{ blob: Blob; extension: string }> {
  const opts = toProcessingOptions(encode);
  let blob: Blob;
  switch (encode.format) {
    case "png": blob = await convertImageWithCanvas(file, "image/png", opts); break;
    case "jpeg": blob = await convertImageWithCanvas(file, "image/jpeg", opts); break;
    case "avif": blob = await convertImageToAVIF(file, opts); break;
    case "webp":
    default: blob = await convertImageToWebP(file, opts); break;
  }
  return { blob, extension: getExtensionForFormat(encode.format) };
}
