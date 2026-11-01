import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { SeriesHandle, VOIRange } from '@opendicomviewer/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { useViewerStore } from '../state/viewer-store';
import { LAYOUTS, SPLIT_PANES, type PaneSpec } from '../layout/viewport-layouts';
import { MprPane, type MprPaneHandle } from './MprPane';
import { describeSeriesImages } from './image-presentation';
import { blocksViewerShortcut, CAMERA_CHANGED, notifyCameraChanged } from './viewport-gestures';
import { parseLayerInput, queueLayerNavigation, type LayerRequest } from './slice-navigation';
import { getWindowPresets, pickAdaptiveVOI } from './window-presets';
import { measureMmPerPx } from './scale-bar';

export type SplitNavigationSession = Map<string, { seriesUid: string; index: number }>;
interface PaneActions { navigate(request: LayerRequest): void; automatic(): Promise<void>; preset(voi: VOIRange, name: string): void; paint(): void }
interface SplitProps { renderer: CornerstoneRenderer; session: RefObject<SplitNavigationSession> }

/** 每格只消费自己的句柄；翻层/调窗只写渲染器与 DOM，不写 React/Zustand。 */
function IndependentPane({ pane, handle, renderer, active, session, register, onNavigation }: {
  pane: PaneSpec; handle?: SeriesHandle; renderer: CornerstoneRenderer; active: boolean;
  session: RefObject<SplitNavigationSession>; register(id: string, actions: PaneActions | null): void;
  onNavigation(id: string, index: number, total: number): void;
}) {
  const hud = useRef<MprPaneHandle | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(false);
  const autoRequest = useRef(0);
  const [status, setStatus] = useState<{ handle?: SeriesHandle; phase: 'loading' | 'ready' | 'error'; message?: string }>({ phase: 'loading' });
  const ready = !!handle && status.handle === handle && status.phase === 'ready';
  const readyRef = useRef(false); readyRef.current = ready;
  const count = handle?.meta.planes.length ?? 0;
  const imageInfo = describeSeriesImages(handle?.meta);
  const current = () => live.current && !!handle && useViewerStore.getState().splitSeries[pane.viewportId] === handle;
  const error = (err: unknown) => useViewerStore.getState().setImportStatus({ loading: false,
    error: `${pane.shortTitle}：${err instanceof Error ? err.message : String(err)}` });
  const paint = () => {
    if (!handle || !current() || !readyRef.current) return;
    const index = renderer.currentSliceIndex(pane.viewportId);
    session.current.set(pane.viewportId, { seriesUid: handle.meta.seriesInstanceUid, index });
    hud.current?.setSlice(index, count);
    const voi = renderer.getVOI(pane.viewportId);
    hud.current?.setVoi(`WW ${Math.round(voi.windowWidth)} · WL ${Math.round(voi.windowCenter)}`);
    onNavigation(pane.viewportId, index, count);
  };
  const navigate = (request: LayerRequest) => {
    if (!readyRef.current) return;
    const windowRequest = ++autoRequest.current;
    queueLayerNavigation({ request, total: count, isCurrent: current,
      readIndex: () => renderer.currentSliceIndex(pane.viewportId),
      enqueue: task => { chain.current = chain.current.catch(() => undefined).then(task).catch(err => { if (current()) error(err); }); },
      apply: async (_from, to) => {
        await renderer.setStackIndex(pane.viewportId, to);
        if (handle && current() && imageInfo.nonVolumetric) {
          const frame = await handle.pixel(to);
          if (!current()) return;
          renderer.resetView(pane.viewportId);
          if (windowRequest === autoRequest.current) renderer.setVOI(pane.viewportId, pickAdaptiveVOI(frame).voi);
        }
        if (current()) paint();
      },
    });
  };
  const preset = (voi: VOIRange, name: string) => {
    autoRequest.current++;
    if (!readyRef.current || !current()) return;
    renderer.setVOI(pane.viewportId, voi); paint();
    hud.current?.setVoi(`[${name}] WW ${Math.round(voi.windowWidth)} · WL ${Math.round(voi.windowCenter)}`);
  };
  const automatic = async () => {
    if (!handle || !readyRef.current) return;
    const request = ++autoRequest.current;
    try {
      const frame = await handle.pixel(renderer.currentSliceIndex(pane.viewportId));
      if (!current() || request !== autoRequest.current) return;
      const result = pickAdaptiveVOI(frame);
      preset(result.voi, result.estimated ? '自动（估算）' : '自动');
    } catch (err) { if (current() && request === autoRequest.current) error(err); }
  };
  useEffect(() => {
    // StrictMode 会重放 effect；旧装载的完成/失败不得覆盖新装载的状态。
    let cancelled = false;
    live.current = true;
    readyRef.current = false;
    register(pane.viewportId, { navigate, automatic, preset, paint });
    if (handle) {
      setStatus({ handle, phase: 'loading' });
      const saved = session.current.get(pane.viewportId);
      const initial = saved?.seriesUid === handle.meta.seriesInstanceUid ? saved.index : 0;
      void renderer.setStack(pane.viewportId, handle, initial).then(() => {
        if (cancelled || !current()) return;
        readyRef.current = true;
        paint(); setStatus({ handle, phase: 'ready' }); notifyCameraChanged();
      }).catch(err => { if (!cancelled && current()) setStatus({ handle, phase: 'error', message: err instanceof Error ? err.message : String(err) }); });
    }
    return () => { cancelled = true; live.current = false; autoRequest.current++; register(pane.viewportId, null); };
  }, [handle, renderer, pane.viewportId, register]);
  useEffect(() => {
    const changed = () => { if (readyRef.current && current()) paint(); };
    window.addEventListener(CAMERA_CHANGED, changed);
    return () => window.removeEventListener(CAMERA_CHANGED, changed);
  }, [handle, renderer]);
  const registerHud = useCallback((_id: string, value: MprPaneHandle | null) => { hud.current = value; }, []);
  const measure = useCallback((id: string, w: number, h: number) => imageInfo.physicalScale ? measureMmPerPx(renderer, id, w, h) : null, [renderer, imageInfo.physicalScale]);
  const orientation = imageInfo.orientation;
  const study = useViewerStore(state => state.studies.find(item => item.studyInstanceUid === handle?.meta.studyInstanceUid));
  const activate = () => { const state = useViewerStore.getState(); if (state.activeViewportId !== pane.viewportId) state.setActiveViewportId(pane.viewportId); };
  return <MprPane spec={{ ...pane, title: `${pane.shortTitle}${handle ? ` · ${orientation.label}` : ' · 空'}` }} active={active} selectable
    totalSlices={ready ? count : 0} modality={handle?.meta.modality ?? ''}
    seriesDescription={handle ? [study?.patientName || study?.patientId || '患者未知', study?.studyDate, study?.studyDescription || handle.meta.studyInstanceUid, handle.meta.seriesDescription].filter(Boolean).join(' · ') : undefined}
    notice={!handle ? '点击此格，再从左侧选择序列' : ready ? undefined : status.handle === handle && status.phase === 'error' ? status.message : '正在载入原始影像…'}
    noticeKind={!handle ? 'empty' : status.phase === 'error' && status.handle === handle ? 'error' : 'info'} windowingEnabled={ready}
    onActivate={activate} onStep={delta => { activate(); navigate({ delta }); }}
    onPan={(x, y) => renderer.panBy(pane.viewportId, { x, y })} onZoom={factor => renderer.zoomBy(pane.viewportId, factor)} onError={error}
    onVoiPreview={voi => preset(voi, '自定义')} readVoi={() => renderer.getVOI(pane.viewportId)} measureScale={measure} register={registerHud} />;
}

