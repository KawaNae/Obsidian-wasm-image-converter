import { describe, it, expect } from 'vitest';
import { inLayerAbove } from './layer-order';

/**
 * `inLayerAbove` reads the layers of a body in the order they were put
 * there. The nodes are stand-ins that hold only their parent and their next
 * sibling, which is all it reads.
 */

interface FakeNode { name: string; parentNode: FakeNode | null; nextSibling: FakeNode | null }

function node(name: string, parent: FakeNode | null = null): FakeNode {
    return { name, parentNode: parent, nextSibling: null };
}

/** A body holding `names` in that order, each with a child. */
function body(...names: string[]) {
    const root = node('body');
    const layers = names.map(name => node(name, root));
    layers.forEach((layer, i) => { layer.nextSibling = layers[i + 1] ?? null; });
    const inner = Object.fromEntries(layers.map(layer => [layer.name, node(`${layer.name} child`, layer)]));
    const at = (name: string) => layers.find(layer => layer.name === name)!;
    return { root, at, inner };
}

const above = (layer: FakeNode, n: FakeNode | null) => inLayerAbove(layer as unknown as Node, n as unknown as Node | null);

describe('inLayerAbove', () => {
    it('holds what is in a layer put after it, however deep', () => {
        const b = body('workspace', 'overlay', 'suggestion');
        const deep = node('item title', b.inner.suggestion);
        expect(above(b.at('overlay'), b.at('suggestion'))).toBe(true);
        expect(above(b.at('overlay'), deep)).toBe(true);
    });

    it('does not hold the layer itself, what is in it, or a layer before it', () => {
        const b = body('workspace', 'overlay', 'suggestion');
        expect(above(b.at('overlay'), b.at('overlay'))).toBe(false);
        expect(above(b.at('overlay'), b.inner.overlay)).toBe(false);
        expect(above(b.at('overlay'), b.inner.workspace)).toBe(false);
    });

    it('does not hold the body, what is not under it, or nothing', () => {
        const b = body('overlay', 'suggestion');
        expect(above(b.at('overlay'), b.root)).toBe(false);
        expect(above(b.at('overlay'), node('elsewhere'))).toBe(false);
        expect(above(b.at('overlay'), null)).toBe(false);
    });

    it('holds nothing for a layer no longer on the body', () => {
        const gone = node('overlay');
        expect(above(gone, node('any'))).toBe(false);
    });
});
