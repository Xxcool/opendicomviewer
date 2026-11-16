import { useEffect, useState } from 'react';
import { useViewerStore } from '../state/viewer-store';

export function TemporalControls({ ready }: { ready: boolean }) {
  const handle = useViewerStore(state => state.activeSeriesHandle);
  const loading = useViewerStore(state => state.importStatus.loading);
  const failed = useViewerStore(state => state.mprStatus.phase === 'error' || !!state.importStatus.error);
  const setActiveSeries = useViewerStore(state => state.setActiveSeries);
  const temporal = handle?.temporal;
  const position = handle?.meta.temporalPosition;
  const [playing, setPlaying] = useState(false);

  useEffect(() => { setPlaying(false); }, [temporal]);
  useEffect(() => {
    if (loading || failed) setPlaying(false);
  }, [loading, failed]);
  useEffect(() => {
    if (!playing || !temporal || !ready || position === undefined || loading || failed) return;
    // 仅在本相已挂到视口后调度下一相。500 ms 是展示节奏，不代表采集间隔。
    const timer = window.setTimeout(() => {
      if (document.hidden || document.querySelector('[data-viewer-home="true"], [role="dialog"][aria-modal="true"]')
        || useViewerStore.getState().activeSeriesHandle !== handle) { setPlaying(false); return; }
      const next = temporal.positions[temporal.positions.indexOf(position) + 1];
      if (next === undefined) { setPlaying(false); return; }
      setActiveSeries(temporal.select(next));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [playing, temporal, ready, position, handle, loading, failed, setActiveSeries]);

  if (!temporal || position === undefined) return null;
  return <div role="group" aria-label="4D 时相" className="inline-flex items-center gap-2 shrink-0">
    <label>时相 <select aria-label="选择时相" className="bg-panel border border-line rounded" value={position} disabled={loading}
      onChange={event => { setPlaying(false); setActiveSeries(temporal.select(Number(event.target.value))); }}>
      {temporal.positions.map(id => <option key={id} value={id}>{id} / {temporal.positions.length}</option>)}
    </select></label>
    <button type="button" className="workspace-control" disabled={!playing && (!ready || loading || failed)} aria-pressed={playing}
      title="按时相顺序回放，每相显示至少 0.5 秒" onClick={() => {
        if (!playing && position === temporal.positions.at(-1)) setActiveSeries(temporal.select(temporal.positions[0]));
        setPlaying(!playing);
      }}>{playing ? '暂停时相' : '播放时相'}</button>
  </div>;
}
