// Path arithmetic of the save layer. Pure module: must not import "obsidian".

/** Joins a vault folder and a file name; "" and "/" are the vault root. */
export function joinPath(folder: string, name: string): string {
  const trimmed = folder.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? name : `${trimmed}/${name}`;
}

/** Folder part of a vault path; "" for files in the root. */
export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function fileName(basename: string, extension: string): string {
  return extension === "" ? basename : `${basename}.${extension}`;
}

/**
 * First free name among "base.ext", "base 1.ext", "base 2.ext", ... with no
 * upper limit. The numbers are added as Obsidian adds them to attachments, so
 * both save destinations number duplicates alike.
 *
 * @param isTaken - whether a name is in use. Callers compare names without
 *   regard to case, since the file systems of macOS and Windows do.
 */
export function availableName(basename: string, extension: string, isTaken: (name: string) => boolean): string {
  let name = fileName(basename, extension);
  for (let n = 1; isTaken(name); n++) {
    name = fileName(`${basename} ${n}`, extension);
  }
  return name;
}

/**
 * New name of a file whose content is replaced by an image of another
 * format: the base name is kept and only the extension changes
 * ("IMG_0123.png" -> "IMG_0123.webp"). Returns null when the extension does
 * not change (ignoring case), i.e. the file keeps its name. When another
 * file already has the new name, a number is added as in availableName.
 *
 * @param isTaken - whether a name is used by another file of the same folder
 */
export function replacementName(
  basename: string,
  currentExtension: string,
  newExtension: string,
  isTaken: (name: string) => boolean
): string | null {
  if (currentExtension.toLowerCase() === newExtension.toLowerCase()) return null;
  return availableName(basename, newExtension, isTaken);
}

/** Case-insensitive membership test over a list of names. */
export function nameSet(names: Iterable<string>): (name: string) => boolean {
  const set = new Set<string>();
  for (const n of names) set.add(n.toLowerCase());
  return name => set.has(name.toLowerCase());
}
