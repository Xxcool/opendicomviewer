import { describe, expect, it } from 'vitest';
import { decodeJpegLosslessFrame, resolveDecoderConstructor } from '../src/jpeg-lossless';
import { buildLosslessJpeg } from '../testing/jpeg-lossless-fixture';

const SAMPLES_16 = [
  0, 1, 2, 3,
  65535, 32768, 0, 1,
  100, 200, 300, 65534,
  32768, 32769, 0, 65535,
];

describe('JPEG Lossless 解码', () => {
  it('16 位无符号：输出与编码采样逐值一致', async () => {
    const bitstream = buildLosslessJpeg({
      rows: 4,
      columns: 4,
      precision: 16,
      samples: SAMPLES_16,
    });

    const decoded = await decodeJpegLosslessFrame(bitstream, {
      rows: 4,
      columns: 4,
      bitsAllocated: 16,
      pixelRepresentation: 0,
    });

    expect(decoded).toBeInstanceOf(Uint16Array);
    expect(Array.from(decoded)).toEqual(SAMPLES_16);
  });

  it('16 位有符号：同一码流按补码解释', async () => {
    const bitstream = buildLosslessJpeg({
      rows: 4,
      columns: 4,
      precision: 16,
      samples: SAMPLES_16,
    });

    const decoded = await decodeJpegLosslessFrame(bitstream, {
      rows: 4,
      columns: 4,
      bitsAllocated: 16,
      pixelRepresentation: 1,
    });

    expect(decoded).toBeInstanceOf(Int16Array);
    expect(Array.from(decoded)).toEqual([
      0, 1, 2, 3,
      -1, -32768, 0, 1,
      100, 200, 300, -2,
      -32768, -32767, 0, -1,
    ]);
  });

  it('8 位单通道：输出长度与采样数一致', async () => {
    const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const bitstream = buildLosslessJpeg({
      rows: 3,
      columns: 4,
      precision: 8,
      samples,
    });

    const decoded = await decodeJpegLosslessFrame(bitstream, {
      rows: 3,
      columns: 4,
      bitsAllocated: 8,
      pixelRepresentation: 0,
    });

    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual(samples);
  });

  it('非 JPEG 码流显式失败，不返回空白缓冲', async () => {
    await expect(
      decodeJpegLosslessFrame(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
        rows: 1,
        columns: 1,
        bitsAllocated: 16,
        pixelRepresentation: 0,
      }),
    ).rejects.toThrow(/JPEG|SOI|解码/);
  });

  it('解码器模块形态异常时给出可读错误', () => {
    expect(() => resolveDecoderConstructor({})).toThrow(/未导出 Decoder/);
    expect(() => resolveDecoderConstructor(null)).toThrow(/未导出 Decoder/);
  });

  it('兼容 ESM 具名导出与 CJS default 包装', () => {
    class FakeDecoder {}
    expect(resolveDecoderConstructor({ Decoder: FakeDecoder })).toBe(FakeDecoder);
    expect(resolveDecoderConstructor({ default: { Decoder: FakeDecoder } })).toBe(
      FakeDecoder,
    );
  });
});
