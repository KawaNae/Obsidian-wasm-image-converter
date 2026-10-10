import { ImageFormat } from "../settings";
import { encodeWebP } from "./webp-encoder";
import { encodeAVIF } from "./avif-encoder";
import { encodeWithCanvas } from "./canvas-encoder";
import { RGBAPixels } from "./render";

/** Everything format-specific lives here: one entry per output format. */
export interface Encoder {
  format: ImageFormat;
  label: string;
  description: string;
  extension: string;
  mime: string;
  /** false: quality is ignored */
  lossy: boolean;
  /** quality is 0.1 - 1.0 as in EncodeSettings */
  encode(rgba: RGBAPixels, width: number, height: number, quality: number): Promise<Blob>;
}

const ENCODERS: Record<ImageFormat, Encoder> = {
  webp: {
    format: "webp",
    label: "WASM WebP",
    description: "WebP conversion using WebAssembly",
    extension: "webp",
    mime: "image/webp",
    lossy: true,
    encode: encodeWebP,
  },
  jpeg: {
    format: "jpeg",
    label: "JPEG",
    description: "JPEG conversion using Canvas API",
    extension: "jpg",
    mime: "image/jpeg",
    lossy: true,
    encode: (rgba, width, height, quality) => encodeWithCanvas(rgba, width, height, "image/jpeg", quality),
  },
  png: {
    format: "png",
    label: "PNG",
    description: "Lossless PNG conversion using Canvas API",
    extension: "png",
    mime: "image/png",
    lossy: false,
    encode: (rgba, width, height) => encodeWithCanvas(rgba, width, height, "image/png"),
  },
  avif: {
    format: "avif",
    label: "WASM AVIF",
    description: "AVIF conversion using WebAssembly (downloaded on first use)",
    extension: "avif",
    mime: "image/avif",
    lossy: true,
    encode: encodeAVIF,
  },
};

/** Formats in the order the UI lists them. */
export const ENCODER_LIST: readonly Encoder[] = [ENCODERS.webp, ENCODERS.jpeg, ENCODERS.png, ENCODERS.avif];

export function encoderFor(format: ImageFormat): Encoder {
  return ENCODERS[format];
}
