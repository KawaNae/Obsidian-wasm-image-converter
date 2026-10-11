import { Notice, Platform } from "obsidian";
import { dropZoneHint, HintPlatform, pastedFiles } from "./drop-zone-input";

function hintPlatform(): HintPlatform {
    if (Platform.isAndroidApp) return "android";
    if (Platform.isIosApp) return "ios";
    return Platform.isMacOS ? "mac" : "desktop";
}

/**
 * Where the dialog takes images: dropped, picked with the file input, or
 * pasted. The zone is an editing host (contenteditable) so that it can
 * have the focus and receive a paste: Ctrl+V or Cmd+V on a desktop, the
 * "Paste" of a long press on Android, where no button can read the
 * clipboard. It takes the pasted images like dropped ones and refuses any
 * edit: typing, deleting, the text of a paste. `inputmode="none"` keeps
 * the soft keyboard down when it is tapped.
 */
export class DropZone {
    element: HTMLDivElement;
    private onFilesSelected: (files: File[]) => void;

    private contentContainer: HTMLDivElement;
    private currentObjectUrls: string[] = [];
    private fileInput: HTMLInputElement;
    private isDisabled: boolean = false;
    private selectedFiles: File[] = [];

    constructor(onFilesSelected: (files: File[]) => void) {
        this.onFilesSelected = onFilesSelected;
        this.element = document.createElement("div");
        this.contentContainer = document.createElement("div");
        this.contentContainer.className = "wasm-image-drop-zone__content";

        // File input (created once)
        this.fileInput = document.createElement("input");
        this.fileInput.type = "file";
        this.fileInput.accept = "image/*";
        this.fileInput.multiple = true;
        this.fileInput.style.display = "none";
        this.element.appendChild(this.fileInput);

        this.element.contentEditable = "true";
        this.element.inputMode = "none";
        this.element.spellcheck = false;

        this.render();
    }

    public setDisabled(disabled: boolean) {
        this.isDisabled = disabled;
        this.element.classList.toggle("wasm-image-drop-zone--disabled", disabled);
        this.fileInput.disabled = disabled;
        this.element.contentEditable = disabled ? "false" : "true";
    }

