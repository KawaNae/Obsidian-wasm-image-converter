import { App, Modal } from "obsidian";
import { PluginSettings } from "../settings";
import { ConverterBody, ConverterRequest } from "./converter-body";

/**
 * Opens the converter dialog and resolves with the embed links of the saved
 * images (separated by an empty line), or undefined when nothing was converted.
 */
export function openImageConverterModal(app: App, settings: PluginSettings, request: ConverterRequest): Promise<string | undefined> {
    return new Promise((resolve) => {
        new ImageConverterModal(app, settings, request, resolve).open();
    });
}

/** The window of the converter dialog; its content is ConverterBody. */
class ImageConverterModal extends Modal {
    private body: ConverterBody;

    constructor(app: App, settings: PluginSettings, request: ConverterRequest, onResult: (value?: string) => void) {
        super(app);
        this.body = new ConverterBody(app, settings, request, this, onResult);
    }

    onOpen() {
        this.modalEl.addClass("wasm-image-modal");
        this.titleEl.setText("Image Converter");
        this.contentEl.empty();
        this.body.build(this.contentEl);
    }

    onClose() {
        this.body.dispose();
        this.contentEl.empty();
    }
}
