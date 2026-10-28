import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { LocalDataSource } from '@opendicomviewer/source-local';
import {
  createCornerstoneRenderer,
  type CornerstoneRenderer,
} from '@opendicomviewer/renderer-cs3d';
import { createCs3dModule } from './bridge/cs3d-adapter';
import { registerCs3dBridge } from './bridge/cs3d-bridge';
import { fileToImportCandidate } from './bridge/candidate';
import { loadSampleCandidates } from './bridge/sample-loader';
import { Header } from './components/Header';
import { SeriesList } from './components/SeriesList';
import { Viewport } from './components/Viewport';
import { MetadataPanel } from './components/MetadataPanel';
import { useViewerStore } from './state/viewer-store';
import { SpinnerIcon, WarningIcon } from './components/Icons';

export function App() {
  const dataSource = useMemo(() => new LocalDataSource(), []);
  const [renderer, setRenderer] = useState<CornerstoneRenderer | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { importStatus, setImportStatus, setStudies, setActiveSeries } =
    useViewerStore();

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

  const loadCandidates = async (candidates: ImportCandidate[]) => {
    setImportStatus({
      loading: true,
      message: `正在解析 ${candidates.length} 个候选文件...`,
    });
    try {
      const studies = await dataSource.probe({ files: candidates });
      if (studies.length === 0) {
        setImportStatus({
          loading: false,
          error: '未发现有效的 DICOM 影像文件。',
        });
        return;
      }
      setStudies(studies);

      const firstStudy = studies[0]!;
      const seriesList = await dataSource.listSeries(firstStudy.studyInstanceUid);
      const firstSeries = seriesList[0];
      if (firstSeries) {
        const handle = await dataSource.openSeries({
          studyInstanceUid: firstStudy.studyInstanceUid,
          seriesInstanceUid: firstSeries.seriesInstanceUid,
        });
        setActiveSeries(handle);
      }
      setImportStatus({ loading: false });
    } catch (err: unknown) {
      setImportStatus({
        loading: false,
        error: `解析失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleLoadSample = async (datasetId?: string) => {
    setImportStatus({
      loading: true,
      message: datasetId
        ? `正在加载示例数据集 ${datasetId}...`
        : '正在加载示例数据集（MR + CT）...',
    });
    try {
      const candidates = await loadSampleCandidates(datasetId);
      await loadCandidates(candidates);
    } catch (err: unknown) {
      setImportStatus({
        loading: false,
        error: `加载示例失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const candidates = files.map(fileToImportCandidate);
    await loadCandidates(candidates);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="w-screen h-screen flex flex-col bg-[#0B0F17] text-gray-200 overflow-hidden relative"
    >
      <Header dataSource={dataSource} />

      {/* 拖拽上传全屏提示层 */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-950/80 border-2 border-dashed border-blue-400 z-50 flex items-center justify-center backdrop-blur-xs pointer-events-none">
          <div className="text-blue-200 text-lg font-semibold flex items-center space-x-2">
            <span>松开鼠标以导入 DICOM 文件</span>
          </div>
        </div>
      )}

      {/* 错误提示横条 */}
      {importStatus.error && (
        <div className="bg-red-950/80 border-b border-red-700/60 px-4 py-2 flex items-center justify-between text-xs text-red-200 z-50">
          <div className="flex items-center space-x-2">
            <WarningIcon className="w-4 h-4 text-red-400 shrink-0" />
            <span>{importStatus.error}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportStatus({ loading: false, error: undefined })}
            className="px-2 py-0.5 rounded hover:bg-red-900/60 text-red-300 cursor-pointer"
          >
            关闭
          </button>
        </div>
      )}

      {/* 导入进度提示模态框 */}
      {importStatus.loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-[#121826] border border-gray-700 rounded-lg p-6 shadow-2xl flex flex-col items-center space-y-3 max-w-sm text-center">
            <SpinnerIcon className="w-8 h-8 text-blue-500" />
            <div className="text-sm font-semibold text-gray-100">
              {importStatus.message || '正在读取影像数据...'}
            </div>
            <div className="text-xs text-gray-400">
              正在执行魔数探测、DICOMDIR 校验与几何构建
            </div>
          </div>
        </div>
      )}

      {/* 主工作区 */}
      <div className="flex-1 flex overflow-hidden">
        <SeriesList dataSource={dataSource} />
        <Viewport
          renderer={renderer}
          viewportId="default-viewport"
          onLoadSample={handleLoadSample}
        />
        <MetadataPanel />
      </div>
    </div>
  );
}
