import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlobSaver, isDownloadSaving, type DownloadResult, type DownloadHost } from '../src/download-saver';

const png = () => new Blob([new Uint8Array(64)], { type: 'image/png' });
function harness() {
  let receive: (result: DownloadResult) => void = () => undefined;
  let id = '';
  const stop = vi.fn();
  const host: DownloadHost = {
    prepare: vi.fn<DownloadHost['prepare']>(async request => { id = request; return 'ready'; }),
    cancel: vi.fn(async () => undefined),
    subscribe: vi.fn(async listener => { receive = listener; return stop; }),
    download: vi.fn(() => receive({ id, status: 'saved' })),
  };
  return { host, stop, receive: (result: Omit<DownloadResult, 'id'>, foreign = false) => receive({ ...result, id: foreign ? 'other' : id }) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('原生导出下载桥', () => {
  it.each([
    ['application/dicom', 'dicom', 'original-instance.dcm'],
    ['application/zip', 'zip', 'original-series.zip'],
  ])('routes %s through local Blob download without binary IPC', async (mime, format, filename) => {
    const { host } = harness();
    expect(await createBlobSaver(host)(new Blob([new Uint8Array(64)], { type: mime }))).toBe('saved');
    expect(host.prepare).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^blob:/), 64, format);
    expect(host.download).toHaveBeenCalledWith(expect.stringMatching(/^blob:/), filename);
  });
  it('cancels an archive download and ignores completion after cleanup', async () => {
    const h = harness(); h.host.download = vi.fn();
    const abort = new AbortController();
    const result = createBlobSaver(h.host)(new Blob([new Uint8Array(64)], { type: 'application/zip' }), abort.signal);
    await vi.waitFor(() => expect(h.host.download).toHaveBeenCalledOnce());
    abort.abort(); expect(await result).toBe('cancelled');
    h.receive({ status: 'saved' });
    expect(isDownloadSaving()).toBe(false);
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce();
  });

  it('订阅完成事件后才下载，实际 success 才报告 saved，撤销一次性授权', async () => {
    const { host, stop } = harness();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const result = await createBlobSaver(host)(png());
    expect(result).toBe('saved');
    expect(host.subscribe).toHaveBeenCalledOnce();
    expect(host.prepare).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^blob:/), 64, 'png');
    expect(host.download).toHaveBeenCalledOnce();
    expect(host.cancel).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce(); expect(isDownloadSaving()).toBe(false);
  });
  it('取消原生保存对话框不会触发下载或报告保存成功', async () => {
    const { host, stop } = harness(); host.prepare = vi.fn<DownloadHost['prepare']>(async () => 'cancelled');
    expect(await createBlobSaver(host)(png())).toBe('cancelled');
    expect(host.download).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  });
  it('失败事件保留真实错误，释放 listener/URL/宿主授权', async () => {
    const h = harness(); h.host.download = vi.fn(() => h.receive({ status: 'failed', error: '磁盘不足' }));
    await expect(createBlobSaver(h.host)(png())).rejects.toThrow('磁盘不足');
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce();
    expect(isDownloadSaving()).toBe(false);
  });
  it('忽略其他请求事件；超时真实报错并取消宿主任务', async () => {
    vi.useFakeTimers(); const h = harness();
    h.host.download = vi.fn(() => h.receive({ status: 'saved' }, true));
    const result = createBlobSaver(h.host)(png());
    const failure = expect(result).rejects.toThrow('未收到文件保存完成结果');
    await vi.advanceTimersByTimeAsync(60_000); await failure;
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(isDownloadSaving()).toBe(false);
  });
  it('进行中拒绝重复保存，abort 后清理且不再等待完成事件', async () => {
    const h = harness(); h.host.download = vi.fn(); const controller = new AbortController();
    const save = createBlobSaver(h.host); const result = save(png(), controller.signal);
    await vi.waitFor(() => expect(h.host.download).toHaveBeenCalledOnce());
    await expect(save(png())).rejects.toThrow('已有文件正在保存');
    controller.abort(); expect(await result).toBe('cancelled');
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(isDownloadSaving()).toBe(false);
  });
  it('只接受限定 PNG Blob，不通过宿主调用传递图像内容', async () => {
    const h = harness();
    await expect(createBlobSaver(h.host)(new Blob(['bad'], { type: 'text/html' }))).rejects.toThrow('文件大小或格式无效');
    expect(h.host.prepare).not.toHaveBeenCalled();
  });
});
