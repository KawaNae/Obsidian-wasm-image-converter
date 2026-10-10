import { EncodeSettings } from "../settings";
import { decode, DecodedImage } from "./decode";
import { encoderFor } from "./encoders";
import { render } from "./render";

/** Converts a decoded image with the given settings. */
export async function convert(decoded: DecodedImage, encode: EncodeSettings): Promise<Blob> {
  const { data, width, height } = render(decoded, encode);
  return encoderFor(encode.format).encode(data, width, height, encode.quality);
}

/** Decodes, converts and releases: for callers that have no use for the decode afterwards. */
export async function convertBlob(blob: Blob, encode: EncodeSettings): Promise<Blob> {
  const decoded = await decode(blob);
  try {
    return await convert(decoded, encode);
  } finally {
    decoded.close();
  }
}
