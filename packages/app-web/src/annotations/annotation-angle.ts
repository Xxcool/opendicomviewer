import { measureImageAngle, measureImageCobbAngle, type MeasurementRecord, type ImagePlane } from '@opendicomviewer/core';
import { calibrated } from './annotation-geometry';
export function isAngle(record: Pick<MeasurementRecord, 'type'>) { return record.type === 'angle' || record.type === 'cobbAngle'; }
export function anglePointCount(type: MeasurementRecord['type']) { return type === 'angle' ? 3 : 4; }
export function angleStats(record: Pick<MeasurementRecord, 'type' | 'points'>, plane: ImagePlane): MeasurementRecord['stats'] {
  const points = record.points.map(point => [point[0], point[1]] as const);
  if (points.length !== anglePointCount(record.type)) throw new Error('角度控制点数量无效');
  const calibration = { trusted: calibrated(plane), pixelSpacing: plane.pixelSpacing };
  const result = record.type === 'angle'
    ? measureImageAngle(points[0]!, points[1]!, points[2]!, calibration)
    : measureImageCobbAngle(points[0]!, points[1]!, points[2]!, points[3]!, calibration);
  if (!result.ok) throw new Error(`角度不可计算：${result.reason}`);
  return { angleDeg: result.value };
}
export function angleSegments(record: MeasurementRecord): readonly (readonly [number, number])[] {
  return record.type === 'angle' ? [[0, 1], [1, 2]] : record.type === 'cobbAngle' ? [[0, 1], [2, 3]] : [[0, 1]];
}
