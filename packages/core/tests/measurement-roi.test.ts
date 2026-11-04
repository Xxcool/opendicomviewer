import { describe, expect, it } from 'vitest';
import type { PixelFrame } from '../domain/types';
import { measureImageRegion, type ImageRegion } from '../measurement/roi';

const frame = (values: number[], width: number, more: Partial<PixelFrame> = {}): PixelFrame => ({
  width, height: values.length / width, pixelData: new Int16Array(values), rescaleSlope: 1, rescaleIntercept: 0, ...more,
});
const rectangle: ImageRegion = { shape: 'rectangle', start: [0, 0], end: [1, 1] };
const calibration = { trusted: true, pixelSpacing: [2, 3] } as const;

describe('原始帧 ROI 数值核心', () => {
  it('矩形闭边界四中心，人口标准差，几何面积与采样数量分开', () => {
    const result = measureImageRegion(frame([0, 2, 4, 6], 2), rectangle, calibration);
    expect(result).toEqual({ ok: true, stats: { count: 4, mean: 3, stdDev: Math.sqrt(5), min: 0, max: 6, areaMm2: 6 } });
    expect(measureImageRegion(frame([0, 2, 4, 6], 2), { ...rectangle, start: [1, 1], end: [0, 0] }, calibration)).toEqual(result);
  });
  it('水、空气、骨 phantom 应用 slope/intercept，不受显示反色影响', () => {
    for (const [stored, expected] of [[512, 0], [12, -1000], [1012, 1000]]) {
      const result = measureImageRegion(frame([stored!, stored!, stored!, stored!], 2,
        { rescaleSlope: 2, rescaleIntercept: -1024, photometricInterpretation: 'MONOCHROME1' }), rectangle, calibration);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.stats).toMatchObject({ mean: expected, min: expected, max: expected, stdDev: 0 });
    }
  });
  it('Modality LUT 优先于 Rescale，低高越界使用端点；输出不自动命名HU', () => {
    const result = measureImageRegion(frame([-1, 0, 1, 3], 2, { rescaleSlope: 20, rescaleIntercept: 300,
      modalityLUT: { firstMappedPixelValue: 0, bitsStored: 16, lutData: [10, 20, 30] } }), rectangle, calibration);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stats).toMatchObject({ count: 4, mean: 17.5, min: 10, max: 30 });
      expect(result.stats.stdDev).toBeCloseTo(Math.sqrt(68.75), 12);
      expect(result.stats).not.toHaveProperty('meanHU');
    }
  });
  it('椭圆排除四角，包含半径边界中心，面积按异距连续几何计算', () => {
    const values = Array.from({ length: 25 }, () => 100);
    values[0] = 1000; values[4] = 1000; values[20] = 1000; values[24] = 1000;
    const result = measureImageRegion(frame(values, 5), { shape: 'ellipse', start: [0, 0], end: [4, 4] }, calibration);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stats).toMatchObject({ count: 13, mean: 100, min: 100, max: 100, stdDev: 0 });
      expect(result.stats.areaMm2).toBeCloseTo(24 * Math.PI, 12);
    }
  });
  it('分数边界只选择落入的像素中心，空区域明确失败', () => {
    expect(measureImageRegion(frame([1, 2, 3, 4, 5, 6, 7, 8, 9], 3),
      { shape: 'rectangle', start: [0.5, 0.5], end: [1.5, 1.5] }, calibration))
      .toEqual({ ok: true, stats: { count: 1, mean: 5, min: 5, max: 5, stdDev: 0, areaMm2: 6 } });
    expect(measureImageRegion(frame([1, 2, 3, 4], 2), { shape: 'ellipse', start: [0.1, 0.1], end: [0.9, 0.9] }))
      .toEqual({ ok: false, reason: 'empty-region' });
  });
  it('没有可信标定仍可统计灰度，但明确不生成物理面积', () => {
    const result = measureImageRegion(frame([1, 1, 1, 1], 2), rectangle);
    expect(result).toEqual({ ok: true, stats: { count: 4, mean: 1, min: 1, max: 1, stdDev: 0, areaUnavailable: 'uncalibrated' } });
    expect(measureImageRegion(frame([1, 1, 1, 1], 2), rectangle, { ...calibration, trusted: false })).toEqual(result);
  });
  it('拒绝无效区域、零面积、部分越界，不裁剪或制造值', () => {
    const image = frame([1, 2, 3, 4], 2);
    expect(measureImageRegion(image, { ...rectangle, start: [NaN, 0] })).toEqual({ ok: false, reason: 'invalid-region' });
    expect(measureImageRegion(image, { ...rectangle, end: [0, 1] })).toEqual({ ok: false, reason: 'degenerate' });
    expect(measureImageRegion(image, { ...rectangle, start: [-0.1, 0] })).toEqual({ ok: false, reason: 'outside-image' });
    expect(measureImageRegion(image, { ...rectangle, end: [1, 1.01] })).toEqual({ ok: false, reason: 'outside-image' });
  });
  it('拒绝不完整像素帧、彩色、非整数尺寸及非法变换', () => {
    const image = frame([1, 2, 3, 4], 2);
    for (const more of [{ width: 1.5 }, { width: 0 }, { height: 3 }, { photometricInterpretation: 'RGB' }]) {
      expect(measureImageRegion({ ...image, ...more }, rectangle)).toEqual({ ok: false, reason: 'invalid-frame' });
    }
    for (const more of [{ rescaleSlope: NaN }, { rescaleSlope: 0 }, { rescaleIntercept: Infinity },
      { modalityLUT: { firstMappedPixelValue: 0, bitsStored: 16, lutData: [] } },
      { modalityLUT: { firstMappedPixelValue: 0.5, bitsStored: 16, lutData: [1] } },
      { modalityLUT: { firstMappedPixelValue: 0, bitsStored: 8, lutData: [256] } }]) {
      expect(measureImageRegion({ ...image, ...more }, rectangle)).toEqual({ ok: false, reason: 'invalid-transform' });
    }
  });
  it('拒绝无效物理标定和数值溢出', () => {
    const image = frame([1, 2, 3, 4], 2);
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(measureImageRegion(image, rectangle, { trusted: true, pixelSpacing: [invalid, 1] }))
        .toEqual({ ok: false, reason: 'invalid-spacing' });
    }
    expect(measureImageRegion(frame([32767, 32767, 32767, 32767], 2, { rescaleSlope: 1e308 }), rectangle))
      .toEqual({ ok: false, reason: 'numeric-overflow' });
  });
});
