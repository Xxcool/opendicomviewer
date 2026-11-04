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

export async function fetchSampleManifest(signal?: AbortSignal): Promise<SampleManifest> {
  const res = await fetch(MANIFEST_URL, { signal });
  if (!res.ok) {
    throw new Error(
      `无法读取示例清单（HTTP ${res.status}）。请确认仓库根目录存在 sample-dicom/`,
    );
  }
  return (await res.json()) as SampleManifest;
}

async function loadOne(datasetId: string, fileName: string, signal?: AbortSignal): Promise<ImportCandidate> {
  const url = `./samples/${encodeURIComponent(datasetId)}/${encodeURIComponent(fileName)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`加载示例切片失败：${datasetId}/${fileName}（HTTP ${res.status}）`);
  }
  const buffer = await res.arrayBuffer();
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

  const total = picked.reduce((sum, dataset) => sum + dataset.files.length, 0);
  let completed = 0;
  onProgress?.(0, total);
  const groups = await Promise.all(
    picked.map((dataset) =>
      Promise.all(dataset.files.map(async (file) => {
        const candidate = await loadOne(dataset.id, file, signal);
        signal?.throwIfAborted();
        onProgress?.(++completed, total);
        return candidate;
      })),
    ),
  );

  return groups.flat();
}
