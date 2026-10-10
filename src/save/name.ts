// File names from the name template. Pure module: must not import "obsidian"
// (the date formatting is injected) so that it can be unit-tested with vitest.

import { DEFAULT_NAME_TEMPLATE } from "../settings";

/** Values of the template variables. A missing value expands to "". */
export interface NameContext {
  /** File name of the source image, with or without its extension */
  original?: string;
  /** Path (or name) of the note the image is inserted into */
  note?: string;
  date: Date;
  /** Size of the converted image in bytes */
  sizeBytes?: number;
}

/** Formats `date` with a moment format string. */
export type DateFormatter = (date: Date, format: string) => string;

/**
 * Characters that cannot appear in a file name. The first group is rejected
 * by Windows, macOS or Obsidian itself; # ^ [ ] | break Obsidian links.
 * Control characters are included as well.
 */
const FORBIDDEN = /[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/;
const FORBIDDEN_RUN = new RegExp(`${FORBIDDEN.source}+`, "g");
const FORBIDDEN_EDGES = new RegExp(`^${FORBIDDEN.source}+|${FORBIDDEN.source}+$`, "g");

/** Characters treated as separators between the parts of a name. */
const SEPARATOR_CLASS = "[-_.\\s]";
const SEPARATOR_EDGES = new RegExp(`^${SEPARATOR_CLASS}+|${SEPARATOR_CLASS}+$`, "g");

/** Marks the place of a variable that expanded to "" (cannot survive sanitizing). */
const EMPTY = "\u0000";
const EMPTY_WITH_SEPARATORS = new RegExp(`(${SEPARATOR_CLASS}*)${EMPTY}(${SEPARATOR_CLASS}*)`);

/** Longest base name in UTF-8 bytes; leaves room for "-123" and the extension within 255. */
export const MAX_BASENAME_BYTES = 200;

const VARIABLE = /\{(original|note|size|date:([^}]*))\}/g;

/**
 * Replaces the forbidden characters inside a variable value: runs at the
 * ends are dropped ("[[x]]" -> "x"), runs inside become one "-"
 * ("12:30" -> "12-30").
 */
export function sanitizeValue(value: string): string {
  return value.replace(FORBIDDEN_EDGES, "").replace(FORBIDDEN_RUN, "-");
}

/** Replaces each run of forbidden characters in literal template text with one "-". */
export function sanitizeLiteral(text: string): string {
  return text.replace(FORBIDDEN_RUN, "-");
}

/** Removes the folder and the last extension: "Notes/旅行.md" -> "旅行". */
export function stripPathAndExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The converted size in KB with two decimals, as the file names of v0.6.0. */
export function formatSizeKB(sizeBytes: number): string {
  return (sizeBytes / 1024).toFixed(2);
}

function expandVariable(name: string, dateFormat: string | undefined, context: NameContext, formatDate: DateFormatter): string {
  switch (name) {
    case "original":
      return context.original ? stripPathAndExtension(context.original) : "";
    case "note":
      return context.note ? stripPathAndExtension(context.note) : "";
    case "size":
      return context.sizeBytes === undefined ? "" : formatSizeKB(context.sizeBytes);
    default:
      return formatDate(context.date, dateFormat ?? "");
  }
}

/**
 * Removes the markers of empty variables together with the separators they
 * leave over: "IMG-{note}-{size}" with no note gives "IMG-12.34", not
 * "IMG--12.34". Of the separator runs on both sides of an empty variable the
 * one before it is kept (the one after it when there is none before).
 */
function dropEmpty(name: string): string {
  let result = name;
  while (result.includes(EMPTY)) {
    result = result.replace(EMPTY_WITH_SEPARATORS, (_, before: string, after: string) => before || after);
  }
  return result;
}

/** Cuts `name` to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function truncateUtf8(name: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= maxBytes) return name;
  let bytes = 0;
  let end = 0;
  for (const ch of name) {
    const size = encoder.encode(ch).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return name.slice(0, end);
}

function expand(template: string, context: NameContext, formatDate: DateFormatter): string {
  let out = "";
  let last = 0;
  for (const match of template.matchAll(VARIABLE)) {
    out += sanitizeLiteral(template.slice(last, match.index));
    const name = match[1].startsWith("date:") ? "date" : match[1];
    const value = sanitizeValue(expandVariable(name, match[2], context, formatDate));
    out += value === "" ? EMPTY : value;
    last = match.index! + match[0].length;
  }
  out += sanitizeLiteral(template.slice(last));

  // Trim after cutting so a cut right after a separator leaves none at the end
  return truncateUtf8(dropEmpty(out), MAX_BASENAME_BYTES).replace(SEPARATOR_EDGES, "");
}

/**
 * Expands the name template into a file name without extension.
 *
 * - Variables: {original}, {note}, {date:<moment format>}, {size}. Anything
 *   else in braces is kept as literal text.
 * - A variable without a value expands to "", and the separators (- _ . and
 *   white space) it leaves over are removed, as are separators at the start
 *   and the end of the name.
 * - Forbidden characters (see FORBIDDEN) never reach the result.
 * - When nothing is left, the default template is used instead.
 */
export function resolveName(template: string, context: NameContext, formatDate: DateFormatter): string {
  const name = expand(template, context, formatDate);
  if (name !== "" || template === DEFAULT_NAME_TEMPLATE) return name;
  return expand(DEFAULT_NAME_TEMPLATE, context, formatDate);
}