export function SplitWorkspace({ renderer, session }: SplitProps) {
  const { splitSeries, activeViewportId, activeSeriesHandle } = useViewerStore();
  const actions = useRef(new Map<string, PaneActions>());
  const layer = useRef<HTMLInputElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const count = activeSeriesHandle?.meta.planes.length ?? 0;
  const presets = getWindowPresets(activeSeriesHandle?.meta);
  const displayedIndex = session.current.get(activeViewportId)?.index ?? 0;
  const register = useCallback((id: string, value: PaneActions | null) => { if (value) actions.current.set(id, value); else actions.current.delete(id); }, []);
  const onNavigation = useCallback((id: string, index: number, total: number) => {
    if (id !== useViewerStore.getState().activeViewportId) return;
    if (layer.current) layer.current.value = String(index + 1);
    if (previous.current) previous.current.disabled = index <= 0;
    if (next.current) next.current.disabled = index >= total - 1;
  }, []);
  useEffect(() => { actions.current.get(activeViewportId)?.paint(); }, [activeViewportId, activeSeriesHandle]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (blocksViewerShortcut(event) || !activeSeriesHandle) return;
      const target = actions.current.get(activeViewportId);
      if (event.key === '1') { event.preventDefault(); void target?.automatic(); }
      const preset = presets[Number(event.key) - 2];
      if (preset) { event.preventDefault(); target?.preset(preset.voi, preset.name); }
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        const sign = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 1;
        target?.navigate({ delta: sign * (event.key.startsWith('Page') || event.shiftKey ? 10 : 1) });
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [activeViewportId, activeSeriesHandle, presets]);
  const currentActions = () => actions.current.get(activeViewportId);
  return <div className="flex-1 flex flex-col relative z-10 min-h-0 min-w-0 overflow-hidden select-none">
    <div className="split-status" style={{ height: 'var(--vp-bar-h)' }}>独立分屏 · 各格独立浏览，无空间联动</div>
    <div className="flex-1 min-h-0 min-w-0" style={LAYOUTS['split-2x2'].gridStyle}>
      {SPLIT_PANES.map(pane => <IndependentPane key={pane.viewportId} pane={pane} handle={splitSeries[pane.viewportId]} renderer={renderer}
        active={activeViewportId === pane.viewportId} session={session} register={register} onNavigation={onNavigation} />)}
    </div>
    <div className="split-footer" style={{ minHeight: 'var(--vp-foot-h)' }}>
      <span>{SPLIT_PANES.find(p => p.viewportId === activeViewportId)?.shortTitle}</span>
      {activeSeriesHandle ? <>
        <button ref={previous} className="workspace-control" aria-label="上一层" disabled={count <= 1 || displayedIndex <= 0} onClick={() => currentActions()?.navigate({ delta: -1 })}>‹</button>
        <input ref={layer} aria-label="层号" defaultValue="1" inputMode="numeric" onKeyDown={event => {
          if (event.key !== 'Enter') return;
          const index = parseLayerInput(event.currentTarget.value, count);
          if (index === null) currentActions()?.paint(); else currentActions()?.navigate(index);
        }} />
        <span>/ {count}</span>
        <button ref={next} className="workspace-control" aria-label="下一层" disabled={count <= 1 || displayedIndex >= count - 1} onClick={() => currentActions()?.navigate({ delta: 1 })}>›</button>
        <div className="toolbar-spacer" />
        <button className="workspace-control" onClick={() => void currentActions()?.automatic()}>自动</button>
        {presets.map((p, i) => <button key={p.name} className="workspace-control" title={`快捷键 ${i + 2} · WW ${p.voi.windowWidth} / WL ${p.voi.windowCenter}`} onClick={() => currentActions()?.preset(p.voi, p.name)}>{p.name}</button>)}
      </> : <span>请从左侧为当前格选择序列</span>}
    </div>
  </div>;
}
