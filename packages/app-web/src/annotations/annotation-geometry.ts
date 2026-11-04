import { imagePixelToPatient, patientToImagePixel, isNonVolumetricImage, type ImagePlane, type MeasurementRecord } from '@opendicomviewer/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
export type PixelPoint = [number, number, number];
/** 渲染桥的显示占位网格可用于图形位置，不能作为物理标定。 */
function displayPlane(plane: ImagePlane): ImagePlane {
  return { ...plane, hasMissingGeometry: false, hasMissingPixelSpacing: false };
}
export function sourcePoint(renderer: Pick<CornerstoneRenderer, 'canvasToWorld' | 'worldToCanvas'>, viewportId: string, plane: ImagePlane, x: number, y: number): PixelPoint | null {
  const world = renderer.canvasToWorld(viewportId, { x, y });
  const point = patientToImagePixel(displayPlane(plane), world);
  return point && point[0] >= 0 && point[1] >= 0 && point[0] <= plane.columns - 1 && point[1] <= plane.rows - 1
    ? [point[0], point[1], 0] : null;
}
export function canvasPoint(renderer: Pick<CornerstoneRenderer, 'canvasToWorld' | 'worldToCanvas'>, viewportId: string, plane: ImagePlane, point: readonly [number, number, number]) {
  const world = imagePixelToPatient(displayPlane(plane), [point[0], point[1]]);
  return world ? renderer.worldToCanvas(viewportId, world) : null;
}
export function calibrated(plane: ImagePlane): boolean {
  return !isNonVolumetricImage(plane) && !plane.hasMissingGeometry && !plane.hasMissingPixelSpacing
    && plane.pixelSpacing.every(value => Number.isFinite(value) && value > 0);
}
export function belongsToFrame(record: MeasurementRecord, sessionId: string, seriesUid: string, plane: ImagePlane): boolean {
  return record.sessionId === sessionId && record.seriesInstanceUid === seriesUid
    && record.sopInstanceUid === plane.sopInstanceUid && record.frameIndex === (plane.frameIndex ?? 0);
}
export function segmentDistance(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
