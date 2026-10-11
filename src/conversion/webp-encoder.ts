import webpEncode, { init as initWebPEncode } from "@jsquash/webp/encode";
import { simd } from "wasm-feature-detect";
import { toPercentQuality } from "./geometry";
import { createRemoteWasmLoader } from "./wasm-loader";
import { WEBP_ENCODER_WASM } from "./wasm-assets";
import { RGBAPixels } from "./render";

// Only the SIMD build is embedded in main.js. The rare devices without
// WASM SIMD support download the plain build once instead.
const nonSimdFallback = createRemoteWasmLoader({
  asset: WEBP_ENCODER_WASM,
  downloadNotice: "Downloading WebP encoder (~0.3 MB)... This only happens once.",
  readyNotice: "WebP encoder ready!",
  errorMessage: "Failed to download the WebP encoder. Check your internet connection.",
});

let initPromise: Promise<void> | null = null;

/**
 * On SIMD-capable environments the embedded SIMD build initializes itself
 * inside webpEncode. Elsewhere the package picks its non-SIMD glue, whose
 * binary is not bundled — provide it via download. Both sides branch on the
 * same wasm-feature-detect simd() check, so glue and binary always match.
 */
function ensureEncoder(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (await simd()) return;
      await initWebPEncode(await nonSimdFallback.getModule());
    })().catch(err => { initPromise = null; throw err; });
  }
  return initPromise;
}

export async function encodeWebP(rgba: RGBAPixels, width: number, height: number, quality: number): Promise<Blob> {
  await ensureEncoder();
  const encoded = await webpEncode(new ImageData(rgba, width, height), { quality: toPercentQuality(quality) });
  return new Blob([encoded], { type: "image/webp" });
}
