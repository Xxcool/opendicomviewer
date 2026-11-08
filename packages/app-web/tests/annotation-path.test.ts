import { describe, expect, it } from 'vitest';
import { measureImagePolyline, MeasurementSession, type ImagePlane, type MeasurementRecord, type SeriesMeta } from '@opendicomviewer/core';
import { appendFreehandPoint, freehandPointLimitExceeded, MAX_PATH_POINTS, pathSegments, pathStats } from '../src/annotations/annotation-path';
import { annotationLabel } from '../src/annotations/annotation-roi';
import { restoreAnnotationRecords } from '../src/annotations/annotation-restore';
const plane: ImagePlane = { imageId: 'image', sopInstanceUid: 'sop', rows: 100, columns: 100, pixelSpacing: [2, 3], imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0] };
const source: SeriesMeta = { studyInstanceUid: 'study', seriesInstanceUid: 'series', modality: 'MR', seriesDescription: '', numberOfFrames: 1, spacing: [2, 3, 1], planes: [plane], warnings: [] };
const record: MeasurementRecord = { id: 'path', sessionId: 'old', seriesInstanceUid: 'series', sopInstanceUid: 'sop', frameIndex: 0, coordinateSpace: 'image-pixel', type: 'polyline', points: [[1, 1, 0], [4, 1, 0], [4, 5, 0]], stats: {}, createdAt: 1 };
describe('原图折线与手绘轮廓', () => {
  it('逐段各向异距计算，不以首尾距离或平滑长度代替', () => {
    expect(pathStats(record, plane)).toEqual({ lengthMm: 17 });
    expect(pathStats({ ...record, points: [...record.points].reverse() }, plane)).toEqual({ lengthMm: 17 });
    expect(annotationLabel({ ...record, stats: pathStats(record, plane) })).toBe('折线 · 17.00 mm');
    expect(pathSegments(record)).toEqual([[0, 1], [1, 2]]);
    expect(measureImagePolyline([[0, 0], [1, 1], [2, 1]], { trusted: true, pixelSpacing: [2, 3] })).toEqual({ ok: true, value: Math.sqrt(13) + 3, unit: 'mm' });
  });
  it('不可信标定、非有限坐标、退化及顶点限额不产生伪毫米', () => {
    expect(() => pathStats(record, { ...plane, hasMissingPixelSpacing: true })).toThrow('不可计算');
    expect(measureImagePolyline([[0, 0], [1, 0]], undefined)).toMatchObject({ ok: false });
    expect(measureImagePolyline([[0, 0], [1, 0]], { trusted: true, pixelSpacing: [0, 3] })).toMatchObject({ ok: false });
    const invalidCases: MeasurementRecord['points'][] = [[], [[1, 1, 0]], [[1, 1, 0], [1.1, 1, 0]], [[1, 1, 0], [NaN, 1, 0]], [[1, 1, 0], [100, 1, 0]], Array.from({ length: MAX_PATH_POINTS + 1 }, (_, i) => [i % 20, i % 30, 0])];
    for (const points of invalidCases) {
      expect(() => pathStats({ ...record, points }, plane)).toThrow();
    }
  });
  it('手绘独立顶点隐式闭合，无标定仍可备注且不附带统计', () => {
    const contour = { ...record, type: 'freehand' as const };
    expect(pathSegments(contour)).toEqual([[0, 1], [1, 2], [2, 0]]);
    expect(pathStats(contour, { ...plane, hasMissingPixelSpacing: true })).toEqual({});
    expect(annotationLabel(contour)).toBe('手绘轮廓');
    expect(() => pathStats({ ...contour, points: [[1, 1, 0], [3, 1, 0], [5, 1, 0]] }, plane)).toThrow('跨度');
    expect(() => pathStats({ ...contour, points: [...record.points, record.points[0]!] }, plane)).toThrow('跨度');
    expect(appendFreehandPoint([[1, 1, 0]], [1.3, 1.2, 0])).toEqual([[1, 1, 0]]);
    const full = Array.from({ length: MAX_PATH_POINTS }, (_, i) => [i, 0, 0] as [number, number, number]);
    expect(appendFreehandPoint(full, [3000, 0, 0])).toBe(full);
    expect(freehandPointLimitExceeded(full, [3000, 0, 0])).toBe(true);
    expect(freehandPointLimitExceeded(full, [2047.1, 0, 0])).toBe(false);
  });
  it('JSON严格匹配源帧并重算折线，拒绝篡改/未知统计与边界', () => {
    const saved = { ...record, stats: pathStats(record, plane) };
    expect(restoreAnnotationRecords([saved], [source], 'new')).toEqual([{ ...saved, sessionId: 'new' }]);
    for (const changed of [{ ...saved, stats: { lengthMm: 9 } }, { ...saved, sopInstanceUid: 'other' }, { ...saved, frameIndex: 1 }, { ...saved, points: [[1, 1, 0], [100, 1, 0]] }]) expect(() => restoreAnnotationRecords([changed], [source], 'new')).toThrow();
    const contour = { ...record, type: 'freehand' as const };
    expect(restoreAnnotationRecords([contour], [source], 'new')[0]?.stats).toEqual({});
    expect(() => restoreAnnotationRecords([{ ...contour, stats: { areaMm2: 12 } }], [source], 'new')).toThrow('字段');
  });
  it('路径控制点编辑和整图移动都进入可撤销领域历史', () => {
    const session = new MeasurementSession(() => {}); session.add({ ...record, stats: pathStats(record, plane) });
    const points: MeasurementRecord['points'] = [[1, 1, 0], [6, 1, 0], [4, 5, 0]];
    const edited = { ...record, points, stats: pathStats({ ...record, points }, plane) }; session.update(edited);
    expect(session.list()[0]?.stats.lengthMm).toBeCloseTo(15 + 10);
    session.undo(); expect(session.list()[0]?.stats.lengthMm).toBe(17);
    session.redo(); expect(session.list()[0]).toEqual(edited);
    const translatedPoints: MeasurementRecord['points'] = points.map(point => [point[0] + 10, point[1] + 7, 0]);
    const translated = { ...edited, points: translatedPoints, stats: pathStats({ ...edited, points: translatedPoints }, plane) };
    session.update(translated); expect(translated.stats).toEqual(edited.stats); session.undo(); expect(session.list()[0]).toEqual(edited);
    session.remove(record.id); expect(session.list()).toHaveLength(0); session.undo(); expect(session.list()[0]).toEqual(edited);
  });
});
