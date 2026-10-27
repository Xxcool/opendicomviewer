/**
 * DICOM 元数据独立 Web Worker 解析通道（P1-1 架构级）
 *
 * 遵循规范：
 * ARCHITECTURE §6.3: DICOM 解析与耗时计算全部在 Worker 中执行，主线程零阻塞。
 * 通过 Transferable 传递 ArrayBuffer，避免结构化克隆拷贝。
 */

import { parseDicomMetadata } from '../scanner';
import type { WorkerParseRequest, WorkerParseResponse } from './types';

// Web Worker 消息接收端
self.onmessage = (e: MessageEvent<WorkerParseRequest>): void => {
  const { id, buffer, candidateInfo } = e.data;
  try {
    const bytes = new Uint8Array(buffer);
    const parsed = parseDicomMetadata(bytes, candidateInfo, {
      untilTag: 'x7fe00010',
    });
    const response: WorkerParseResponse = {
      id,
      success: true,
      result: parsed,
    };
    self.postMessage(response);
  } catch (err) {
    const response: WorkerParseResponse = {
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
