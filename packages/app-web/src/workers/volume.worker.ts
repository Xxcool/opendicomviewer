/**
 * 降采样体积构建 Worker（P1 数据通路）
 *
 * 职责：接收按层分块的原始帧，增量块平均后产出 8-bit 体素缓冲。
 * 遵循 ARCHITECTURE §5.2：降采样在 Worker 内完成，主线程不参与逐体素运算。
 *
 * 注意：输入帧**不转移所有权**。`SeriesHandle.pixel()` 的结果由主线程 LRU 缓存，
 * 转移会 detach 掉 buffer，导致 Stack 通路后续渲染读到空数据。
 * 只有输出的 scalarData 是 Worker 新建的，才以 Transferable 回传。
 */

import { VolumeSampler } from '@opendicomviewer/core';
import type {
  VolumeWorkerRequest,
  VolumeWorkerResponse,
} from '../bridge/volume-types';

interface VolumeJob {
  readonly sampler: VolumeSampler;
  readonly startedAt: number;
  nextSlice: number;
}

const jobs = new Map<number, VolumeJob>();

function reply(response: VolumeWorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    self.postMessage(response, { transfer });
  } else {
    self.postMessage(response);
  }
}

function fail(id: number, err: unknown): void {
  jobs.delete(id);
  reply({
    type: 'error',
    id,
    message: err instanceof Error ? err.message : String(err),
  });
}

self.onmessage = (event: MessageEvent<VolumeWorkerRequest>): void => {
  const request = event.data;
  const { id } = request;

  try {
    switch (request.type) {
      case 'start': {
        jobs.set(id, {
          sampler: new VolumeSampler(request.plan, request.window),
          startedAt: performance.now(),
          nextSlice: 0,
        });
        return;
      }

      case 'chunk': {
        const job = jobs.get(id);
        if (!job) {
          throw new Error('体积构建任务不存在或已终止');
        }
        if (request.startSlice !== job.nextSlice) {
          throw new Error(
            `体积构建收到乱序切片块：期望从第 ${job.nextSlice} 层开始，实际第 ${request.startSlice} 层`,
          );
        }
        for (const frame of request.frames) {
          job.sampler.addSlice(frame);
        }
        job.nextSlice += request.frames.length;
        reply({
          type: 'progress',
          id,
          processedSlices: job.sampler.processedSlices,
          expectedSlices: job.sampler.expectedSlices,
        });
        return;
      }

      case 'finish': {
        const job = jobs.get(id);
        if (!job) {
          throw new Error('体积构建任务不存在或已终止');
        }
        jobs.delete(id);
        const scalarData = job.sampler.finish();
        reply(
          {
            type: 'done',
            id,
            scalarData,
            elapsedMs: performance.now() - job.startedAt,
          },
          [scalarData.buffer],
        );
        return;
      }

      case 'abort': {
        jobs.delete(id);
        return;
      }
    }
  } catch (err) {
    fail(id, err);
  }
};
