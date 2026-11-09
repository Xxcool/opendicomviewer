import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPngSaver, isPngSaving, type PngResult, type PngSaveHost } from '../src/png-saver';

const png = () => new Blob([new Uint8Array(64)], { type: 'image/png' });
function harness() {
  let receive: (result: PngResult) => void = () => undefined;
  let id = '';
  const stop = vi.fn();
  const host: PngSaveHost = {
    prepare: vi.fn<PngSaveHost['prepare']>(async request => { id = request; return 'ready'; }),
    cancel: vi.fn(async () => undefined),
    subscribe: vi.fn(async listener => { receive = listener; return stop; }),
    download: vi.fn(() => receive({ id, status: 'saved' })),
  };
  return { host, stop, receive: (result: Omit<PngResult, 'id'>, foreign = false) => receive({ ...result, id: foreign ? 'other' : id }) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('原生 PNG 下载桥', () => {
  it('订阅完成事件后才下载，实际 success 才报告 saved，撤销一次性授权', async () => {
    const { host, stop } = harness();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const result = await createPngSaver(host)(png());
    expect(result).toBe('saved');
    expect(host.subscribe).toHaveBeenCalledOnce();
    expect(host.prepare).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^blob:/), 64);
    expect(host.download).toHaveBeenCalledOnce();
    expect(host.cancel).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce(); expect(isPngSaving()).toBe(false);
  });
  it('取消原生保存对话框不会触发下载或报告保存成功', async () => {
    const { host, stop } = harness(); host.prepare = vi.fn<PngSaveHost['prepare']>(async () => 'cancelled');
    expect(await createPngSaver(host)(png())).toBe('cancelled');
    expect(host.download).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
  });
  it('失败事件保留真实错误，释放 listener/URL/宿主授权', async () => {
    const h = harness(); h.host.download = vi.fn(() => h.receive({ status: 'failed', error: '磁盘不足' }));
    await expect(createPngSaver(h.host)(png())).rejects.toThrow('磁盘不足');
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(h.stop).toHaveBeenCalledOnce();
    expect(isPngSaving()).toBe(false);
  });
  it('忽略其他请求事件；超时真实报错并取消宿主任务', async () => {
    vi.useFakeTimers(); const h = harness();
    h.host.download = vi.fn(() => h.receive({ status: 'saved' }, true));
    const result = createPngSaver(h.host)(png());
    const failure = expect(result).rejects.toThrow('未收到 PNG 保存完成结果');
    await vi.advanceTimersByTimeAsync(60_000); await failure;
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(isPngSaving()).toBe(false);
  });
  it('进行中拒绝重复保存，abort 后清理且不再等待完成事件', async () => {
    const h = harness(); h.host.download = vi.fn(); const controller = new AbortController();
    const save = createPngSaver(h.host); const result = save(png(), controller.signal);
    await vi.waitFor(() => expect(h.host.download).toHaveBeenCalledOnce());
    await expect(save(png())).rejects.toThrow('已有 PNG 正在保存');
    controller.abort(); expect(await result).toBe('cancelled');
    expect(h.host.cancel).toHaveBeenCalledOnce(); expect(isPngSaving()).toBe(false);
  });
  it('只接受限定 PNG Blob，不通过宿主调用传递图像内容', async () => {
    const h = harness();
    await expect(createPngSaver(h.host)(new Blob(['bad'], { type: 'application/dicom' }))).rejects.toThrow('PNG 大小或格式无效');
    expect(h.host.prepare).not.toHaveBeenCalled();
  });
});
