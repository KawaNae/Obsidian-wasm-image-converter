// The overlays open now. Pure module: must not import "obsidian".

/**
 * OverlayShell puts its DOM on the document's body, outside every container
 * Obsidian tears down for a plugin, so an overlay left open would outlive
 * the plugin's unload, wired to the old instance. The registry gives
 * onunload one place to close them all. A plugin reload evaluates the
 * module anew, so an old instance only ever sees its own overlays.
 * Ported from obsidian-task-viewer's OverlayRegistry.
 *
 * An overlay registered with a key is the one open overlay of that key: a
 * dialog that must not open twice looks itself up before opening.
 */

export interface ClosableOverlay {
    close(): void;
}

const openOverlays = new Set<ClosableOverlay>();
const keyedOverlays = new Map<string, ClosableOverlay>();

/** Adds `overlay`; with `key`, it becomes the open overlay of that key. */
export function registerOverlay(overlay: ClosableOverlay, key?: string): void {
    openOverlays.add(overlay);
    if (key !== undefined) keyedOverlays.set(key, overlay);
}

export function unregisterOverlay(overlay: ClosableOverlay): void {
    openOverlays.delete(overlay);
    for (const [key, keyed] of keyedOverlays) {
        if (keyed === overlay) keyedOverlays.delete(key);
    }
}

/** The open overlay registered with `key`, if any. */
export function overlayFor(key: string): ClosableOverlay | undefined {
    return keyedOverlays.get(key);
}

/**
 * Closes every open overlay. Walks a snapshot, so a close() that
 * unregisters itself (the normal path) cannot cut the walk short, and
 * isolates each one, so a thrower cannot leave the rest open.
 */
export function closeAllOverlays(): void {
    const overlays = [...openOverlays];
    openOverlays.clear();
    keyedOverlays.clear();
    for (const overlay of overlays) {
        try {
            overlay.close();
        } catch (error) {
            console.error("Failed to close an overlay:", error);
        }
    }
}

/** Number of open overlays. For tests. */
export function openOverlayCount(): number {
    return openOverlays.size;
}
