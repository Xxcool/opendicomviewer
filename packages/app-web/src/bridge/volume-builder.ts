/**
 * 降采样体积构建调度器（P1 数据通路）
 *
 * 从 `SeriesHandle.pixel()` 逐层取原始帧，按块送进 Worker 做块平均降采样，
 * 产出仅用于显示与定位的 8-bit `VolumeHandle`（ARCHITECTURE §5.2）。
 *
 * 设计要点：
 * 1. **分块而非全量**：512×512×1000 的原始像素约 512 MB，整批克隆会击穿内存预算；
 * 2. **输入不转移所有权**：帧可能被主线程 LRU 复用，只有输出缓冲以 Transferable 回传；
 * 3. **无 Worker 运行时（Node/受限环境）同步回退**：结果完全一致，只影响速度（R7 只要求可感知，不要求拒绝）。
 */

import {
  seriesViewKey,
  planVolumeDownsample,
  resolveVolumeWindow,
  VolumeSampler,
  type PixelFrame,
  type SeriesHandle,
  type VolumeDownsamplePlan,
  type VolumeHandle,
  type VolumeRejectCode,
  type VolumeWindow,
} from '@opendicomviewer/core';
import type {
  VolumeWorkerRequest,
  VolumeWorkerResponse,
} from './volume-types';

export interface VolumeBuildProgress {
  readonly processedSlices: number;
  readonly totalSlices: number;
}

export interface VolumeWorkerLike {
  postMessage(message: VolumeWorkerRequest, transfer?: Transferable[]): void;
  onMessage(handler: (response: VolumeWorkerResponse) => void): void;
  onError(handler: (message: string) => void): void;
  terminate(): void;
}

export interface VolumeBuildOptions {
  /** 取消信号：命中后向 Worker 发送 abort 并返回 `aborted` */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: VolumeBuildProgress) => void;
  /** 单轴体素上限，默认走 core 的 256 */
  readonly maxDim?: number;
  /** 每次送进 Worker 的源切片数，默认 16 */
  readonly slicesPerChunk?: number;
  /**
   * Worker 工厂。传 `null` 强制同步构建；不传则自动探测运行时。
   * 测试通过注入 fake 工厂覆盖 Worker 调度分支。
   */
  readonly createWorker?: (() => VolumeWorkerLike) | null;
}

export type VolumeBuildOutcome =
  | {
      readonly status: 'ok';
      readonly volume: VolumeHandle;
      readonly plan: VolumeDownsamplePlan;
      readonly window: VolumeWindow;
      readonly elapsedMs: number;
    }
  | {
      readonly status: 'rejected';
      readonly code: VolumeRejectCode;
      readonly message: string;
    }
  | { readonly status: 'aborted' };

const DEFAULT_SLICES_PER_CHUNK = 16;

