// What the drop zone takes from a paste and what its placeholder tells.
// Pure module: must not import "obsidian".

/** The parts of a DataTransfer (ClipboardEvent.clipboardData) a paste reads. */
export interface PastedData {
    readonly files?: ArrayLike<File> | null;
    readonly items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
}

/**
 * The files a paste carries: `files`, or, when a browser leaves it empty,
 * the items of kind "file". Text and HTML items are not files. The caller
 * keeps the images among them, as for a drop.
 */
export function pastedFiles(data: PastedData | null | undefined): File[] {
    if (!data) return [];
    const files = Array.from(data.files ?? []);
    if (files.length > 0) return files;
    const fromItems: File[] = [];
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) fromItems.push(file);
    }
    return fromItems;
}

/** Whether the drop zone takes a file: an image of any type, as the file input's accept="image/*". */
export function isImageFile(file: { type: string }): boolean {
    return file.type.startsWith("image/");
}

/**
 * The images a paste carries. Empty for a paste of text, or of files none
 * of which is an image: the drop zone then tells there is no image.
 */
export function pastedImages(data: PastedData | null | undefined): File[] {
    return pastedFiles(data).filter(isImageFile);
}

/** The device, as far as the placeholder's words differ. */
export type HintPlatform = "android" | "ios" | "mac" | "desktop";

/**
 * The placeholder's heading and the line on how to paste.
 *
 * - Android: no drag & drop on a phone, and no button reads the clipboard
 *   (the WebView denies the read), so the user pastes with a long press
 * - iOS: unchanged; the "Paste from Clipboard" button is there
 * - Desktop: Ctrl+V, or Cmd+V on a Mac, once the zone has the focus
 */
export function dropZoneHint(platform: HintPlatform): { heading: string; paste: string | null } {
    switch (platform) {
        case "android":
            return { heading: "Long-press here and tap Paste", paste: null };
        case "ios":
            return { heading: "Drag & drop images here", paste: null };
        case "mac":
            return { heading: "Drag & drop images here", paste: "or click here and press Cmd+V to paste" };
        case "desktop":
            return { heading: "Drag & drop images here", paste: "or click here and press Ctrl+V to paste" };
    }
}
