import { LocalDataSource } from '../../adapters/source-local/src/source-local';
import { buildDicomdirBuffer } from '../../adapters/source-local/testing/dicom-fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SpinnerIcon } from '../src/components/Icons';
import { loadSampleCandidates } from '../src/bridge/sample-loader';
import { scanCandidates } from '../../adapters/source-local/src/scanner';

afterEach(() => vi.unstubAllGlobals());
describe('导入真实进度与取消', () => {
  it('调用方样式不覆盖旋转动画', () => {
    const html = renderToStaticMarkup(createElement(SpinnerIcon, { className: 'w-8 h-8 text-accent' }));
    expect(html).toContain('animate-spin w-8 h-8 text-accent');
  });
  it('示例以实际完成文件数报告，请求可取消', async () => {
    const controller = new AbortController(); const events: number[][] = [];
    const request = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(options?.signal?.aborted).toBe(false);
      return new Response(request.mock.calls.length === 1
        ? JSON.stringify({ datasets: [{ id: 'sample', files: ['one.dcm', 'two.dcm'] }] }) : new Uint8Array([1, 2]));
    });
    vi.stubGlobal('fetch', request);
    const files = await loadSampleCandidates('sample', controller.signal, (n, total) => events.push([n, total]));
    expect(files).toHaveLength(2); expect(events).toEqual([[0, 2], [1, 2], [2, 2]]);
  });
  it('取消后即使读取晚到也不继续报告示例完成', async () => {
    const controller = new AbortController(); const events: number[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return new Response(JSON.stringify({ datasets: [{ id: 'sample', files: ['one.dcm'] }] }));
      controller.abort(); return new Response(new Uint8Array([1]));
    }));
    await expect(loadSampleCandidates('sample', controller.signal, (n, t) => events.push([n, t]))).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([[0, 1]]);
  });
  it('慢切片有并发上限，返回顺序与清单一致', async () => {
    const names = Array.from({ length: 15 }, (_, index) => `${index}.dcm`);
    const releases: (() => void)[] = [];
    let active = 0, peak = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('manifest.json')) return Response.json({ datasets: [{ id: 'sample', files: names }] });
      peak = Math.max(peak, ++active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return new Response(new Uint8Array([1]));
    });
    const result = loadSampleCandidates('sample');
    for (let completed = 0; completed < names.length; completed++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      releases.pop()!();
    }
    expect((await result).map(candidate => candidate.name)).toEqual(names);
    expect(peak).toBe(6);
  });

  it('暂时的服务器错误重试，缺失文件立即失败', async () => {
    for (const status of [503, 404]) {
      let attempts = 0;
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith('manifest.json')) return Response.json({ datasets: [{ id: 'sample', files: ['one.dcm'] }] });
        if (++attempts === 1) return new Response(null, { status });
        return new Response(new Uint8Array([1]));
      });
      if (status === 503) {
        await expect(loadSampleCandidates('sample')).resolves.toHaveLength(1);
        expect(attempts).toBe(2);
      } else {
        await expect(loadSampleCandidates('sample')).rejects.toThrow('HTTP 404');
        expect(attempts).toBe(1);
      }
    }
  });

  it('含响应体读取的超时在两次尝试后结束', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (_url: string, options: RequestInit) => ({
        ok: true,
        arrayBuffer: () => new Promise((_, reject) => {
          options.signal!.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')));
        }),
      }));
      vi.stubGlobal('fetch', fetcher);
      const result = expect(loadSampleCandidates('sample')).rejects.toThrow('超时');
      await vi.runAllTimersAsync();
      await result;
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('扫描跳过项和失败项也计数，不能把成功数伪装成处理进度', async () => {
    const bytes = await readFile(new URL('../../../sample-dicom/brain-head-mr/head-sagittal.dcm', import.meta.url));
    const events: { stage: string; completed?: number; total?: number }[] = [];
    const result = await scanCandidates([
      { id: 'one', name: 'one.dcm', size: bytes.length, read: async (a, b) => Uint8Array.from(bytes.subarray(a ?? 0, b)).buffer },
      { id: 'skip', name: 'text', size: 2, read: async () => new Uint8Array([0, 0]).buffer },
      { id: 'bad', name: 'bad', size: 0, read: async () => { throw new Error('不可读'); } },
    ], undefined, progress => events.push(progress));
    expect(result.parsedFileCount).toBe(1); expect(result.failedFiles).toHaveLength(1);
    expect(events.filter(event => event.completed !== undefined).map(event => [event.completed, event.total])).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    expect(events.at(-1)).toEqual({ stage: '分组与校验空间几何' });
  });
});

it('取消的晚到DICOMDIR不能覆盖新导入索引', async () => {
  const bytes = buildDicomdirBuffer([
    { recordType: 'PATIENT', patientId: 'synthetic' },
    { recordType: 'STUDY', studyInstanceUid: '1.2.3' },
    { recordType: 'SERIES', seriesInstanceUid: '1.2.3.4', modality: 'CT' },
    { recordType: 'IMAGE', referencedFileId: 'OLD', referencedSopInstanceUid: '1.2.3.4.5' },
  ]);
  let release!: (value: ArrayBuffer) => void; let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const delayed = new Promise<ArrayBuffer>(resolve => { release = resolve; });
  const source = new LocalDataSource(); const controller = new AbortController();
  const old = source.probe({ files: [{ id: 'dir', name: 'DICOMDIR', size: bytes.byteLength,
    read: async (start, end) => { if (start !== undefined) return bytes.slice(start, end); started(); return delayed; } }] }, controller.signal);
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  await ready; controller.abort();
  const current = await readFile(new URL('../../../sample-dicom/brain-head-mr/head-sagittal.dcm', import.meta.url));
  await source.probe({ files: [{ id: 'new', name: 'new.dcm', size: current.length,
    read: async (a, b) => Uint8Array.from(current.subarray(a ?? 0, b)).buffer }] });
  const before = await source.listSeries();
  release(bytes); await rejected;
  expect(await source.listSeries()).toEqual(before);
  expect(before).toHaveLength(1);
});
