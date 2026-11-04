import { AnnotationIcon } from './AnnotationIcon';
import type { HostCloseGuard } from '../bridge/host-close-guard';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MeasurementSession, type MeasurementRecord, type DataSourcePort } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { MAX_ANNOTATION_BYTES, parseAnnotationBackup, loadBackupSources, restoreWithPixels } from './annotation-restore';
import type { HostFileSaver } from '../bridge/host-file-saver';

export type AnnotationTool = 'none' | 'rectangleRoi' | 'ellipseRoi' | 'length' | 'arrow' | 'text' | 'select';
export const FLUSH_ANNOTATION_NOTE = 'odv-flush-annotation-note';
function flushAnnotationNote() { window.dispatchEvent(new Event(FLUSH_ANNOTATION_NOTE)); }
interface AnnotationState {
  session: MeasurementSession; sessionId: string; records: readonly MeasurementRecord[];
  tool: AnnotationTool; setTool: (tool: AnnotationTool) => void;
  selected: string | null; select: (id: string | null) => void;
  panelOpen: boolean; setPanelOpen: (open: boolean) => void;
  confirmReplacement: () => Promise<boolean>;
  saveAnnotations: () => Promise<'saved' | 'cancelled' | 'download-started'>;
  restoreAnnotations: (file: File) => Promise<boolean>;
  downloadPending: boolean; confirmDownloaded: () => void;
}
const Context = createContext<AnnotationState | null>(null);
async function browserSave(file: { name: string; mimeType: string; text: string }): Promise<'download-started'> {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'download-started';
}
export function AnnotationProvider({ children, saveFile, closeGuard, dataSource }: { children: ReactNode; dataSource: DataSourcePort; saveFile?: HostFileSaver; closeGuard?: HostCloseGuard }) {
  const studies = useViewerStore(s => s.studies);
  const [generation, setGeneration] = useState(() => crypto.randomUUID());
  const [tool, setTool] = useState<AnnotationTool>('none');
  const [selected, select] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [, refresh] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const downloadedSnapshot = useRef<readonly MeasurementRecord[] | null>(null);
  const restoreInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const resolver = useRef<((proceed: boolean) => void) | null>(null);
  const session = useMemo(() => new MeasurementSession(error => useViewerStore.getState().setImportStatus({
    loading: false, error: `标注更新失败：${error instanceof Error ? error.message : String(error)}`,
  })), [studies]);
  useEffect(() => session.subscribe(() => refresh(value => value + 1)), [session]);
  useEffect(() => { setGeneration(crypto.randomUUID()); select(null); setTool('none'); setDownloadPending(false); }, [studies]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      flushAnnotationNote();
      if (session.isDirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [session]);
  useEffect(() => () => { resolver.current?.(false); }, []);
  const confirmReplacement = async () => {
    flushAnnotationNote();
    if (!session.isDirty) return true;
    if (resolver.current) return false;
    setSaveMessage(''); setConfirming(true);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  };
  const latestConfirm = useRef(confirmReplacement); latestConfirm.current = confirmReplacement;
  useEffect(() => {
    if (!closeGuard) return;
    let cancelled = false; let unsubscribe: (() => void) | undefined;
    void closeGuard(() => latestConfirm.current()).then(stop => {
      if (cancelled) stop(); else unsubscribe = stop;
    }).catch(error => useViewerStore.getState().setImportStatus({ loading: false,
      error: `关闭窗口保护初始化失败：${error instanceof Error ? error.message : String(error)}` }));
    return () => { cancelled = true; unsubscribe?.(); };
  }, [closeGuard]);
  const finish = (proceed: boolean) => {
    resolver.current?.(proceed); resolver.current = null; setConfirming(false);
  };
  const saveAnnotations = async () => {
    flushAnnotationNote();
    const snapshot = session.list();
    const result = await (saveFile ?? browserSave)({ name: 'annotations.json', mimeType: 'application/json',
      text: JSON.stringify({ format: 'opendicomviewer-annotations', version: 1, records: snapshot }, null, 2) });
    // 保存期间可能发生新修改，不能把未写入的版本一起标记为已保存。
    if (result === 'saved' && session.list() === snapshot) { session.markSaved(); setDownloadPending(false); }
    else if (result === 'download-started') { downloadedSnapshot.current = snapshot; setDownloadPending(true); }
    return result;
  };
  const saveAndContinue = async () => {
    setBusy(true);
    try {
      const result = await saveAnnotations();
      if (result === 'saved' && !session.isDirty) finish(true);
      else if (result === 'download-started') setSaveMessage('浏览器已发起下载。请确认文件保存成功后再继续。');
      else setSaveMessage(result === 'cancelled' ? '已取消保存，当前标注仍保留。' : '保存期间有新修改，请重新保存。');
    } catch (error) { setSaveMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  const confirmDownloaded = () => {
    if (downloadedSnapshot.current !== session.list()) throw new Error('导出后标注已变化，请重新保存当前版本');
    session.markSaved(); setDownloadPending(false); downloadedSnapshot.current = null;
  };
  const restoreAnnotations = async (file: File) => {
    if (restoreInFlight.current) throw new Error('正在恢复标注，请稍候');
    if (file.size > MAX_ANNOTATION_BYTES) throw new Error('标注文件超过 10 MiB 限制');
    const originalStudies = studies;
    restoreInFlight.current = true;
    try {
      const records = parseAnnotationBackup(await file.text());
      const sources = await loadBackupSources(records, dataSource);
      const restored = await restoreWithPixels(records, sources, generation, dataSource);
      const stillCurrent = () => alive.current && useViewerStore.getState().studies === originalStudies;
      if (!stillCurrent()) throw new Error('影像会话已变化，请重新恢复');
      if (!await confirmReplacement()) return false;
      if (!stillCurrent()) throw new Error('影像会话已变化，请重新恢复');
      session.restoreSaved(restored);
      select(null); setTool('none'); setDownloadPending(false); downloadedSnapshot.current = null;
      return true;
    } finally { restoreInFlight.current = false; }
  };
  return <Context.Provider value={{ session, sessionId: generation, records: session.list(), tool, setTool,
    selected, select, panelOpen, setPanelOpen, confirmReplacement, saveAnnotations, restoreAnnotations, downloadPending, confirmDownloaded }}>
    {children}
    {confirming && <div className="absolute inset-0 z-50 bg-canvas/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="annotation-unsaved-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); finish(false); }
      if (event.key !== 'Tab') return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <section className="annotation-confirm">
        <h2 id="annotation-unsaved-title" className="font-semibold mb-2">当前有未保存的标注与测量</h2>
        <p>离开当前会话前，请选择保存、丢弃修改，或取消并继续阅片。</p>
        {saveMessage && <p role="status" className="mt-3">{saveMessage}</p>}
        <div className="annotation-confirm-actions">
          <button className="annotation-action annotation-action-primary" disabled={busy} onClick={() => void saveAndContinue()}><AnnotationIcon name="save" />保存并继续</button>
          {downloadPending && <button className="annotation-action" disabled={busy} onClick={() => { try { confirmDownloaded(); finish(true); } catch (error) { setSaveMessage(error instanceof Error ? error.message : String(error)); } }}>确认文件已保存并继续</button>}
          <button className="annotation-action annotation-action-danger" disabled={busy} onClick={() => finish(true)}><AnnotationIcon name="trash" />丢弃并继续</button>
          <button className="annotation-action" disabled={busy} autoFocus onClick={() => finish(false)}><AnnotationIcon name="close" />取消</button>
        </div>
      </section>
    </div>}
  </Context.Provider>;
}
export function useAnnotations(): AnnotationState {
  const state = useContext(Context);
  if (!state) throw new Error('标注会话未初始化');
  return state;
}
