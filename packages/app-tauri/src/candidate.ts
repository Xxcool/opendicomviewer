import type { ImportCandidate } from '@opendicomviewer/core';

/** Tauri asset 单次 Range 响应有上限；512 KiB 分块避免大文件被截短。 */
export const READ_CHUNK_BYTES = 512 * 1024;

export interface SelectedFile { readonly id: string; readonly name: string; readonly path: string; readonly size: number }

/** native 像素只走 asset 协议。分段读取必须返回 206，禁止悄悄把整文件拉进内存。 */
export function nativeCandidate(file: SelectedFile, url: string): ImportCandidate {
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('所选文件大小无效');
  return { id: file.id, name: file.name, size: file.size,
    async read(start = 0, end = file.size, signal?: AbortSignal): Promise<ArrayBuffer> {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > file.size) throw new Error('文件分段范围无效');
      if (signal?.aborted) throw new DOMException('读取已中断', 'AbortError');
      if (start === end) return new ArrayBuffer(0);
      const output = new Uint8Array(end - start);
      for (let offset = start; offset < end; offset += READ_CHUNK_BYTES) {
        const rangeEnd = Math.min(offset + READ_CHUNK_BYTES, end);
        const response = await fetch(url, { headers: { Range: `bytes=${offset}-${rangeEnd - 1}` }, signal });
        if (response.status !== 206) throw new Error(`本地协议未按范围返回文件（HTTP ${response.status}）`);
        const expected = `bytes ${offset}-${rangeEnd - 1}/${file.size}`;
        if (response.headers.get('Content-Range') !== expected) throw new Error('本地协议返回的分段信息不一致');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== rangeEnd - offset) throw new Error('本地协议返回的字节数不一致');
        output.set(new Uint8Array(buffer), offset - start);
      }
      return output.buffer;
    },
  };
}
