import type { PixelFrame } from '../domain/types';
import { rawToHU } from '../pipeline/lut';
import type { ImagePixelPoint, MeasurementCalibration } from './geometry';

export interface ImageRegion {
  readonly shape: 'rectangle' | 'ellipse';
  readonly start: ImagePixelPoint;
  readonly end: ImagePixelPoint;
}
export interface RegionStatistics {
  readonly count: number;
  /** 经 Modality LUT 或 Rescale 换算后的值；单位由调用方验证，不能默认称为 HU。 */
  readonly mean: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
  /** 连续图形的几何面积，不是入选像素数乘像素面积。 */
  readonly areaMm2?: number;
  readonly areaUnavailable?: 'uncalibrated';
}
export type RegionMeasurement = { readonly ok: true; readonly stats: RegionStatistics }
  | { readonly ok: false; readonly reason: 'invalid-frame' | 'invalid-transform' | 'invalid-region'
    | 'outside-image' | 'degenerate' | 'empty-region' | 'invalid-spacing' | 'numeric-overflow' };
type Bounds = { left: number; right: number; top: number; bottom: number };

function validFrame(frame: PixelFrame): boolean {
  return Number.isSafeInteger(frame.width) && frame.width > 0 && Number.isSafeInteger(frame.height) && frame.height > 0
    && Number.isSafeInteger(frame.width * frame.height) && frame.pixelData.length === frame.width * frame.height
    && (frame.pixelData instanceof Int16Array || frame.pixelData instanceof Uint16Array || frame.pixelData instanceof Uint8Array)
    && (frame.photometricInterpretation === undefined || ['MONOCHROME1', 'MONOCHROME2'].includes(frame.photometricInterpretation));
}
function validTransform(frame: PixelFrame): boolean {
  const lut = frame.modalityLUT;
  if (!lut) return Number.isFinite(frame.rescaleSlope) && frame.rescaleSlope !== 0 && Number.isFinite(frame.rescaleIntercept);
  return Number.isInteger(lut.firstMappedPixelValue) && [8, 16].includes(lut.bitsStored)
    && lut.lutData.length > 0 && lut.lutData.length <= 65536
    && Array.from(lut.lutData).every(value => Number.isInteger(value) && value >= 0 && value < 2 ** lut.bitsStored);
}
function boundsOf(region: ImageRegion): Bounds | null {
  if (!['rectangle', 'ellipse'].includes(region.shape) || region.start.length !== 2 || region.end.length !== 2
    || ![...region.start, ...region.end].every(Number.isFinite)) return null;
  return { left: Math.min(region.start[0], region.end[0]), right: Math.max(region.start[0], region.end[0]),
    top: Math.min(region.start[1], region.end[1]), bottom: Math.max(region.start[1], region.end[1]) };
}

function collect(frame: PixelFrame, region: ImageRegion, bounds: Bounds): RegionMeasurement {
  const { left, right, top, bottom } = bounds;
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const rx = (right - left) / 2, ry = (bottom - top) / 2;
  let count = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity;
  // 整数位置是原图像素中心；矩形闭边界包含中心，椭圆仅纳入归一化半径平方 <= 1 的中心。
  for (let y = Math.ceil(top); y <= Math.floor(bottom); y++) {
    for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
      if (region.shape === 'ellipse' && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      const value = rawToHU(frame.pixelData[y * frame.width + x]!, frame.rescaleSlope, frame.rescaleIntercept, frame.modalityLUT);
      count++;
      const delta = value - mean;
      mean += delta / count; m2 += delta * (value - mean);
      min = Math.min(min, value); max = Math.max(max, value);
      if (![value, mean, m2].every(Number.isFinite)) return { ok: false, reason: 'numeric-overflow' };
    }
  }
  if (count === 0) return { ok: false, reason: 'empty-region' };
  return { ok: true, stats: { count, mean, stdDev: Math.sqrt(Math.max(0, m2 / count)), min, max } };
}

/** 原始帧 ROI；拒绝部分越界而非静默裁剪。灰度统计不依赖物理标定，未标定时明确省略面积。 */
export function measureImageRegion(frame: PixelFrame, region: ImageRegion, calibration?: MeasurementCalibration): RegionMeasurement {
  if (!validFrame(frame)) return { ok: false, reason: 'invalid-frame' };
  if (!validTransform(frame)) return { ok: false, reason: 'invalid-transform' };
  const bounds = boundsOf(region);
  if (!bounds) return { ok: false, reason: 'invalid-region' };
  const { left, right, top, bottom } = bounds;
  if (left < 0 || top < 0 || right > frame.width - 1 || bottom > frame.height - 1) return { ok: false, reason: 'outside-image' };
  if (left === right || top === bottom) return { ok: false, reason: 'degenerate' };
  const result = collect(frame, region, bounds);
  if (!result.ok) return result;
  if (!calibration?.trusted) return { ok: true, stats: { ...result.stats, areaUnavailable: 'uncalibrated' } };
  const [row, column] = calibration.pixelSpacing;
  const areaMm2 = (right - left) * column * (bottom - top) * row * (region.shape === 'ellipse' ? Math.PI / 4 : 1);
  if (![row, column, areaMm2].every(value => Number.isFinite(value) && value > 0)) return { ok: false, reason: 'invalid-spacing' };
  return { ok: true, stats: { ...result.stats, areaMm2 } };
}
