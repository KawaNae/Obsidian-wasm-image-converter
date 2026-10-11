// The layers of a window. Pure module: must not import "obsidian".

/**
 * The elements a window's body holds are its layers — the workspace, an
 * overlay of ours, the list an Obsidian suggest shows under an input, a
 * menu — stacked in the order they were put there. A surface opened on top
 * of an overlay while it is open is put after it: the lists and menus
 * Obsidian opens from a field of ours go on the body, not in our panel
 * (AbstractInputSuggest's `.suggestion-container`).
 *
 * So what is on the body after an overlay belongs to it: a press there is
 * no press outside the overlay. What stands before it is outside.
 * Ported from obsidian-task-viewer's LayerOrder.
 */

/**
 * Whether `node` is in a layer put after `layer` (an element the body
 * holds): under an element of the same parent that follows it. Not for
 * `layer` itself, nor for what is in it.
 */
export function inLayerAbove(layer: Node, node: Node | null): boolean {
    const host = layer.parentNode;
    if (!host) return false;
    let at: Node | null = node;
    while (at && at.parentNode !== host) at = at.parentNode;
    if (!at || at === layer) return false;
    for (let next = layer.nextSibling; next; next = next.nextSibling) {
        if (next === at) return true;
    }
    return false;
}
