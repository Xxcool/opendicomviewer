import { describe, expect, it } from 'vitest';
import type { PixelFrame } from '@opendicomviewer/core';
import { makeThumbnail } from '../src/components/thumbnail';

const frame: PixelFrame = { width: 4, height: 2, pixelData: new Uint16Array([0, 1, 2, 3, 0, 1, 2, 3]), rescaleSlope: 2, rescaleIntercept: -4 };
describe('序列缩略图灰度', () => {
  it('在没有默认窗时根据模态灰度映射，保留宽高比和不透明 alpha', () => {
    const image = makeThumbnail(frame, 2);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
  it('尊重默认窗与 MONOCHROME1，不与主视口反相', () => {
    const image = makeThumbnail({ ...frame, defaultVOI: { windowWidth: 7, windowCenter: -0.5 }, photometricInterpretation: 'MONOCHROME1' });
    expect([...image.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...image.rgba.slice(12, 16)]).toEqual([0, 0, 0, 255]);
  });
  it('拒绝损坏的像素尺寸，交由预览 UI 明示不可用', () => {
    expect(() => makeThumbnail({ ...frame, width: 20 })).toThrow(/无效/);
  });
  it('横长和竖长矩阵缩小后都保留四角边界', () => {
    for (const [width, height] of [[9, 5], [5, 9]] as const) {
      const pixels = new Uint16Array(width * height);
      pixels[0] = 10; pixels[width - 1] = 20;
      pixels[pixels.length - width] = 30; pixels[pixels.length - 1] = 40;
      const image = makeThumbnail({ width: width, height: height, pixelData: pixels, rescaleSlope: 1, rescaleIntercept: 0, defaultVOI: { windowWidth: 256, windowCenter: 128 } }, 4);
      const gray = (x: number, y: number) => image.rgba[4 * (x + y * image.width)];
      expect([gray(0, 0), gray(image.width - 1, 0), gray(0, image.height - 1), gray(image.width - 1, image.height - 1)]).toEqual([10, 20, 30, 40]);
    }
  });
});
