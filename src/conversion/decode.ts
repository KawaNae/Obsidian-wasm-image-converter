/**
 * A decoded source image. Decode once per file and reuse it for every
 * prediction and the conversion; call close() when done (releases the
 * ImageBitmap's pixel memory).
 */
export interface DecodedImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

/**
 * Decodes an image blob. Uses createImageBitmap and falls back to an <img>
 * element for inputs it rejects.
 */
export async function decode(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to <img>
    }
  }
  const img = await decodeWithImageElement(blob);
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => { /* GC-managed */ } };
}

async function decodeWithImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
