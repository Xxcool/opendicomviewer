import { VolumeSampler } from '@opendicomviewer/core';
import type { ImagePlane, PixelFrame, SeriesHandle, SeriesMeta } from '@opendicomviewer/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVolumeFromSeries } from '../src/bridge/volume-builder';
import type { VolumeWorkerLike } from '../src/bridge/volume-builder';
import type {
  VolumeWorkerRequest,
  VolumeWorkerResponse,
} from '../src/bridge/volume-types';

interface FakeWorker extends VolumeWorkerLike {
  readonly sent: VolumeWorkerRequest[];
  isTerminated(): boolean;
}

/** 在 Node 内模拟 Worker：协议与 volume.worker.ts 一致，便于单测调度分支 */
function createFakeWorker(): FakeWorker {
  const sent: VolumeWorkerRequest[] = [];
  let handler: ((response: VolumeWorkerResponse) => void) | null = null;
  let errorHandler: ((message: string) => void) | null = null;
  let sampler: VolumeSampler | null = null;
  let nextSlice = 0;
  let terminated = false;

  const emit = (response: VolumeWorkerResponse): void => {
    handler?.(response);
  };

  const handle = (message: VolumeWorkerRequest): void => {
    if (message.type === 'start') {
      sampler = new VolumeSampler(message.plan, message.window);
      nextSlice = 0;
      return;
    }
    if (message.type === 'chunk') {
      if (!sampler) throw new Error('任务未启动');
      if (message.startSlice !== nextSlice) {
        errorHandler?.(`乱序切片块：${message.startSlice} ≠ ${nextSlice}`);
        return;
      }
      for (const frame of message.frames) sampler.addSlice(frame);
      nextSlice += message.frames.length;
      emit({
        type: 'progress',
        id: message.id,
        processedSlices: sampler.processedSlices,
        expectedSlices: sampler.expectedSlices,
      });
      return;
    }
    if (message.type === 'finish') {
      if (!sampler) throw new Error('任务未启动');
      const scalarData = sampler.finish();
      emit({ type: 'done', id: message.id, scalarData, elapsedMs: 1 });
      return;
    }
  };

  return {
    sent,
    postMessage: (message) => {
      sent.push(message);
      handle(message);
    },
    onMessage: (h) => {
      handler = h;
    },
    onError: (h) => {
      errorHandler = h;
    },
    terminate: () => {
      terminated = true;
    },
    isTerminated: () => terminated,
  };
}

function createMeta(slices: number): SeriesMeta {
  const planes: ImagePlane[] = Array.from({ length: slices }, (_, i) => ({
    imageId: `slice-${i}`,
    sopInstanceUid: `1.2.3.${i}`,
    imagePositionPatient: [0, 0, i],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    pixelSpacing: [1, 1],
    sliceThickness: 1,
    spacingBetweenSlices: 1,
    rows: 4,
    columns: 4,
  }));

  return {
    seriesInstanceUid: '1.2.3.4',
    studyInstanceUid: '1.2.3',
    seriesDescription: 'test',
    modality: 'CT',
    numberOfFrames: slices,
    planes,
    spacing: [1, 1, 1],
    warnings: [],
  };
}

function createHandle(slices: number): { handle: SeriesHandle; calls: number[] } {
  const meta = createMeta(slices);
  const calls: number[] = [];
  const handle: SeriesHandle = {
    meta,
    warnings: [],
    pixel: async (layerIndex: number): Promise<PixelFrame> => {
      calls.push(layerIndex);
      const values = new Uint8Array(16);
      for (let i = 0; i < values.length; i++) {
        values[i] = (layerIndex * 16 + i) % 256;
      }
      return {
        width: 4,
        height: 4,
        pixelData: values,
        rescaleSlope: 1,
        rescaleIntercept: 0,
      };
    },
    dispose: () => {},
  };
  return { handle, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildVolumeFromSeries', () => {
  it('缺层在读取像素或创建 Worker 前拒绝，避免生成压缩空间的体积', async () => {
    const { handle, calls } = createHandle(4);
    const planes = handle.meta.planes.map((plane, i): ImagePlane => ({
      ...plane,
      imagePositionPatient: [0, 0, i < 2 ? i : i + 1],
    }));
    const createWorker = vi.fn(() => createFakeWorker());
    const outcome = await buildVolumeFromSeries({
      ...handle, meta: { ...handle.meta, planes },
    }, { createWorker });
    expect(outcome.status).toBe('rejected');
    expect(calls).toHaveLength(0);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('层数不足时直接拒绝，不触发任何像素读取', async () => {
    const { handle, calls } = createHandle(2);
    const outcome = await buildVolumeFromSeries(handle, { createWorker: null });

    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.code).toBe('INSUFFICIENT_SLICES');
    expect(calls).toHaveLength(0);
  });

  it('已取消的信号立即返回 aborted', async () => {
    const { handle, calls } = createHandle(4);
    const controller = new AbortController();
    controller.abort();

    const outcome = await buildVolumeFromSeries(handle, {
      signal: controller.signal,
      createWorker: null,
    });

    expect(outcome.status).toBe('aborted');
    expect(calls).toHaveLength(0);
  });

  it('同步回退路径产出正确几何、8-bit 缓冲与控制台摘要', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { handle, calls } = createHandle(4);

    const outcome = await buildVolumeFromSeries(handle, { createWorker: null, maxDim: 2 });

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;

    expect(outcome.volume.dimensions).toEqual([2, 2, 2]);
    expect(outcome.volume.spacing).toEqual([2, 2, 2]);
    expect(outcome.volume.scalarData.length).toBe(8);
    expect(outcome.volume.seriesInstanceUid).toBe('1.2.3.4');
    expect(outcome.volume.volumeId).toBe('odv:volume:1.2.3.4');
    expect(outcome.volume.displayOnly).toBe(true);
    expect(calls).toEqual([0, 1, 2, 3]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain('4×4×4 → 2×2×2');
    expect(info.mock.calls[0]?.[0]).toContain('8-bit');
  });

  it('Worker 路径按层分块投递，且结果与同步路径逐字节一致', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const sync = await buildVolumeFromSeries(createHandle(6).handle, {
      createWorker: null,
      maxDim: 2,
    });
    expect(sync.status).toBe('ok');
    if (sync.status !== 'ok') return;

    const worker = createFakeWorker();
    const progress: number[] = [];
    const asyncOutcome = await buildVolumeFromSeries(createHandle(6).handle, {
      createWorker: () => worker,
      maxDim: 2,
      slicesPerChunk: 2,
      onProgress: (p) => progress.push(p.processedSlices),
    });

    expect(asyncOutcome.status).toBe('ok');
    if (asyncOutcome.status !== 'ok') return;

    expect(worker.sent.map((m) => m.type)).toEqual([
      'start',
      'chunk',
      'chunk',
      'chunk',
      'finish',
    ]);
    const chunkStarts = worker.sent
      .filter((m) => m.type === 'chunk')
      .map((m) => (m.type === 'chunk' ? m.startSlice : -1));
    expect(chunkStarts).toEqual([0, 2, 4]);
    expect(progress).toEqual([2, 4, 6]);
    expect(worker.isTerminated()).toBe(true);
    expect(Array.from(asyncOutcome.volume.scalarData)).toEqual(
      Array.from(sync.volume.scalarData),
    );
  });
});