function adaptBrowserWorker(worker: Worker): VolumeWorkerLike {
  return {
    postMessage: (message, transfer) => {
      if (transfer) {
        worker.postMessage(message, { transfer });
      } else {
        worker.postMessage(message);
      }
    },
    onMessage: (handler) => {
      worker.addEventListener('message', (event: MessageEvent<VolumeWorkerResponse>) => {
        handler(event.data);
      });
    },
    onError: (handler) => {
      worker.addEventListener('error', (event) => {
        handler(event.message || '未知 Worker 错误');
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}

function createDefaultWorker(): VolumeWorkerLike {
  return adaptBrowserWorker(
    new Worker(new URL('../workers/volume.worker.ts', import.meta.url), {
      type: 'module',
    }),
  );
}

function makeVolume(
  handle: SeriesHandle,
  plan: VolumeDownsamplePlan,
  scalarData: Uint8Array,
): VolumeHandle {
  return {
    volumeId: `odv:volume:${seriesViewKey(handle.meta)}`,
    seriesInstanceUid: handle.meta.seriesInstanceUid,
    dimensions: plan.dimensions,
    spacing: plan.spacing,
    origin: plan.origin,
    direction: plan.direction,
    scalarData,
    displayOnly: true,
  };
}

function logBuilt(
  plan: VolumeDownsamplePlan,
  elapsedMs: number,
  mode: 'worker' | 'sync',
): void {
  const [sx, sy, sz] = plan.sourceDimensions;
  const [dx, dy, dz] = plan.dimensions;
  const [px, py, pz] = plan.spacing;
  console.info(
    `[volume] ${sx}×${sy}×${sz} → ${dx}×${dy}×${dz}，` +
      `spacing ${px.toFixed(2)}×${py.toFixed(2)}×${pz.toFixed(2)} mm，` +
      `8-bit ${(plan.byteLength / 1048576).toFixed(1)} MB，` +
      `${elapsedMs.toFixed(0)} ms（${mode === 'worker' ? 'Worker' : '主线程'}）`,
  );
}

async function buildInWorker(
  handle: SeriesHandle,
  plan: VolumeDownsamplePlan,
  window: VolumeWindow,
  options: VolumeBuildOptions,
  workerFactory: () => VolumeWorkerLike,
): Promise<VolumeBuildOutcome> {
  const requestId = 1;
  const slicesPerChunk = Math.max(1, options.slicesPerChunk ?? DEFAULT_SLICES_PER_CHUNK);
  const startedAt = performance.now();

  const worker = workerFactory();
  type Reply = VolumeWorkerResponse | { type: 'aborted' };
  let deliver: ((response: Reply) => void) | null = null;
  let terminal: Reply | null = null;
  const receive = (response: Reply) => {
    if (response.type === 'error' || response.type === 'aborted') terminal = response;
    deliver?.(response);
    deliver = null;
  };
  worker.onMessage(receive);
  worker.onError(message => receive({ type: 'error', id: requestId, message: `体积构建 Worker 异常：${message}` }));
  const abort = () => receive({ type: 'aborted' });
  options.signal?.addEventListener('abort', abort, { once: true });

  async function send(request: VolumeWorkerRequest): Promise<Reply> {
    const reply = terminal ?? await new Promise<Reply>(resolve => {
      deliver = resolve;
      worker.postMessage(request);
    });
    if (reply.type === 'error') throw new Error(reply.message);
    return reply;
  }

  try {
    worker.postMessage({ type: 'start', id: requestId, plan, window });

    // 每个分块处理完才读下一块，避免快速像素源将整套原始影像积压在 Worker 队列。
    for (let start = 0; start < plan.usedSourceSlices; start += slicesPerChunk) {
      const end = Math.min(start + slicesPerChunk, plan.usedSourceSlices);
      const frames: PixelFrame[] = [];
      for (let i = start; i < end; i++) {
        if (options.signal?.aborted) return { status: 'aborted' };
        frames.push(await handle.pixel(i));
      }
      const reply = await send({ type: 'chunk', id: requestId, startSlice: start, frames });
      if (reply.type === 'aborted') return { status: 'aborted' };
      if (reply.type !== 'progress' || reply.processedSlices !== end) throw new Error('体积构建 Worker 未确认当前切片块');
      options.onProgress?.({ processedSlices: end, totalSlices: reply.expectedSlices });
    }

    const response = await send({ type: 'finish', id: requestId });
    if (response.type === 'aborted') return { status: 'aborted' };
    if (response.type !== 'done') {
      throw new Error('体积构建 Worker 未返回结果');
    }

    const elapsedMs = performance.now() - startedAt;
    logBuilt(plan, elapsedMs, 'worker');
    return {
      status: 'ok',
      volume: makeVolume(handle, plan, response.scalarData),
      plan,
      window,
      elapsedMs,
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    worker.terminate();
  }
}

/**
 * 由序列构建降采样体积。
 *
 * 预期内的失败（几何不合格、已取消）通过返回值表达；Worker 崩溃等
 * 非预期错误直接抛出，由调用方的错误边界承接（R7 禁止静默吞掉）。
 */
export async function buildVolumeFromSeries(
  handle: SeriesHandle,
  options: VolumeBuildOptions = {},
): Promise<VolumeBuildOutcome> {
  const planned = planVolumeDownsample(handle.meta, { maxDim: options.maxDim });
  if (!planned.ok) {
    return { status: 'rejected', code: planned.code, message: planned.message };
  }

  const { plan } = planned;
  const window = resolveVolumeWindow(handle.meta);

  if (options.signal?.aborted) {
    return { status: 'aborted' };
  }

  let workerFactory: (() => VolumeWorkerLike) | null;
  if (options.createWorker === null) {
    workerFactory = null;
  } else if (options.createWorker) {
    workerFactory = options.createWorker;
  } else {
    workerFactory = typeof Worker !== 'undefined' ? createDefaultWorker : null;
  }

  if (workerFactory) {
    return buildInWorker(handle, plan, window, options, workerFactory);
  }

  const startedAt = performance.now();
  const sampler = new VolumeSampler(plan, window);
  for (let i = 0; i < plan.usedSourceSlices; i++) {
    if (options.signal?.aborted) {
      return { status: 'aborted' };
    }
    sampler.addSlice(await handle.pixel(i));
    options.onProgress?.({ processedSlices: i + 1, totalSlices: plan.usedSourceSlices });
  }

  const scalarData = sampler.finish();
  const elapsedMs = performance.now() - startedAt;

  logBuilt(plan, elapsedMs, 'sync');
  return {
    status: 'ok',
    volume: makeVolume(handle, plan, scalarData),
    plan,
    window,
    elapsedMs,
  };
}
