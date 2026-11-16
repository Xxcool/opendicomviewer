/**
 * 示例 DICOM 载入器
 *
 * 数据源：仓库根目录 `sample-dicom/`，由 vite.config.ts 的 `odv-sample-dicom` 插件
 * 在 dev/preview 下以 `/samples/*` 提供、build 时复制到 `dist/samples/`。
 *
 * 关键点：**文件名从清单读，不拼字符串**。
 * 真实数据集命名不规律（brain-mr 是 000018.dcm），早期实现按 `0000NN.dcm` 拼路径
 * 会 404 —— 这也是示例必须走 manifest 的原因。
 *
 * 隐私：样本包括公开平均头部模板与测试数据集（`Dummy` / `MISTER^CT`），
 * 不含真实患者信息。**禁止把真实临床数据放进 sample-dicom/ 并提交**。
 */

import type { ImportCandidate } from '@opendicomviewer/core';

export interface SampleDataset {
  readonly id: string;
  readonly modality: string;
  readonly files: readonly string[];
}

export interface SampleManifest {
  readonly datasets: readonly SampleDataset[];
}

const MANIFEST_URL = './samples/manifest.json';

const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 20_000;

async function readSample(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
    let retryable = true;
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new Error(`${url}（HTTP ${response.status}）`);
      }
      const bytes = await response.arrayBuffer();
      request.signal.throwIfAborted();
      return bytes;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= 1 || !retryable) {
        if (request.signal.aborted) throw new Error(`读取 ${url} 超时，请重新载入示例`, { cause: error });
        throw error;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      request.abort();
    }
  }
}

export async function fetchSampleManifest(signal?: AbortSignal): Promise<SampleManifest> {
  const bytes = await readSample(MANIFEST_URL, signal);
  return JSON.parse(new TextDecoder().decode(bytes)) as SampleManifest;
}

async function loadOne(datasetId: string, fileName: string, signal: AbortSignal): Promise<ImportCandidate> {
  const url = `./samples/${encodeURIComponent(datasetId)}/${encodeURIComponent(fileName)}`;
  const buffer = await readSample(url, signal);
  return {
    // id 保留目录前缀，便于失败时定位是哪份数据
    id: `${datasetId}/${fileName}`,
    name: fileName,
    size: buffer.byteLength,
    read: async (start?: number, end?: number): Promise<ArrayBuffer> =>
      start !== undefined || end !== undefined
        ? buffer.slice(start ?? 0, end ?? buffer.byteLength)
        : buffer,
  };
}

/**
 * 载入指定数据集（不传则载入全部）。
 *
 * 传 undefined 时会同时载入平均头部模板、原 MR 序列与 CT —— 这是演示"跨序列切换"的必要条件：
 * 单数据集只有一条序列，左栏只有一个可点项，等于没法验证切换。
 */
export async function loadSampleCandidates(datasetId?: string, signal?: AbortSignal, onProgress?: (completed: number, total: number) => void): Promise<ImportCandidate[]> {
  const manifest = await fetchSampleManifest(signal);
  if (manifest.datasets.length === 0) {
    throw new Error('sample-dicom/ 为空：请放入至少一个含 .dcm 的子目录');
  }

  const picked = datasetId
    ? manifest.datasets.filter((d) => d.id === datasetId)
    : manifest.datasets;

  if (picked.length === 0) {
    throw new Error(
      `未找到数据集 "${datasetId}"，可用：${manifest.datasets.map((d) => d.id).join(', ')}`,
    );
  }

  const files = picked.flatMap(dataset => dataset.files.map(name => ({ id: dataset.id, name })));
  const results = new Array<ImportCandidate>(files.length);
  const batch = new AbortController();
  const cancel = () => batch.abort();
  signal?.throwIfAborted();
  signal?.addEventListener('abort', cancel, { once: true });
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < files.length) {
      batch.signal.throwIfAborted();
      const index = next++;
      const file = files[index]!;
      results[index] = await loadOne(file.id, file.name, batch.signal);
      batch.signal.throwIfAborted();
      onProgress?.(++completed, files.length);
    }
  }
  try {
    onProgress?.(0, files.length);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    return results;
  } finally {
    cancel();
    signal?.removeEventListener('abort', cancel);
  }
}
