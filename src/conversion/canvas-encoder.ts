import { context2d, createCanvas, RGBAPixels } from "./render";

/** Encodes RGBA pixels with the browser's own codecs (PNG, JPEG). */
export async function encodeWithCanvas(
  rgba: RGBAPixels,
  width: number,
  height: number,
  mime: "image/png" | "image/jpeg",
  quality?: number
): Promise<Blob> {
  const canvas = createCanvas(width, height);
  context2d(canvas).putImageData(new ImageData(rgba, width, height), 0, 0);

  if (canvas instanceof HTMLCanvasElement) {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null")),
        mime,
        quality
      );
    });
  }
  return await canvas.convertToBlob({ type: mime, quality });
}
