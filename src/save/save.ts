// Save layer: writes converted images to the vault and builds their links.
// It takes encoded Blobs and never decodes or converts by itself.

import { App, TFile, TFolder, moment, normalizePath } from "obsidian";
import { SaveSettings } from "../settings";
import { DateFormatter, resolveName } from "./name";
import { availableName, fileName, joinPath, nameSet, parentPath, replacementName } from "./paths";

// The typings declare `moment` as the module namespace, which TypeScript
// does not consider callable; at runtime it is the moment function.
const callMoment = moment as unknown as (date: Date) => { format(format: string): string };

export const formatDateWithMoment: DateFormatter = (date, format) => callMoment(date).format(format);

/** What saveNew needs besides the image itself. */
export interface NewFileContext {
  destination: SaveSettings["destination"];
  nameTemplate: string;
  /** Path of the note the image goes into; "" when there is none */
  sourcePath: string;
  /** File name of the source image, for {original} */
  originalName?: string;
  /** Time used for {date:...}; now when omitted */
  date?: Date;
}

export interface ReplaceResult {
  file: TFile;
  originalSize: number;
  convertedSize: number;
}

/** Vault path of a folder setting, "" for the root. */
function normalizeFolder(folder: string): string {
  const path = normalizePath(folder);
  return path === "/" ? "" : path;
}

/**
 * Ensures a folder exists using the Vault API so Obsidian's file index
 * knows about it immediately (adapter.mkdir bypasses the index).
 */
async function ensureFolder(app: App, folder: string): Promise<TFolder> {
  if (folder === "") return app.vault.getRoot();
  const existing = app.vault.getAbstractFileByPath(folder);
  if (existing instanceof TFolder) return existing;
  try {
    return await app.vault.createFolder(folder);
  } catch (e) {
    // Another writer may have created it concurrently
    const created = app.vault.getAbstractFileByPath(folder);
    if (created instanceof TFolder) return created;
    throw e;
  }
}

/** Base name (without extension) of a new file from the name template. */
export function newFileBasename(context: NewFileContext, sizeBytes: number): string {
  return resolveName(
    context.nameTemplate,
    {
      original: context.originalName,
      note: context.sourcePath || undefined,
      date: context.date ?? new Date(),
      sizeBytes,
    },
    formatDateWithMoment
  );
}

/**
 * Saves an encoded image as a new file and returns it.
 *
 * - "obsidian": Obsidian's attachment setting decides the folder and avoids
 *   duplicate names (fileManager.getAvailablePathForAttachment).
 * - "folder": the folder is created when missing, and "-1", "-2", ... is
 *   added to the name until it is free.
 */
export async function saveNew(app: App, blob: Blob, extension: string, context: NewFileContext): Promise<TFile> {
  const basename = newFileBasename(context, blob.size);
  const data = await blob.arrayBuffer();

  if (context.destination.mode === "obsidian") {
    const path = await app.fileManager.getAvailablePathForAttachment(
      fileName(basename, extension),
      context.sourcePath || undefined
    );
    // Obsidian creates the folder itself, but attachment plugins that patch
    // the lookup may not (Custom Attachment Location defers it to the write)
    await ensureFolder(app, normalizeFolder(parentPath(path)));
    return app.vault.createBinary(path, data);
  }

  const folder = await ensureFolder(app, normalizeFolder(context.destination.folder));
  const name = availableName(basename, extension, nameSet(folder.children.map(c => c.name)));
  return app.vault.createBinary(joinPath(folder.path, name), data);
}

/**
 * Replaces the content of an existing image with an encoded image of
 * (possibly) another format. The file keeps its folder and base name; only
 * the extension changes, with a number added when another file already has
 * the new name. The rename goes through fileManager.renameFile, which
 * updates the links to the file.
 *
 * On failure the original content and path are restored and the error is
 * rethrown. Whether a larger result should be skipped is the caller's
 * policy: compare blob.size with file.stat.size before calling.
 */
export async function replaceExisting(app: App, file: TFile, blob: Blob, extension: string): Promise<ReplaceResult> {
  const originalSize = file.stat.size;
  const originalPath = file.path;
  const originalData = await app.vault.readBinary(file);

  const folder = file.parent ?? app.vault.getRoot();
  const siblings = folder.children.filter(c => c !== file).map(c => c.name);
  const newName = replacementName(file.basename, file.extension, extension, nameSet(siblings));
  const data = await blob.arrayBuffer();

  try {
    await app.vault.modifyBinary(file, data);
    if (newName !== null) {
      await app.fileManager.renameFile(file, joinPath(folder.path, newName));
    }
  } catch (error) {
    try {
      if (file.path !== originalPath) await app.fileManager.renameFile(file, originalPath);
      await app.vault.modifyBinary(file, originalData);
    } catch (rollbackError) {
      console.error("Rollback after a failed replacement also failed:", rollbackError);
    }
    throw error;
  }

  return { file, originalSize, convertedSize: blob.size };
}

/**
 * Embed link to `file` from the note at `sourcePath`, in the user's link
 * format (wikilink or Markdown, shortest/relative/absolute path).
 * generateMarkdownLink returns a plain link, so "!" is added to embed it.
 */
export function embedLink(app: App, file: TFile, sourcePath: string): string {
  const link = app.fileManager.generateMarkdownLink(file, sourcePath);
  return link.startsWith("!") ? link : `!${link}`;
}
