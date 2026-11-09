import type { HostOriginalSaver } from '../bridge/host-original-saver';
import type { HostPngSaver } from '../bridge/host-png-saver';
import { originalDicomBlob } from './original-dicom';
import { useEffect, useRef, useState } from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { useViewerStore } from '../state/viewer-store';
import { capturePngSnapshot, composePng, type PngSnapshot } from './png-capture';

export function PngExportControl({ renderer, enabled, desktop, saveOriginals, savePng }: { renderer: CornerstoneRenderer | null; enabled: boolean; desktop: boolean; saveOriginals?: HostOriginalSaver; savePng?: HostPngSaver }) {
  const [format, setFormat] = useState<'png' | 'dicom'>('png');
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PngSnapshot | null>(null);
  const [annotations, setAnnotations] = useState(true);
  const [identity, setIdentity] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const originalAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { originalAbort.current?.abort(); generation.current++; setExporting(false); setOpen(false); setSnapshot(null); setBlob(null); trigger.current?.focus(); };
  useEffect(() => () => { originalAbort.current?.abort(); generation.current++; }, []);
  useEffect(() => {
    if (!snapshot || !open || format !== 'png') return;
    let cancelled = false;
    setBlob(null); setMessage('正在生成预览…');
    void composePng(snapshot, annotations, identity).then(result => {
      if (!cancelled) { setBlob(result); setMessage(''); }
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [snapshot, open, annotations, identity, format]);
  useEffect(() => {
    if (!blob) { setPreview(''); return; }
    const url = URL.createObjectURL(blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const capture = async () => {
    if (!renderer || !enabled) return;
    const token = ++generation.current;
    setOpen(true); setFormat('png'); setIdentity(false); setAnnotations(true); setMessage('正在捕获当前影像…'); setSnapshot(null); setBlob(null); setPreview('');
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
  const exportOriginal = async (series: boolean) => {
    if (!renderer || exporting) return;
    const controller = new AbortController(); originalAbort.current = controller;
    const token = ++generation.current;
    setExporting(true); setMessage('正在准备完整原始 DICOM…');
    try {
      const handle = useViewerStore.getState().activeSeriesHandle;
      if (!handle?.originalCandidates) throw new Error('当前数据源不支持原始实例导出');
      const files = handle.originalCandidates(series ? undefined : renderer.currentSliceIndex('default-viewport'));
      if (desktop) {
        if (!saveOriginals) throw new Error('桌面原始文件保存不可用');
        const result = await saveOriginals(files.map(file => ({ id: file.id, size: file.size })));
        if (token === generation.current) setMessage(result === 'saved' ? '原始 DICOM 已保存。' : '已取消保存。');
      } else {
        const result = await originalDicomBlob(files, controller.signal);
        if (controller.signal.aborted || token !== generation.current) return;
        const url = URL.createObjectURL(result); const link = document.createElement('a');
        link.href = url; link.download = files.length === 1 ? 'original-instance.dcm' : 'original-series.zip'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setMessage('已发起原始 DICOM 下载，请检查浏览器下载记录。');
      }
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setExporting(false); }
  };
  const downloadPng = async () => {
    if (!blob || exporting) return;
    const token = ++generation.current;
    const controller = new AbortController(); originalAbort.current = controller;
    setExporting(true); setMessage('正在保存 PNG…');
    try {
      if (desktop) {
        if (!savePng) throw new Error('桌面 PNG 保存不可用');
        const result = await savePng(blob, controller.signal);
        if (token === generation.current) setMessage(result === 'saved' ? 'PNG 已保存。' : '已取消保存 PNG。');
      } else {
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'opendicomviewer.png'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000); setMessage('已发起 PNG 下载，请检查浏览器下载记录。');
      }
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (token === generation.current) setExporting(false); }
  };
  return <>
    <button ref={trigger} className="workspace-control" disabled={!enabled} aria-label="导出影像" onClick={() => void capture()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7" /></svg><span>导出</span>
    </button>
    {open && <div className="absolute inset-0 z-50 bg-canvas/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="导出影像" ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!exporting || !desktop) close(); }
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <section className="annotation-confirm" style={{ width: 'min(760px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="annotation-panel-heading"><h2>导出影像</h2><button className="annotation-action" autoFocus disabled={exporting && desktop} onClick={close} aria-label="关闭导出">关闭</button></div>
        <div className="annotation-actions" role="group" aria-label="导出格式">
          <button className="annotation-action" aria-pressed={format === 'png'} disabled={exporting} onClick={() => void capture()}>PNG 快照</button>
          <button className="annotation-action" aria-pressed={format === 'dicom'} disabled={exporting} onClick={() => { generation.current++; setFormat('dicom'); setMessage(''); }}>原始 DICOM</button>
        </div>
        {format === 'png' && <>
        <p>当前单视口快照，保留窗宽窗位、缩放与方向；仅供研究、教学参考。</p>
        <div className="annotation-actions">
          <label><input type="checkbox" disabled={exporting} checked={annotations} onChange={event => setAnnotations(event.target.checked)} /> 包含标注与测量</label>
          <label><input type="checkbox" disabled={exporting} checked={identity} onChange={event => setIdentity(event.target.checked)} /> 包含患者姓名和编号</label>
        </div>
        <p className="text-txt-muted">源像素可能已有烧录信息；关闭身份叠加不等于脱敏。</p>
        {preview && <img src={preview} alt="待导出的 PNG 预览" style={{ width: '100%', maxHeight: '50vh', objectFit: 'contain', background: '#000', marginTop: 12 }} />}
        {message && <p role="status" className="annotation-status">{message}</p>}
        {desktop && !savePng && <p className="annotation-status">当前宿主未提供 PNG 保存，请使用 Web 版下载。</p>}
        </>}
        {format === 'dicom' && <>
        <p className="text-txt-muted">原始 DICOM 保留全部标签和像素，可能包含身份信息；不含本次标注与测量，未经脱敏。序列仅包含本次成功导入的实例。Web 多实例以 ZIP 打包；桌面 ZIP 来源暂不支持原始导出。</p>
        <div className="annotation-actions">
          <button className="annotation-action" disabled={exporting} onClick={() => void exportOriginal(false)}>当前原始实例 · DICOM</button>
          <button className="annotation-action" disabled={exporting} onClick={() => void exportOriginal(true)}>当前序列 · DICOM</button>
        </div>
        </>}
        {format === 'png' && <div className="annotation-confirm-actions">
          <button className="annotation-action annotation-action-primary" disabled={!blob || exporting || (desktop && !savePng)} onClick={() => void downloadPng()}>{exporting ? '保存中…' : desktop ? '保存 PNG' : '下载 PNG'}</button>
        </div>}
        {format === 'dicom' && message && <p role="status" className="annotation-status">{message}</p>}
      </section>
    </div>}
  </>;
}
