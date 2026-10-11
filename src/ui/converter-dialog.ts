import { App } from "obsidian";
import { PluginSettings } from "../settings";
import { ConverterBody, ConverterRequest } from "./converter-body";
import { OverlayShell, raiseOverlay } from "./overlay/overlay-shell";

/** The key of the converter dialog among the open overlays: one at a time. */
const CONVERTER_DIALOG = "converter-dialog";

/**
 * Opens the converter dialog (a bottom sheet on a phone) in `hostDocument`
 * and resolves with the embed links of the saved images, separated by an
 * empty line, or undefined when nothing was converted.
 *
 * The dialog opens once: while it is open, another call brings it to the
 * front, in its own window, and resolves with undefined at once. The open
 * dialog keeps its request and delivers its links to its own caller.
 */
export function openConverterDialog(app: App, settings: PluginSettings, request: ConverterRequest, hostDocument: Document): Promise<string | undefined> {
    if (raiseOverlay(CONVERTER_DIALOG)) return Promise.resolve(undefined);
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
