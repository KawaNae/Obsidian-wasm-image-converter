import { App, FileSystemAdapter, Platform, TFile } from "obsidian";
import { vaultRelativePath } from "./targets";

/** Electron's webUtils, as far as it is used here. */
interface WebUtils {
  getPathForFile(file: File): string;
}

/**
 * Electron's webUtils on the desktop, or null (mobile, or an Electron
 * without it). `File.path`, its predecessor, is gone from recent Electron.
 */
function webUtils(): WebUtils | null {
  if (!Platform.isDesktopApp) return null;
  try {
    const electron = (window as unknown as { require?: (id: string) => { webUtils?: WebUtils } }).require?.("electron");
    return typeof electron?.webUtils?.getPathForFile === "function" ? electron.webUtils : null;
  } catch {
    return null;
  }
}

/**
 * A function telling the vault file a dropped file is, or null when it is
 * none (a file from outside the vault, one without a path). Null itself
 * when the files of a drop cannot be told apart: on mobile, or where
 * Electron does not give their paths.
 */
export function vaultFileLocator(app: App): ((file: File) => TFile | null) | null {
  const utils = webUtils();
  const adapter = app.vault.adapter;
  if (!utils || !(adapter instanceof FileSystemAdapter)) return null;
  const basePath = adapter.getBasePath();
  return (file) => {
    let filePath: string;
    try {
      filePath = utils.getPathForFile(file);
    } catch {
      return null;
    }
    const path = vaultRelativePath(filePath, basePath);
    if (path === null) return null;
    const found = app.vault.getAbstractFileByPath(path);
    return found instanceof TFile ? found : null;
  };
}
