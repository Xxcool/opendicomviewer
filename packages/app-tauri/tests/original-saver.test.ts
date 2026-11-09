import { describe, expect, it, vi } from 'vitest';
import { createOriginalSaver } from '../src/original-saver';
import { nativeCandidate } from '../src/candidate';
import { extractZipEntries } from '../../adapters/source-local/src/zip';
import type { ImportCandidate } from '@opendicomviewer/core';

const file = (id: string, bytes: number[]): ImportCandidate => ({ id, name: id, size: bytes.length,
  read: vi.fn(async () => new Uint8Array(bytes).buffer),
});

describe('desktop original source export', () => {
  it('uses the native copy only for actual native candidates, not matching ID strings', async () => {
    const copy = vi.fn(async () => 'saved' as const);
    const save = vi.fn<(blob: Blob) => Promise<'saved'>>(async () => 'saved');
    const native = nativeCandidate({ id: 'desktop-1/disc/file', name: 'file', size: 4, path: '/selected/file' }, 'asset://file');
    expect(await createOriginalSaver(copy, save)([native])).toBe('saved');
    expect(copy).toHaveBeenCalledWith([{ id: native.id, size: 4 }]);
    expect(save).not.toHaveBeenCalled();
    copy.mockClear();
    const entry = file('desktop-1/disc.zip!file', [1, 2, 3, 4]);
    expect(await createOriginalSaver(copy, save)([entry])).toBe('saved');
    expect(copy).not.toHaveBeenCalled();
    expect(new Uint8Array(await save.mock.calls[0]![0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
  it('packages ZIP entries and samples with identical complete bytes, and propagates picker cancellation', async () => {
    const copy = vi.fn(async () => 'saved' as const);
    let output: Blob | undefined;
    const save = async (blob: Blob) => { output = blob; return 'cancelled' as const; };
    expect(await createOriginalSaver(copy, save)([file('sample-one', [5, 6]), file('archive!two', [7, 8, 9])])).toBe('cancelled');
    expect(copy).not.toHaveBeenCalled();
    expect(output?.type).toBe('application/zip');
    const entries = await extractZipEntries(await output!.arrayBuffer());
    expect(new Uint8Array(await entries[0]!.read())).toEqual(new Uint8Array([5, 6]));
    expect(new Uint8Array(await entries[1]!.read())).toEqual(new Uint8Array([7, 8, 9]));
  });
  it('rejects oversize input before reading and never saves truncated or aborted bytes', async () => {
    const copy = vi.fn(async () => 'saved' as const), save = vi.fn(async () => 'saved' as const);
    const large = { ...file('large', []), size: 512 * 1024 * 1024 + 1 };
    await expect(createOriginalSaver(copy, save)([large])).rejects.toThrow('512 MiB');
    expect(large.read).not.toHaveBeenCalled();
    await expect(createOriginalSaver(copy, save)([{ ...file('truncated', [1]), size: 3 }])).rejects.toThrow('读取不完整');
    const abort = new AbortController(); abort.abort();
    expect(await createOriginalSaver(copy, save)([file('aborted', [1])], abort.signal)).toBe('cancelled');
    expect(save).not.toHaveBeenCalled(); expect(copy).not.toHaveBeenCalled();
  });
});
