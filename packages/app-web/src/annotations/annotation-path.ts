import { measureImagePolyline, type ImagePlane, type MeasurementRecord } from '@opendicomviewer/core';
import { calibrated, type PixelPoint } from './annotation-geometry';
export const MAX_PATH_POINTS = 2048;
export function isPath(record: Pick<MeasurementRecord, 'type'>) { return record.type === 'polyline' || record.type === 'freehand'; }
export function pathSegments(record: Pick<MeasurementRecord, 'points' | 'type'>): readonly (readonly [number, number])[] {
  const segments: [number, number][] = [];
  for (let index = 1; index < record.points.length; index++) segments.push([index - 1, index]);
  if (record.type === 'freehand' && record.points.length >= 3) segments.push([record.points.length - 1, 0]);
  return segments;
}
/** 轮廓存储独立顶点；闭合边由绘制器隐式补齐，移动首点不会留下重复端点。 */
export function validatePath(record: Pick<MeasurementRecord, 'points' | 'type'>, plane: ImagePlane): void {
  const points = record.points;
  if (points.length < (record.type === 'freehand' ? 3 : 2) || points.length > MAX_PATH_POINTS) throw new Error('路径控制点数量无效');
  if (points.some(point => point.length !== 3 || point[2] !== 0 || !point.every(Number.isFinite) || point[0] < 0 || point[1] < 0 || point[0] > plane.columns - 1 || point[1] > plane.rows - 1)) throw new Error('路径控制点超出原图范围');
  if (pathSegments(record).some(([a, b]) => Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1]) < 0.5)) throw new Error('路径相邻控制点跨度不足');
  if (record.type === 'freehand') {
    const first = points[0]!;
    // 至少有一个偏离起点与最远点连线的点，拒绝只有往返直线的假轮廓。
    const farthest = points.reduce((a, b) => Math.hypot(b[0] - first[0], b[1] - first[1]) > Math.hypot(a[0] - first[0], a[1] - first[1]) ? b : a, first);
    const length = Math.hypot(farthest[0] - first[0], farthest[1] - first[1]);
    if (!points.some(point => Math.abs((farthest[0] - first[0]) * (point[1] - first[1]) - (farthest[1] - first[1]) * (point[0] - first[0])) / length >= 0.5)) throw new Error('手绘轮廓跨度不足');
  }
}
export function pathStats(record: Pick<MeasurementRecord, 'points' | 'type'>, plane: ImagePlane): MeasurementRecord['stats'] {
  validatePath(record, plane);
  if (record.type === 'freehand') return {};
  const result = measureImagePolyline(record.points.map(point => [point[0], point[1]]), { trusted: calibrated(plane), pixelSpacing: plane.pixelSpacing });
  if (!result.ok) throw new Error(`折线测距不可计算：${result.reason}`);
  return { lengthMm: result.value };
}
export function freehandPointLimitExceeded(points: readonly PixelPoint[], point: PixelPoint): boolean {
  const last = points[points.length - 1];
  return points.length >= MAX_PATH_POINTS && !!last && Math.hypot(last[0] - point[0], last[1] - point[1]) >= 1;
}
/** 采样依据原图像素间距，限定顶点数；高频移动仅修改局部 draft。 */
export function appendFreehandPoint(points: readonly PixelPoint[], point: PixelPoint): readonly PixelPoint[] {
  const last = points[points.length - 1];
  if (points.length >= MAX_PATH_POINTS || (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1)) return points;
  return [...points, point];
}
