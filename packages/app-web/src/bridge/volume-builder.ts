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
    volumeId: `odv:volume:${handle.meta.seriesInstanceUid}`,
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
  let settle: ((response: VolumeWorkerResponse) => void) | null = null;
  const responsePromise = new Promise<VolumeWorkerResponse>((resolve) => {
    settle = resolve;
  });

  worker.onMessage((response) => {
    if (response.type === 'progress') {
      options.onProgress?.({
        processedSlices: response.processedSlices,
        totalSlices: response.expectedSlices,
      });
      return;
    }
    settle?.(response);
  });
  worker.onError((message) => {
    settle?.({ type: 'error', id: requestId, message: `体积构建 Worker 异常：${message}` });
  });

  try {
    worker.postMessage({ type: 'start', id: requestId, plan, window });

    for (let start = 0; start < plan.usedSourceSlices; start += slicesPerChunk) {
      const end = Math.min(start + slicesPerChunk, plan.usedSourceSlices);
      const frames: PixelFrame[] = [];
      for (let i = start; i < end; i++) {
        if (options.signal?.aborted) {
          worker.postMessage({ type: 'abort', id: requestId });
          return { status: 'aborted' };
        }
        frames.push(await handle.pixel(i));
      }
      worker.postMessage({ type: 'chunk', id: requestId, startSlice: start, frames });
    }

    worker.postMessage({ type: 'finish', id: requestId });
    const response = await responsePromise;

    if (response.type === 'error') {
      throw new Error(response.message);
    }
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

  // 同步回退：逐层取帧后一次性采样，逻辑与 Worker 路径完全一致
  const frames: PixelFrame[] = [];
  for (let i = 0; i < plan.usedSourceSlices; i++) {
    if (options.signal?.aborted) {
      return { status: 'aborted' };
    }
    frames.push(await handle.pixel(i));
    options.onProgress?.({ processedSlices: i + 1, totalSlices: plan.usedSourceSlices });
  }

  const startedAt = performance.now();
  const sampler = new VolumeSampler(plan, window);
  for (const frame of frames) {
    sampler.addSlice(frame);
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
