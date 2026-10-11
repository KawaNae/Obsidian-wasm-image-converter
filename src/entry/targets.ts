// Which files the entry points convert, and how their results are put
// together. Pure module: must not import "obsidian".

/** A file dropped or pasted into the editor. */
export interface IncomingFile {
  name: string;
  type: string;
}

/** A file of the vault, as batch convert sees it. */
export interface VaultImage {
  path: string;
  extension: string;
}

/**
 * Whether a dropped or pasted file is auto-converted: its MIME type is an
 * image and its name ends with one of the target extensions.
 */
export function isAutoConvertTarget(file: IncomingFile, extensions: readonly string[]): boolean {
  const name = file.name.toLowerCase();
  return file.type.startsWith("image/") && extensions.some(ext => name.endsWith(`.${ext}`));
}

/**
 * What auto-convert does with a dropped or pasted file: "convert" a target
 * image, "attach" any other file as it is, under its own name, or "link"
 * a file that is already in the vault, without copying it.
 */
export type IncomingAction = "convert" | "attach" | "link";

/**
 * The action for each file of a drop or paste, in the order of the files.
 * Null when no file is a target image from outside the vault: then the
 * event is left to Obsidian, which links the files of the vault and
 * attaches the others itself. Once auto-convert takes the event over, it
 * links the files of the vault as Obsidian would, and attaches the other
 * files, so that none of them is lost or copied.
 *
 * @param inVault - whether a file is a file of the vault (a drop on the
 *   desktop can tell; see vault-file.ts)
 */
export function planIncoming<T extends IncomingFile>(
  files: readonly T[],
  extensions: readonly string[],
  inVault: (file: T) => boolean = () => false
): { file: T; action: IncomingAction }[] | null {
  const plan = files.map(file => ({
    file,
    action: (inVault(file) ? "link" : isAutoConvertTarget(file, extensions) ? "convert" : "attach") as IncomingAction,
  }));
  return plan.some(p => p.action === "convert") ? plan : null;
}

/**
 * Vault path of the file at the absolute path `filePath`, or null when it
 * is not under `basePath`, the vault's folder. Both "/" and "\" separate
 * the parts; the vault's folder is compared without regard to case, as the
 * file systems of macOS and Windows do, and the rest keeps its own case.
 */
export function vaultRelativePath(filePath: string, basePath: string): string | null {
  const file = filePath.replace(/\\/g, "/");
  const base = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (file === "" || base === "") return null;
  if (file.length <= base.length + 1 || file[base.length] !== "/") return null;
  if (file.slice(0, base.length).toLowerCase() !== base.toLowerCase()) return null;
  return file.slice(base.length + 1);
}

/** "15.25KB → 3.03KB (80.1% compressed)", or "(+402.5% larger)" when the result is larger. */
export function sizeChange(originalBytes: number, convertedBytes: number): string {
  const sizes = `${(originalBytes / 1024).toFixed(2)}KB → ${(convertedBytes / 1024).toFixed(2)}KB`;
  if (originalBytes <= 0) return sizes;
  const percent = Math.abs(originalBytes - convertedBytes) / originalBytes * 100;
  return convertedBytes > originalBytes
    ? `${sizes} (+${percent.toFixed(1)}% larger)`
    : `${sizes} (${percent.toFixed(1)}% compressed)`;
}

/** Whether an incoming file may be an (animated) GIF. */
export function isGifFile(file: IncomingFile): boolean {
  return file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
}

/**
 * The links of several images as inserted at once: in order, separated by
 * an empty line, as Obsidian separates the links of a drop it handles itself.
 */
export function joinLinks(links: readonly string[]): string {
  return links.join("\n\n");
}

/** Whether `path` lies in `folder` or its subfolders; "" and "/" are the whole vault. */
export function isInFolder(path: string, folder: string): boolean {
  const prefix = folder.replace(/^\/+|\/+$/g, "");
  return prefix === "" || path.startsWith(`${prefix}/`);
}

/** Files of `folder` (recursively) whose extension is a target extension, in the given order. */
export function batchTargets<T extends VaultImage>(files: readonly T[], extensions: readonly string[], folder: string): T[] {
  return files.filter(f => extensions.includes(f.extension.toLowerCase()) && isInFolder(f.path, folder));
}

/** Number of files per lower-cased extension, the most frequent first (ties by name). */
export function countByExtension(files: readonly Pick<VaultImage, "extension">[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = f.extension.toLowerCase();
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Batch convert keeps a file whose converted image would be larger than it. */
export function isLargerAfterConversion(originalSize: number, convertedSize: number): boolean {
  return convertedSize > originalSize;
}

export interface BatchTally {
  total: number;
  converted: number;
  skippedLarger: number;
  skippedAnimated: number;
  failed: number;
  /** Bytes of the converted files before and after */
  originalBytes: number;
  convertedBytes: number;
  /** Files handled before a cancel; equals total when not cancelled */
  processed: number;
  cancelled: boolean;
}

export function emptyTally(total: number): BatchTally {
  return {
    total, converted: 0, skippedLarger: 0, skippedAnimated: 0, failed: 0,
    originalBytes: 0, convertedBytes: 0, processed: 0, cancelled: false,
  };
}

/** Final report of a batch convert. */
export function batchSummary(t: BatchTally): string {
  const lines = [t.cancelled ? `Batch conversion cancelled (${t.processed}/${t.total})` : "Batch conversion complete"];
  lines.push(`Converted: ${t.converted}`);
  if (t.skippedLarger > 0) lines.push(`Skipped (would be larger): ${t.skippedLarger}`);
  if (t.skippedAnimated > 0) lines.push(`Skipped (animated GIF): ${t.skippedAnimated}`);
  if (t.failed > 0) lines.push(`Failed: ${t.failed}`);
  if (t.converted > 0) {
    const saved = t.originalBytes - t.convertedBytes;
    const ratio = t.originalBytes > 0 ? (saved / t.originalBytes * 100).toFixed(1) : "0";
    lines.push(`Saved: ${(saved / (1024 * 1024)).toFixed(2)} MB (${ratio}%)`);
  }
  return lines.join("\n");
}
