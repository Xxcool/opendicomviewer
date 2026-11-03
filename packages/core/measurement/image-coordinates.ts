import type { ImagePlane } from '../domain/types';
import type { ImagePixelPoint } from './geometry';

type PatientPoint = readonly [number, number, number];

/** 只用于有可信空间标签的原始帧；占位几何不能参与标注坐标换算。 */
function validPlane(plane: ImagePlane): boolean {
  const o = plane.imageOrientationPatient;
  return !plane.hasMissingGeometry && !plane.hasMissingPixelSpacing
    && [...o, ...plane.imagePositionPatient, ...plane.pixelSpacing].every(Number.isFinite)
    && plane.pixelSpacing.every(value => value > 0)
    && Math.abs(Math.hypot(o[0], o[1], o[2]) - 1) < 1e-4
    && Math.abs(Math.hypot(o[3], o[4], o[5]) - 1) < 1e-4
    && Math.abs(o[0] * o[3] + o[1] * o[4] + o[2] * o[5]) < 1e-4;
}

/** DICOM 第一组方向沿列 x；PixelSpacing 第一个值却是行 y 的间距。 */
export function imagePixelToPatient(plane: ImagePlane, point: ImagePixelPoint): PatientPoint | null {
  if (!validPlane(plane) || !point.every(Number.isFinite)) return null;
  const o = plane.imageOrientationPatient;
  const x = point[0] * plane.pixelSpacing[1];
  const y = point[1] * plane.pixelSpacing[0];
  const result: PatientPoint = [
    plane.imagePositionPatient[0] + o[0] * x + o[3] * y,
    plane.imagePositionPatient[1] + o[1] * x + o[4] * y,
    plane.imagePositionPatient[2] + o[2] * x + o[5] * y,
  ];
  return result.every(Number.isFinite) ? result : null;
}

/** 不把其他切面上的患者坐标投影到当前帧；容差仅接纳标签舍入误差。 */
export function patientToImagePixel(plane: ImagePlane, point: PatientPoint): ImagePixelPoint | null {
  if (!validPlane(plane) || !point.every(Number.isFinite)) return null;
  const o = plane.imageOrientationPatient;
  const d = point.map((value, i) => value - plane.imagePositionPatient[i]!);
  const u = d[0]! * o[0] + d[1]! * o[1] + d[2]! * o[2];
  const v = d[0]! * o[3] + d[1]! * o[4] + d[2]! * o[5];
  // 合法 IOP 也可能经过十进制舍入，按实际基底解逆，不能假设严格单位正交。
  const a = o[0] ** 2 + o[1] ** 2 + o[2] ** 2;
  const b = o[0] * o[3] + o[1] * o[4] + o[2] * o[5];
  const c = o[3] ** 2 + o[4] ** 2 + o[5] ** 2;
  const determinant = a * c - b * b;
  const x = (u * c - v * b) / determinant;
  const y = (v * a - u * b) / determinant;
  const residual = Math.hypot(...d.map((value, i) => value - x * o[i]! - y * o[i + 3]!));
  const pixel: ImagePixelPoint = [x / plane.pixelSpacing[1], y / plane.pixelSpacing[0]];
  return residual <= 0.001 && pixel.every(Number.isFinite) ? pixel : null;
}
