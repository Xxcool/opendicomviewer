import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
import { Header } from './components/Header';
import { SeriesList } from './components/SeriesList';
import { Viewport } from './components/Viewport';
import { MprWorkspace } from './components/MprWorkspace';
import { MetadataPanel } from './components/MetadataPanel';
import { ImportFailuresDialog } from './components/ImportFailuresDialog';
import { useViewerStore } from './state/viewer-store';
import { LAYOUTS, type LayoutMode } from './layout/viewport-layouts';
import { SpinnerIcon, WarningIcon } from './components/Icons';

export function App() {
  // 压缩像素解码器由组合根注入；重解码库本身在 PixelCodec 内部按需动态加载
  const dataSource = useMemo(() => new LocalDataSource(new PixelCodec()), []);
  const [renderer, setRenderer] = useState<CornerstoneRenderer | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
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
  } = useViewerStore();
  // 导入流程（三条入口共用）：探针 → 失败汇总 → 打开首序列
  const {
    pendingFailures,
    importCandidates,
    loadSample,
    cancel: cancelImport,
    confirmPendingFailures,
  } = useImportFlow(dataSource);

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
        onImportCandidates={importCandidates}
        onLoadSample={loadSample}
        onCancelImport={cancelImport}
      />

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
      {importStatus.loading && (
        <div className="absolute inset-0 bg-canvas/60 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-elevated border border-line rounded-lg p-6 shadow-2xl flex flex-col items-center space-y-3 max-w-sm text-center">
            <SpinnerIcon className="w-8 h-8 text-accent" />
            <div className="text-sm font-semibold text-txt">
              {importStatus.message || '正在读取影像数据...'}
            </div>
            <div className="text-xs text-txt-dim">
              正在执行魔数探测、DICOMDIR 校验与几何构建
            </div>
          </div>
        </div>
      )}

      {/* 部分失败汇总模态（§5）：用户确认后才载入成功部分 */}
      {pendingFailures && (
        <ImportFailuresDialog
          outcome={pendingFailures}
          onConfirm={confirmPendingFailures}
        />
      )}

      {/* 主工作区：三栏布局，宽度统一走 CSS token */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        <div
          className="shrink-0 border-r border-line bg-panel overflow-hidden"
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
              top: 'var(--vp-bar-h)',
              bottom: activeSeriesHandle ? 'var(--vp-foot-h)' : '0',
            }}
          >
            <div
              id="odv-viewport-el"
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
              />
            ) : (
              <MprWorkspace
                renderer={renderer}
                mode={layoutMode}
                layoutReady={appliedLayout === layoutMode}
                onLoadSample={loadSample}
              />
            )
          ) : (
            <div
              className="absolute inset-x-0 z-10 flex items-center justify-center text-xs text-txt-dim pointer-events-none"
              style={{
                top: 'var(--vp-bar-h)',
                bottom: activeSeriesHandle ? 'var(--vp-foot-h)' : '0',
              }}
            >
              <SpinnerIcon className="w-4 h-4 text-accent mr-2" />
              <span>正在切换布局…</span>
            </div>
          )}
        </div>
        <MetadataPanel />
      </div>
    </div>
  );
}
