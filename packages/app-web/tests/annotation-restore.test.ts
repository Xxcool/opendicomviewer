import { describe, expect, it } from 'vitest';
import type { SeriesMeta } from '@opendicomviewer/core';
import { backupSeriesUids, parseAnnotationBackup, restoreAnnotationRecords } from '../src/annotations/annotation-restore';
const source: SeriesMeta = { studyInstanceUid: 'study', seriesInstanceUid: 'series', modality: 'MR', seriesDescription: '', numberOfFrames: 1, spacing: [2, 0.5, 1], warnings: [],
  planes: [{ imageId: 'image', sopInstanceUid: 'sop', frameIndex: 1, rows: 100, columns: 80,
    imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [2, 0.5] }] };
const record = { id: 'id', sessionId: 'old', seriesInstanceUid: 'series', sopInstanceUid: 'sop', frameIndex: 1,
  coordinateSpace: 'image-pixel', type: 'length', points: [[0, 0, 0], [6, 2, 0]], stats: { lengthMm: 5 }, createdAt: 1, text: '中文备注' };
const backup = (records: unknown[] = [record]) => JSON.stringify({ format: 'opendicomviewer-annotations', version: 1, records });
const restore = (records: readonly unknown[] = [record], sources = [source]) => restoreAnnotationRecords(records, sources, 'new-session');
describe('标注JSON恢复边界', () => {
  it('版本1保留ID/中文/源帧并换成当前会话，物理数值按源图重算', () => {
    const parsed = parseAnnotationBackup(backup());
    expect(backupSeriesUids(parsed)).toEqual(['series']);
    expect(restore(parsed)).toEqual([{ ...record, sessionId: 'new-session' }]);
  });
  it('不支持版本/格式、未知字段、数量与非法JSON均拒绝', () => {
    for (const text of ['{', '{}', backup().replace('"version":1', '"version":2'), backup().replace('"version":1', '"extra":1,"version":1'), backup(Array.from({ length: 10001 }, () => record))]) {
      expect(() => parseAnnotationBackup(text)).toThrow();
    }
    expect(() => parseAnnotationBackup(' '.repeat(10 * 1024 * 1024 + 1))).toThrow('10 MiB');
  });
  it('不把同SOP其他帧、其他序列或重复引用当作源图', () => {
    expect(() => restore([{ ...record, frameIndex: 0 }])).toThrow('找不到');
    expect(() => restore([{ ...record, seriesInstanceUid: 'other' }])).toThrow('找不到');
    expect(() => restore([record], [source, source])).toThrow('唯一');
    expect(() => restore([record], [])).toThrow('找不到');
  });
  it('错误坐标、单位、点数、工具、统计和重复ID不进入会话', () => {
    for (const value of [{ ...record, coordinateSpace: 'patient' }, { ...record, points: [[0, 0, 0], [80, 0, 0]] },
      { ...record, points: [[0, 0, 0]] }, { ...record, points: [[0, 0, 1], [6, 2, 0]] },
      { ...record, type: 'angle' }, { ...record, stats: { lengthMm: 99 } }, { ...record, stats: { lengthMm: 5, meanHU: 1 } },
      { ...record, text: 'x'.repeat(8193) }, { ...record, frameIndex: -1 }, { ...record, points: [[NaN, 0, 0], [6, 2, 0]] }]) expect(() => restore([value])).toThrow();
    expect(() => restore([record, record])).toThrow('重复');
    expect(() => restore([record], [{ ...source, planes: source.planes.map(plane => ({ ...plane, hasMissingPixelSpacing: true })) }])).toThrow('标定');
  });
  it('箭头与文字不要求毫米标定，不接受隐藏的统计结果', () => {
    const records = [{ ...record, type: 'arrow', stats: {} }, { ...record, id: 'text', type: 'text', points: [[1, 2, 0]], stats: {} }];
    expect(restore(records)).toHaveLength(2);
    expect(() => restore([{ ...records[0], stats: { lengthMm: 5 } }])).toThrow('字段');
  });
});

it('恢复元数据使用独立临时句柄，释放不清除当前活动序列像素缓存', async () => {
  const { LocalDataSource } = await import('@opendicomviewer/source-local');
  const { PixelCodec } = await import('@opendicomviewer/codec-wasm');
  const { buildDicomBuffer } = await import('../../adapters/source-local/testing/dicom-fixture');
  const { loadBackupSources } = await import('../src/annotations/annotation-restore');
  const bytes = buildDicomBuffer({ modality: 'CT', pixelData: new Uint8Array(8), rows: 2, columns: 2 });
  let reads = 0;
  const dataSource = new LocalDataSource(new PixelCodec());
  await dataSource.probe({ files: [{ id: 'source', name: 'source.dcm', size: bytes.length, read: async (start = 0, end = bytes.length) => {
    reads++; return Uint8Array.from(bytes.subarray(start, end)).buffer;
  } }] });
  const active = await dataSource.openSeries((await dataSource.listSeries())[0]!);
  try {
    const frame = await active.pixel(0); const before = reads;
    const sources = await loadBackupSources([{ ...record, seriesInstanceUid: active.meta.seriesInstanceUid }], dataSource);
    expect(sources[0]?.seriesInstanceUid).toBe(active.meta.seriesInstanceUid);
    expect(reads).toBe(before);
    expect(await active.pixel(0)).toBe(frame);
    expect(reads).toBe(before);
  } finally { active.dispose(); }
});
