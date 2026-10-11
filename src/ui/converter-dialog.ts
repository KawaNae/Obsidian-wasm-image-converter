import { App } from "obsidian";
import { PluginSettings } from "../settings";
import { ConverterBody, ConverterRequest } from "./converter-body";
import { OverlayShell, keepOverlay } from "./overlay/overlay-shell";

/** The key of the converter dialog among the open overlays: one at a time. */
const CONVERTER_DIALOG = "converter-dialog";

/**
 * Opens the converter dialog (a bottom sheet on a phone) in `hostDocument`
 * and resolves with the embed links of the saved images, separated by an
 * empty line, or undefined when nothing was converted.
 *
 * The dialog opens once. While it is open in `hostDocument`, another call
 * leaves it there (keepOverlay) and resolves with undefined at once; the
 * open dialog keeps its request and delivers its links to its own caller.
 * While it is open in another window, that one closes, delivering to its
 * caller what it converted, and the dialog opens anew in `hostDocument`.
 */
export function openConverterDialog(app: App, settings: PluginSettings, request: ConverterRequest, hostDocument: Document): Promise<string | undefined> {
    if (keepOverlay(CONVERTER_DIALOG, hostDocument)) return Promise.resolve(undefined);
    return new Promise((resolve) => {
        const shell = new OverlayShell();
        const body = new ConverterBody(app, settings, request, shell, resolve);
        shell.open({
            label: "Image Converter",
            hostDocument,
            key: CONVERTER_DIALOG,
            panelClass: "wasm-image-modal",
            keymap: app.keymap,
            build: (bodyEl, footerEl) => body.build(bodyEl, footerEl),
            onClose: () => body.dispose(),
        });
    });
}
