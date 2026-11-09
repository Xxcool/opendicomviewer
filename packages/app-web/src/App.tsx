import type { HostOriginalSaver } from './bridge/host-original-saver';
import type { HostPngSaver } from './bridge/host-png-saver';
import { ImportProgressDialog } from './components/ImportProgressDialog';
import type { HostCloseGuard } from './bridge/host-close-guard';
import type { HostFileSaver } from './bridge/host-file-saver';
import { AnnotationProvider, useAnnotations } from './annotations/AnnotationContext';
import type { ImportCandidate } from '@opendicomviewer/core';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { PixelCodec } from '@opendicomviewer/codec-wasm';
import { LocalDataSource } from '@opendicomviewer/source-local';
import {
  createCornerstoneRenderer,
  type CornerstoneRenderer,
} from '@opendicomviewer/renderer-cs3d';
import { createCs3dModule } from './bridge/cs3d-adapter';
import { registerCs3dBridge } from './bridge/cs3d-bridge';
import { fileToImportCandidate } from './bridge/candidate';
import { useImportFlow } from './import-flow';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Header } from './components/Header';
import { SeriesList } from './components/SeriesList';
import { Viewport } from './components/Viewport';
import { MprWorkspace, type MprNavigationSession } from './components/MprWorkspace';
import { SplitWorkspace, type SplitNavigationSession } from './components/SplitWorkspace';
import { MetadataPanel } from './components/MetadataPanel';
import { ImportFailuresDialog } from './components/ImportFailuresDialog';
import { useViewerStore } from './state/viewer-store';
import { LAYOUTS, type LayoutMode } from './layout/viewport-layouts';
import { WorkspaceToolbar } from './components/WorkspaceToolbar';
import { SpinnerIcon, WarningIcon } from './components/Icons';
import type { HostFilePicker } from './bridge/host-file-picker';

