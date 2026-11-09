export type ExportFormat = 'png' | 'dicom' | 'zip';

export interface DownloadResult { id: string; status: 'saved' | 'failed' | 'cancelled'; error?: string }
export interface DownloadHost {
  prepare(id: string, url: string, size: number, format: ExportFormat): Promise<'ready' | 'cancelled'>;
  cancel(id: string): Promise<void>;
  subscribe(receive: (result: DownloadResult) => void): Promise<() => void>;
  download(url: string, filename: string): void;
}
let saving = false;
export const isDownloadSaving = () => saving;

export function createBlobSaver(host: DownloadHost) {
  return async (blob: Blob, signal?: AbortSignal): Promise<'saved' | 'cancelled'> => {
    const format = exportFormat(blob);
    if (saving) throw new Error('已有文件正在保存，请稍后重试');
    if (signal?.aborted) return 'cancelled';
    saving = true;
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(blob);
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      let resolveResult: (value: 'saved' | 'cancelled') => void = () => undefined;
      let rejectResult: (error: Error) => void = () => undefined;
      const result = new Promise<'saved' | 'cancelled'>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
      // 先订阅，再发起下载；原生完成事件可能快于按钮事件返回。
      stop = await host.subscribe(payload => {
        if (payload.id !== id) return;
        if (payload.status === 'saved') resolveResult('saved');
        else if (payload.status === 'cancelled') resolveResult('cancelled');
        else rejectResult(new Error(payload.error || '文件保存失败，请重试'));
      });
      abort = () => { resolveResult('cancelled'); };
      signal?.addEventListener('abort', abort, { once: true });
      const prepared = await host.prepare(id, url, blob.size, format);
      if (prepared === 'cancelled' || signal?.aborted) return 'cancelled';
      timer = setTimeout(() => rejectResult(new Error('未收到文件保存完成结果，请检查保存目录后重试')), 60_000);
      host.download(url, format === 'png' ? 'opendicomviewer.png' : format === 'dicom' ? 'original-instance.dcm' : 'original-series.zip');
      return await result;
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      stop?.();
      // 取消/超时和下载结束都撤销一次性授权，迟到回调不得发布文件。
      try { await host.cancel(id); } finally { URL.revokeObjectURL(url); saving = false; }
    }
  };
}

function exportFormat(blob: Blob): ExportFormat {
  if (blob.type === 'image/png' && blob.size >= 45 && blob.size <= 100 * 1024 * 1024) return 'png';
  if (blob.type === 'application/dicom' && blob.size > 0 && blob.size <= 512 * 1024 * 1024) return 'dicom';
  if (blob.type === 'application/zip' && blob.size >= 22 && blob.size <= 512 * 1024 * 1024) return 'zip';
  throw new Error('文件大小或格式无效（PNG 上限 100 MiB，DICOM/ZIP 上限 512 MiB）');
}
