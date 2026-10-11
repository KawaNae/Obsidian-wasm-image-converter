import { Platform } from "obsidian";

/**
 * Why the dialog may not read the clipboard as it opens (the setting
 * "Auto-read clipboard on startup") on this device, in the words of the
 * settings tab; null where it may. There the setting is shown disabled and
 * ignored whatever its value.
 *
 * - iOS: a read the user did not start by a tap asks for permission each
 *   time, with a menu over the dialog
 * - Android: the WebView denies every clipboard read of an image, and the
 *   app cannot grant it (see canPasteByButton)
 */
export function autoReadClipboardBlock(): string | null {
    if (Platform.isIosApp) {
        return "Not available on iOS: the clipboard is not read when the converter opens.";
    }
    if (Platform.isAndroidApp) {
        return "Not available on Android: the app cannot read images from the clipboard. " +
            "Long-press the drop zone and tap Paste instead.";
    }
    return null;
}

/** Whether the dialog may read the clipboard as it opens: see autoReadClipboardBlock. */
export function canAutoReadClipboard(): boolean {
    return autoReadClipboardBlock() === null;
}

/**
 * Whether the dialog shows "Paste from Clipboard". Not on Android: its
 * WebView denies every clipboard read of an image, even on a tap, and the
 * app cannot grant it. There the user pastes into the drop zone with a long
 * press instead.
 */
export function canPasteByButton(): boolean {
    return !Platform.isAndroidApp;
}
