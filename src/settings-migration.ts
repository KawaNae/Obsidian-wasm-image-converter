// Turns whatever loadData() returned into the current PluginSettings.
// Pure module (no "obsidian" import): the caller shows Notices and saves.

import {
  BUILTIN_PRESETS,
  DEFAULT_ENCODE,
  DEFAULT_FOLDER,
  DEFAULT_NAME_TEMPLATE,
  DEFAULT_PRESET_ID,
  EncodeSettings,
  ImageFormat,
  PluginSettings,
  Preset,
  SETTINGS_VERSION,
  clonePreset,
  createDefaultSettings,
  createPresetId,
  isImageFormat,
  repairPresetRefs,
} from "./settings";

/** A per-preset save folder that the migration could not keep. */
export interface DiscardedPresetFolder {
  presetName: string;
  folder: string;
}

export interface MigrationResult {
  settings: PluginSettings;
  /**
   * fresh: nothing saved yet (new install)
   * legacy: settings of v0.6.0 or earlier (no settingsVersion)
   * current: settings already in the current shape
   */
  source: "fresh" | "legacy" | "current";
  /** True when the stored data differs from `settings` and should be saved. */
  changed: boolean;
  /** Presets whose save folder differed from the one kept as the default. */
  discardedFolders: DiscardedPresetFolder[];
}

type Raw = Record<string, unknown>;

export function migrateSettings(raw: unknown, newId: () => string = createPresetId): MigrationResult {
  if (!isObject(raw) || Object.keys(raw).length === 0) {
    return { settings: createDefaultSettings(), source: "fresh", changed: false, discardedFolders: [] };
  }
  if (raw.settingsVersion === SETTINGS_VERSION) {
    const settings = normalizeCurrent(raw, newId);
    return {
      settings,
      source: "current",
      changed: JSON.stringify(settings) !== JSON.stringify(raw),
      discardedFolders: [],
    };
  }
  const { settings, discardedFolders } = migrateLegacy(raw, newId);
  return { settings, source: "legacy", changed: true, discardedFolders };
}

// ===== v0.6.0 and earlier =====

const LEGACY_CONVERTER_FORMAT: Record<string, ImageFormat> = {
  "wasm-webp": "webp",
  "wasm-avif": "avif",
  "canvas-jpeg": "jpeg",
  "canvas-png": "png",
};

/** Every legacy built-in preset was defined with this folder. */
const LEGACY_BUILTIN_FOLDER = "Attachments";

function migrateLegacy(raw: Raw, newId: () => string): { settings: PluginSettings; discardedFolders: DiscardedPresetFolder[] } {
  const settings = createDefaultSettings();
  copyBehaviorFields(raw, settings);

  // Before presets existed (v0.0.x) the saved data had no presets array;
  // those versions fell back to the built-in presets, and so do we.
  const legacyPresets = Array.isArray(raw.presets) ? raw.presets.filter(isObject) : null;

  if (legacyPresets) {
    const usedIds = new Set<string>();
    settings.presets = legacyPresets.map(p => {
      const name = typeof p.name === "string" ? p.name : "";
      const encode = legacyEncode(p);
      const def = BUILTIN_PRESETS.find(b => b.name === name);
      // v0.6.0 stored isBuiltin. Older versions did not: "Default" was always
      // protected, other presets count as built-in only when every field
      // matches the built-in definition (same rule as v0.6.0's loadSettings).
      const flagged = typeof p.isBuiltin === "boolean"
        ? p.isBuiltin
        : name === "Default" || (!!def && encodeEquals(def.encode, encode) && p.attachmentFolder === LEGACY_BUILTIN_FOLDER);
      const builtin = flagged && !!def && !usedIds.has(def.id);
      const id = builtin ? def!.id : uniqueId(usedIds, newId);
      usedIds.add(id);
      return { id, name, builtin, encode };
    });
  }

  // The save folder of the Default preset becomes the default save folder,
  // so updating does not change where files go.
  const legacyDefault = legacyPresets?.find(p => p.name === "Default");
  const folder = nonEmptyString(legacyDefault?.attachmentFolder)
    ?? nonEmptyString(raw.attachmentFolder)
    ?? DEFAULT_FOLDER;
  settings.save.destination = { mode: "folder", folder };

  const discardedFolders: DiscardedPresetFolder[] = [];
  for (const p of legacyPresets ?? []) {
    const presetFolder = nonEmptyString(p.attachmentFolder);
    if (presetFolder !== undefined && normalizeFolder(presetFolder) !== normalizeFolder(folder)) {
      discardedFolders.push({ presetName: typeof p.name === "string" ? p.name : "", folder: presetFolder });
    }
  }

  // autoConvertPreset referred to a preset by name
  const autoName = raw.autoConvertPreset;
  const auto = settings.presets.find(p => p.name === autoName);
  settings.autoConvertPresetId = auto?.id ?? DEFAULT_PRESET_ID;

  finalize(settings);
  return { settings, discardedFolders };
}

