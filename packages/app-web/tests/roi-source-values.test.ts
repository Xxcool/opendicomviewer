import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '@opendicomviewer/source-local';
import { measureImageRegion } from '@opendicomviewer/core';
import { buildDicomBuffer, encodeElement, stringToBytes, type DicomFixtureOptions } from '../../adapters/source-local/testing/dicom-fixture';

function words(values: number[]) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value & 65535, true));
  return bytes;
}
function lutSequence(values: number[], first = 0, bits = 16, descriptorVR = 'US', packed = false) {
  const content = new Uint8Array([
    ...encodeElement(0x28, 0x3002, descriptorVR, words([values.length, first, bits])),
    ...encodeElement(0x28, 0x3004, 'LO', stringToBytes('US')),
    ...encodeElement(0x28, 0x3006, 'OW', packed ? new Uint8Array(values) : words(values)),
  ]);
  const item = new Uint8Array(content.length + 8);
  const view = new DataView(item.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint16(2, 0xe000, true); view.setUint32(4, content.length, true);
  item.set(content, 8);
  return { tag: [0x28, 0x3000] as [number, number], vr: 'SQ', value: item };
}
async function open(options: DicomFixtureOptions) {
  const bytes = buildDicomBuffer({ rows: 2, columns: 2, ...options });
  const source = new LocalDataSource();
  await source.probe({ files: [{ id: 'fixture', name: 'fixture', size: bytes.length,
    read: async (start = 0, end = bytes.length) => Uint8Array.from(bytes.subarray(start, end)).buffer }] });
  const series = (await source.listSeries())[0];
  if (!series) throw new Error(source.importOutcome().failures.map(failure => failure.reason).join('; '));
  return source.openSeries(series);
}
const region = { shape: 'rectangle', start: [0, 0], end: [1, 1] } as const;

describe('实际 DICOM 字节→源帧→ROI 数值', () => {
  it('signed12 按实际有效位符号扩展，忽略任意未使用高位', async () => {
    const handle = await open({ bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 1,
      pixelData: words([0x0c00, 0xfc00, 0xac00, 0x5c00]) });
    try {
      const frame = await handle.pixel(0);
      expect(Array.from(frame.pixelData)).toEqual([-1024, -1024, -1024, -1024]);
      const result = measureImageRegion(frame, region);
      expect(result.ok && result.stats.mean).toBe(-1024);
    } finally { handle.dispose(); }
  });
  it.each([
    { signed: 1, stored: 16, input: [0xffff, 0x8000, 0, 0x7fff], output: [-1, -32768, 0, 32767] },
    { signed: 0, stored: 16, input: [0xffff, 0x8000, 0, 0x7fff], output: [65535, 32768, 0, 32767] },
    { signed: 0, stored: 12, input: [0xffff, 0xa800, 0x1000, 0x07ff], output: [4095, 2048, 0, 2047] },
  ])('保留正常16位或无符号有效位 $signed/$stored', async ({ signed, stored, input, output }) => {
    const handle = await open({ bitsAllocated: 16, bitsStored: stored, pixelRepresentation: signed, pixelData: words(input) });
    try { expect(Array.from((await handle.pixel(0)).pixelData)).toEqual(output); } finally { handle.dispose(); }
  });
  it('8位有符号有效位不会被当成无符号字节', async () => {
    const handle = await open({ bitsAllocated: 8, bitsStored: 8, pixelRepresentation: 1,
      pixelData: new Uint8Array([0x80, 0xff, 0, 0x7f]) });
    try { expect(Array.from((await handle.pixel(0)).pixelData)).toEqual([-128, -1, 0, 127]); } finally { handle.dispose(); }
  });
  it('HighBit 对齐的旧文件和多帧均按实际位域读取', async () => {
    const handle = await open({ bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 1,
      pixelData: words([0xc00f, 0xc00e, 0xc00d, 0xc00c, 0x001f, 0x001e, 0x001d, 0x001c]),
      extraElements: [{ tag: [0x28, 0x0102], vr: 'US', value: 15 }, { tag: [0x28, 8], vr: 'IS', value: '2' }] });
    try {
      expect(handle.meta.planes).toHaveLength(2);
      expect(Array.from((await handle.pixel(0)).pixelData)).toEqual([-1024, -1024, -1024, -1024]);
      expect(Array.from((await handle.pixel(1)).pixelData)).toEqual([1, 1, 1, 1]);
    } finally { handle.dispose(); }
  });
  it('标准3000序列与US Descriptor实际进入原始帧及ROI', async () => {
    const handle = await open({ modality: 'OT', sopClassUid: '1.2.840.10008.5.1.4.1.1.7',
      pixelData: words([0, 1, 2, 2]), extraElements: [lutSequence([10, 20, 30])] });
    try {
      expect(handle.meta.planes[0]?.modalityLUT?.bitsStored).toBe(16);
      const frame = await handle.pixel(0);
      expect(Array.from(frame.modalityLUT?.lutData ?? [])).toEqual([10, 20, 30]);
      const result = measureImageRegion(frame, region);
      expect(result.ok && result.stats).toMatchObject({ mean: 22.5, min: 10, max: 30 });
    } finally { handle.dispose(); }
  });
  it('SS Descriptor仅第二值有符号，8位LUT紧排和16位填充均支持', async () => {
    for (const packed of [true, false]) {
      const handle = await open({ pixelRepresentation: 1, bitsStored: 12,
        pixelData: words([0xfff, 0, 1, 1]), extraElements: [lutSequence([10, 20, 30], -1, 8, 'SS', packed)] });
      try {
        const frame = await handle.pixel(0);
        expect(frame.modalityLUT?.firstMappedPixelValue).toBe(-1);
        const result = measureImageRegion(frame, region);
        expect(result.ok && result.stats).toMatchObject({ mean: 22.5, min: 10, max: 30 });
      } finally { handle.dispose(); }
    }
  });
  it('非法HighBit和LUT长度明确拒绝，不作为无LUT静默读取', async () => {
    await expect(open({ bitsStored: 12, pixelData: words([0, 0, 0, 0]),
      extraElements: [{ tag: [0x28, 0x0102], vr: 'US', value: 10 }] })).rejects.toThrow('HighBit');
    const badLut = lutSequence([10, 20, 30]);
    // 明确长度Item内Descriptor条目数由3改4，实际LUT数据不改。
    badLut.value[16] = 4;
    await expect(open({ pixelData: words([0, 0, 0, 0]), extraElements: [badLut] })).rejects.toThrow('LUT');
  });
});
