import { useEffect, useMemo, useState, type DragEvent } from 'react';
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
import { MetadataPanel } from './components/MetadataPanel';
import { ImportFailuresDialog } from './components/ImportFailuresDialog';
import { useViewerStore } from './state/viewer-store';
import { SpinnerIcon, WarningIcon } from './components/Icons';

export function App() {
  const dataSource = useMemo(() => new LocalDataSource(), []);
  const [renderer, setRenderer] = useState<CornerstoneRenderer | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { importStatus, setImportStatus } = useViewerStore();
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
  }, [setImportStatus]);

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

      {/* 主工作区 */}
      <div className="flex-1 flex overflow-hidden">
        <SeriesList dataSource={dataSource} />
        <Viewport
          renderer={renderer}
          viewportId="default-viewport"
          onLoadSample={loadSample}
        />
        <MetadataPanel />
      </div>
    </div>
  );
}
