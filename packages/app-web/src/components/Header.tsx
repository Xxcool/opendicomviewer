import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { useViewerStore } from '../state/viewer-store';
import {
  DiscIcon,
  FileIcon,
  FolderIcon,
  ImportIcon,
  MoonIcon,
  SettingsIcon,
  SpinnerIcon,
  SunIcon,
} from './Icons';
import { SettingsDialog } from './SettingsDialog';
import { LAYOUT_MODES, LAYOUTS } from '../layout/viewport-layouts';

interface HeaderProps {
  /** 与拖拽、示例共用同一条导入流程（含部分失败汇总），不在顶栏另写一份 */
  readonly onImportCandidates: (candidates: readonly ImportCandidate[]) => void;
  /** 不传 id 时载入 sample-dicom/ 下的全部数据集，才能演示跨序列切换 */
  readonly onLoadSample: (datasetId?: string) => void;
  readonly onCancelImport: () => void;
}

/**
 * 顶栏按钮基类（单一真源：docs/design/prototype.html L127-L141）
 *
 * 三个变体：
 * - btn-primary  蓝底白字（主操作）
 * - btn-ghost    带边框（次操作）
 * - btn-default  无边框 hover 变背景（辅助）
 * 统一高度 32px / 圆角 6px / padding 0 12px，避免每个按钮自己写一套尺寸。
 */
const BTN_BASE =
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] transition cursor-pointer select-none border border-transparent';
const BTN_PRIMARY = `${BTN_BASE} bg-accent hover:bg-accent-hover text-white font-medium shadow-xs border-transparent`;
const BTN_GHOST = `${BTN_BASE} bg-hover hover:bg-active text-txt border-line`;
const BTN_DEFAULT = `${BTN_BASE} text-txt-dim hover:text-txt hover:bg-hover border-transparent px-2.5`;
const BTN_SEP = 'w-px h-5 bg-line mx-1';

export function Header({
  onImportCandidates,
  onLoadSample,
  onCancelImport,
}: HeaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 主题来自 store（单一真源），顶栏与设置面板共用，避免任一处显示过期值
  const {
    importStatus,
    theme,
    setTheme,
    layoutMode,
    setLayoutMode,
    rendererCapabilities,
    activeSeriesHandle,
  } = useViewerStore();
  // 能力为 false 时按契约隐藏 MPR 入口，而不是留一个点了会报错的按钮
  const supportsMpr = rendererCapabilities?.supportsVolume === true;
  // 没有序列时整组隐藏：空壳 MPR 切过去只会看到"请载入序列"，徒增迷惑
  const showLayoutGroup = supportsMpr && activeSeriesHandle !== null;
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    <header
      className="border-b border-line bg-panel flex items-center justify-between select-none px-4"
      style={{ height: 'var(--header-h)' }}
    >
      {/* 左：Logo + 品牌 + 用途声明 */}
      <div className="flex items-center gap-3 shrink-0 overflow-hidden">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center font-bold text-white text-[11px] leading-none shadow-sm select-none">
            ODV
          </div>
          <span className="font-semibold text-txt text-[15px] tracking-tight">
            OpenDicomViewer
          </span>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded bg-transparent text-txt-dim border border-line-strong">
          仅供科研教学与影像分析参考
        </span>
      </div>

      {/* 右：按钮组（单一真源顺序：载入示例 | 打开文件/文件夹/读光盘 |——分隔——| 设置/主题）
          gap-1.5 提供按钮间呼吸；分隔条自带 mx-1，与 gap 叠加成 10px 分组距离 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* 隐藏的 file input，由按钮触发 */}
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
            className={`${BTN_PRIMARY} !bg-danger hover:!bg-danger/90`}
          >
            <SpinnerIcon className="w-4 h-4" />
            <span>取消导入</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onLoadSample()}
              className={BTN_PRIMARY}
              title="载入 sample-dicom/ 下的全部示例（脑部 MR 36 帧 + 胸腹 CT），可验证跨序列切换"
            >
              <ImportIcon className="w-4 h-4" />
              <span>载入示例</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFileClick}
              className={BTN_GHOST}
            >
              <FileIcon className="w-4 h-4" />
              <span>打开文件</span>
            </button>

            <button
              type="button"
              onClick={handleOpenFolderClick}
              className={BTN_GHOST}
            >
              <FolderIcon className="w-4 h-4" />
              <span>打开文件夹</span>
            </button>

            {/* 读光盘需要桌面端 + 光驱，浏览器内不可能实现：
                置灰但仍显示，是为了告诉用户"这个能力存在，只是当前环境没有" */}
            <button
              type="button"
              disabled
              title="需要桌面端与光盘驱动，浏览器内不可用"
              className={`${BTN_GHOST} text-disabled cursor-not-allowed opacity-60 hover:bg-hover`}
            >
              <DiscIcon className="w-4 h-4" />
              <span>读光盘</span>
            </button>
          </>
        )}

        {showLayoutGroup && (
          <>
            <span className={BTN_SEP} />
            <div
              role="group"
              aria-label="视口布局"
              className="flex items-center gap-0.5 p-0.5 rounded-md bg-hover/60"
            >
              {LAYOUT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayoutMode(mode)}
                  aria-pressed={layoutMode === mode}
                  title={LAYOUTS[mode].hint}
                  className={`h-6 px-2 rounded-sm text-[11px] font-mono transition cursor-pointer ${
                    layoutMode === mode
                      ? 'bg-accent text-white shadow-xs'
                      : 'text-txt-dim hover:text-txt hover:bg-active/60'
                  }`}
                >
                  {LAYOUTS[mode].label}
                </button>
              ))}
            </div>
          </>
        )}

        <span className={BTN_SEP} />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="设置（快捷键 Ctrl+,）"
          className={BTN_DEFAULT}
        >
          <SettingsIcon className="w-4 h-4" />
          <span>设置</span>
        </button>

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="切换深色/浅色（教学投屏用浅色）"
          className={BTN_DEFAULT}
        >
          {theme === 'dark' ? (
            <SunIcon className="w-4 h-4" />
          ) : (
            <MoonIcon className="w-4 h-4" />
          )}
          <span>{theme === 'dark' ? '浅色' : '深色'}</span>
        </button>
      </div>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
