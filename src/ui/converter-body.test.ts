import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The components and the save layer reach Obsidian's API beyond the stand-in
vi.mock('./components/drop-zone', () => ({ DropZone: class {} }));
vi.mock('./components/settings-panel', () => ({ SettingsPanel: class {} }));
vi.mock('./components/save-fields', () => ({ SaveFields: class {} }));
vi.mock('../save/save', () => ({}));

const decoded = vi.hoisted(() => ({ list: [] as { closed: boolean }[] }));
vi.mock('../conversion/decode', () => ({
    decode: vi.fn(async () => {
        const image = {
            closed: false,
            source: {},
            width: 120,
            height: 56,
            close() { image.closed = true; },
        };
        decoded.list.push(image);
        return image;
    }),
}));

const samples = vi.hoisted(() => ({ closedAtCall: [] as boolean[] }));
vi.mock('../conversion/predict', () => ({
    analyze: () => ({ width: 120, height: 56, complexity: 0 }),
    estimateByHeuristic: () => ({ predictedSize: 1000 }),
    estimateBySample: vi.fn(async (image: { closed: boolean }) => {
        samples.closedAtCall.push(image.closed);
        return { predictedSize: 900 };
    }),
}));

import { ConverterBody } from './converter-body';

/** The private members the tests drive, without the DOM build() makes. */
interface BodyInternals {
    selectedFiles: File[];
    converting: boolean;
    settingsPanel: { getEncode(): unknown };
    infoDiv: unknown;
    updateExample(): void;
    renderPredictionLine(): void;
    updatePrediction(): Promise<void>;
    releaseDecodeSource(): void;
    dispose(): void;
}

let frames: FrameRequestCallback[] = [];

/** Lets the pending promise callbacks run. */
async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Runs the frame the prediction waits for, and the task after it. */
async function runFrame() {
    const pending = frames;
    frames = [];
    pending.forEach(cb => cb(0));
    await new Promise(r => setTimeout(r, 0));
    await flush();
}

function makeBody(): BodyInternals {
    const settings = { enableSampledPrediction: true, presets: [], defaultPresetId: '' };
    const body = new ConverterBody(
        {} as never,
        settings as never,
        { sourcePath: '' },
        { close: () => {} },
        () => {}
    ) as unknown as BodyInternals;
    body.selectedFiles = [new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })];
    body.settingsPanel = { getEncode: () => ({}) };
    body.infoDiv = {};
    body.updateExample = () => {};
    body.renderPredictionLine = () => {};
    return body;
}

describe('ConverterBody prediction after closing', () => {
    beforeEach(() => {
        decoded.list = [];
        samples.closedAtCall = [];
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('encodes the sample while the dialog is open', async () => {
        const body = makeBody();
        const done = body.updatePrediction();
        await flush();
        await runFrame();
        await done;
        expect(samples.closedAtCall).toEqual([false]);
    });

    it('does not encode the sample after the dialog closed and closed the decode', async () => {
        const body = makeBody();
        const done = body.updatePrediction();
        await flush();
        expect(frames).toHaveLength(1);

        body.dispose();
        await flush();
        expect(decoded.list[0].closed).toBe(true);

        await runFrame();
        await done;
        expect(samples.closedAtCall).toEqual([]);
    });

    it('does not encode the sample when the dialog closed during a conversion', async () => {
        const body = makeBody();
        const done = body.updatePrediction();
        await flush();

        body.converting = true;
        body.dispose();
        await flush();
        // The conversion still holds the decode, and releases it when it ends
        expect(decoded.list[0].closed).toBe(false);
        body.releaseDecodeSource();
        await flush();

        await runFrame();
        await done;
        expect(samples.closedAtCall).toEqual([]);
    });

    it('decodes nothing for a change after closing', async () => {
        const body = makeBody();
        body.dispose();
        await body.updatePrediction();
        expect(decoded.list).toHaveLength(0);
    });
});
