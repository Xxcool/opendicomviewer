import { describe, expect, it } from 'vitest';
import {
  JPEG_LOSSLESS_SV1_UID,
  JPEG_LOSSLESS_UID,
  PixelCodec,
  RLE_LOSSLESS_UID,
} from '../src';
import { buildRleFrame } from '../testing/rle-fixture';

describe('PixelCodec（CodecPort 实现）', () => {
  it('只声明支持已实现的三条传输语法', () => {
    const codec = new PixelCodec();
    expect(codec.canDecode(RLE_LOSSLESS_UID)).toBe(true);
    expect(codec.canDecode(JPEG_LOSSLESS_UID)).toBe(true);
    expect(codec.canDecode(JPEG_LOSSLESS_SV1_UID)).toBe(true);
    expect(codec.canDecode('1.2.840.10008.1.2.4.50')).toBe(false);
    expect(codec.canDecode('1.2.840.10008.1.2.1')).toBe(false);
    expect(codec.prefersSharedMemory).toBe(false);
  });

  it('RLE 解码结果组装成完整 PixelFrame', async () => {
    const values = [0, 100, 200, 300, 400, 500, 600, 65535];
    const bitstream = buildRleFrame({
      rows: 2,
      columns: 4,
      bitsAllocated: 16,
      values,
    });

    const codec = new PixelCodec();
    const frame = await codec.decode(bitstream.buffer, RLE_LOSSLESS_UID, {
      rows: 2,
      columns: 4,
      bitsAllocated: 16,
      pixelRepresentation: 0,
      photometricInterpretation: 'MONOCHROME2',
      rescaleSlope: 0.5,
      rescaleIntercept: -1024,
      windowCenter: 40,
      windowWidth: 400,
    });

    expect(frame.width).toBe(4);
    expect(frame.height).toBe(2);
    expect(Array.from(frame.pixelData)).toEqual(values);
    expect(frame.rescaleSlope).toBe(0.5);
    expect(frame.rescaleIntercept).toBe(-1024);
    expect(frame.defaultVOI).toEqual({ windowCenter: 40, windowWidth: 400 });
    expect(frame.photometricInterpretation).toBe('MONOCHROME2');
  });

  it('彩色光度学解释显式拒绝', async () => {
    const bitstream = buildRleFrame({
      rows: 1,
      columns: 1,
      bitsAllocated: 8,
      values: [0],
    });

    await expect(
      new PixelCodec().decode(bitstream.buffer, RLE_LOSSLESS_UID, {
        rows: 1,
        columns: 1,
        bitsAllocated: 8,
        pixelRepresentation: 0,
        photometricInterpretation: 'RGB',
      }),
    ).rejects.toThrow(/RGB|单通道/);
  });

  it('缺少矩阵尺寸时拒绝组装 PixelFrame', async () => {
    await expect(
      new PixelCodec().decode(new ArrayBuffer(8), RLE_LOSSLESS_UID, {
        bitsAllocated: 16,
      }),
    ).rejects.toThrow(/矩阵尺寸/);
  });

  it('未实现的传输语法即使调用 decode 也显式失败', async () => {
    await expect(
      new PixelCodec().decode(new ArrayBuffer(8), '1.2.840.10008.1.2.4.50', {
        rows: 1,
        columns: 1,
      }),
    ).rejects.toThrow(/不支持的压缩传输语法/);
  });
});
