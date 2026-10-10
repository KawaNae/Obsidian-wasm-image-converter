import { App, normalizePath, TFile, TFolder } from "obsidian";
import { EncodeSettings, SaveSettings } from "./settings";
import { encodeImage } from "./converters/encode";

export interface ConversionResult {
  path: string;
  originalSize: number;
  convertedSize: number;
}

/**
 * Folder new files are saved to.
 * Interim: both destination modes use the fixed folder, which keeps the
 * pre-0.7 behavior. Following Obsidian's attachment setting comes with the
 * save layer.
 */
export function resolveSaveFolder(save: SaveSettings): string {
  return save.destination.folder;
}

/**
 * Ensures a folder exists using the Vault API so Obsidian's file index
 * knows about it immediately (adapter.mkdir bypasses the index).
 */
async function ensureFolder(app: App, folder: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(folder) instanceof TFolder) return;
  try {
    await app.vault.createFolder(folder);
  } catch (e) {
    // Another writer may have created it concurrently
    if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw e;
  }
}

/**
 * Creates a binary file via the Vault API, deduplicating the name on the
 * (unlikely) chance the timestamp-based name already exists.
 */
async function createBinaryFile(app: App, destPath: string, data: ArrayBuffer): Promise<string> {
  let path = destPath;
  for (let i = 1; app.vault.getAbstractFileByPath(path) && i < 10; i++) {
    path = destPath.replace(/(\.[^.]+)$/, `-${i}$1`);
  }
  await app.vault.createBinary(path, data);
  return path;
}

export async function saveImageAndInsert(
  app: App,
  file: File,
  encode: EncodeSettings,
  folder: string
): Promise<ConversionResult> {
  folder = normalizePath(folder);
  const { blob: convertedBlob, extension } = await encodeImage(file, encode);

  const fileName = generateFileName(extension, convertedBlob.size);
  const destPath = normalizePath(`${folder}/${fileName}`);

  await ensureFolder(app, folder);
  const ab = await convertedBlob.arrayBuffer();
  const savedPath = await createBinaryFile(app, destPath, ab);

  return { path: savedPath, originalSize: file.size, convertedSize: convertedBlob.size };
}

/**
 * Generates a consistent file name based on timestamp and size.
 * Centralized for future customization (e.g. regex support).
 */
export function generateFileName(extension: string, sizeBytes: number): string {
  const timestamp = (window as any).moment().format("YYYYMMDD[T]HHmmssSSS");
  const sizeKB = (sizeBytes / 1024).toFixed(2);
  return `IMG-${timestamp}-${sizeKB}.${extension}`;
}

/**
 * Saves the original file without conversion, but follows the plugin's naming and folder conventions.
 */
export async function saveOriginalFile(app: App, file: File, folder: string): Promise<string> {
  folder = normalizePath(folder);
  const m = file.name.match(/\.([^.]+)$/);
  const extension = m ? m[1] : 'unknown';
  const fileName = generateFileName(extension, file.size);
  const destPath = normalizePath(`${folder}/${fileName}`);

  await ensureFolder(app, folder);
  const arrayBuffer = await file.arrayBuffer();
  return await createBinaryFile(app, destPath, arrayBuffer);
}

/**
 * Converts the file and REPLACES the original TFile with the converted content.
 * Also renames the file to match the new extension and timestamp convention, updating links.
 */
export async function convertAndReplaceFile(
  app: App,
  targetFile: TFile,
  file: File, // Source content
  encode: EncodeSettings,
  folder: string
): Promise<ConversionResult> {
  const { blob, extension } = await encodeImage(file, encode);
  // Overwrite and rename
  return replaceFileContentAndPath(app, targetFile, blob, folder, extension);
}

/**
 * Replaces the content of a TFile with a Blob, and renames/moves it to a new location.
 * This handles the filesystem side of "converting" an existing file.
 */
export async function replaceFileContentAndPath(
  app: App,
  targetFile: TFile,
  newContent: Blob,
  folder: string,
  newExtension: string
): Promise<ConversionResult> {
  const originalSize = targetFile.stat.size;

  // Keep original bytes so a failure after the overwrite can be rolled back
  const originalData = await app.vault.readBinary(targetFile);

  // Generate new path and ensure the folder exists before touching the file
  folder = normalizePath(folder);
  const fileName = generateFileName(newExtension, newContent.size);
  const destPath = normalizePath(`${folder}/${fileName}`);
  await ensureFolder(app, folder);

  // Overwrite content
  const arrayBuffer = await newContent.arrayBuffer();
  await app.vault.modifyBinary(targetFile, arrayBuffer);

  // Rename/Move file (triggers link updates)
  try {
    await app.fileManager.renameFile(targetFile, destPath);
  } catch (renameError) {
    // Restore the original bytes so no corrupted file is left behind
    try {
      await app.vault.modifyBinary(targetFile, originalData);
    } catch (rollbackError) {
      console.error("Rollback after failed rename also failed:", rollbackError);
    }
    throw renameError;
  }

  return {
    path: destPath,
    originalSize: originalSize,
    convertedSize: newContent.size
  };
}