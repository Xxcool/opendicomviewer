import type { ImportCandidate } from '@opendicomviewer/core';

/** 宿主只提供候选文件；解析和渲染继续走原有端口，不向 core 泄漏原生 API。 */
export interface HostFilePicker {
  pick(mode: 'files' | 'folder'): Promise<readonly ImportCandidate[]>;
  subscribe(onFiles: (files: readonly ImportCandidate[]) => void, onError: (message: string) => void): Promise<() => void>;
}
