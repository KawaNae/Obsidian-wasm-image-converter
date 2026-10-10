// WASM binaries downloaded at runtime and their expected SHA-256.
// Pure: unit-tested with vitest, which also checks that each entry matches
// the installed package (version in package.json, hash of the file in
// node_modules). Update the version and the hash together when bumping a
// @jsquash package.

export interface WasmAsset {
  /** npm package that ships the binary */
  packageName: string;
  /** must equal the package's version in package.json */
  version: string;
  /** path of the binary inside the package */
  file: string;
  /** lowercase hex SHA-256 of the binary */
  sha256: string;
}

export const AVIF_ENCODER_WASM: WasmAsset = {
  packageName: "@jsquash/avif",
  version: "2.1.1",
  file: "codec/enc/avif_enc.wasm",
  sha256: "d9f2a95164362af48558d176e619becfd49dd97b50b86c679b47100860522b3d",
};

/** Non-SIMD WebP encoder; the SIMD build is embedded in main.js. */
export const WEBP_ENCODER_WASM: WasmAsset = {
  packageName: "@jsquash/webp",
  version: "1.4.0",
  file: "codec/enc/webp_enc.wasm",
  sha256: "b6085bb6702f144e9dc6016d58d230b34a84976bf0d080b7390b4b4b137d6ab7",
};

export function assetUrl(asset: WasmAsset): string {
  return `https://unpkg.com/${asset.packageName}@${asset.version}/${asset.file}`;
}

/** File name of the cached copy in the plugin directory. */
export function assetFilename(asset: WasmAsset): string {
  return asset.file.slice(asset.file.lastIndexOf("/") + 1);
}

export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function matchesAsset(data: ArrayBuffer, asset: WasmAsset): Promise<boolean> {
  return (await sha256Hex(data)) === asset.sha256;
}
