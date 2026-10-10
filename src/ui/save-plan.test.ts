import { describe, expect, it } from "vitest";
import { canonicalFolder, displayFolder, FieldValues, folderChanged, nameChanged, planNewFile, planReplacement } from "./save-plan";
import { SaveSettings } from "../settings";

const fields = (over: Partial<FieldValues> = {}): FieldValues => ({
    name: "IMG-{size}", initialName: "IMG-{size}", folder: "Attachments", initialFolder: "Attachments", ...over,
});

const obsidian: SaveSettings = { destination: { mode: "obsidian", folder: "Attachments" }, nameTemplate: "IMG-{size}" };

describe("canonicalFolder / displayFolder", () => {
    it("maps the root and slashes", () => {
        expect(canonicalFolder("")).toBeNull();
        expect(canonicalFolder("  ")).toBeNull();
        expect(canonicalFolder("/")).toBe("");
        expect(canonicalFolder(" /Notes/img/ ")).toBe("Notes/img");
        expect(displayFolder("")).toBe("/");
        expect(displayFolder("Notes/")).toBe("Notes");
    });
});

describe("nameChanged / folderChanged", () => {
    it("treats empty fields and slash-only differences as unchanged", () => {
        expect(nameChanged(fields({ name: "  " }))).toBe(false);
        expect(folderChanged(fields({ folder: "" }))).toBe(false);
        expect(folderChanged(fields({ folder: "/Attachments/" }))).toBe(false);
        expect(folderChanged(fields({ folder: "/", initialFolder: "/" }))).toBe(false);
    });

    it("notices edits", () => {
        expect(nameChanged(fields({ name: "{original}" }))).toBe(true);
        expect(folderChanged(fields({ folder: "Other" }))).toBe(true);
        // initial folder unknown (shown as a placeholder): the root is a choice
        expect(folderChanged(fields({ initialFolder: "", folder: "/" }))).toBe(true);
    });
});

describe("planNewFile", () => {
    it("keeps the configured destination while the folder is unchanged", () => {
        expect(planNewFile(fields(), obsidian)).toEqual({ destination: obsidian.destination, nameTemplate: "IMG-{size}" });
    });

    it("saves to a typed folder as a fixed folder, for this conversion only", () => {
        const plan = planNewFile(fields({ folder: "Notes/img/", name: "{note}" }), obsidian);
        expect(plan).toEqual({ destination: { mode: "folder", folder: "Notes/img" }, nameTemplate: "{note}" });
        expect(obsidian.destination.mode).toBe("obsidian");
    });
});

describe("planReplacement", () => {
    const original = { name: "IMG_0123", initialName: "IMG_0123", folder: "Notes/旅行", initialFolder: "Notes/旅行" };

    it("keeps name and place when nothing changed", () => {
        expect(planReplacement(original, { folder: "Notes/旅行" })).toBeNull();
        expect(planReplacement({ ...original, name: "" }, { folder: "Notes/旅行" })).toBeNull();
    });

    it("moves and keeps the base name when only the folder changed", () => {
        expect(planReplacement({ ...original, folder: "/" }, { folder: "Notes/旅行" })).toEqual({ folder: "", nameTemplate: null });
    });

    it("renames in place when only the name changed", () => {
        expect(planReplacement({ ...original, name: "trip-{size}" }, { folder: "Notes/旅行" })).toEqual({ folder: "Notes/旅行", nameTemplate: "trip-{size}" });
    });
});
