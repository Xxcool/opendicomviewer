import { useEffect, useRef, type ChangeEvent } from 'react';
import type { DataSourcePort, ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { loadSampleCandidates } from '../bridge/sample-loader';
import { useViewerStore } from '../state/viewer-store';
import { FolderIcon, ResetIcon, SpinnerIcon } from './Icons';

interface HeaderProps {
  readonly dataSource: DataSourcePort;
}

export function Header({ dataSource }: HeaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { importStatus, setImportStatus, setStudies, setActiveSeries, reset } =
    useViewerStore();

  const handleOpenFolderClick = () => {
    folderInputRef.current?.click();
  };

  const handleOpenFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setImportStatus({ loading: false, message: undefined });
  };

  const processCandidates = async (candidates: ImportCandidate[]) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setImportStatus({
      loading: true,
      message: `正在扫描 ${candidates.length} 个候选文件...`,
    });

    try {
      const studies = await dataSource.probe(
        { files: candidates },
        abortController.signal,
      );

      if (studies.length === 0) {
        setImportStatus({
          loading: false,
          error: '未在所选文件或目录中发现有效的 DICOM 影像文件或 DICOMDIR。',
        });
        return;
      }

      setStudies(studies);

      const firstStudy = studies[0]!;
      const seriesList = await dataSource.listSeries(firstStudy.studyInstanceUid);
      const firstSeries = seriesList[0];

      if (firstSeries) {
        const firstHandle = await dataSource.openSeries(
          {
            studyInstanceUid: firstStudy.studyInstanceUid,
            seriesInstanceUid: firstSeries.seriesInstanceUid,
          },
          abortController.signal,
        );
        setActiveSeries(firstHandle);
      }

      setImportStatus({ loading: false, message: undefined });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setImportStatus({ loading: false, message: undefined });
        return;
      }
      setImportStatus({
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : `导入失败：${String(err)}`,
      });
    } finally {
      abortControllerRef.current = null;
      if (folderInputRef.current) folderInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const candidates = Array.from(fileList).map(fileToImportCandidate);
    await processCandidates(candidates);
  };

  /**
   * 载入示例数据集。不传 id 时载入 sample-dicom/ 下的**全部**数据集——
   * 这是演示"跨序列切换"的前提：单数据集只有一条序列，左栏只有一个可点项。
   */
  const handleLoadSample = async (datasetId?: string) => {
    setImportStatus({
      loading: true,
      message: datasetId
        ? `正在加载示例数据集 ${datasetId}...`
        : '正在加载示例数据集（MR + CT）...',
    });
    try {
      const candidates = await loadSampleCandidates(datasetId);
      await processCandidates(candidates);
    } catch (err: unknown) {
      setImportStatus({
        loading: false,
        error: `加载示例失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // 支持 ?sample=1 / ?sample=all / ?sample=brain-mr：Demo 分享链接与自动化验证都靠它
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    const param = new URLSearchParams(window.location.search).get('sample');
    if (!param) return;
    autoLoadedRef.current = true;
    void handleLoadSample(param === '1' || param === 'all' ? undefined : param);
  }, []);

  return (
    <header className="h-14 border-b border-gray-800 bg-[#0F1420] px-4 flex items-center justify-between select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2.5 shrink-0">
          <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center font-bold text-white text-xs leading-none shrink-0 shadow-sm select-none">
            ODV
          </div>
          <span className="font-semibold text-gray-100 text-base tracking-tight shrink-0">
            OpenDicomViewer
          </span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 shrink-0">
          仅供科研教学与影像分析参考
        </span>
      </div>

      <div className="flex items-center space-x-2.5">
        {/* 选择文件夹 */}
        <input
          ref={folderInputRef}
          type="file"
          {...({
            webkitdirectory: '',
            directory: '',
            multiple: true,
          } as React.InputHTMLAttributes<HTMLInputElement>)}
          className="hidden"
          onChange={handleFilesSelected}
        />

        {/* 选择单个或多个文件 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />

        {importStatus.loading ? (
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-md bg-red-800 hover:bg-red-700 active:bg-red-900 text-white text-sm font-medium transition cursor-pointer"
          >
            <SpinnerIcon className="w-4 h-4" />
            <span>取消导入</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleLoadSample()}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-medium transition cursor-pointer shadow-xs"
              title="载入 sample-dicom/ 下的全部示例（脑部 MR 36 帧 + 胸腹 CT），可验证跨序列切换"
            >
              <span>载入示例</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFileClick}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 active:bg-gray-900 text-gray-200 text-sm font-medium transition cursor-pointer border border-gray-700"
            >
              <span>打开文件</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFolderClick}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition cursor-pointer"
            >
              <FolderIcon className="w-4 h-4" />
              <span>打开文件夹</span>
            </button>
          </>
        )}

        <button
          type="button"
          onClick={reset}
          title="清空当前会话"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition cursor-pointer"
        >
          <ResetIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
