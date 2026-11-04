import type { DataSet } from 'dicom-parser';

export function pixelEncoding(dataSet: DataSet) {
  const bitsAllocated = dataSet.uint16('x00280100') ?? 16;
  const bitsStored = dataSet.uint16('x00280101') ?? bitsAllocated;
  const highBit = dataSet.uint16('x00280102') ?? bitsStored - 1;
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0;
  if (![8, 16].includes(bitsAllocated) || bitsStored < 1 || bitsStored > bitsAllocated
    || highBit < bitsStored - 1 || highBit >= bitsAllocated || ![0, 1].includes(pixelRepresentation)) {
    throw new Error('无效或暂不支持的像素位深、HighBit 或 PixelRepresentation');
  }
  return { bitsAllocated, bitsStored, highBit, pixelRepresentation };
}

export function unpackNativePixels(raw: Uint8Array, encoding: ReturnType<typeof pixelEncoding>): Int16Array | Uint16Array | Uint8Array {
  const { bitsAllocated, bitsStored, highBit, pixelRepresentation } = encoding;
  const words = bitsAllocated === 16 ? new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2) : raw;
  const output = pixelRepresentation === 1 ? new Int16Array(words.length)
    : bitsAllocated === 16 ? new Uint16Array(words.length) : new Uint8Array(words.length);
  const shift = highBit - bitsStored + 1;
  const mask = 2 ** bitsStored - 1;
  const sign = 2 ** (bitsStored - 1);
  // 未使用位可能含任意内容，必须先提取有效位，再按有效位的符号位扩展。
  for (let index = 0; index < words.length; index++) {
    const value = (words[index]! >>> shift) & mask;
    output[index] = pixelRepresentation === 1 && value >= sign ? value - 2 ** bitsStored : value;
  }
  return output;
}
