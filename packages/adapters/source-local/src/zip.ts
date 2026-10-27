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
          return decompressDeflate(rawEntryData);
        }
        throw new Error(`不支持的 ZIP 压缩方式: ${compressionMethod}`);
      },
    });

    offset = dataEnd;
  }

  return entries;
}

/**
 * 辅助解压 Deflate 数据流
 */
async function decompressDeflate(rawEntryData: Uint8Array): Promise<ArrayBuffer> {
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

/**
 * 基于中央目录（Central Directory）按需分段读取 ZIP 条目（P1-9）
 *
 * 严格遵循 ARCHITECTURE §7.5：不将整个大 ZIP 文件全量读入内存。
 * 1. 优先读取尾部 EOCD 记录定位 Central Directory；
 * 2. 仅抓取中央目录索引段解析各文件元信息与偏移；
 * 3. 仅在调用单个条目的 read() 时才按需拉取对应 byte range 并解压。
 */
export async function extractZipEntriesFromCandidate(
  candidate: ImportCandidate,
  signal?: AbortSignal,
): Promise<ZipEntry[]> {
  const fileSize = candidate.size;
  // 若文件大小已知且有效，优先通过 EOCD 分段抓取 Central Directory
  if (fileSize >= 22) {
    const searchLen = Math.min(fileSize, 65557);
    const searchStart = fileSize - searchLen;
    const tailBuffer = await candidate.read(searchStart, fileSize, signal);
    const tailBytes = new Uint8Array(tailBuffer);
    const tailView = new DataView(tailBuffer);

    let eocdRelOffset = -1;
    for (let i = tailBytes.length - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === 0x06054b50) {
        eocdRelOffset = i;
        break;
      }
    }

    if (eocdRelOffset >= 0) {
      const cdSize = tailView.getUint32(eocdRelOffset + 12, true);
      const cdOffset = tailView.getUint32(eocdRelOffset + 16, true);

      // 仅读取中央目录范围（通常仅数 KB），绝不全量读取整个压缩包
      const cdBuffer = await candidate.read(cdOffset, cdOffset + cdSize, signal);
      const cdView = new DataView(cdBuffer);
      const cdBytes = new Uint8Array(cdBuffer);
      const entries: ZipEntry[] = [];
      let offset = 0;

      while (offset + 46 <= cdSize) {
        if (cdView.getUint32(offset, true) !== 0x02014b50) break;

        const compressionMethod = cdView.getUint16(offset + 10, true);
        const compressedSize = cdView.getUint32(offset + 20, true);
        const uncompressedSize = cdView.getUint32(offset + 24, true);
        const nameLength = cdView.getUint16(offset + 28, true);
        const extraLength = cdView.getUint16(offset + 30, true);
        const commentLength = cdView.getUint16(offset + 32, true);
        const localHeaderOffset = cdView.getUint32(offset + 42, true);

        const filenameBytes = cdBytes.slice(offset + 46, offset + 46 + nameLength);
        const filename = new TextDecoder().decode(filenameBytes);
        const isDirectory = filename.endsWith('/');

        entries.push({
          filename,
          uncompressedSize,
          isDirectory,
          async read(): Promise<ArrayBuffer> {
            if (compressedSize === 0) return new ArrayBuffer(0);
            // 按需仅读取单个条目范围（头部 30 字节解析 extra 长度 + 压缩数据）
            const headerBuf = await candidate.read(
              localHeaderOffset,
              localHeaderOffset + 30,
            );
            const hView = new DataView(headerBuf);
            const localNameLen = hView.getUint16(26, true);
            const localExtraLen = hView.getUint16(28, true);
            const dataStart =
              localHeaderOffset + 30 + localNameLen + localExtraLen;
            const rawCompressed = await candidate.read(
              dataStart,
              dataStart + compressedSize,
            );
            const rawBytes = new Uint8Array(rawCompressed);

            if (compressionMethod === 0) {
              return rawCompressed;
            } else if (compressionMethod === 8) {
              return decompressDeflate(rawBytes);
            }
            throw new Error(`不支持的 ZIP 压缩方式: ${compressionMethod}`);
          },
        });

        offset += 46 + nameLength + extraLength + commentLength;
      }

      return entries;
    }
  }

  // 兜底回退：若无标准 EOCD 结构，读取完整缓冲区走顺序扫描
  const fullBuffer = await candidate.read(undefined, undefined, signal);
  return extractZipEntries(fullBuffer);
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
