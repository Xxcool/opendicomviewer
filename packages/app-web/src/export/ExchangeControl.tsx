import { useEffect, useRef, useState } from 'react';
import { readExchangeDocument } from '@opendicomviewer/source-local';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import type { HostPngSaver } from '../bridge/host-png-saver';
import { FLUSH_ANNOTATION_NOTE, useAnnotations } from '../annotations/AnnotationContext';
import { useViewerStore } from '../state/viewer-store';
import { buildFrameExchange, checkExchangeReference, reportRecords } from './exchange';
import { ExchangePreview, type ExchangePreviewData } from './ExchangePreview';

export function ExchangeControl({ renderer, desktop, save, busy, setBusy }: {
  renderer: CornerstoneRenderer; desktop: boolean; save?: HostPngSaver; busy: boolean; setBusy: (value: boolean) => void;
}) {
  const annotations = useAnnotations();
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ExchangePreviewData | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  const run = async (action: 'GSPS' | 'SR' | 'bundle' | File) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true); setPreview(null); setMessage('正在处理当前帧…');
    try {
      const handle = useViewerStore.getState().activeSeriesHandle;
      const index = renderer.currentSliceIndex('default-viewport');
      const plane = handle?.meta.planes[index];
      if (!handle || !plane) throw new Error('当前原始帧尚未就绪');
      const window = renderer.getVOI('default-viewport');
      const ensureCurrent = () => {
        controller.signal.throwIfAborted();
        if (useViewerStore.getState().activeSeriesHandle !== handle || useViewerStore.getState().layoutMode !== '1x1'
          || renderer.currentSliceIndex('default-viewport') !== index) throw new Error('当前帧已切换，请重新操作');
      };
      if (typeof action !== 'string') {
        if (action.size > 10 * 1024 * 1024) throw new Error('结果文件超过 10 MiB');
        const result = readExchangeDocument(new Uint8Array(await action.arrayBuffer()));
        checkExchangeReference(result, handle, plane);
        if (plane.columns * plane.rows > 16 * 1024 * 1024) throw new Error('当前源帧超过核对图的 16M 像素上限');
        const frame = await handle.pixel(index);
        ensureCurrent();
        setPreview({ result, frame, window: result.kind === 'GSPS' ? result.voi : window }); setMessage('');
        return;
      }
      globalThis.window.dispatchEvent(new Event(FLUSH_ANNOTATION_NOTE));
      const blob = await buildFrameExchange(action, handle, index, annotations.sessionId, annotations.session.list(), window, controller.signal);
      ensureCurrent();
      if (desktop) {
        if (!save) throw new Error('当前宿主缺少 DICOM 保存服务');
        const outcome = await save(blob, controller.signal, action === 'bundle' ? 'results' : action === 'GSPS' ? 'gsps' : 'sr');
        if (!controller.signal.aborted) setMessage(outcome === 'saved' ? (action === 'bundle' ? '结果包' : action) + ' 已保存。' : '已取消保存。');
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = action === 'bundle' ? 'frame-results.zip' : action === 'GSPS' ? 'presentation-state.dcm' : 'distance-report.dcm'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setMessage((action === 'bundle' ? '结果包' : action) + ' 下载已发起。');
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <>
    <p>GSPS 保存当前灰阶帧的窗值、原图坐标图形和备注。测距 SR 仅包含此帧已标定的直线和折线，单位为毫米。</p>
    <p className="text-txt-muted">结果文件引用原始影像并保留患者标识。完整可编辑备份请使用标注列表中的 JSON 保存。</p>
    <div className="annotation-actions">
      <button className="annotation-action" disabled={busy} onClick={() => void run('GSPS')}>导出当前帧 GSPS</button>
      <button className="annotation-action" disabled={busy} onClick={() => void run('SR')}>导出当前帧测距 SR</button>
      <button className="annotation-action" disabled={busy} onClick={() => void run('bundle')}>打包原图与当前帧结果</button>
      <button className="annotation-action" disabled={busy} onClick={() => fileInput.current?.click()}>读取结果文件</button>
      <input hidden aria-label="选择 GSPS 或测距 SR 文件" type="file" ref={fileInput} accept=".dcm,.dicom,application/dicom" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(file);
      }} />
    </div>
    {message && <p role="status" className="annotation-status">{message}</p>}
    {preview && <ExchangePreview {...preview} />}
    {preview?.result.kind === 'SR' && <button className="annotation-action" onClick={() => {
      try {
        const handle = useViewerStore.getState().activeSeriesHandle;
        const plane = handle?.meta.planes[renderer.currentSliceIndex('default-viewport')];
        if (!handle || !plane || preview.result.kind !== 'SR') throw new Error('请先定位到源帧');
        const records = reportRecords(preview.result, handle, plane, annotations.sessionId);
        annotations.session.addAll(records);
        annotations.setPanelOpen(true);
        setMessage(`已加入 ${records.length} 条可编辑测距，可在标注列表中撤销。`);
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    }}>将测距加入标注列表</button>}
  </>;
}
