import { describe, expect, it } from 'vitest';
import { decodeRleFrame } from '../src/rle';
import { buildRleFrame } from '../testing/rle-fixture';

const RLE_HEADER_BYTES = 64;

/** 手工构造的最小 8 位码流，用来固定 PackBits 的语义，而不是只做自产自销的往返 */
function buildHandWritten8BitFrame(): Uint8Array {
  const bytes = new Uint8Array(RLE_HEADER_BYTES + 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, RLE_HEADER_BYTES, true);
  // 10 重复 3 次（0xFE = 257-3），随后 5 字节字面量（0x04 = 5-1）
  bytes.set([0xfe, 0x0a, 0x04, 0x14, 0x1e, 0x1e, 0x28, 0x28], RLE_HEADER_BYTES);
  return bytes;
}

describe('RLE Lossless 解码', () => {
  it('8 位：重复游程与字面量逐字节还原', () => {
    const decoded = decodeRleFrame(buildHandWritten8BitFrame(), {
      rows: 2,
      columns: 4,
      bitsAllocated: 8,
      pixelRepresentation: 0,
    });

    expect(Array.from(decoded)).toEqual([10, 10, 10, 20, 30, 30, 40, 40]);
  });

  it('16 位：高位段与低位段按数值合成', () => {
    const values = [0x1234, 0x00ff, 0xabcd, 0x0001];
    const frame = buildRleFrame({
      rows: 2,
      columns: 2,
      bitsAllocated: 16,
      values,
    });

    const decoded = decodeRleFrame(frame, {
      rows: 2,
      columns: 2,
      bitsAllocated: 16,
      pixelRepresentation: 0,
    });

    expect(decoded).toBeInstanceOf(Uint16Array);
    expect(Array.from(decoded)).toEqual(values);
  });

  it('16 位有符号：位模式不变，按 Int16 解释', () => {
    const frame = buildRleFrame({
      rows: 2,
      columns: 2,
      bitsAllocated: 16,
      values: [0xffff, 0x8000, 0x0001, 0x7fff],
    });

    const decoded = decodeRleFrame(frame, {
      rows: 2,
      columns: 2,
      bitsAllocated: 16,
      pixelRepresentation: 1,
    });

    expect(decoded).toBeInstanceOf(Int16Array);
    expect(Array.from(decoded)).toEqual([-1, -32768, 1, 32767]);
  });

  it('超过 15 段的码流按损坏处理', () => {
    const frame = buildRleFrame({
      rows: 1,
      columns: 1,
      bitsAllocated: 8,
      values: [0],
    });
    new DataView(frame.buffer).setUint32(0, 16, true);

    expect(() =>
      decodeRleFrame(frame, {
        rows: 1,
        columns: 1,
        bitsAllocated: 8,
        pixelRepresentation: 0,
      }),
    ).toThrow(/段数|彩色/);
  });

  it('头部不足 64 字节显式报错', () => {
    expect(() =>
      decodeRleFrame(new Uint8Array(32), {
        rows: 1,
        columns: 1,
        bitsAllocated: 8,
        pixelRepresentation: 0,
      }),
    ).toThrow(/不足 64 字节/);
  });

  it('段偏移越界显式报错', () => {
    const frame = buildRleFrame({
      rows: 1,
      columns: 1,
      bitsAllocated: 8,
      values: [7],
    });
    new DataView(frame.buffer).setUint32(4, frame.byteLength + 10, true);

    expect(() =>
      decodeRleFrame(frame, {
        rows: 1,
        columns: 1,
        bitsAllocated: 8,
        pixelRepresentation: 0,
      }),
    ).toThrow(/偏移非法/);
  });

  it('字面量被截断时不返回半张图', () => {
    const frame = buildRleFrame({
      rows: 1,
      columns: 4,
      bitsAllocated: 8,
      values: [1, 2, 3, 4],
    });
    // 砍掉最后一个像素，模拟码流截断
    const truncated = frame.slice(0, frame.byteLength - 1);

    expect(() =>
      decodeRleFrame(truncated, {
        rows: 1,
        columns: 4,
        bitsAllocated: 8,
        pixelRepresentation: 0,
      }),
    ).toThrow(/越界|长度不足/);
  });
});