    private render() {
        this.element.className = "wasm-image-drop-zone";
        this.element.appendChild(this.contentContainer);

        this.renderContent();

        this.fileInput.addEventListener("change", () => {
            if (this.isDisabled) return;
            if (this.fileInput.files && this.fileInput.files.length > 0) {
                const newFiles = Array.from(this.fileInput.files);
                this.addFiles(newFiles);
                // Reset input so same file can be selected again if needed
                this.fileInput.value = '';
            }
        });

        this.element.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (this.isDisabled) return;
            this.element.classList.add("wasm-image-drop-zone--drag-over");
        });

        this.element.addEventListener("dragleave", () => {
            if (this.isDisabled) return;
            this.element.classList.remove("wasm-image-drop-zone--drag-over");
        });

        this.element.addEventListener("drop", (e) => {
            e.preventDefault();
            if (this.isDisabled) return;
            this.element.classList.remove("wasm-image-drop-zone--drag-over");
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const newFiles = Array.from(files);
                this.addFiles(newFiles);
            }
        });

        this.element.addEventListener("paste", (e) => {
            // Never let the browser insert what was pasted, text or images
            e.preventDefault();
            if (this.isDisabled) return;
            this.addFiles(pastedFiles(e.clipboardData));
        });

        // Refuse every edit: typing, Enter, deleting, cutting, dragging inside
        this.element.addEventListener("beforeinput", (e) => e.preventDefault());

        // An IME's composition cannot be cancelled in beforeinput; undo
        // whatever reached the zone by drawing it again.
        this.element.addEventListener("input", () => {
            for (const node of Array.from(this.element.childNodes)) {
                if (node !== this.fileInput && node !== this.contentContainer) node.remove();
            }
            this.renderContent();
        });
    }

    private addFiles(newFiles: File[]) {
        // Filter to only image files
        const imageFiles = newFiles.filter(f => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return;

        // Add to existing selection
        this.selectedFiles = [...this.selectedFiles, ...imageFiles];
        this.renderContent();
        this.onFilesSelected(this.selectedFiles);
    }

    public removeFile(index: number) {
        this.selectedFiles.splice(index, 1);
        this.renderContent();
        this.onFilesSelected(this.selectedFiles);
    }

    /** Draws the placeholder, or the preview of the selected files. */
    private renderContent() {
        this.revokeAllUrls();
        this.contentContainer.empty();

        if (this.selectedFiles.length === 0) {
            this.renderPlaceholder();
            return;
        }

        if (this.selectedFiles.length === 1) {
            // Single file: show large preview (same as original behavior)
            const url = URL.createObjectURL(this.selectedFiles[0]);
            this.currentObjectUrls.push(url);

            const img = document.createElement("img");
            img.src = url;
            img.className = "wasm-image-preview__img";
            img.title = "Drag & drop to replace";
            this.contentContainer.appendChild(img);
        } else {
            // Multiple files: show thumbnail grid
            const grid = document.createElement("div");
            grid.className = "wasm-image-thumbnail__grid";

            this.selectedFiles.forEach((file, index) => {
                const thumb = document.createElement("div");
                thumb.className = "wasm-image-thumbnail__item";

                const url = URL.createObjectURL(file);
                this.currentObjectUrls.push(url);

                const img = document.createElement("img");
                img.src = url;
                img.className = "wasm-image-thumbnail__img";
                img.title = file.name;

                const removeBtn = document.createElement("button");
                removeBtn.className = "wasm-image-thumbnail__remove";
                removeBtn.textContent = "\u00d7";
                removeBtn.title = "Remove";
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeFile(index);
                };

                thumb.appendChild(img);
                thumb.appendChild(removeBtn);
                grid.appendChild(thumb);
            });

            this.contentContainer.appendChild(grid);
        }
    }

    private renderPlaceholder() {
        const hint = dropZoneHint(hintPlatform());
        this.contentContainer.createDiv({ cls: "wasm-image-drop-zone__icon", text: "\ud83d\udcf7" });
        this.contentContainer.createDiv({ cls: "wasm-image-drop-zone__heading", text: hint.heading });
        if (hint.paste) {
            this.contentContainer.createDiv({ cls: "wasm-image-drop-zone__subtext", text: hint.paste });
        }
        this.contentContainer.createDiv({
            cls: "wasm-image-drop-zone__subtext",
            text: "Supported: JPG, PNG, GIF, BMP, TIFF (multiple files supported)",
        });
    }

    public dispose() {
        this.revokeAllUrls();
    }

    private revokeAllUrls() {
        this.currentObjectUrls.forEach(url => URL.revokeObjectURL(url));
        this.currentObjectUrls = [];
    }

    public async handleClipboardPaste() {
        try {
            // @ts-ignore
            const items = await navigator.clipboard.read();
            for (const it of items) {
                // @ts-ignore
                for (const t of it.types) {
                    if (t.startsWith("image/")) {
                        // @ts-ignore
                        const blob = await it.getType(t);
                        const file = new File([blob], `clipboard-${Date.now()}.${t.split("/")[1]}`, { type: t });
                        this.addFiles([file]);
                        new Notice("\u2705 Clipboard image added");
                        return;
                    }
                }
            }
            new Notice("\u274c No image found in clipboard");
        } catch (err) {
            console.log("Clipboard read failed:", err);
            new Notice("\u274c Failed to read clipboard. Try using drag & drop instead.");
        }
    }

    public triggerFileInput() {
        this.fileInput.click();
    }

    /** Show preview for a single file (used by initial file from context menu) */
    public showPreview(file: File) {
        this.selectedFiles = [file];
        this.renderContent();
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    public getSelectedFiles(): File[] {
        return this.selectedFiles;
    }
}
