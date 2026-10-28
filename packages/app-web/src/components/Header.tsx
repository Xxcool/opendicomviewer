import { useEffect, useRef, type ChangeEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { useViewerStore } from '../state/viewer-store';
import { FolderIcon, ResetIcon, SpinnerIcon } from './Icons';

interface HeaderProps {
  /** 与拖拽、示例共用同一条导入流程（含部分失败汇总），不在顶栏另写一份 */
  readonly onImportCandidates: (candidates: readonly ImportCandidate[]) => void;
  /** 不传 id 时载入 sample-dicom/ 下的全部数据集，才能演示跨序列切换 */
  readonly onLoadSample: (datasetId?: string) => void;
  readonly onCancelImport: () => void;
}

export function Header({
  onImportCandidates,
  onLoadSample,
  onCancelImport,
}: HeaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { importStatus, reset } = useViewerStore();

  const handleOpenFolderClick = () => {
    folderInputRef.current?.click();
  };

  const handleOpenFileClick = () => {
    fileInputRef.current?.click();
  };

  const resetInputValues = () => {
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const candidates = Array.from(fileList).map(fileToImportCandidate);
    // 立刻清空，否则再次选择同一目录不会触发 change
    resetInputValues();
    onImportCandidates(candidates);
  };

  // 支持 ?sample=1 / ?sample=all / ?sample=brain-mr：Demo 分享链接与自动化验证都靠它
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    const param = new URLSearchParams(window.location.search).get('sample');
    if (!param) return;
    autoLoadedRef.current = true;
    onLoadSample(param === '1' || param === 'all' ? undefined : param);
  }, [onLoadSample]);

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
            onClick={onCancelImport}
            className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-md bg-red-800 hover:bg-red-700 active:bg-red-900 text-white text-sm font-medium transition cursor-pointer"
          >
            <SpinnerIcon className="w-4 h-4" />
            <span>取消导入</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onLoadSample()}
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
