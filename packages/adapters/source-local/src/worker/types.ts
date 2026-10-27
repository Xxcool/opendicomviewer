import type { ImagePlane, Modality } from '@opendicomviewer/core';

export interface WorkerParseRequest {
  readonly id: string;
  readonly buffer: ArrayBuffer;
  readonly candidateInfo: {
    readonly id: string;
    readonly name: string;
    readonly size: number;
  };
}

export interface ParsedWorkerResult {
  readonly plane: ImagePlane;
  readonly studyUid: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly studyDate?: string;
  readonly studyDescription: string;
  readonly seriesUid: string;
  readonly seriesNumber?: number;
  readonly seriesDescription: string;
  readonly modality: Modality;
}

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
