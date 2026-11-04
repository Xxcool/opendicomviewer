import { measureImageRegion, type ImagePlane, type MeasurementRecord, type PixelFrame } from '@opendicomviewer/core';
import { calibrated } from './annotation-geometry';
export function isRoi(record: Pick<MeasurementRecord, 'type'>): boolean { return record.type === 'rectangleRoi' || record.type === 'ellipseRoi'; }
export function roiStats(record: MeasurementRecord, frame: PixelFrame, plane: ImagePlane): MeasurementRecord['stats'] {
  const a = record.points[0], b = record.points[1];
  if (!a || !b || frame.width !== plane.columns || frame.height !== plane.rows) throw new Error('区域与原始帧尺寸不匹配');
  const result = measureImageRegion(frame, { shape: record.type === 'ellipseRoi' ? 'ellipse' : 'rectangle', start: [a[0], a[1]], end: [b[0], b[1]] }, { trusted: calibrated(plane), pixelSpacing: plane.pixelSpacing });
  if (!result.ok) throw new Error(`区域统计失败：${result.reason}`);
  const { count, mean, stdDev, min, max, areaMm2 } = result.stats;
  return { count, mean, stdDev, min, max, ...(areaMm2 === undefined ? {} : { areaMm2 }) };
}
export function annotationLabel(record: MeasurementRecord): string {
  if (record.type === 'angle' || record.type === 'cobbAngle') return `${record.type === 'angle' ? '三点角' : 'Cobb 角'} · ${record.stats.angleDeg?.toFixed(2) ?? '--'}°`;
  if (record.type === 'length') return `${record.stats.lengthMm?.toFixed(2) ?? '--'} mm`;
  if (isRoi(record)) return `${record.type === 'ellipseRoi' ? '椭圆' : '矩形'} · ${record.stats.areaMm2 === undefined ? '面积未标定' : `${record.stats.areaMm2.toFixed(2)} mm²`} · 均值 ${record.stats.mean?.toFixed(2) ?? '--'} · SD ${record.stats.stdDev?.toFixed(2) ?? '--'}`;
  return record.type === 'arrow' ? '箭头' : '文字';
}
