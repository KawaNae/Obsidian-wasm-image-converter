import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settings-migration";
import {
  BUILTIN_PRESETS,
  DEFAULT_FOLDER,
  DEFAULT_NAME_TEMPLATE,
  PluginSettings,
  createDefaultSettings,
  repairPresetRefs,
  resolvePreset,
} from "./settings";

function counterIds() {
  let n = 0;
  return () => `id-${++n}`;
}

const builtinIds = BUILTIN_PRESETS.map(b => b.id);

/** Shape of the real user's data.json written by v0.6.0 (or earlier). */
function realUserData() {
  return {
    converterType: "wasm-webp",
    quality: 0.75,
    maxWidth: 2000,
    maxHeight: 2000,
    enableResize: true,
    attachmentFolder: "Attachments",
    autoReadClipboard: true,
    enableGrayscale: false,
    enableAutoConvert: true,
    batchConvertExtensions: ["jpg", "jpeg", "png", "gif", "bmp", "tiff"],
    processAnimatedGifs: false,
    autoConvertPreset: "Default",
    enableAutoOrganizeImages: false,
    presets: [
      {
        name: "Default", converterType: "wasm-webp", quality: 0.8, maxWidth: 2000, maxHeight: 2000,
        enableResize: true, enableGrayscale: false, attachmentFolder: "Attachments",
      },
      {
        name: "Gray", converterType: "wasm-webp", quality: 0.8, maxWidth: 1920, maxHeight: 1080,
        enableResize: false, enableGrayscale: true, attachmentFolder: "Attachments",
      },
    ],
  };
}

/** A legacy preset with the given overrides (defaults match the legacy built-in Default). */
function legacyPreset(overrides: Record<string, unknown>) {
  return {
    name: "Default", converterType: "wasm-webp", quality: 0.8, maxWidth: 1920, maxHeight: 1080,
    enableResize: true, enableGrayscale: false, attachmentFolder: "Attachments",
    ...overrides,
  };
}

describe("fresh install", () => {
  it.each([null, undefined, {}])("uses the defaults for %s", (raw) => {
    const r = migrateSettings(raw);
    expect(r.source).toBe("fresh");
    expect(r.changed).toBe(false);
    expect(r.discardedFolders).toEqual([]);
    expect(r.settings).toEqual(createDefaultSettings());
    expect(r.settings.save.destination).toEqual({ mode: "obsidian", folder: DEFAULT_FOLDER });
    expect(r.settings.save.nameTemplate).toBe(DEFAULT_NAME_TEMPLATE);
    expect(r.settings.presets.map(p => p.id)).toEqual(builtinIds);
  });

  it("returns objects not shared with the built-in definitions", () => {
    const a = migrateSettings(null).settings;
    a.presets[0].encode.resize.maxWidth = 1;
    a.batchConvertExtensions.push("x");
    const b = migrateSettings(null).settings;
    expect(b.presets[0].encode.resize.maxWidth).toBe(1920);
    expect(BUILTIN_PRESETS[0].encode.resize.maxWidth).toBe(1920);
    expect(b.batchConvertExtensions).not.toContain("x");
  });
});

