import { useEffect, useRef, useState } from 'react';
import type { DataSourcePort, SeriesHandle, SeriesSummary } from '@opendicomviewer/core';
import { makeThumbnail } from './thumbnail';

// 预览独立于当前阅片句柄，限制同时解码数量，避免导入后一次性解码所有序列。
let running = 0;
const queue: (() => Promise<void>)[] = [];
function drain() {
  while (running < 2 && queue.length) {
    const task = queue.shift()!;
    running++;
    void task().finally(() => { running--; drain(); });
  }
}

export function SeriesThumbnail({ source, series }: { source: DataSourcePort; series: SeriesSummary }) {
  const root = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const controller = new AbortController();
    let queued = false;
    setStatus('loading');
    const load = async () => {
      let handle: SeriesHandle | undefined;
      try {
        if (controller.signal.aborted) return;
        handle = await source.openSeries(series, controller.signal);
        if (controller.signal.aborted) return;
        const frame = await handle.pixel(Math.floor(handle.meta.planes.length / 2));
        if (controller.signal.aborted || !canvas.current) return;
        const thumbnail = makeThumbnail(frame);
        const context = canvas.current.getContext('2d');
        if (!context) throw new Error('无法创建预览画布');
        canvas.current.width = thumbnail.width; canvas.current.height = thumbnail.height;
        const image = context.createImageData(thumbnail.width, thumbnail.height);
        image.data.set(thumbnail.rgba); context.putImageData(image, 0, 0);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      } finally { handle?.dispose(); }
    };
    const enqueue = () => { if (!queued) { queued = true; queue.push(load); drain(); } };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); enqueue(); }
    }, { rootMargin: '60px' });
    if (observer) observer.observe(element); else enqueue();
    return () => { controller.abort(); observer?.disconnect(); };
  }, [source, series]);
  return <span ref={root} className="series-thumbnail" role="img" aria-label={`${series.modality} 序列缩略图${status === 'error' ? '，预览不可用' : ''}`}
    title={status === 'error' ? '预览不可用，仍可点击打开序列' : '序列中间帧预览'}>
    <canvas ref={canvas} hidden={status !== 'ready'} aria-hidden="true" />
    {status !== 'ready' && <span className="series-thumbnail-fallback">{series.modality}{status === 'error' && <small>预览不可用</small>}</span>}
  </span>;
}
