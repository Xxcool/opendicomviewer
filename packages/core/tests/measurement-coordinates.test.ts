import { describe, expect, it } from 'vitest';
import type { ImagePlane } from '../domain/types';
import { imagePixelToPatient, patientToImagePixel } from '../measurement/image-coordinates';
const plane: ImagePlane = {
  imageId: 'fixture', sopInstanceUid: '1.2.3', rows: 100, columns: 100,
  imagePositionPatient: [10, 20, 30], imageOrientationPatient: [0, 1, 0, 0, 0, -1], pixelSpacing: [2, 0.5],
};
describe('源帧像素与患者坐标', () => {
  it('非轴位方向与不等距像素符合已知物理点', () => {
    expect(imagePixelToPatient(plane, [6, 2])).toEqual([10, 23, 26]);
    expect(patientToImagePixel(plane, [10, 23, 26])).toEqual([6, 2]);
  });
  it('斜切方向往返且不接受其他切面上的点', () => {
    const c = Math.SQRT1_2;
    const oblique: ImagePlane = { ...plane, imageOrientationPatient: [c, c, 0, -c, c, 0] };
    const patient = imagePixelToPatient(oblique, [3.5, 7.25]);
    expect(patient).not.toBeNull();
    if (patient) {
      const pixel = patientToImagePixel(oblique, patient);
      expect(pixel?.[0]).toBeCloseTo(3.5, 10);
      expect(pixel?.[1]).toBeCloseTo(7.25, 10);
      expect(patientToImagePixel(oblique, [patient[0], patient[1], patient[2] + 1])).toBeNull();
    }
  });
  it('四位小数舍入的方向余弦仍可逆', () => {
    const rounded: ImagePlane = { ...plane, imageOrientationPatient: [0.7071, 0.7071, 0, -0.7071, 0.7071, 0] };
    const point = imagePixelToPatient(rounded, [100, 70]);
    expect(point).not.toBeNull();
    if (point) {
      const pixel = patientToImagePixel(rounded, point);
      expect(pixel?.[0]).toBeCloseTo(100, 10);
      expect(pixel?.[1]).toBeCloseTo(70, 10);
    }
  });

  it('占位几何、缺间距、非法方向不输出伪坐标', () => {
    const invalidPlanes: ImagePlane[] = [
      { ...plane, hasMissingGeometry: true }, { ...plane, hasMissingPixelSpacing: true },
      { ...plane, pixelSpacing: [0, 1] },
      { ...plane, imageOrientationPatient: [1, 0, 0, 1, 0, 0] },
    ];
    for (const invalid of invalidPlanes) {
      expect(imagePixelToPatient(invalid, [1, 1])).toBeNull();
      expect(patientToImagePixel(invalid, [10, 20, 30])).toBeNull();
    }
    expect(imagePixelToPatient(plane, [Infinity, 0])).toBeNull();
    expect(patientToImagePixel(plane, [NaN, 20, 30])).toBeNull();
  });
});
