import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AVIF_ENCODER_WASM, WEBP_ENCODER_WASM, WasmAsset, assetFilename, assetUrl, sha256Hex } from "./wasm-assets";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(root + path, "utf8"));

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe.each<[string, WasmAsset]>([
  ["AVIF", AVIF_ENCODER_WASM],
  ["WebP", WEBP_ENCODER_WASM],
])("%s encoder asset", (_, asset) => {
  it("pins the version of package.json and of the installed package", () => {
    expect(readJson("package.json").dependencies[asset.packageName]).toBe(asset.version);
    expect(readJson(`node_modules/${asset.packageName}/package.json`).version).toBe(asset.version);
  });

  it("has the SHA-256 of the installed binary", async () => {
    const bin = readFileSync(`${root}node_modules/${asset.packageName}/${asset.file}`);
    expect(await sha256Hex(bin)).toBe(asset.sha256);
  });

  it("keeps the cache file name of earlier versions", () => {
    expect(assetFilename(asset)).toMatch(/^(avif|webp)_enc\.wasm$/);
    expect(assetUrl(asset)).toBe(`https://unpkg.com/${asset.packageName}@${asset.version}/${asset.file}`);
  });
});
