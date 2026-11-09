import type { HostOriginalSaver } from '../bridge/host-original-saver';
import type { HostPngSaver } from '../bridge/host-png-saver';
import { PngExportControl } from '../export/PngExportControl';
import { AnnotationControls } from '../annotations/AnnotationControls';
import { useAnnotations } from '../annotations/AnnotationContext';
import { useEffect, useMemo } from 'react';
import { planVolumeDownsample } from '@opendicomviewer/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { useViewerStore, type ViewTool } from '../state/viewer-store';
import { LAYOUTS, LAYOUT_MODES } from '../layout/viewport-layouts';
import { WorkspaceIcon } from './WorkspaceIcon';
import { ToolbarMenu } from './ToolbarMenu';
import { blocksViewerShortcut, notifyCameraChanged } from './viewport-gestures';

const tools: { id: ViewTool; label: string; key: string }[] = [
  { id: 'browse', label: '翻页', key: 'B' }, { id: 'window', label: '调窗', key: 'W' },
  { id: 'pan', label: '平移', key: 'P' }, { id: 'zoom', label: '缩放', key: 'Z' },
];

export function WorkspaceToolbar({ renderer, ready, desktop = false, saveOriginals, savePng }: { renderer: CornerstoneRenderer | null; ready: boolean; desktop?: boolean; saveOriginals?: HostOriginalSaver; savePng?: HostPngSaver }) {
  const state = useViewerStore();
  const annotations = useAnnotations();
  const plan = useMemo(() => state.activeSeriesHandle
    ? planVolumeDownsample(state.activeSeriesHandle.meta) : null, [state.activeSeriesHandle]);
  const canWindow = state.layoutMode === 'split-2x2' || state.activeViewportId === 'default-viewport';
  const disabled = !renderer || !ready || !state.activeSeriesHandle;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (disabled || blocksViewerShortcut(event)) return;
      const tool = tools.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (tool && (tool.id !== 'window' || canWindow)) { event.preventDefault(); annotations.setTool('none'); state.setActiveTool(tool.id); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); state.toggleFocusMode(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [state.setActiveTool, state.toggleFocusMode, canWindow, disabled]);
  const camera = (action: 'fit' | number) => {
    if (!renderer || disabled) return;
    try {
      if (action === 'fit') renderer.resetView(state.activeViewportId);
      else renderer.zoomBy(state.activeViewportId, action);
      notifyCameraChanged();
    } catch (error) {
      state.setImportStatus({ loading: false, error: `视图操作失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };
  return <div className="workspace-toolbar" aria-label="阅片工具栏" role="toolbar">
    <button className="workspace-control icon-control" title="序列面板" aria-label="序列面板"
      aria-controls="series-panel" aria-expanded={!state.focusMode && state.seriesPanelOpen} onClick={state.toggleSeriesPanel}>
      <WorkspaceIcon name="left" />
    </button>
    <span className="toolbar-divider" />
    <div className="tool-group" role="group" aria-label="鼠标工具">
      {tools.map((tool) => <button key={tool.id} className="workspace-control" disabled={disabled || (tool.id === 'window' && !canWindow)}
        aria-label={tool.label} aria-pressed={state.activeTool === tool.id} title={`${tool.label}（${tool.key}）${tool.id === 'window' && !canWindow ? ' · MPR 为固定灰度' : ''}`}
        onClick={() => { annotations.setTool('none'); state.setActiveTool(tool.id); }}><WorkspaceIcon name={tool.id} /><span>{tool.label}</span></button>)}
    </div>
    <span className="toolbar-divider" />
    <button className="workspace-control" aria-label="适应窗口" title="适应窗口" disabled={disabled} onClick={() => camera('fit')}><WorkspaceIcon name="fit" /><span>适应窗口</span></button>
    <AnnotationControls enabled={!disabled && state.layoutMode === '1x1'} />
    <PngExportControl renderer={renderer} enabled={!disabled && state.layoutMode === '1x1'} desktop={desktop} saveOriginals={saveOriginals} savePng={savePng} />
    <span className="toolbar-spacer" />
    <ToolbarMenu label={`布局 · ${LAYOUTS[state.layoutMode].label}`} icon={<WorkspaceIcon name="layout" />} disabled={!renderer || !ready}>
      {close => <><div className="annotation-menu-heading">视口布局</div>
        {LAYOUT_MODES.filter(mode => mode === '1x1' || mode === 'split-2x2' || (plan?.ok && state.rendererCapabilities?.supportsVolume)).map(mode =>
          <button key={mode} className="annotation-menu-item toolbar-layout-choice" role="menuitemradio" aria-checked={state.layoutMode === mode}
            onClick={() => { state.setLayoutMode(mode); close(); }}><WorkspaceIcon name="layout" /><span><strong>{LAYOUTS[mode].label}</strong><small>{LAYOUTS[mode].hint}</small></span>{state.layoutMode === mode && <span aria-hidden="true">✓</span>}</button>)}
      </>}
    </ToolbarMenu>
    <ToolbarMenu label="更多" icon={<WorkspaceIcon name="more" />} disabled={disabled}>
      {close => <><div className="annotation-menu-heading">视图操作</div>
        <button className="annotation-menu-item" role="menuitem" onClick={() => { camera(1.2); close(); }}><WorkspaceIcon name="zoom" /><span>放大</span></button>
        <button className="annotation-menu-item" role="menuitem" onClick={() => { camera(1 / 1.2); close(); }}><WorkspaceIcon name="zoom" /><span>缩小</span></button>
      </>}
    </ToolbarMenu>
    <button className="workspace-control icon-control" title="影像详情" aria-label={`影像详情${state.warnings.length ? `，${state.warnings.length} 条提醒` : ''}`} aria-controls="inspector-panel" aria-expanded={!state.focusMode && state.inspectorOpen}
      onClick={state.toggleInspector}><WorkspaceIcon name="right" />
      {state.warnings.length > 0 && <span className="toolbar-count" data-severity={state.warnings.some((warning) => warning.severity === 'error') ? 'error' : state.warnings.some((warning) => warning.severity === 'warning') ? 'warning' : 'info'}>{state.warnings.length}</span>}</button>
    <button className="workspace-control icon-control" aria-label={state.focusMode ? '退出专注阅片' : '专注阅片'} title="专注阅片（F）" aria-pressed={state.focusMode} onClick={state.toggleFocusMode}>
      <WorkspaceIcon name="focus" /></button>
  </div>;
}
