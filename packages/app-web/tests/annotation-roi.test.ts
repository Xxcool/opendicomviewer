import { describe, expect, it } from 'vitest';
import type { MeasurementRecord, PixelFrame, SeriesMeta } from '@opendicomviewer/core';
import { annotationLabel, roiStats } from '../src/annotations/annotation-roi';
import { restoreAnnotationRecords, restoreWithPixels } from '../src/annotations/annotation-restore';
const plane = { imageId: 'image', sopInstanceUid: 'sop', rows: 3, columns: 3, imagePositionPatient: [0, 0, 0] as [number, number, number], imageOrientationPatient: [1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number], pixelSpacing: [2, 0.5] as [number, number] };
const meta: SeriesMeta = { studyInstanceUid: 'study', seriesInstanceUid: 'series', modality: 'MR', seriesDescription: '', numberOfFrames: 1, spacing: [2, 0.5, 1], warnings: [], planes: [plane] };
const frame: PixelFrame = { width: 3, height: 3, pixelData: new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), rescaleSlope: 2, rescaleIntercept: -4 };
const record: MeasurementRecord = { id: 'roi', sessionId: 'old', seriesInstanceUid: 'series', sopInstanceUid: 'sop', frameIndex: 0, coordinateSpace: 'image-pixel', type: 'rectangleRoi', points: [[0, 0, 0], [2, 2, 0]], stats: {}, createdAt: 1 };
describe('ROI工具与备份原图数值链', () => {
  it('矩形统计基于原始像素变换与可信间距，不将MR灰度标为HU', () => {
    const stats = roiStats(record, frame, plane);
    expect(stats).toMatchObject({ count: 9, mean: 4, min: -4, max: 12, areaMm2: 4 });
    expect(annotationLabel({ ...record, stats })).toContain('均值 4.00');
    expect(annotationLabel({ ...record, stats })).not.toContain('HU');
  });
  it('椭圆使用形状内像素中心，未标定时省略面积但保留灰度', () => {
    expect(roiStats({ ...record, type: 'ellipseRoi' }, frame, plane)).toMatchObject({ count: 5, mean: 4, areaMm2: Math.PI });
    const stats = roiStats(record, frame, { ...plane, hasMissingPixelSpacing: true });
    expect(stats.areaMm2).toBeUndefined();
    expect(annotationLabel({ ...record, stats })).toContain('面积未标定');
  });
  it('拒绝退化、出界与源图尺寸不一致，不产生有效记录', () => {
    expect(() => roiStats({ ...record, points: [[1, 1, 0], [1, 2, 0]] }, frame, plane)).toThrow();
    expect(() => roiStats({ ...record, points: [[-1, 0, 0], [2, 2, 0]] }, frame, plane)).toThrow();
    expect(() => roiStats(record, { ...frame, width: 4 }, plane)).toThrow('尺寸');
  });
  it('备份恢复重读原图，拒绝篡改统计并总是释放句柄', async () => {
    let disposed = 0, reads = 0;
    const source = { openSeries: async () => ({ meta, warnings: [], pixel: async () => { reads++; return frame; }, dispose: () => { disposed++; } }) };
    const valid = { ...record, stats: roiStats(record, frame, plane) };
    const restored = await restoreWithPixels([valid], [meta], 'new', source);
    expect(restored).toEqual([{ ...valid, sessionId: 'new' }]);
    await expect(restoreWithPixels([{ ...valid, stats: { ...valid.stats, mean: 99 } }], [meta], 'new', source)).rejects.toThrow('不一致');
    expect(reads).toBe(2); expect(disposed).toBe(2);
    expect(() => restoreAnnotationRecords([valid], [meta], 'new')).toThrow('原始像素');
  });
});
