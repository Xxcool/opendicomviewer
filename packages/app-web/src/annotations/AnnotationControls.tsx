import { useEffect, useRef, useState } from 'react';
import type { MeasurementRecord } from '@opendicomviewer/core';
import { FLUSH_ANNOTATION_NOTE, useAnnotations } from './AnnotationContext';
import { AnnotationToolMenu } from './AnnotationToolMenu';
import { AnnotationIcon } from './AnnotationIcon';

export function AnnotationControls({ enabled }: { enabled: boolean }) {
  const state = useAnnotations();
  return <div className="tool-group" role="group" aria-label="标注与测量">
    <AnnotationToolMenu group="measurement" enabled={enabled} />
    <AnnotationToolMenu group="annotation" enabled={enabled} />
    <button type="button" className="workspace-control" aria-label="标注列表" onClick={() => state.setPanelOpen(!state.panelOpen)} aria-expanded={state.panelOpen}>
      <AnnotationIcon name="list" /><span>标注列表{state.records.length > 0 ? ` (${state.records.length})` : ''}</span>
    </button>
  </div>;
}
export function AnnotationPanel({ navigate, seriesUid }: { navigate: (sop: string, frame: number) => void; seriesUid: string }) {
  const state = useAnnotations();
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  if (!state.panelOpen) return null;
  const records = state.records.filter(record => record.seriesInstanceUid === seriesUid && record.sessionId === state.sessionId);
  const selected = records.find(record => record.id === state.selected);
  const run = (action: () => void) => {
    try { action(); setMessage(''); setFailed(false); } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const save = async () => {
    try {
      const result = await state.saveAnnotations();
      setFailed(false);
      setMessage(result === 'saved' ? (state.session.isDirty ? '已保存导出时的版本，当前仍有未保存修改。' : '标注已保存。') : result === 'cancelled' ? '已取消保存。' : '下载已发起，请确认文件保存成功后点击「确认已保存」。');
    } catch (error) { setFailed(true); setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
  };
  const restore = async (file: File) => {
    setRestoring(true);
    try {
      const restored = await state.restoreAnnotations(file);
      setFailed(false); setMessage(restored ? '标注已恢复，可继续编辑；撤销可返回恢复前的内容。' : '已取消恢复，当前标注仍保留。');
    } catch (error) { setFailed(true); setMessage(`恢复失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setRestoring(false); }
  };
  return <section data-annotation-panel="true" aria-label="标注与测量列表" className="annotation-panel" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <div className="annotation-panel-heading"><strong>标注与测量{state.session.isDirty ? ' · 未保存' : ''}</strong><button className="annotation-action annotation-icon-button" aria-label="关闭标注列表" onClick={() => state.setPanelOpen(false)}><AnnotationIcon name="close" /></button></div>
    <p className="text-txt-muted mb-2">测量值仅供参考，未经临床验证。按 Esc 取消绘制。</p>
    <div className="annotation-actions">
      <button className="annotation-action" disabled={!state.session.canUndo} onClick={() => run(() => { state.session.undo(); })}><AnnotationIcon name="undo" />撤销</button>
      <button className="annotation-action" disabled={!state.session.canRedo} onClick={() => run(() => { state.session.redo(); })}><AnnotationIcon name="redo" />重做</button>
      <button className="annotation-action annotation-action-primary" disabled={!state.records.length} onClick={() => void save()}><AnnotationIcon name="save" />保存标注</button>
      <button className="annotation-action" disabled={restoring} onClick={() => restoreInput.current?.click()}><AnnotationIcon name="undo" />{restoring ? '恢复中…' : '恢复标注'}</button>
      <input ref={restoreInput} type="file" accept=".json,application/json" aria-label="选择标注 JSON 备份" hidden onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void restore(file);
      }} />
    </div>
    {state.downloadPending && <button className="annotation-action" onClick={() => run(state.confirmDownloaded)}>确认文件已保存</button>}
    {!records.length && <p className="text-txt-muted">尚无标注，请选择测距、箭头或文字后在图像上绘制。</p>}
    <p className="text-txt-muted mb-1">当前序列</p>
    <ul>{records.map((record, index) => <li key={record.id} className="mb-1">
      <button className={`w-full text-left rounded p-2 ${state.selected === record.id ? 'bg-selected' : 'hover:bg-hover'}`} onClick={() => { state.select(record.id); navigate(record.sopInstanceUid, record.frameIndex); }}>
        {index + 1}. {record.type === 'length' ? `${record.stats.lengthMm?.toFixed(2) ?? '--'} mm` : record.type === 'arrow' ? '箭头' : '文字'}{record.text ? ` · ${record.text}` : ''}
      </button>
    </li>)}</ul>
    {selected && <div className="annotation-editor">
      <AnnotationNoteEditor key={selected.id} record={selected} commit={text => run(() => state.session.update({ ...selected, text }))} />
      <button className="annotation-action annotation-action-danger" onClick={() => run(() => { state.session.remove(selected.id); state.select(null); })}><AnnotationIcon name="trash" />删除选中</button>
    </div>}
    {message && <p role={failed ? "alert" : "status"} className={`annotation-status ${failed ? "is-error" : ""}`}>{message}</p>}
  </section>;
}

function AnnotationNoteEditor({ record, commit }: { record: MeasurementRecord; commit: (text: string) => void }) {
  const [text, setText] = useState(record.text ?? '');
  const draft = useRef(text);
  const cancelled = useRef(false);
  useEffect(() => { draft.current = record.text ?? ''; setText(draft.current); }, [record.text]);
  useEffect(() => {
    // 原生退出和浏览器离开不保证触发 blur，先把备注草稿纳入保存与离开检查。
    const flush = () => { if (draft.current !== (record.text ?? '')) commit(draft.current); };
    window.addEventListener(FLUSH_ANNOTATION_NOTE, flush);
    return () => window.removeEventListener(FLUSH_ANNOTATION_NOTE, flush);
  }, [record.text, commit]);
  return <label className="block">备注<input autoFocus className="annotation-note-input" aria-label="标注备注" value={text}
    onChange={event => { draft.current = event.target.value; setText(draft.current); }} onBlur={() => {
      if (!cancelled.current && text !== (record.text ?? '')) commit(text);
      cancelled.current = false;
    }} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { cancelled.current = true; draft.current = record.text ?? ''; setText(draft.current); event.currentTarget.blur(); }
    }} /></label>;
}