describe("legacy settings (v0.6.0 and earlier)", () => {
  it("migrates the real user's settings without changing the save folder", () => {
    const r = migrateSettings(realUserData(), counterIds());
    const s = r.settings;
    expect(r.source).toBe("legacy");
    expect(r.changed).toBe(true);
    expect(r.discardedFolders).toEqual([]);

    expect(s.save.destination).toEqual({ mode: "folder", folder: "Attachments" });
    expect(s.save.nameTemplate).toBe(DEFAULT_NAME_TEMPLATE);

    expect(s.presets.map(p => [p.id, p.name, p.builtin])).toEqual([
      ["default", "Default", true],
      ["id-1", "Gray", false],
      ["photo", "Photo", true],
      ["illustration", "Illustration", true],
      ["document", "Document", true],
    ]);
    // The user's edited Default keeps its own values
    expect(s.presets[0].encode).toEqual({
      format: "webp", quality: 0.8, resize: { enabled: true, maxWidth: 2000, maxHeight: 2000 }, grayscale: false,
    });
    expect(s.presets[1].encode).toEqual({
      format: "webp", quality: 0.8, resize: { enabled: false, maxWidth: 1920, maxHeight: 1080 }, grayscale: true,
    });

    expect(s.defaultPresetId).toBe("default");
    expect(s.autoConvertPresetId).toBe("default");
    expect(s.autoReadClipboard).toBe(true);
    expect(s.enableAutoConvert).toBe(true);
    expect(s.processAnimatedGifs).toBe(false);
    expect(s.enableSampledPrediction).toBe(true);
    expect(s.batchConvertExtensions).toEqual(["jpg", "jpeg", "png", "gif", "bmp"]);
  });

  it("drops the abolished top-level fields and unknown keys", () => {
    const s = migrateSettings(realUserData(), counterIds()).settings as unknown as Record<string, unknown>;
    for (const key of ["converterType", "quality", "maxWidth", "maxHeight", "enableResize",
      "enableGrayscale", "attachmentFolder", "autoConvertPreset", "enableAutoOrganizeImages"]) {
      expect(s).not.toHaveProperty(key);
    }
    for (const p of (s as unknown as PluginSettings).presets) {
      expect(p).not.toHaveProperty("attachmentFolder");
      expect(p).not.toHaveProperty("isBuiltin");
    }
  });

  it("keeps the Default folder and reports presets with a different folder", () => {
    const raw = realUserData();
    raw.presets[0].attachmentFolder = "Images/";
    raw.presets[1].attachmentFolder = "Gray";
    const r = migrateSettings(raw, counterIds());
    expect(r.settings.save.destination).toEqual({ mode: "folder", folder: "Images/" });
    expect(r.discardedFolders).toEqual([{ presetName: "Gray", folder: "Gray" }]);
  });

  it("treats folder spellings that differ only by slashes as the same folder", () => {
    const raw = realUserData();
    raw.presets[0].attachmentFolder = "Assets/img";
    raw.presets[1].attachmentFolder = "/Assets/img/";
    expect(migrateSettings(raw, counterIds()).discardedFolders).toEqual([]);
  });

  it("falls back to the top-level folder when there is no Default preset", () => {
    const raw = {
      attachmentFolder: "Old",
      presets: [legacyPreset({ name: "Mine", attachmentFolder: "Old" })],
    };
    const r = migrateSettings(raw, counterIds());
    expect(r.settings.save.destination).toEqual({ mode: "folder", folder: "Old" });
    expect(r.discardedFolders).toEqual([]);
    // The missing built-ins are restored
    expect(r.settings.presets.map(p => p.id)).toEqual(["id-1", ...builtinIds]);
  });

  it("handles data written before presets existed (v0.0.x)", () => {
    const r = migrateSettings({ quality: 0.6, attachmentFolder: "Pics", enableGrayscale: true });
    expect(r.source).toBe("legacy");
    expect(r.settings.save.destination).toEqual({ mode: "folder", folder: "Pics" });
    expect(r.settings.presets.map(p => p.id)).toEqual(builtinIds);
    expect(r.discardedFolders).toEqual([]);
  });

  it("uses the default folder when the old data names none", () => {
    const r = migrateSettings({ autoReadClipboard: true });
    expect(r.settings.save.destination).toEqual({ mode: "folder", folder: DEFAULT_FOLDER });
  });

  it("respects isBuiltin written by v0.6.0", () => {
    const raw = {
      presets: [
        legacyPreset({ isBuiltin: true }),
        // Same name as a built-in but marked custom: stays custom and blocks the built-in
        legacyPreset({ name: "Photo", converterType: "wasm-avif", quality: 0.75, isBuiltin: false }),
        legacyPreset({ name: "Illustration", quality: 0.9, isBuiltin: true }),
      ],
    };
    const s = migrateSettings(raw, counterIds()).settings;
    expect(s.presets.map(p => [p.id, p.name, p.builtin])).toEqual([
      ["default", "Default", true],
      ["id-1", "Photo", false],
      ["illustration", "Illustration", true],
      ["document", "Document", true],
    ]);
  });

  it("infers built-ins without isBuiltin the same way v0.6.0 did", () => {
    const raw = {
      presets: [
        // Edited Default is still the built-in
        legacyPreset({ quality: 0.5, maxWidth: 800 }),
        // Exactly the built-in Photo
        legacyPreset({ name: "Photo", converterType: "wasm-avif", quality: 0.75 }),
        // Illustration with an edited quality is a user preset
        legacyPreset({ name: "Illustration", quality: 0.7 }),
        // Document identical except the folder is a user preset
        legacyPreset({ name: "Document", quality: 0.5, maxWidth: 1200, maxHeight: 1600, enableGrayscale: true, attachmentFolder: "Docs" }),
      ],
    };
    const r = migrateSettings(raw, counterIds());
    expect(r.settings.presets.map(p => [p.id, p.name, p.builtin])).toEqual([
      ["default", "Default", true],
      ["photo", "Photo", true],
      ["id-1", "Illustration", false],
      ["id-2", "Document", false],
    ]);
    expect(r.discardedFolders).toEqual([{ presetName: "Document", folder: "Docs" }]);
  });

  it("maps the old converter types to formats", () => {
    const raw = {
      presets: [
        legacyPreset({ name: "A", converterType: "wasm-webp" }),
        legacyPreset({ name: "B", converterType: "wasm-avif" }),
        legacyPreset({ name: "C", converterType: "canvas-jpeg" }),
        legacyPreset({ name: "D", converterType: "canvas-png" }),
        legacyPreset({ name: "E", converterType: "sharp-webp" }),
      ],
    };
    const s = migrateSettings(raw, counterIds()).settings;
    expect(s.presets.slice(0, 5).map(p => p.encode.format)).toEqual(["webp", "avif", "jpeg", "png", "webp"]);
  });

  it("replaces invalid numbers with the defaults", () => {
    const raw = { presets: [legacyPreset({ quality: 0, maxWidth: -5, maxHeight: "x", enableResize: "yes" })] };
    const e = migrateSettings(raw, counterIds()).settings.presets[0].encode;
    expect(e).toEqual({ format: "webp", quality: 0.8, resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 }, grayscale: false });
  });

  it("turns the auto-convert preset name into an id", () => {
    const raw = realUserData();
    raw.autoConvertPreset = "Gray";
    expect(migrateSettings(raw, counterIds()).settings.autoConvertPresetId).toBe("id-1");

    raw.autoConvertPreset = "Deleted";
    expect(migrateSettings(raw, counterIds()).settings.autoConvertPresetId).toBe("default");
  });
});

