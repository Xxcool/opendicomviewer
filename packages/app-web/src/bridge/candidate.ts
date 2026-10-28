/**
 * 浏览器 File 对象向 core ImportCandidate 转换适配器
 *
 * 遵循 R6：核心包与适配器层均不直接碰 DOM/File，
 * 由 app-web 负责将浏览器 File 包装为 ImportCandidate 接口。
 */

import type { ImportCandidate } from '@opendicomviewer/core';

export function fileToImportCandidate(file: File): ImportCandidate {
  const relativePath = file.webkitRelativePath || file.name;
  return {
    id: relativePath,
    name: file.name,
    size: file.size,
    async read(
      start?: number,
      end?: number,
      signal?: AbortSignal,
    ): Promise<ArrayBuffer> {
      if (signal?.aborted) {
        throw new DOMException('读取已中断', 'AbortError');
      }

      if (start !== undefined || end !== undefined) {
        const slice = file.slice(start ?? 0, end ?? file.size);
        return slice.arrayBuffer();
      }

      return file.arrayBuffer();
    },
  };
}
