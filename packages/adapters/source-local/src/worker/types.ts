import type { ParsedDicomMeta } from '../parse';

export interface WorkerParseRequest {
  readonly id: string;
  readonly buffer: ArrayBuffer;
  readonly candidateInfo: {
    readonly id: string;
    readonly name: string;
    readonly size: number;
  };
}

/**
 * 解析结果直接复用主线程的 `ParsedDicomMeta`。
 * 原先此处手写了一份等价结构体，两份定义会随字段增减而漂移，已改为类型别名。
 */
export type ParsedWorkerResult = ParsedDicomMeta;

export interface WorkerParseSuccessResponse {
  readonly id: string;
  readonly success: true;
  readonly result: ParsedWorkerResult;
}

export interface WorkerParseErrorResponse {
  readonly id: string;
  readonly success: false;
  readonly error: string;
}

export type WorkerParseResponse =
  | WorkerParseSuccessResponse
  | WorkerParseErrorResponse;
