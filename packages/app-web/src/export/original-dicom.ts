import type { ImportCandidate } from '@opendicomviewer/core';

async function yieldExport(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
}

async function crc32(bytes: Uint8Array, signal?: AbortSignal): Promise<number> {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    if (index > 0 && index % (256 * 1024) === 0) await yieldExport(signal);
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 无压缩 ZIP32；目录仅用序号，原始实例字节不重编码，不带患者文件路径。 */
export async function originalDicomBlob(files: readonly ImportCandidate[], signal?: AbortSignal): Promise<Blob> {
  if (!files.length) throw new Error('没有可导出的原始实例');
  if (files.length > 65535) throw new Error('实例数量超过 ZIP32 上限');
  const parts: BlobPart[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const [index, file] of files.entries()) {
    if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
    if (file.size > 0xffffffff || offset + file.size + 100 > 0xffffffff) throw new Error('序列超过 ZIP32 大小上限，请分批导出');
    const buffer = await file.read(undefined, undefined, signal);
    await yieldExport(signal);
    if (buffer.byteLength !== file.size) throw new Error('原始文件大小已变化或读取不完整，请重新导入');
    if (files.length === 1) return new Blob([buffer], { type: 'application/dicom' });
    const name = new TextEncoder().encode(`instance-${String(index + 1).padStart(6, '0')}.dcm`);
    const checksum = await crc32(new Uint8Array(buffer), signal);
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint32(14, checksum, true); view.setUint32(18, file.size, true); view.setUint32(22, file.size, true);
    view.setUint16(26, name.length, true); local.set(name, 30);
    const entry = new Uint8Array(46 + name.length), central = new DataView(entry.buffer);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint32(16, checksum, true); central.setUint32(20, file.size, true); central.setUint32(24, file.size, true);
    central.setUint16(28, name.length, true); central.setUint32(42, offset, true); entry.set(name, 46);
    parts.push(local, buffer); directory.push(entry); offset += local.length + file.size;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  if (offset + directorySize + 22 > 0xffffffff) throw new Error('序列超过 ZIP32 大小上限，请分批导出');
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
