import { App, Notice, requestUrl } from "obsidian";
import { assetFilename, assetUrl, matchesAsset, WasmAsset } from "./wasm-assets";

let appRef: App | null = null;
let pluginDirRef: string | null = null;

/** Stores app/plugin-dir references used by all remote WASM loaders. */
export function initWasmLoaderContext(app: App, pluginDir: string): void {
  appRef = app;
  pluginDirRef = pluginDir;
}

interface RemoteWasmOptions {
  asset: WasmAsset;
  downloadNotice: string;
  readyNotice: string;
  errorMessage: string;
}

/**
 * Creates a loader that compiles a WASM binary cached in the plugin
 * directory, downloading it on first use. The plugin directory lives
 * outside the vault index, so adapter access is correct here.
 *
 * Both the download and the cached copy are checked against the expected
 * SHA-256. A cached copy that fails the check or does not compile (truncated
 * write, older package version) is deleted and downloaded again, so a bad
 * cache never keeps the encoder broken.
 */
export function createRemoteWasmLoader(opts: RemoteWasmOptions): { getModule(): Promise<WebAssembly.Module> } {
  let modulePromise: Promise<WebAssembly.Module> | null = null;

  return {
    getModule(): Promise<WebAssembly.Module> {
      if (!modulePromise) {
        if (!appRef || !pluginDirRef) {
          throw new Error("WASM loader not initialized. Call initWasmLoaderContext() first.");
        }
        modulePromise = load(appRef, `${pluginDirRef}/${assetFilename(opts.asset)}`, opts).catch(e => {
          modulePromise = null;
          console.error(`Failed to load ${assetFilename(opts.asset)}:`, e);
          throw new Error(opts.errorMessage);
        });
      }
      return modulePromise;
    }
  };
}

async function load(app: App, cachePath: string, opts: RemoteWasmOptions): Promise<WebAssembly.Module> {
  const adapter = app.vault.adapter;

  if (await adapter.exists(cachePath)) {
    const cached = await loadCached(app, cachePath, opts.asset);
    if (cached) return cached;
    console.warn(`Discarding invalid cached ${cachePath}; downloading again.`);
    await adapter.remove(cachePath);
  }

  new Notice(opts.downloadNotice);
  const buffer = (await requestUrl({ url: assetUrl(opts.asset) })).arrayBuffer;
  if (!(await matchesAsset(buffer, opts.asset))) {
    throw new Error(`SHA-256 mismatch for ${assetUrl(opts.asset)}`);
  }
  const module = await WebAssembly.compile(buffer);
  await adapter.writeBinary(cachePath, buffer);
  new Notice(opts.readyNotice);
  return module;
}

/** Compiles the cached copy, or returns null when it is corrupt or stale. */
async function loadCached(app: App, cachePath: string, asset: WasmAsset): Promise<WebAssembly.Module | null> {
  try {
    const buffer = await app.vault.adapter.readBinary(cachePath);
    if (!(await matchesAsset(buffer, asset))) return null;
    return await WebAssembly.compile(buffer);
  } catch (e) {
    console.warn(`Cached ${cachePath} could not be compiled:`, e);
    return null;
  }
}
