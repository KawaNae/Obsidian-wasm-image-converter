import { App } from "obsidian";
import { PluginSettings } from "../settings";
import { ConverterBody, ConverterRequest } from "./converter-body";
import { OverlayShell } from "./overlay/overlay-shell";

/**
 * Opens the converter dialog (a bottom sheet on a phone) and resolves with
 * the embed links of the saved images, separated by an empty line, or
 * undefined when nothing was converted.
 */
export function openConverterDialog(app: App, settings: PluginSettings, request: ConverterRequest): Promise<string | undefined> {
    return new Promise((resolve) => {
        const shell = new OverlayShell();
        const body = new ConverterBody(app, settings, request, shell, resolve);
        shell.open({
            title: "Image Converter",
            panelClass: "wasm-image-modal",
            keymap: app.keymap,
            build: (bodyEl, footerEl) => body.build(bodyEl, footerEl),
            onClose: () => body.dispose(),
        });
    });
}
