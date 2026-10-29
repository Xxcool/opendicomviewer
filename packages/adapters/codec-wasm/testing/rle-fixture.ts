/**
 * RLE 码流生成器（仅测试用）
 *
 * 与 src/rle.ts 的解码器相互独立：这里按 PS3.5 Annex G 生成真实码流，
 * 用于验证解码结果，而不是把解码逻辑抄一遍再自证。
 */

export interface RleFixtureOptions {
  readonly rows: number;
  readonly columns: number;
  /** 8 或 16 */
  readonly bitsAllocated: number;
  /** 无符号采样值，长度必须等于 rows × columns */
  readonly values: readonly number[];
}

const RLE_HEADER_BYTES = 64;

export function buildRleFrame(options: RleFixtureOptions): Uint8Array {
  const { rows, columns, bitsAllocated, values } = options;
  const pixelCount = rows * columns;
  if (values.length !== pixelCount) {
    throw new Error(`RLE fixture 采样数不符: ${values.length} != ${pixelCount}`);
  }
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`RLE fixture 仅支持 8/16 位，收到 ${bitsAllocated}`);
  }

  const segmentCount = bitsAllocated / 8;
  const segmentPayloads: Uint8Array[] = [];

  for (let segment = 0; segment < segmentCount; segment++) {
    // 段顺序：高位在前的字节平面（PS3.5 G.2）
    const shift = (segmentCount - 1 - segment) * 8;
    const plane = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const value = values[i];
      if (value === undefined) throw new Error(`RLE fixture 缺少第 ${i} 个采样`);
      plane[i] = (value >> shift) & 0xff;
    }
    segmentPayloads.push(encodePackBits(plane));
  }

  const header = new Uint8Array(RLE_HEADER_BYTES);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, segmentCount, true);

  let offset = RLE_HEADER_BYTES;
  for (let segment = 0; segment < segmentCount; segment++) {
    headerView.setUint32(4 + segment * 4, offset, true);
    const payload = segmentPayloads[segment];
    if (!payload) throw new Error(`RLE fixture 缺少第 ${segment} 段`);
    offset += payload.length;
  }

  const total = new Uint8Array(offset);
  total.set(header, 0);
  let cursor = RLE_HEADER_BYTES;
  for (const payload of segmentPayloads) {
    total.set(payload, cursor);
    cursor += payload.length;
  }
  return total;
}

/** PS3.5 G.3.2 PackBits：0x00–0x7F 字面量、0x80 空操作、0x81–0xFF 重复 */
function encodePackBits(input: Uint8Array): Uint8Array {
  const output: number[] = [];
  let index = 0;

  while (index < input.length) {
    const runLength = countRun(input, index, 128);
    if (runLength >= 3) {
      const value = input[index];
      if (value === undefined) throw new Error('RLE fixture 重复游程越界');
      output.push(257 - runLength, value);
      index += runLength;
      continue;
    }

    const literalStart = index;
    index += 1;
    while (index < input.length && index - literalStart < 128) {
      if (countRun(input, index, 128) >= 3) break;
      index += 1;
    }
    const literalCount = index - literalStart;
    output.push(literalCount - 1);
    for (let i = literalStart; i < index; i++) {
      const value = input[i];
      if (value === undefined) throw new Error('RLE fixture 字面量越界');
      output.push(value);
    }
  }

  return new Uint8Array(output);
}

function countRun(input: Uint8Array, start: number, maxLength: number): number {
  const first = input[start];
  if (first === undefined) return 0;
  let length = 1;
  while (
    length < maxLength &&
    start + length < input.length &&
    input[start + length] === first
  ) {
    length += 1;
  }
  return length;
}