describe("current settings", () => {
  it("is idempotent: migrated data loads back unchanged", () => {
    const first = migrateSettings(realUserData(), counterIds());
    const stored = JSON.parse(JSON.stringify(first.settings));
    const second = migrateSettings(stored, counterIds());
    expect(second.source).toBe("current");
    expect(second.changed).toBe(false);
    expect(second.discardedFolders).toEqual([]);
    expect(second.settings).toEqual(first.settings);
  });

  it("repairs dangling ids, missing built-ins and broken fields", () => {
    const raw = {
      settingsVersion: 2,
      presets: [
        { id: "default", name: "Default", builtin: true, encode: { format: "gif", quality: 2 } },
        { id: "p-1", name: "Mine", builtin: true, encode: { format: "png", quality: 0.5, resize: { enabled: false, maxWidth: 10, maxHeight: 20 }, grayscale: true } },
        { id: "p-1", name: "Dup", builtin: false, encode: {} },
      ],
      defaultPresetId: "default",
      autoConvertPresetId: "gone",
      save: { destination: { mode: "somewhere", folder: "X" }, nameTemplate: "" },
    };
    const r = migrateSettings(raw, counterIds());
    const s = r.settings;
    expect(r.source).toBe("current");
    expect(r.changed).toBe(true);
    expect(s.presets.map(p => [p.id, p.name, p.builtin])).toEqual([
      ["default", "Default", true],
      ["p-1", "Mine", false], // only shipped built-in ids can be built-in
      ["id-1", "Dup", false],
      ["photo", "Photo", true],
      ["illustration", "Illustration", true],
      ["document", "Document", true],
    ]);
    expect(s.presets[0].encode).toEqual({ format: "webp", quality: 0.8, resize: { enabled: true, maxWidth: 1920, maxHeight: 1080 }, grayscale: false });
    expect(s.presets[1].encode).toEqual({ format: "png", quality: 0.5, resize: { enabled: false, maxWidth: 10, maxHeight: 20 }, grayscale: true });
    expect(s.autoConvertPresetId).toBe("default");
    expect(s.save).toEqual({ destination: { mode: "obsidian", folder: "X" }, nameTemplate: DEFAULT_NAME_TEMPLATE });
  });

  it("keeps the folder mode", () => {
    const raw = { ...createDefaultSettings(), save: { destination: { mode: "folder", folder: "A/B" }, nameTemplate: "{original}" } };
    const r = migrateSettings(JSON.parse(JSON.stringify(raw)));
    expect(r.changed).toBe(false);
    expect(r.settings.save).toEqual({ destination: { mode: "folder", folder: "A/B" }, nameTemplate: "{original}" });
  });
});

describe("resolvePreset", () => {
  const s = createDefaultSettings();

  it("finds a preset by id", () => {
    expect(resolvePreset(s, "photo")?.name).toBe("Photo");
  });

  it("falls back to the default preset for an unknown id", () => {
    expect(resolvePreset(s, "gone")?.id).toBe("default");
  });

  it("falls back to the first preset when the default is missing too", () => {
    expect(resolvePreset({ presets: s.presets.slice(1), defaultPresetId: "default" }, "gone")?.id).toBe("photo");
  });
});

describe("repairPresetRefs", () => {
  it("points a deleted auto-convert preset back at the default preset", () => {
    const s = createDefaultSettings();
    s.autoConvertPresetId = "photo";
    s.presets = s.presets.filter(p => p.id !== "photo");
    repairPresetRefs(s);
    expect(s.autoConvertPresetId).toBe("default");
  });

  it("keeps ids that still exist", () => {
    const s = createDefaultSettings();
    s.autoConvertPresetId = "document";
    repairPresetRefs(s);
    expect(s.autoConvertPresetId).toBe("document");
    expect(s.defaultPresetId).toBe("default");
  });

  it("uses the first preset when the default preset is gone", () => {
    const s = createDefaultSettings();
    s.presets = s.presets.slice(2);
    repairPresetRefs(s);
    expect(s.defaultPresetId).toBe("illustration");
    expect(s.autoConvertPresetId).toBe("illustration");
  });
});
