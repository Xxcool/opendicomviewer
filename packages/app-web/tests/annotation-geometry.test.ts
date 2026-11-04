import { describe, expect, it } from 'vitest';
import type { ImagePlane, MeasurementRecord } from '@opendicomviewer/core';
import { belongsToFrame, calibrated, canvasPoint, segmentDistance, sourcePoint } from '../src/annotations/annotation-geometry';
const plane: ImagePlane = { imageId: 'image#1', sopInstanceUid: 'sop', frameIndex: 1, rows: 100, columns: 80,
  imagePositionPatient: [10, 20, 30], imageOrientationPatient: [0, 1, 0, 0, 0, -1], pixelSpacing: [2, 0.5] };
const projection = {
  canvasToWorld: (_viewportId: string, point: { x: number; y: number }): [number, number, number] => [10, 20 + point.x * 0.5, 30 - point.y * 2],
  worldToCanvas: (_viewportId: string, point: readonly [number, number, number]) => ({ x: (point[1] - 20) / 0.5, y: (30 - point[2]) / 2 }),
};
const record: MeasurementRecord = { id: 'a', sessionId: 'session', coordinateSpace: 'image-pixel', frameIndex: 1,
  seriesInstanceUid: 'series', sopInstanceUid: 'sop', type: 'length', points: [[0, 0, 0], [6, 2, 0]], stats: { lengthMm: 5 }, createdAt: 1 };
describe('标注源图归属与坐标', () => {
  it('同SOP不同文件帧、序列或导入会话不能继承标注', () => {
    expect(belongsToFrame(record, 'session', 'series', plane)).toBe(true);
    expect(belongsToFrame(record, 'new-session', 'series', plane)).toBe(false);
    expect(belongsToFrame(record, 'session', 'another', plane)).toBe(false);
    expect(belongsToFrame(record, 'session', 'series', { ...plane, frameIndex: 0 })).toBe(false);
    expect(belongsToFrame(record, 'session', 'series', { ...plane, sopInstanceUid: 'other' })).toBe(false);
  });
  it('非轴向坐标对应当前显示位置，画布外影像坐标不建草稿', () => {
    expect(sourcePoint(projection, 'vp', plane, 6, 2)).toEqual([6, 2, 0]);
    expect(canvasPoint(projection, 'vp', plane, [6, 2, 0])).toEqual({ x: 6, y: 2 });
    expect(sourcePoint(projection, 'vp', plane, -1, 2)).toBeNull();
    expect(sourcePoint(projection, 'vp', plane, 80, 2)).toBeNull();
  });
  it('显示占位网格不能成为物理测距标定', () => {
    expect(calibrated(plane)).toBe(true);
    expect(calibrated({ ...plane, hasMissingGeometry: true })).toBe(false);
    expect(calibrated({ ...plane, hasMissingPixelSpacing: true })).toBe(false);
    expect(calibrated({ ...plane, isMultiframe2D: true })).toBe(false);
    expect(calibrated({ ...plane, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' })).toBe(false);
  });
  it('命中检测按线段而非无限直线，零长度不产生NaN', () => {
    expect(segmentDistance(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(segmentDistance(15, 0, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(segmentDistance(3, 4, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});
