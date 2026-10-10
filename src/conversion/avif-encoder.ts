import avifEncode, { init as initAvifEncode } from "@jsquash/avif/encode";
import { toPercentQuality } from "./geometry";
import { createRemoteWasmLoader } from "./wasm-loader";
import { AVIF_ENCODER_WASM } from "./wasm-assets";
import { RGBAPixels } from "./render";

// The AVIF encoder (~3.5 MB) is not bundled; it is downloaded on first use.
const loader = createRemoteWasmLoader({
  asset: AVIF_ENCODER_WASM,
  downloadNotice: "Downloading AVIF encoder (~3.5 MB)... This only happens once.",
  readyNotice: "AVIF encoder ready!",
  errorMessage:
    "Failed to download AVIF encoder. Check your internet connection. " +
    "The encoder will be downloaded automatically on next AVIF use.",
});

let initPromise: Promise<void> | null = null;

function ensureEncoder(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initAvifEncode(await loader.getModule());
    })().catch(err => { initPromise = null; throw err; });
  }
  return initPromise;
}

export async function encodeAVIF(rgba: RGBAPixels, width: number, height: number, quality: number): Promise<Blob> {
  await ensureEncoder();
  const encoded = await avifEncode(new ImageData(rgba, width, height), { quality: toPercentQuality(quality), speed: 6 });
  return new Blob([encoded], { type: "image/avif" });
}
