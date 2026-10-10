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

/** Whether an incoming file may be an (animated) GIF. */
export function isGifFile(file: IncomingFile): boolean {
  return file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
}

/** The links of several images as inserted at once: in order, one per line. */
export function joinLinks(links: readonly string[]): string {
  return links.join("\n");
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
