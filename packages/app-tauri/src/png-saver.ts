import type { HostPngSaver } from '../../app-web/src/bridge/host-png-saver';

export interface PngResult { id: string; status: 'saved' | 'failed' | 'cancelled'; error?: string }
export interface PngSaveHost {
  prepare(id: string, url: string, size: number): Promise<'ready' | 'cancelled'>;
  cancel(id: string): Promise<void>;
  subscribe(receive: (result: PngResult) => void): Promise<() => void>;
  download(url: string): void;
}
let saving = false;
export const isPngSaving = () => saving;

export function createPngSaver(host: PngSaveHost): HostPngSaver {
  return async (blob, signal) => {
    if (saving) throw new Error('已有 PNG 正在保存，请稍后重试');
    if (signal?.aborted) return 'cancelled';
    if (blob.type !== 'image/png' || blob.size < 45 || blob.size > 100 * 1024 * 1024) throw new Error('PNG 大小或格式无效（上限 100 MiB）');
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
        else rejectResult(new Error(payload.error || 'PNG 保存失败，请重试'));
      });
      abort = () => { resolveResult('cancelled'); };
      signal?.addEventListener('abort', abort, { once: true });
      const prepared = await host.prepare(id, url, blob.size);
      if (prepared === 'cancelled' || signal?.aborted) return 'cancelled';
      timer = setTimeout(() => rejectResult(new Error('未收到 PNG 保存完成结果，请检查保存目录后重试')), 60_000);
      host.download(url);
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
