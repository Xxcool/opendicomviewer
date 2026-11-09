import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '../../adapters/source-local/src/source-local';
import { buildDicomBuffer } from '../../adapters/source-local/testing/dicom-fixture';
import { buildZip } from '../../adapters/source-local/testing/zip-fixture';
import { extractZipEntries } from '../../adapters/source-local/src/zip';
import { originalDicomBlob } from '../src/export/original-dicom';
const candidate = (id: string, values: number[]) => ({ id, name: 'private-patient-name', size: values.length, read: async () => new Uint8Array(values).buffer });
describe('original DICOM export', () => {
  it('keeps an opaque complete instance including trailing bytes', async () => {
    const bytes = [0, 255, 1, 2, 3, 0, 123];
    expect([...new Uint8Array(await (await originalDicomBlob([candidate('one', bytes)])).arrayBuffer())]).toEqual(bytes);
  });
  it('round trips complete instances through the existing ZIP importer', async () => {
    const blob = await originalDicomBlob([candidate('one', [7, 8]), candidate('two', [9])]);
    const entries = await extractZipEntries(await blob.arrayBuffer());
    expect(entries.map(item => item.filename)).toEqual(['instance-000001.dcm', 'instance-000002.dcm']);
    expect([...new Uint8Array(await entries[0]!.read())]).toEqual([7, 8]);
    expect([...new Uint8Array(await entries[1]!.read())]).toEqual([9]);
    expect(await blob.text()).not.toContain('private-patient');
  });
  it('exports the complete two-frame DICOM from either frame and deduplicates the source instance', async () => {
    const bytes = buildDicomBuffer({
      studyInstanceUid: '1.2.3.501', seriesInstanceUid: '1.2.3.501.1', sopInstanceUid: '1.2.3.501.1.1',
      rows: 2, columns: 2, bitsAllocated: 8, bitsStored: 8,
      pixelData: new Uint8Array([1, 2, 3, 4, 11, 12, 13, 14]),
      extraElements: [{ tag: [0x0028, 0x0008], vr: 'IS', value: '2' }],
    });
    const file = rangedCandidate('two-frame.dcm', bytes);
    const source = new LocalDataSource(); await source.probe({ files: [file] });
    const handle = await source.openSeries({ studyInstanceUid: '1.2.3.501', seriesInstanceUid: '1.2.3.501.1' });
    expect(handle.meta.numberOfFrames).toBe(2);
    expect(handle.originalCandidates!()).toEqual([file]);
    for (const frame of [0, 1]) {
      expect(handle.originalCandidates!(frame)).toEqual([file]);
      const output = await originalDicomBlob(handle.originalCandidates!(frame));
      expect(new Uint8Array(await output.arrayBuffer())).toEqual(bytes);
    }
  });
  it('preserves both real ZIP-imported DICOM instances through original-source export and reimport', async () => {
    const buffers = [0, 1].map(index => buildDicomBuffer({
      studyInstanceUid: '1.2.3.502', seriesInstanceUid: '1.2.3.502.1', sopInstanceUid: `1.2.3.502.1.${index + 1}`,
      imagePositionPatient: [0, 0, index], rows: 2, columns: 2, bitsAllocated: 8, bitsStored: 8,
      pixelData: new Uint8Array([index, 2, 3, 4]),
    }));
    const archive = buildZip(buffers.map((data, index) => ({ nameBytes: new TextEncoder().encode(`private-${index}.dcm`), data, utf8FilenameFlag: true })));
    const source = new LocalDataSource(); await source.probe({ files: [rangedCandidate('disc.zip', archive)] });
    const ref = { studyInstanceUid: '1.2.3.502', seriesInstanceUid: '1.2.3.502.1' };
    const handle = await source.openSeries(ref);
    const originals = handle.originalCandidates!(); expect(originals).toHaveLength(2);
    const output = await originalDicomBlob(originals);
    const entries = await extractZipEntries(await output.arrayBuffer());
    for (const [index, entry] of entries.entries()) expect(new Uint8Array(await entry.read())).toEqual(buffers[index]);
    const reimport = new LocalDataSource();
    await reimport.probe({ files: [rangedCandidate('export.zip', new Uint8Array(await output.arrayBuffer()))] });
    expect((await reimport.openSeries(ref)).meta.numberOfFrames).toBe(2);
  });
  it('writes the standard CRC32 vector and rejects ZIP32 overflow before reading', async () => {
    const bytes = [...new TextEncoder().encode('123456789')];
    const blob = await originalDicomBlob([candidate('crc', bytes), candidate('second', [0])]);
    expect(new DataView(await blob.arrayBuffer()).getUint32(14, true)).toBe(0xcbf43926);
    await expect(originalDicomBlob([{ ...candidate('large', []), size: 0x100000000 }, candidate('second', [])])).rejects.toThrow('ZIP32');
  });
  it('processes cancellation queued after an immediate cached read', async () => {
    const controller = new AbortController();
    const file = { ...candidate('cached', [1]), read: async () => {
      setTimeout(() => controller.abort(), 0);
      return new Uint8Array([1]).buffer;
    } };
    await expect(originalDicomBlob([file], controller.signal)).rejects.toThrow('取消');
  });
  it('rejects incomplete reads and cancellation', async () => {
    await expect(originalDicomBlob([{ ...candidate('one', [1]), size: 2 }])).rejects.toThrow('读取不完整');
    const controller = new AbortController(); controller.abort();
    await expect(originalDicomBlob([candidate('one', [1])], controller.signal)).rejects.toThrow('取消');
  });
});

function rangedCandidate(id: string, bytes: Uint8Array) {
  return { id, name: id, size: bytes.byteLength,
    read: async (start = 0, end = bytes.byteLength) => bytes.slice(start, end).buffer,
  };
}
