import { Platform } from "obsidian";

/**
 * Whether the dialog may read the clipboard as it opens (the setting
 * "Auto-read clipboard on startup"). Not on iOS: there a read the user did
 * not start by a tap asks for permission each time, with a menu over the
 * dialog, so the setting is shown disabled and ignored whatever its value.
 */
export function canAutoReadClipboard(): boolean {
    return !Platform.isIosApp;
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
