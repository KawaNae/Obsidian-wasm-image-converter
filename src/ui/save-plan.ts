// How the name and folder fields of the converter dialog turn into a save.
// Pure module: must not import "obsidian".

import { SaveSettings } from "../settings";

/** A folder as typed: null when empty, otherwise the vault path ("" for the root). */
export function canonicalFolder(text: string): string | null {
    const trimmed = text.trim();
    return trimmed === "" ? null : trimmed.replace(/^\/+|\/+$/g, "");
}

/** Folder path as the field shows it: "/" for the root. */
export function displayFolder(path: string): string {
    return canonicalFolder(path) || "/";
}

/** What the user left in the two fields, against their initial values. */
export interface FieldValues {
    name: string;
    initialName: string;
    folder: string;
    initialFolder: string;
}

/** The name typed; the initial one when the field is empty. */
export function effectiveName(f: FieldValues): string {
    return f.name.trim() || f.initialName;
}

export function nameChanged(f: FieldValues): boolean {
    return effectiveName(f) !== f.initialName;
}

/** An empty folder field counts as unchanged. */
export function folderChanged(f: FieldValues): boolean {
    const typed = canonicalFolder(f.folder);
    return typed !== null && typed !== canonicalFolder(f.initialFolder);
}

/**
 * A new file: the name field is the name template, and a folder the user
 * typed makes this one conversion save to that fixed folder. An unchanged
 * folder keeps the configured destination ("obsidian" stays "obsidian").
 */
export function planNewFile(f: FieldValues, save: SaveSettings): { destination: SaveSettings["destination"]; nameTemplate: string } {
    return {
        destination: folderChanged(f) ? { mode: "folder", folder: canonicalFolder(f.folder)! } : save.destination,
        nameTemplate: effectiveName(f),
    };
}

/**
 * Replacing an existing file. Null when both fields are unchanged: the file
 * keeps its name and folder and only the extension changes. Otherwise the
 * folder to move to, and the name template to resolve (null: keep the base
 * name).
 *
 * @param current - folder and base name of the file being replaced
 */
export function planReplacement(f: FieldValues, current: { folder: string }): { folder: string; nameTemplate: string | null } | null {
    const moves = folderChanged(f);
    const renames = nameChanged(f);
    if (!moves && !renames) return null;
    return {
        folder: moves ? canonicalFolder(f.folder)! : current.folder,
        nameTemplate: renames ? effectiveName(f) : null,
    };
}
