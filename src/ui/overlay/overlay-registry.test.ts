import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerOverlay,
    unregisterOverlay,
    closeAllOverlays,
    openOverlayCount,
    overlayFor,
    type ClosableOverlay,
} from './overlay-registry';

/**
 * Stand-in for OverlayShell: the registry only ever calls `close()`, so a
 * plain object is the whole contract.
 */
function fakeOverlay(closed: string[], name: string, onClose?: () => void): ClosableOverlay {
    return {
        close() {
            closed.push(name);
            onClose?.();
        },
    };
}

describe('OverlayRegistry', () => {
    beforeEach(() => {
        closeAllOverlays();
    });

    it('closes every registered overlay and empties the registry', () => {
        const closed: string[] = [];
        registerOverlay(fakeOverlay(closed, 'a'));
        registerOverlay(fakeOverlay(closed, 'b'));
        expect(openOverlayCount()).toBe(2);

        closeAllOverlays();

        expect(closed).toEqual(['a', 'b']);
        expect(openOverlayCount()).toBe(0);
    });

    it('does not close an overlay that unregistered itself', () => {
        const closed: string[] = [];
        const gone = fakeOverlay(closed, 'gone');
        registerOverlay(gone);
        registerOverlay(fakeOverlay(closed, 'kept'));

        unregisterOverlay(gone);
        closeAllOverlays();

        expect(closed).toEqual(['kept']);
    });

    it('walks every overlay even when close() unregisters during the walk', () => {
        // OverlayShell.close() calls unregisterOverlay(this), so this is the
        // normal path — mutating the set mid-iteration must not cut it short.
        const closed: string[] = [];
        const overlays: ClosableOverlay[] = [];
        for (const name of ['a', 'b', 'c']) {
            const overlay: ClosableOverlay = fakeOverlay(closed, name, () => unregisterOverlay(overlay));
            overlays.push(overlay);
            registerOverlay(overlay);
        }

        closeAllOverlays();

        expect(closed).toEqual(['a', 'b', 'c']);
        expect(openOverlayCount()).toBe(0);
    });

    it('closes the remaining overlays when one throws', () => {
        const closed: string[] = [];
        registerOverlay({ close() { closed.push('boom'); throw new Error('teardown failed'); } });
        registerOverlay(fakeOverlay(closed, 'after'));

        expect(() => closeAllOverlays()).not.toThrow();

        expect(closed).toEqual(['boom', 'after']);
        expect(openOverlayCount()).toBe(0);
    });

    it('closes an overlay once even if it is registered twice', () => {
        const closed: string[] = [];
        const overlay = fakeOverlay(closed, 'a');
        registerOverlay(overlay);
        registerOverlay(overlay);

        closeAllOverlays();

        expect(closed).toEqual(['a']);
    });

    it('finds an overlay by its key until it unregisters', () => {
        const closed: string[] = [];
        const dialog = fakeOverlay(closed, 'dialog');
        registerOverlay(dialog, 'converter');
        registerOverlay(fakeOverlay(closed, 'other'));

        expect(overlayFor('converter')).toBe(dialog);
        expect(overlayFor('batch')).toBeUndefined();

        unregisterOverlay(dialog);
        expect(overlayFor('converter')).toBeUndefined();
    });

    it('forgets the keys when it closes every overlay', () => {
        registerOverlay(fakeOverlay([], 'dialog'), 'converter');

        closeAllOverlays();

        expect(overlayFor('converter')).toBeUndefined();
    });
});
