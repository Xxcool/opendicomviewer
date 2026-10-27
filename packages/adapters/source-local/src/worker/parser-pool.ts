/**
 * DICOM 解析 Worker 线程池调度器（P1-1）
 *
 * 遵循规范：
 * ARCHITECTURE §6.3:
 * 1. 采用并发 Worker 池调度解析任务；
 * 2. 传递 Transferable ArrayBuffer，零拷贝；
 * 3. 在无 Worker 运行时环境（如 Node.js 自动化单元测试环境）中平滑回退至同进程调度，
 *    确保跨端（Web/Node）测试与运行两全。
 */

import type { ImportCandidate } from '@opendicomviewer/core';
import { parseDicomMetadata } from '../scanner';
import type {
  ParsedWorkerResult,
  WorkerParseRequest,
  WorkerParseResponse,
} from './types';

export class ParserPool {
  private workers: Worker[] = [];
  private readonly maxConcurrency: number;
  private requestIdCounter = 0;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (val: ParsedWorkerResult) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 是否支持原生 Web Worker
   */
  public isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
  }

  /**
   * 分发解析任务：优先投递 Worker 池，Node.js 下自动无缝回退
   */
  public async parse(
    buffer: ArrayBuffer,
    candidate: ImportCandidate,
  ): Promise<ParsedWorkerResult> {
    if (!this.isWorkerSupported()) {
      // Node.js / 非浏览器环境安全同步回退
      const bytes = new Uint8Array(buffer);
      return parseDicomMetadata(bytes, candidate, {
        untilTag: 'x7fe00010',
      });
    }

    // 浏览器生产环境：调度至 Web Worker 并转移所有权
    return new Promise<ParsedWorkerResult>((resolve, reject) => {
      const id = `req-${++this.requestIdCounter}`;
      this.pendingRequests.set(id, { resolve, reject });

      // 懒初始化 Worker
      let worker: Worker;
      if (this.workers.length < this.maxConcurrency) {
        worker = new Worker(new URL('./parser.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (e: MessageEvent<WorkerParseResponse>): void => {
          const resp = e.data;
          const handler = this.pendingRequests.get(resp.id);
          if (handler) {
            this.pendingRequests.delete(resp.id);
            if (resp.success) {
              handler.resolve(resp.result);
            } else {
              handler.reject(new Error(resp.error));
            }
          }
        };
        worker.onerror = (err): void => {
          reject(new Error(`Worker 解析异常: ${err.message}`));
        };
        this.workers.push(worker);
      } else {
        const idx = this.requestIdCounter % this.workers.length;
        worker = this.workers[idx]!;
      }

      const request: WorkerParseRequest = {
        id,
        buffer,
        candidateInfo: {
          id: candidate.id,
          name: candidate.name,
          size: candidate.size,
        },
      };

      // Transferable 转移 ArrayBuffer 所有权，零主线程拷贝开销
      worker.postMessage(request, [buffer]);
    });
  }

  public terminate(): void {
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.pendingRequests.clear();
  }
}

let defaultPool: ParserPool | null = null;

export function getParserPool(): ParserPool {
  if (!defaultPool) {
    const concurrency =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.min(navigator.hardwareConcurrency, 8)
        : 4;
    defaultPool = new ParserPool(concurrency);
  }
  return defaultPool;
}
