import type { ModalityLUT } from '@opendicomviewer/core';
import type { DataSet } from 'dicom-parser';

export function parseModalityLUT(dataSet: DataSet): ModalityLUT | undefined {
  const sequence = dataSet.elements.x00283000;
  if (!sequence) return undefined;
  const item = sequence.items?.[0]?.dataSet;
  if (sequence.items?.length !== 1 || !item) throw new Error('Modality LUT Sequence 必须包含一个有效项');
  const descriptor = item.elements.x00283002;
  const data = item.elements.x00283006;
  if (descriptor?.length !== 6 || !data) throw new Error('Modality LUT 缺少有效 Descriptor 或 LUT Data');
  const count = item.uint16('x00283002', 0) || 65536;
  // 多值 Descriptor 仅第二项按 PixelRepresentation 解释为有符号，首尾永远按 US。
  const firstMappedPixelValue = dataSet.uint16('x00280103') === 1
    ? item.int16('x00283002', 1) : item.uint16('x00283002', 1);
  const bitsStored = item.uint16('x00283002', 2);
  if (firstMappedPixelValue === undefined || (bitsStored !== 8 && bitsStored !== 16)) throw new Error('Modality LUT Descriptor 无效');
  const packed8 = bitsStored === 8 && data.length === count + count % 2;
  if (!packed8 && data.length !== count * 2) throw new Error('Modality LUT 数据长度与 Descriptor 不一致');
  const lutData = new Uint16Array(count);
  for (let index = 0; index < count; index++) {
    const value = packed8 ? item.byteArray[data.dataOffset + index] : item.uint16('x00283006', index);
    if (value === undefined || value >= 2 ** bitsStored) throw new Error('Modality LUT 数据值超出声明位深');
    lutData[index] = value;
  }
  return { firstMappedPixelValue, bitsStored, lutData };
}
