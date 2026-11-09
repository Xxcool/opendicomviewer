import type { ImportCandidate } from '@opendicomviewer/core';

/** 候选读取函数留在 WebView；宿主 IPC 仅传授权 ID 或一次性 Blob URL。 */
export type HostOriginalSaver = (files: readonly ImportCandidate[], signal?: AbortSignal) => Promise<'saved' | 'cancelled'>;
