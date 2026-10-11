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
 * What was known of a blob that could not be decoded: whether it was read
 * at all tells an unreadable file from undecodable bytes.
 */
export interface UndecodableSource {
  /** File name; a plain Blob has none */
  name?: string;
  size: number;
  type: string;
  /** Length arrayBuffer() returned, or null when it failed */
  bytesRead: number | null;
  /** Why arrayBuffer() failed */
  readError?: string;
}

/** Thrown by decode(); the message describes the source for the console. */
export class DecodeError extends Error {
  constructor(readonly source: UndecodableSource, readonly causes: string[]) {
    super(`Could not decode ${formatUndecodable(source)}: ${causes.join("; ")}`);
    this.name = "DecodeError";
  }
}

/** Reads `blob` once more to tell how much of it can be read. */
export async function describeUndecodable(blob: Blob): Promise<UndecodableSource> {
  const description: UndecodableSource = {
    name: typeof File !== "undefined" && blob instanceof File ? blob.name : undefined,
    size: blob.size,
    type: blob.type,
    bytesRead: null,
  };
  try {
    description.bytesRead = (await blob.arrayBuffer()).byteLength;
  } catch (error) {
    description.readError = String(error);
  }
  return description;
}

/** `"a.png" (image/png, 1024 bytes, 0 bytes read)` */
export function formatUndecodable(source: UndecodableSource): string {
  const read = source.bytesRead !== null ? `${source.bytesRead} bytes read` : `not readable (${source.readError})`;
  const name = source.name !== undefined ? `"${source.name}"` : "a blob";
  return `${name} (${source.type || "no type"}, ${source.size} bytes, ${read})`;
}

/**
 * Decodes an image blob. Uses createImageBitmap and falls back to an <img>
 * element for inputs it rejects. Throws a DecodeError when both fail.
 */
export async function decode(blob: Blob): Promise<DecodedImage> {
  const causes: string[] = [];
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch (error) {
      causes.push(`createImageBitmap: ${String(error)}`);
      // fall through to <img>
    }
  }
  let img: HTMLImageElement;
  try {
    img = await decodeWithImageElement(blob);
  } catch (error) {
    causes.push(`<img>: ${String(error)}`);
    throw new DecodeError(await describeUndecodable(blob), causes);
  }
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
