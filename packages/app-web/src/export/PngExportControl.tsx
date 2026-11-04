import { useEffect, useRef, useState } from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { useViewerStore } from '../state/viewer-store';
import { capturePngSnapshot, composePng, type PngSnapshot } from './png-capture';

export function PngExportControl({ renderer, enabled, desktop }: { renderer: CornerstoneRenderer | null; enabled: boolean; desktop: boolean }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PngSnapshot | null>(null);
  const [annotations, setAnnotations] = useState(true);
  const [identity, setIdentity] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { generation.current++; setOpen(false); setSnapshot(null); setBlob(null); trigger.current?.focus(); };
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!snapshot || !open) return;
    let cancelled = false;
    setBlob(null); setMessage('正在生成预览…');
    void composePng(snapshot, annotations, identity).then(result => {
      if (!cancelled) { setBlob(result); setMessage(''); }
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [snapshot, open, annotations, identity]);
  useEffect(() => {
    if (!blob) { setPreview(''); return; }
    const url = URL.createObjectURL(blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const capture = async () => {
    if (!renderer || !enabled) return;
    const token = ++generation.current;
    setOpen(true); setIdentity(false); setAnnotations(true); setMessage('正在捕获当前影像…'); setSnapshot(null);
    try {
    const state = useViewerStore.getState();
    const handle = state.activeSeriesHandle;
    const index = renderer.currentSliceIndex('default-viewport');
    const study = state.studies.find(item => item.studyInstanceUid === state.activeStudyUid);
      const result = await capturePngSnapshot(renderer, [study?.patientName || '未提供姓名', study?.patientId || '未提供编号']);
      if (token !== generation.current) return;
      if (useViewerStore.getState().activeSeriesHandle !== handle || renderer.currentSliceIndex('default-viewport') !== index) throw new Error('影像已变化，请关闭并重新导出');
      setSnapshot(result);
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <button ref={trigger} className="workspace-control" disabled={!enabled} aria-label="导出 PNG" onClick={() => void capture()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7" /></svg><span>导出</span>
    </button>
    {open && <div className="absolute inset-0 z-50 bg-canvas/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="导出 PNG" ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <section className="annotation-confirm" style={{ width: 'min(760px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="annotation-panel-heading"><h2>导出 PNG</h2><button className="annotation-action" autoFocus onClick={close} aria-label="关闭导出">关闭</button></div>
        <p>当前单视口快照，保留窗宽窗位、缩放与方向；仅供研究、教学参考。</p>
        <div className="annotation-actions">
          <label><input type="checkbox" checked={annotations} onChange={event => setAnnotations(event.target.checked)} /> 包含标注与测量</label>
          <label><input type="checkbox" checked={identity} onChange={event => setIdentity(event.target.checked)} /> 包含患者姓名和编号</label>
        </div>
        <p className="text-txt-muted">源像素可能已有烧录信息；关闭身份叠加不等于脱敏。</p>
        {preview && <img src={preview} alt="待导出的 PNG 预览" style={{ width: '100%', maxHeight: '50vh', objectFit: 'contain', background: '#000', marginTop: 12 }} />}
        {message && <p role="status" className="annotation-status">{message}</p>}
        {desktop && <p className="annotation-status">当前桌面版尚未接入 PNG 原生保存，可预览；请使用 Web 版下载。</p>}
        <div className="annotation-confirm-actions">
          <button className="annotation-action annotation-action-primary" disabled={!blob || desktop} onClick={() => {
            if (!blob) return;
            const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'opendicomviewer.png'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000); setMessage('已发起 PNG 下载，请检查浏览器下载记录。');
          }}>下载 PNG</button>
        </div>
      </section>
    </div>}
  </>;
}
