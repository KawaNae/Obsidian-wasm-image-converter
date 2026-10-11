import { describe, it, expect, vi, afterEach } from 'vitest';
import { decode, DecodeError, describeUndecodable, formatUndecodable } from './decode';

describe('describeUndecodable', () => {
    it('tells the name, size, type and the bytes read of a file', async () => {
        const file = new File([new Uint8Array(12)], 'broken.png', { type: 'image/png' });
        expect(await describeUndecodable(file)).toEqual({ name: 'broken.png', size: 12, type: 'image/png', bytesRead: 12 });
    });

    it('tells that a blob could not be read', async () => {
        const blob = new Blob([new Uint8Array(5)], { type: 'image/png' });
        blob.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
        const description = await describeUndecodable(blob);
        expect(description.name).toBeUndefined();
        expect(description.bytesRead).toBeNull();
        expect(description.readError).toContain('NotReadableError');
    });
});

describe('formatUndecodable', () => {
    it('writes the bytes read', () => {
        expect(formatUndecodable({ name: 'a.png', size: 1024, type: 'image/png', bytesRead: 0 }))
            .toBe('"a.png" (image/png, 1024 bytes, 0 bytes read)');
    });

    it('writes why the source was not readable', () => {
        expect(formatUndecodable({ size: 3, type: '', bytesRead: null, readError: 'NotReadableError: gone' }))
            .toBe('a blob (no type, 3 bytes, not readable (NotReadableError: gone))');
    });
});

describe('decode', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws a DecodeError describing the source when both decoders fail', async () => {
        vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('bitmap failed')));
        vi.stubGlobal('Image', class { src = ''; decode() { return Promise.reject(new Error('img failed')); } });
        vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

        const file = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' });
        const error = await decode(file).catch(e => e);
        expect(error).toBeInstanceOf(DecodeError);
        expect(error.source).toEqual({ name: 'x.png', size: 4, type: 'image/png', bytesRead: 4 });
        expect(error.message).toBe(
            'Could not decode "x.png" (image/png, 4 bytes, 4 bytes read): createImageBitmap: Error: bitmap failed; <img>: Error: img failed'
        );
    });
});
