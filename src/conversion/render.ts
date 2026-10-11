import { EncodeSettings } from "../settings";
import { DecodedImage } from "./decode";
import { outputSize, Size } from "./geometry";
import { grayscaleInPlace } from "./grayscale";

/** Raw RGBA pixels (row-major, 4 bytes per pixel), the input of every encoder. */
export type RGBAPixels = ImageData["data"];

export interface RGBAImage {
  data: RGBAPixels;
  width: number;
  height: number;
}

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export function createCanvas(width: number, height: number): AnyCanvas {
  return typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
}

export function context2d(canvas: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/**
 * Draws the decoded image with the resize and grayscale of `encode` applied
 * and returns its RGBA pixels. With `size`, draws at exactly that size
 * instead (sample encodes of the size prediction); the resize settings are
 * then ignored.
 */
export function render(decoded: DecodedImage, encode: Pick<EncodeSettings, "resize" | "grayscale">, size?: Size): RGBAImage {
  const target = size ?? outputSize(decoded.width, decoded.height, encode.resize);
  return drawPixels(decoded, target, { grayscale: encode.grayscale, smoothing: "high" });
}

/** Draws the decoded image scaled to exactly `size` and reads its pixels back. */
export function drawPixels(
  decoded: DecodedImage,
  size: Size,
  opts: { grayscale: boolean; smoothing: ImageSmoothingQuality }
): RGBAImage {
  const { width, height } = size;
  const ctx = context2d(createCanvas(width, height));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = opts.smoothing;
  ctx.drawImage(decoded.source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  if (opts.grayscale) grayscaleInPlace(data);
  return { data, width, height };
}
