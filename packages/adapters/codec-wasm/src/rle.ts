/**
 * DICOM RLE Lossless 解码（PS3.5 Annex G）
 *
 * 职责边界：只把已解封装的单帧码流还原成像素，不解析任何标签（GEMINI §2）。
 * 16 位按 PS3.5 G.2 拆成两个字节平面：段 1 是高位、段 2 是低位；
 * 组装时直接按数值合成，不依赖宿主字节序。
 */

export interface RleFrameContext {
  readonly rows: number;
  readonly columns: number;
  readonly bitsAllocated: number;
  readonly pixelRepresentation: number;
}

/** RLE Header 为 16 个 UL：段数 + 15 个段偏移（PS3.5 G.5） */
const RLE_HEADER_BYTES = 64;
const MAX_RLE_SEGMENTS = 15;

export type DecodedGrayscale =
  | Int16Array
  | Uint16Array
  | Uint8Array;

export function decodeRleFrame(
  bitstream: Uint8Array,
  context: RleFrameContext,
): DecodedGrayscale {
  const { rows, columns, bitsAllocated, pixelRepresentation } = context;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
    throw new Error(`RLE 解码缺少有效矩阵尺寸: rows=${rows}, columns=${columns}`);
  }
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`RLE 仅支持 8/16 位像素，当前 BitsAllocated=${bitsAllocated}`);
  }
  if (bitstream.byteLength < RLE_HEADER_BYTES) {
    throw new Error(
      `RLE 码流过短（${bitstream.byteLength} 字节），不足 ${RLE_HEADER_BYTES} 字节头`,
    );
  }

  const header = new DataView(
    bitstream.buffer,
    bitstream.byteOffset,
    RLE_HEADER_BYTES,
  );
  const segmentCount = header.getUint32(0, true);
  const bytesPerSample = bitsAllocated / 8;

  // 段数 = 每采样字节数 × SamplesPerPixel。我们只支持单通道：
  // 8 位 1 段、16 位 2 段；出现 3 段（RGB）说明是彩色，显式拒绝而不是画灰度。
  if (segmentCount !== bytesPerSample) {
    if (segmentCount > bytesPerSample && segmentCount <= MAX_RLE_SEGMENTS) {
      throw new Error(
        `RLE 彩色图像（${segmentCount} 段）暂不支持：当前仅支持单通道灰度`,
      );
    }
    throw new Error(
      `RLE 段数与像素格式不符: 头部=${segmentCount} 段，期望 ${bytesPerSample} 段（BitsAllocated=${bitsAllocated}）`,
    );
  }

  const bytesPerSegment = rows * columns;
  const segmentBytes: Uint8Array[] = [];
  for (let index = 0; index < segmentCount; index++) {
    const start = header.getUint32(4 + index * 4, true);
    const end =
      index + 1 < segmentCount
        ? header.getUint32(4 + (index + 1) * 4, true)
        : bitstream.byteLength;
    segmentBytes.push(
      readSegment(bitstream, start, end, index, bytesPerSegment),
    );
  }

  if (bitsAllocated === 8) {
    const segment = segmentBytes[0];
    if (!segment) throw new Error('RLE 解码失败：缺少 8 位像素段');
    return segment;
  }

  const high = segmentBytes[0];
  const low = segmentBytes[1];
  if (!high || !low) throw new Error('RLE 解码失败：16 位像素段不完整');

  const pixels = new Uint16Array(bytesPerSegment);
  for (let i = 0; i < bytesPerSegment; i++) {
    // noUncheckedIndexedAccess：逐项判空，越界即视为码流损坏
    const hi = high[i];
    const lo = low[i];
    if (hi === undefined || lo === undefined) {
      throw new Error(`RLE 解码失败：第 ${i} 个像素的字节段不完整`);
    }
    pixels[i] = (hi << 8) | lo;
  }

  // Int16Array 复用同一段内存，仅改变解释方式，位模式不变
  return pixelRepresentation === 1 ? new Int16Array(pixels.buffer) : pixels;
}

function readSegment(
  bitstream: Uint8Array,
  start: number,
  end: number,
  index: number,
  expectedLength: number,
): Uint8Array {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < RLE_HEADER_BYTES ||
    end > bitstream.byteLength ||
    end <= start
  ) {
    throw new Error(
      `RLE 第 ${index + 1} 段偏移非法: start=${start}, end=${end}, 总长=${bitstream.byteLength}`,
    );
  }
  return decodePackBits(bitstream.subarray(start, end), expectedLength, index);
}

/**
 * PackBits 变体（PS3.5 G.3.2）：
 * - 0x00–0x7F：随后 n+1 字节原样输出
 * - 0x80：空操作
 * - 0x81–0xFF：将下一字节重复 257-n 次
 */
function decodePackBits(
  data: Uint8Array,
  expectedLength: number,
  segmentIndex: number,
): Uint8Array {
  const output = new Uint8Array(expectedLength);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < data.length && outputOffset < expectedLength) {
    const control = data[inputOffset];
    inputOffset += 1;
    if (control === undefined) break;

    if (control <= 0x7f) {
      const count = control + 1;
      if (inputOffset + count > data.length) {
        throw new Error(
          `RLE 第 ${segmentIndex + 1} 段字面量越界: 需要 ${count} 字节，剩余 ${data.length - inputOffset}`,
        );
      }
      if (outputOffset + count > expectedLength) {
        throw new Error(
          `RLE 第 ${segmentIndex + 1} 段解码超出预期长度 ${expectedLength}`,
        );
      }
      output.set(data.subarray(inputOffset, inputOffset + count), outputOffset);
      inputOffset += count;
      outputOffset += count;
      continue;
    }

    if (control === 0x80) continue;

    const count = 257 - control;
    const value = data[inputOffset];
    if (value === undefined) {
      throw new Error(`RLE 第 ${segmentIndex + 1} 段重复字节缺失`);
    }
    inputOffset += 1;
    if (outputOffset + count > expectedLength) {
      throw new Error(
        `RLE 第 ${segmentIndex + 1} 段重复游程超出预期长度 ${expectedLength}`,
      );
    }
    output.fill(value, outputOffset, outputOffset + count);
    outputOffset += count;
  }

  if (outputOffset !== expectedLength) {
    throw new Error(
      `RLE 第 ${segmentIndex + 1} 段解压长度不足: ${outputOffset}/${expectedLength}`,
    );
  }
  return output;
}
