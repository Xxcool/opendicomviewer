import { describe, expect, it } from 'vitest';
import { measureImageCobbAngle, type ImagePlane, type MeasurementRecord, type SeriesMeta } from '@opendicomviewer/core';
import { angleStats, angleSegments } from '../src/annotations/annotation-angle';
import { annotationLabel } from '../src/annotations/annotation-roi';
import { restoreAnnotationRecords } from '../src/annotations/annotation-restore';
const calibration = { trusted: true, pixelSpacing: [1, Math.sqrt(3)] as const };
const plane: ImagePlane = { imageId: 'image', sopInstanceUid: 'sop', rows: 100, columns: 100, pixelSpacing: [1, Math.sqrt(3)], imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0] };
const record: MeasurementRecord = { id: 'angle', sessionId: 'old', seriesInstanceUid: 'series', sopInstanceUid: 'sop', frameIndex: 0, coordinateSpace: 'image-pixel', type: 'angle', points: [[2, 2, 0], [1, 1, 0], [2, 0, 0]], stats: {}, createdAt: 1, text: '中文' };
const source: SeriesMeta = { studyInstanceUid: 'study', seriesInstanceUid: 'series', modality: 'MR', seriesDescription: '', numberOfFrames: 1, spacing: [1, Math.sqrt(3), 1], planes: [plane], warnings: [] };
describe('角度工具物理与恢复链路', () => {
  it('三点角先变换物理平面，第二点为顶点，label采用degree', () => {
    const stats = angleStats(record, plane);
    expect(stats.angleDeg).toBeCloseTo(60, 10);
    expect(annotationLabel({ ...record, stats })).toContain('60.00°');
    expect(angleSegments(record)).toEqual([[0, 1], [1, 2]]);
  });
  it('Cobb返回两条无向直线锐角，保持端点反向/平移不变', () => {
    const first = measureImageCobbAngle([0, 0], [1, 1], [5, 5], [6, 4], calibration);
    expect(first.ok).toBe(true); if (first.ok) expect(first.value).toBeCloseTo(60, 10);
    const second = measureImageCobbAngle([1, 1], [0, 0], [6, 4], [5, 5], calibration);
    expect(second).toEqual(first);
    expect(measureImageCobbAngle([0, 0], [1, 0], [0, 2], [-1, 2], calibration)).toEqual({ ok: true, value: 0, unit: 'deg' });
    expect(measureImageCobbAngle([0, 0], [1, 0], [1, 0], [1, 1], calibration)).toEqual({ ok: true, value: 90, unit: 'deg' });
  });
  it('不可信/非法标定与退化端点拒绝，不产生伪角度', () => {
    expect(measureImageCobbAngle([0, 0], [0, 0], [0, 0], [1, 1], calibration)).toMatchObject({ ok: false, reason: 'degenerate' });
    expect(measureImageCobbAngle([0, 0], [1, 1], [0, 0], [1, 0], undefined)).toMatchObject({ ok: false, reason: 'uncalibrated' });
    expect(() => angleStats(record, { ...plane, hasMissingPixelSpacing: true })).toThrow();
    expect(() => angleStats({ ...record, points: record.points.slice(0, 2) }, plane)).toThrow('数量');
  });
  it('三点角和Cobb的备份均按源标定重算，拒绝篡改结果/点数', () => {
    const cobb: MeasurementRecord = { ...record, id: 'cobb', type: 'cobbAngle', points: [[1, 1, 0], [2, 2, 0], [4, 4, 0], [5, 3, 0]] };
    for (const item of [record, cobb]) {
      const saved = { ...item, stats: angleStats(item, plane) };
      expect(restoreAnnotationRecords([saved], [source], 'new')).toEqual([{ ...saved, sessionId: 'new' }]);
      expect(() => restoreAnnotationRecords([{ ...saved, stats: { angleDeg: 99 } }], [source], 'new')).toThrow('不一致');
      expect(() => restoreAnnotationRecords([{ ...saved, points: saved.points.slice(1) }], [source], 'new')).toThrow('数量');
    }
    expect(angleSegments(cobb)).toEqual([[0, 1], [2, 3]]);
  });
});
