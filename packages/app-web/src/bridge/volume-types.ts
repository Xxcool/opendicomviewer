/**
 * 体积构建 Worker 的消息契约
 *
 * 与 `workers/volume.worker.ts` 和 `bridge/volume-builder.ts` 共享。
 * 分层原因：把消息类型放在纯类型模块，主线程侧不必导入 Worker 实现。
 */

import type {
  PixelFrame,
  VolumeDownsamplePlan,
  VolumeWindow,
} from '@opendicomviewer/core';

export interface VolumeWorkerStartRequest {
  readonly type: 'start';
  readonly id: number;
  readonly plan: VolumeDownsamplePlan;
  readonly window: VolumeWindow;
}

export interface VolumeWorkerChunkRequest {
  readonly type: 'chunk';
  readonly id: number;
  /** 本批首帧在源序列中的层号，Worker 用它校验是否漏层/乱序 */
  readonly startSlice: number;
  readonly frames: readonly PixelFrame[];
}

export interface VolumeWorkerFinishRequest {
  readonly type: 'finish';
  readonly id: number;
}

export interface VolumeWorkerAbortRequest {
  readonly type: 'abort';
  readonly id: number;
}

export type VolumeWorkerRequest =
  | VolumeWorkerStartRequest
  | VolumeWorkerChunkRequest
  | VolumeWorkerFinishRequest
  | VolumeWorkerAbortRequest;

export interface VolumeWorkerProgressResponse {
  readonly type: 'progress';
  readonly id: number;
  readonly processedSlices: number;
  readonly expectedSlices: number;
}

export interface VolumeWorkerDoneResponse {
  readonly type: 'done';
  readonly id: number;
  /** 8-bit 降采样体素，按 Transferable 回传 */
  readonly scalarData: Uint8Array;
  readonly elapsedMs: number;
}

export interface VolumeWorkerErrorResponse {
  readonly type: 'error';
  readonly id: number;
  readonly message: string;
}

export type VolumeWorkerResponse =
  | VolumeWorkerProgressResponse
  | VolumeWorkerDoneResponse
  | VolumeWorkerErrorResponse;
