import { describe, expect, it } from 'vitest';
import { measureImageAngle, measureImageLength, type MeasurementCalibration } from '../measurement/geometry';

const calibrated = (row: number, column: number): MeasurementCalibration => ({ trusted: true, pixelSpacing: [row, column] });

describe('原始帧物理测量', () => {
  it('3-4-5 phantom 按 DICOM 行列间距计算，并保持平移与端点交换不变', () => {
    const spacing = calibrated(2, 0.5);
    expect(measureImageLength([0, 0], [6, 2], spacing)).toEqual({ ok: true, value: 5, unit: 'mm' });
    expect(measureImageLength([16, 12], [10, 10], spacing)).toEqual({ ok: true, value: 5, unit: 'mm' });
    expect(measureImageLength([0, 0], [2, 0], spacing)).toEqual({ ok: true, value: 1, unit: 'mm' });
    expect(measureImageLength([0, 0], [0, 2], spacing)).toEqual({ ok: true, value: 4, unit: 'mm' });
  });

  it('各向异性像素中的屏幕直角不被误报为物理直角', () => {
    const result = measureImageAngle([1, 1], [0, 0], [1, -1], calibrated(1, Math.sqrt(3)));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value).toBeCloseTo(60, 10); expect(result.unit).toBe('deg'); }
    expect(measureImageAngle([1, 0], [0, 0], [0, 1], calibrated(2, 0.5)))
      .toEqual({ ok: true, value: 90, unit: 'deg' });
  });

  it('共线但非零向量允许 0° 和 180°，大坐标不在点积时溢出', () => {
    expect(measureImageAngle([1, 0], [0, 0], [2, 0], calibrated(1, 1)))
      .toEqual({ ok: true, value: 0, unit: 'deg' });
    expect(measureImageAngle([-1, 0], [0, 0], [2, 0], calibrated(1, 1)))
      .toEqual({ ok: true, value: 180, unit: 'deg' });
    expect(measureImageAngle([1e200, 0], [0, 0], [0, 1e200], calibrated(1, 1)))
      .toEqual({ ok: true, value: 90, unit: 'deg' });
  });

  it('等比例亚正规间距保留角度', () => {
    const result = measureImageAngle([1, 1], [0, 0], [1, 0], calibrated(Number.MIN_VALUE, Number.MIN_VALUE));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeCloseTo(45, 10);
  });

  it('没有显式可信标定时长度与角度都不可计算', () => {
    for (const spacing of [undefined, { trusted: false, pixelSpacing: [1, 1] } as const]) {
      expect(measureImageLength([0, 0], [1, 1], spacing)).toEqual({ ok: false, reason: 'uncalibrated' });
      expect(measureImageAngle([1, 0], [0, 0], [0, 1], spacing)).toEqual({ ok: false, reason: 'uncalibrated' });
    }
  });

  it.each([0, -1, NaN, Infinity])('非法间距 %s 不生成数值', invalid => {
    for (const spacing of [calibrated(invalid, 1), calibrated(1, invalid)]) {
      expect(measureImageLength([0, 0], [1, 1], spacing)).toEqual({ ok: false, reason: 'invalid-spacing' });
      expect(measureImageAngle([1, 0], [0, 0], [0, 1], spacing)).toEqual({ ok: false, reason: 'invalid-spacing' });
    }
  });

  it('非法坐标和计算溢出不生成数值', () => {
    expect(measureImageLength([NaN, 0], [1, 1], calibrated(1, 1))).toEqual({ ok: false, reason: 'invalid-point' });
    expect(measureImageLength([-1e308, 0], [1e308, 1], calibrated(1, 1))).toEqual({ ok: false, reason: 'invalid-point' });
    expect(measureImageAngle([1, 0], [0, 0], [Infinity, 1], calibrated(1, 1))).toEqual({ ok: false, reason: 'invalid-point' });
  });

  it('重合端点或任一零长度角边不可计算', () => {
    const spacing = calibrated(1, 1);
    expect(measureImageLength([2, 3], [2, 3], spacing)).toEqual({ ok: false, reason: 'degenerate' });
    expect(measureImageAngle([0, 0], [0, 0], [1, 1], spacing)).toEqual({ ok: false, reason: 'degenerate' });
    expect(measureImageAngle([1, 1], [0, 0], [0, 0], spacing)).toEqual({ ok: false, reason: 'degenerate' });
  });
});
