import { useEffect, useRef, useState } from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import type { VolumeHandle } from '@opendicomviewer/core';
import { useDisplayVolume } from '../bridge/use-display-volume';
import { VOLUME_VIEWPORT_ID } from '../layout/viewport-layouts';
import { useViewerStore } from '../state/viewer-store';

import { TemporalControls } from './TemporalControls';

export function VolumeWorkspace({ renderer }: { renderer: CornerstoneRenderer }) {
  const volume = useDisplayVolume();
  const status = useViewerStore(s => s.mprStatus);
  const setStatus = useViewerStore(s => s.setMprStatus);
  const [attached, setAttached] = useState<VolumeHandle | null>(null);
  const attachQueue = useRef(Promise.resolve());
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const ready = Boolean(volume && volume === attached && status.phase !== 'error');

  useEffect(() => {
    if (!volume) return;
    let cancelled = false;
    attachQueue.current = attachQueue.current.then(async () => {
      if (cancelled) return;
      await renderer.setVolume(VOLUME_VIEWPORT_ID, volume);
      if (!cancelled) {
        setAttached(volume);
        setStatus({ phase: 'ready' });
      }
    }).catch((error: unknown) => {
      if (!cancelled) setStatus({ phase: 'error', message: '三维体绘制失败：' + String(error) });
    });
    return () => { cancelled = true; };
  }, [renderer, volume, setStatus]);

  function rotate(yaw: number, pitch: number) {
    if (!ready) return;
    try { renderer.orbit(VOLUME_VIEWPORT_ID, yaw, pitch); }
    catch (error) { setStatus({ phase: 'error', message: '旋转失败：' + String(error) }); }
  }

  return <>
    <div className="absolute inset-x-0 top-0 z-10 flex items-center px-3 text-xs bg-panel border-b border-line"
      style={{ height: 'var(--vp-bar-h)' }}><span className="mr-auto">3D 体绘制 · 降采样显示</span><TemporalControls ready={ready} /></div>
    <div className={'absolute inset-x-0 z-10 touch-none flex items-center justify-center ' + (ready ? 'cursor-grab active:cursor-grabbing' : 'bg-black')}
      style={{ top: 'var(--vp-bar-h)', bottom: 'var(--vp-foot-h)' }}
      onPointerDown={e => {
        if (!ready || !e.isPrimary || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerMove={e => {
        const last = pointer.current;
        if (!last || last.id !== e.pointerId) return;
        rotate((e.clientX - last.x) * 0.45, (e.clientY - last.y) * 0.45);
        pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onLostPointerCapture={() => { pointer.current = null; }}>
      {!ready && <span role="status" className="text-xs text-white">{status.phase === 'error' ? status.message
        : status.phase === 'building' ? `正在构建体积 · ${status.processedSlices ?? 0}/${status.totalSlices ?? 0}` : '正在装载三维视口…'}</span>}
    </div>
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-3 bg-panel text-xs"
      style={{ height: 'var(--vp-foot-h)' }}>
      <button className="workspace-control" disabled={!ready} onClick={() => rotate(-15, 0)}>向左旋转</button>
      <span className="text-txt-dim">拖动旋转</span>
      <button className="workspace-control" disabled={!ready} onClick={() => rotate(15, 0)}>向右旋转</button>
    </div>
  </>;
}