interface AppProps { savePng?: HostPngSaver; saveOriginals?: HostOriginalSaver; filePicker?: HostFilePicker; openProject?: () => Promise<void>; saveFile?: HostFileSaver; closeGuard?: HostCloseGuard }
export function App(props: AppProps) {
  const dataSource = useMemo(() => new LocalDataSource(new PixelCodec()), []);
  return <AnnotationProvider dataSource={dataSource} saveFile={props.saveFile} closeGuard={props.closeGuard}><ViewerApp {...props} dataSource={dataSource} /></AnnotationProvider>;
}
function ViewerApp({ filePicker, openProject, dataSource, saveOriginals, savePng }: AppProps & { dataSource: LocalDataSource }) {
  const annotations = useAnnotations();
  const [renderer, setRenderer] = useState<CornerstoneRenderer | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  /** MPR 准星会话跨布局保留，不参与高频 React 状态更新。 */
  const splitNavigation = useRef<SplitNavigationSession>(new Map());
  const mprNavigation = useRef<MprNavigationSession>({ seriesUid: null, crosshair: null });
  /** setLayout 已成功应用的模式；null = 尚在切换中，MPR 组件不得提前装载数据 */
  const [appliedLayout, setAppliedLayout] = useState<LayoutMode | null>(null);
  /**
   * setLayout 串行队列。
   *
   * 连续切换布局时若并发调用 setLayout，后一次会在前一次 `await` 期间完成，
   * 前一次恢复后又会按旧布局销毁/启用视口——实测会把刚建好的 MPR 视口拆掉，
   * 导致体积 actor 指向已销毁的 imageData（`model.extent is not iterable`）。
   * 串行化后「最后一次点击」一定最后执行，且中间不会互相拆台。
   */
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  const {
    importStatus,
    setImportStatus,
    setRendererCapabilities,
    layoutMode,
    activeSeriesHandle,
    studies,
    seriesPanelOpen, inspectorOpen, focusMode,
  } = useViewerStore();
  const hasWorkspace = !!activeSeriesHandle || layoutMode === 'split-2x2';
  useEffect(() => {
    // 新导入是新的数据会话，不能按相同 UID 继承上一次的定位。
    mprNavigation.current = { seriesUid: null, crosshair: null };
    splitNavigation.current.clear();
    setHomeOpen(false);
  }, [studies]);
  // 导入流程（三条入口共用）：探针 → 失败汇总 → 打开首序列
  const {
    pendingFailures,
    importCandidates: importRaw,
    loadSample: loadSampleRaw,
    cancel: cancelImport,
    confirmPendingFailures,
  } = useImportFlow(dataSource);
  const importCandidates = useCallback(async (files: readonly ImportCandidate[]) => {
    if (files.length && await annotations.confirmReplacement()) await importRaw(files);
  }, [annotations.confirmReplacement, importRaw]);
  const loadSample = useCallback(async (id?: string) => {
    if (await annotations.confirmReplacement()) await loadSampleRaw(id);
  }, [annotations.confirmReplacement, loadSampleRaw]);

  const openLocal = (mode: 'files' | 'folder') => {
    if (!filePicker) {
      document.getElementById(mode === 'folder' ? 'odv-folder-input' : 'odv-file-input')?.click();
      return;
    }
    void filePicker.pick(mode).then(files => { if (files.length) return importCandidates(files); })
      .catch(error => setImportStatus({ loading: false, error: `打开本地影像失败：${error instanceof Error ? error.message : String(error)}` }));
  };
  useEffect(() => {
    if (!filePicker) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void filePicker.subscribe(files => { if (!cancelled) void importCandidates(files); },
      error => { if (!cancelled) setImportStatus({ loading: false, error }); })
      .then(unsubscribe => { if (cancelled) unsubscribe(); else stop = unsubscribe; })
      .catch(error => { if (!cancelled) setImportStatus({ loading: false, error: `原生文件导入初始化失败：${String(error)}` }); });
    return () => { cancelled = true; stop?.(); };
  }, [filePicker, importCandidates, setImportStatus]);

  // 渲染器生命周期上提至 App 组合根，确保 StrictMode 双调用下安全重建 (P0-1)
  useEffect(() => {
    let cancelled = false;

    const r = createCornerstoneRenderer({
      cs3d: createCs3dModule(),
    });
    const bridge = registerCs3dBridge(r);

    async function mountRenderer() {
      try {
        await r.mount(
          { containerId: 'odv-viewport-el' },
          { rows: 1, cols: 1, viewportIds: ['default-viewport'] },
        );
        if (!cancelled) {
          setRenderer(r);
          setRendererCapabilities(r.capabilities());
        }
      } catch (err: unknown) {
        if (!cancelled) {
          // 挂载失败向用户显式展示，杜绝静默黑屏 (P1-1 / R7)
          setImportStatus({
            loading: false,
            error: `渲染引擎初始化失败: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    void mountRenderer();

    return () => {
      cancelled = true;
      bridge.unregister();
      r.destroy();
      setRenderer(null);
    };
  }, [setImportStatus, setRendererCapabilities]);

  /**
   * 布局切换：必须等 setLayout 完成后才允许 MPR 组件装载 Stack/Volume，
   * 否则会向尚未创建的 ORTHOGRAPHIC 视口写入数据（端口会直接抛错）。
   */
  useEffect(() => {
    if (!renderer) return;
    let cancelled = false;

    async function applyLayout() {
      const queued = layoutQueueRef.current
        .catch(() => undefined)
        .then(() => renderer!.setLayout(LAYOUTS[layoutMode].viewportLayout));
      layoutQueueRef.current = queued;
      try {
        await queued;
        if (!cancelled) setAppliedLayout(layoutMode);
      } catch (err: unknown) {
        if (cancelled) return;
        setAppliedLayout(null);
        setImportStatus({
          loading: false,
          error: `布局切换失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    void applyLayout();

    return () => {
      cancelled = true;
    };
  }, [renderer, layoutMode, setImportStatus]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    // 桌面拖入由 Rust 取得路径并授权，不能退回浏览器 File API 绕开原生读取契约。
    if (filePicker) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    void importCandidates(files.map(fileToImportCandidate));
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="w-screen h-screen flex flex-col bg-app text-txt overflow-hidden relative"
    >
      <Header
        onGoHome={() => setHomeOpen(true)}
        onImportCandidates={importCandidates}
        onLoadSample={loadSample}
        onCancelImport={cancelImport}
        onOpenFolder={filePicker ? () => openLocal('folder') : undefined}
        onOpenFiles={filePicker ? () => openLocal('files') : undefined}
        onOpenProject={openProject ? () => { void openProject().catch(() => setImportStatus({ loading: false, error: '无法打开 GitHub 仓库，请检查系统浏览器设置' })); } : undefined}
      />

      {hasWorkspace && !homeOpen && <WorkspaceToolbar savePng={savePng} saveOriginals={saveOriginals} renderer={renderer} desktop={Boolean(filePicker)} ready={appliedLayout === layoutMode && !importStatus.loading} />}

      {/* 拖拽上传全屏提示层 */}
      {isDragOver && (
        <div className="absolute inset-0 bg-app/90 border-2 border-dashed border-accent z-50 flex items-center justify-center backdrop-blur-xs pointer-events-none">
          <div className="text-accent text-lg font-semibold flex items-center space-x-2">
            <span>松开鼠标以导入 DICOM 文件</span>
          </div>
        </div>
      )}

      {/* 错误提示横条 */}
      {importStatus.error && (
        <div className="bg-danger/15 border-b border-danger/40 px-4 py-2 flex items-center justify-between text-xs text-danger z-50">
          <div className="flex items-center space-x-2">
            <WarningIcon className="w-4 h-4 text-danger shrink-0" />
            <span>{importStatus.error}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportStatus({ loading: false, error: undefined })}
            className="px-2 py-0.5 rounded hover:bg-danger/20 text-danger cursor-pointer"
          >
            关闭
          </button>
        </div>
      )}

      {/* 导入进度提示模态框 */}
      {importStatus.loading && <ImportProgressDialog status={importStatus} onCancel={cancelImport} />}

      {/* 部分失败汇总模态（§5）：用户确认后才载入成功部分 */}
      {pendingFailures && (
        <ImportFailuresDialog
          outcome={pendingFailures}
          onConfirm={confirmPendingFailures}
        />
      )}

      {/* 主工作区：三栏布局，宽度统一走 CSS token */}
      <div className="flex-1 flex overflow-hidden min-w-0 relative">
        {homeOpen && <div data-viewer-home="true" className="absolute inset-0 z-20 bg-app overflow-auto">
          {hasWorkspace && <div className="flex justify-center pt-4"><button className="workspace-control" onClick={() => setHomeOpen(false)}>继续阅片</button></div>}
          <WelcomeScreen onOpenFolder={() => openLocal('folder')} onOpenFiles={() => openLocal('files')} onLoadSample={loadSample} />
        </div>}
        <div className="contents" inert={homeOpen}>
        <div
          id="series-panel"
          hidden={!hasWorkspace || !seriesPanelOpen || focusMode}
          className="workspace-series shrink-0 border-r border-line bg-panel overflow-hidden"
          style={{ width: 'var(--left-w)' }}
        >
          <SeriesList dataSource={dataSource} />
        </div>
        {/*
          CS3D 挂载容器由 App 持久持有：布局在 1×1 ↔ MPR 间切换时组件会卸载重建，
          但 #odv-viewport-el 必须始终是同一个 DOM 节点，否则 setLayout 会操作到
          已脱离文档的旧容器（视口全部丢失）。
        */}
        <div className="flex-1 relative flex flex-col min-w-0 bg-app">
          <div
            className="absolute inset-x-0 z-0"
            style={{
              top: hasWorkspace ? 'var(--vp-bar-h)' : 0,
              bottom: hasWorkspace ? 'var(--vp-foot-h)' : '0',
            }}
          >
            <div
              id="odv-viewport-el"
              data-odv-viewport="default-viewport"
              style={layoutMode === '1x1' ? undefined : LAYOUTS[layoutMode].gridStyle}
              className={`absolute inset-0 w-full h-full touch-none ${
                layoutMode === '1x1' ? '' : 'bg-line'
              }`}
            >
              {layoutMode !== '1x1' &&
                LAYOUTS[layoutMode].panes.map((pane) => (
                  <div
                    key={pane.viewportId}
                    data-odv-viewport={pane.viewportId}
                    style={{ gridArea: pane.gridArea }}
                    className="min-w-0 min-h-0 overflow-hidden"
                  />
                ))}
            </div>
          </div>

          {appliedLayout === layoutMode ? (
            layoutMode === '1x1' ? (
              <Viewport
                renderer={renderer}
                viewportId="default-viewport"
                onLoadSample={loadSample}
                onOpenFolder={() => openLocal('folder')}
                onOpenFiles={() => openLocal('files')}
              />
            ) : layoutMode === 'split-2x2' && renderer ? (
              <SplitWorkspace renderer={renderer} session={splitNavigation} />
            ) : (
              <MprWorkspace
                renderer={renderer}
                mode={layoutMode}
                navigationSession={mprNavigation}
                layoutReady={appliedLayout === layoutMode}
                onLoadSample={loadSample}
              />
            )
          ) : (
            <div
              className="absolute inset-x-0 z-10 flex items-center justify-center text-xs text-txt-dim pointer-events-none"
              style={{
                top: hasWorkspace ? 'var(--vp-bar-h)' : 0,
                bottom: hasWorkspace ? 'var(--vp-foot-h)' : '0',
              }}
            >
              <SpinnerIcon className="w-4 h-4 text-accent mr-2" />
              <span>正在切换布局…</span>
            </div>
          )}
        </div>
        <div id="inspector-panel" hidden={!hasWorkspace || !inspectorOpen || focusMode} className="workspace-inspector shrink-0 h-full">
          <MetadataPanel />
        </div>
        </div>
      </div>
    </div>
  );
}