function legacyEncode(p: Raw): EncodeSettings {
  const format = typeof p.converterType === "string" ? LEGACY_CONVERTER_FORMAT[p.converterType] : undefined;
  return normalizeEncode({
    format: format ?? DEFAULT_ENCODE.format,
    quality: p.quality,
    resize: { enabled: p.enableResize, maxWidth: p.maxWidth, maxHeight: p.maxHeight },
    grayscale: p.enableGrayscale,
  });
}

// ===== current shape =====

function normalizeCurrent(raw: Raw, newId: () => string): PluginSettings {
  const settings = createDefaultSettings();
  copyBehaviorFields(raw, settings);

  if (Array.isArray(raw.presets)) {
    const usedIds = new Set<string>();
    settings.presets = raw.presets.filter(isObject).map(p => {
      const rawId = nonEmptyString(p.id);
      const id = rawId !== undefined && !usedIds.has(rawId) ? rawId : uniqueId(usedIds, newId);
      usedIds.add(id);
      return {
        id,
        name: typeof p.name === "string" ? p.name : "",
        // Only the ids of the shipped built-ins can be built-in
        builtin: p.builtin === true && BUILTIN_PRESETS.some(b => b.id === id),
        encode: normalizeEncode(isObject(p.encode) ? p.encode : {}),
      };
    });
  }

  if (typeof raw.defaultPresetId === "string") settings.defaultPresetId = raw.defaultPresetId;
  if (typeof raw.autoConvertPresetId === "string") settings.autoConvertPresetId = raw.autoConvertPresetId;

  const save = isObject(raw.save) ? raw.save : {};
  const dest = isObject(save.destination) ? save.destination : {};
  settings.save = {
    destination: {
      mode: dest.mode === "folder" || dest.mode === "obsidian" ? dest.mode : settings.save.destination.mode,
      folder: typeof dest.folder === "string" ? dest.folder : settings.save.destination.folder,
    },
    nameTemplate: nonEmptyString(save.nameTemplate) ?? DEFAULT_NAME_TEMPLATE,
  };

  finalize(settings);
  return settings;
}

// ===== shared =====

/** Fields whose shape did not change between the legacy and current settings. */
function copyBehaviorFields(raw: Raw, settings: PluginSettings) {
  if (typeof raw.autoReadClipboard === "boolean") settings.autoReadClipboard = raw.autoReadClipboard;
  if (typeof raw.enableAutoConvert === "boolean") settings.enableAutoConvert = raw.enableAutoConvert;
  if (typeof raw.processAnimatedGifs === "boolean") settings.processAnimatedGifs = raw.processAnimatedGifs;
  if (typeof raw.enableSampledPrediction === "boolean") settings.enableSampledPrediction = raw.enableSampledPrediction;
  if (Array.isArray(raw.batchConvertExtensions)) {
    // tiff cannot be decoded by the renderer (dropped from targets in v0.6.0)
    settings.batchConvertExtensions = raw.batchConvertExtensions
      .filter((e): e is string => typeof e === "string")
      .filter(e => e !== "tiff");
  }
}

/** Restores missing built-in presets and repairs dangling preset ids. */
function finalize(settings: PluginSettings) {
  for (const b of BUILTIN_PRESETS) {
    const exists = settings.presets.some(p => p.id === b.id);
    // A user preset with the same name blocks the built-in (names stay unique)
    const nameTaken = settings.presets.some(p => p.name === b.name);
    if (!exists && !nameTaken) settings.presets.push(clonePreset(b));
  }
  if (settings.presets.length === 0) settings.presets.push(clonePreset(BUILTIN_PRESETS[0]));
  repairPresetRefs(settings);
}

function normalizeEncode(e: Raw): EncodeSettings {
  const resize = isObject(e.resize) ? e.resize : {};
  return {
    format: isImageFormat(e.format) ? e.format : DEFAULT_ENCODE.format,
    quality: typeof e.quality === "number" && e.quality > 0 && e.quality <= 1 ? e.quality : DEFAULT_ENCODE.quality,
    resize: {
      enabled: typeof resize.enabled === "boolean" ? resize.enabled : DEFAULT_ENCODE.resize.enabled,
      maxWidth: positiveInt(resize.maxWidth) ?? DEFAULT_ENCODE.resize.maxWidth,
      maxHeight: positiveInt(resize.maxHeight) ?? DEFAULT_ENCODE.resize.maxHeight,
    },
    grayscale: typeof e.grayscale === "boolean" ? e.grayscale : DEFAULT_ENCODE.grayscale,
  };
}

function encodeEquals(a: EncodeSettings, b: EncodeSettings): boolean {
  return a.format === b.format
    && a.quality === b.quality
    && a.resize.enabled === b.resize.enabled
    && a.resize.maxWidth === b.resize.maxWidth
    && a.resize.maxHeight === b.resize.maxHeight
    && a.grayscale === b.grayscale;
}

function uniqueId(used: Set<string>, newId: () => string): string {
  let id = newId();
  while (used.has(id) || BUILTIN_PRESETS.some(b => b.id === id)) id = newId();
  return id;
}

function normalizeFolder(folder: string): string {
  return folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.round(v) : undefined;
}
