// Settings model. Pure module: must not import "obsidian" so that the
// migration and the helpers below can be unit-tested with vitest.

export type ImageFormat = "webp" | "avif" | "jpeg" | "png";

/** Encoding parameters: the content of a preset. */
export interface EncodeSettings {
  format: ImageFormat;
  quality: number; // 0.1 - 1.0. Unused for png
  resize: { enabled: boolean; maxWidth: number; maxHeight: number };
  grayscale: boolean;
}

export interface Preset {
  id: string; // presets are identified by id, never by name
  name: string;
  builtin: boolean; // built-in presets cannot be deleted or renamed
  encode: EncodeSettings;
}

/** Where and under which name converted files are saved. Not part of presets. */
export interface SaveSettings {
  destination: { mode: "obsidian" | "folder"; folder: string };
  nameTemplate: string;
}

export const SETTINGS_VERSION = 2;

export interface PluginSettings {
  settingsVersion: typeof SETTINGS_VERSION;
  presets: Preset[];
  defaultPresetId: string; // initial preset of the converter dialog
  autoConvertPresetId: string; // preset used by drag & drop / paste auto-convert and batch convert
  save: SaveSettings;
  autoReadClipboard: boolean; // read the clipboard when the dialog opens
  enableAutoConvert: boolean; // auto-convert on drag & drop / paste
  batchConvertExtensions: string[]; // target extensions of batch convert and auto-convert
  processAnimatedGifs: boolean; // convert animated GIFs (result is a static image)
  enableSampledPrediction: boolean; // refine the size prediction with a sample encode
}

export function isImageFormat(value: unknown): value is ImageFormat {
  return value === "webp" || value === "avif" || value === "jpeg" || value === "png";
}

export const DEFAULT_PRESET_ID = "default";

export const DEFAULT_ENCODE: EncodeSettings = {
  format: "webp",
  quality: 0.8,
  resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 },
  grayscale: false,
};

export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: "Default",
    builtin: true,
    encode: DEFAULT_ENCODE,
  },
  {
    id: "photo",
    name: "Photo",
    builtin: true,
    encode: { format: "avif", quality: 0.75, resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 }, grayscale: false },
  },
  {
    id: "illustration",
    name: "Illustration",
    builtin: true,
    encode: { format: "webp", quality: 0.9, resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 }, grayscale: false },
  },
  {
    id: "document",
    name: "Document",
    builtin: true,
    encode: { format: "webp", quality: 0.5, resize: { enabled: true, maxWidth: 1200, maxHeight: 1600 }, grayscale: true },
  },
];

/**
 * Extensions batch convert and auto-convert can target: the choices of the
 * settings tab, all on by default. Not tiff, which the renderer (Chromium)
 * cannot decode; it was dropped from the targets in v0.6.0.
 */
export const TARGET_EXTENSIONS: readonly string[] = ["jpg", "jpeg", "png", "gif", "bmp"];

/**
 * Extensions of the images the converter dialog is offered for in the file
 * menu, and that its drop zone names: the targets, and webp to convert again.
 */
export const DIALOG_EXTENSIONS: readonly string[] = [...TARGET_EXTENSIONS, "webp"];

export const DEFAULT_NAME_TEMPLATE = "IMG-{date:YYYYMMDD[T]HHmmssSSS}-{size}";
export const DEFAULT_FOLDER = "Attachments";

export function cloneEncode(encode: EncodeSettings): EncodeSettings {
  return { ...encode, resize: { ...encode.resize } };
}

export function clonePreset(preset: Preset): Preset {
  return { ...preset, encode: cloneEncode(preset.encode) };
}

export function builtinPresets(): Preset[] {
  return BUILTIN_PRESETS.map(clonePreset);
}

/** Whether two encodings give the same output. */
export function encodeEquals(a: EncodeSettings, b: EncodeSettings): boolean {
  return a.format === b.format
    && a.quality === b.quality
    && a.grayscale === b.grayscale
    && a.resize.enabled === b.resize.enabled
    && a.resize.maxWidth === b.resize.maxWidth
    && a.resize.maxHeight === b.resize.maxHeight;
}

/** The factory encoding of a built-in preset; undefined for user presets. */
export function builtinEncode(id: string): EncodeSettings | undefined {
  const preset = BUILTIN_PRESETS.find(p => p.id === id);
  return preset ? cloneEncode(preset.encode) : undefined;
}

/** Name of a preset as the dialogs show it, marked when its values were changed there. */
export function presetLabel(name: string, modified: boolean): string {
  return modified ? `${name} (modified)` : name;
}

/** Settings of a fresh install. Every call returns a new, unshared object. */
export function createDefaultSettings(): PluginSettings {
  return {
    settingsVersion: SETTINGS_VERSION,
    presets: builtinPresets(),
    defaultPresetId: DEFAULT_PRESET_ID,
    autoConvertPresetId: DEFAULT_PRESET_ID,
    save: {
      destination: { mode: "obsidian", folder: DEFAULT_FOLDER },
      nameTemplate: DEFAULT_NAME_TEMPLATE,
    },
    autoReadClipboard: false, // off by default (avoids permission issues on iPad)
    enableAutoConvert: false,
    batchConvertExtensions: [...TARGET_EXTENSIONS],
    processAnimatedGifs: false, // keep animations by default
    enableSampledPrediction: true, // turn off on low-power devices
  };
}

/** Random id for user-created presets. */
export function createPresetId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Looks a preset up by id. Falls back to the default preset, then to the
 * first preset, so a dangling id (deleted preset) never breaks conversion.
 */
export function resolvePreset(settings: Pick<PluginSettings, "presets" | "defaultPresetId">, id: string): Preset | undefined {
  return settings.presets.find(p => p.id === id)
    ?? settings.presets.find(p => p.id === settings.defaultPresetId)
    ?? settings.presets[0];
}

/**
 * Points dangling preset ids (deleted or reset presets) back at existing
 * presets: the default id at "default" or the first preset, the auto-convert
 * id at the default preset.
 */
export function repairPresetRefs(settings: Pick<PluginSettings, "presets" | "defaultPresetId" | "autoConvertPresetId">) {
  const has = (id: string) => settings.presets.some(p => p.id === id);
  if (!has(settings.defaultPresetId)) {
    settings.defaultPresetId = has(DEFAULT_PRESET_ID) ? DEFAULT_PRESET_ID : (settings.presets[0]?.id ?? DEFAULT_PRESET_ID);
  }
  if (!has(settings.autoConvertPresetId)) {
    settings.autoConvertPresetId = settings.defaultPresetId;
  }
}
