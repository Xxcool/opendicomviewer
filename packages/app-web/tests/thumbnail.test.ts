import { describe, expect, it } from 'vitest';
import type { PixelFrame } from '@opendicomviewer/core';
import { makeThumbnail } from '../src/components/thumbnail';

const frame: PixelFrame = { width: 4, height: 2, pixelData: new Uint16Array([0, 1, 2, 3, 0, 1, 2, 3]), rescaleSlope: 2, rescaleIntercept: -4 };
describe('序列缩略图灰度', () => {
  it('在没有默认窗时根据模态灰度映射，保留宽高比和不透明 alpha', () => {
    const image = makeThumbnail(frame, 2);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.rgba]).toEqual([0, 0, 0, 255, 170, 170, 170, 255]);
  });
  it('尊重默认窗与 MONOCHROME1，不与主视口反相', () => {
    const image = makeThumbnail({ ...frame, defaultVOI: { windowWidth: 7, windowCenter: -0.5 }, photometricInterpretation: 'MONOCHROME1' });
    expect([...image.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...image.rgba.slice(12, 16)]).toEqual([0, 0, 0, 255]);
  });
  it('拒绝损坏的像素尺寸，交由预览 UI 明示不可用', () => {
    expect(() => makeThumbnail({ ...frame, width: 20 })).toThrow(/无效/);
  });
});
