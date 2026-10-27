/**
 * 纯原生零依赖 ZIP 流式/分段解包器
 *
 * 遵循规范：零第三方库（除 dicom-parser），使用平台原生 DecompressionStream('deflate-raw')
 */

import type { ImportCandidate } from '@opendicomviewer/core';

export interface ZipEntry {
  readonly filename: string;
  readonly uncompressedSize: number;
  readonly isDirectory: boolean;
  read(): Promise<ArrayBuffer>;
}

/**
 * 检查字节流是否具有标准 ZIP 头部魔数 (0x50, 0x4B, 0x03, 0x04)
 */
export function isZipBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 4) return false;
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * 解析并解压 ZIP 内部条目
 */
export async function extractZipEntries(
  zipBuffer: ArrayBuffer,
): Promise<ZipEntry[]> {
  const view = new DataView(zipBuffer);
  const bytes = new Uint8Array(zipBuffer);
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= zipBuffer.byteLength) {
    const sig = view.getUint32(offset, true);
    // Local file header signature: 0x04034b50
    if (sig !== 0x04034b50) {
      break;
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLength);
    const filename = new TextDecoder().decode(nameBytes);
    const isDirectory = filename.endsWith('/');

    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const rawEntryData = bytes.slice(dataStart, dataEnd);

    entries.push({
      filename,
      uncompressedSize,
      isDirectory,
      async read(): Promise<ArrayBuffer> {
        if (compressionMethod === 0) {
          // Stored (no compression)
          return rawEntryData.buffer.slice(
            rawEntryData.byteOffset,
            rawEntryData.byteOffset + rawEntryData.byteLength,
          );
        } else if (compressionMethod === 8) {
          // Deflated: 使用原生 Web DecompressionStream('deflate-raw')
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(rawEntryData);
              controller.close();
            },
          });
          const decompressed = stream.pipeThrough(
            new DecompressionStream('deflate-raw'),
          );
          const chunks: Uint8Array[] = [];
          const reader = decompressed.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
          }
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          const out = new Uint8Array(totalLen);
          let p = 0;
          for (const c of chunks) {
            out.set(c, p);
            p += c.length;
          }
          return out.buffer;
        }
        throw new Error(`不支持的 ZIP 压缩方式: ${compressionMethod}`);
      },
    });

    offset = dataEnd;
  }

  return entries;
}

/**
 * 将 ZIP 条目转化为 ImportCandidate
 */
export function zipEntryToCandidate(
  parentCandidateId: string,
  entry: ZipEntry,
): ImportCandidate {
  let cached: ArrayBuffer | null = null;
  return {
    id: `${parentCandidateId}!${entry.filename}`,
    name: entry.filename,
    size: entry.uncompressedSize,
    async read(start?: number, end?: number): Promise<ArrayBuffer> {
      if (!cached) {
        cached = await entry.read();
      }
      if (start === undefined && end === undefined) {
        return cached;
      }
      return cached.slice(start ?? 0, end ?? cached.byteLength);
    },
  };
}
