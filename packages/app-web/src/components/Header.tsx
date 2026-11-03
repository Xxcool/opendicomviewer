import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { useViewerStore } from '../state/viewer-store';
import { BookOpenIcon, FileIcon, FolderIcon, MoonIcon, SettingsIcon, SpinnerIcon, SunIcon } from './Icons';
import { SettingsDialog } from './SettingsDialog';
import { PROJECT_REPOSITORY_URL } from '../bridge/project-links';
import { GitHubIcon } from './Icons';

interface HeaderProps {
  readonly onImportCandidates: (candidates: readonly ImportCandidate[]) => void;
  readonly onLoadSample: (datasetId?: string) => void;
  readonly onCancelImport: () => void;
  readonly onOpenFolder?: () => void;
  readonly onOpenFiles?: () => void;
  readonly onOpenProject?: () => void;
  readonly onGoHome?: () => void;
}

export function Header({ onImportCandidates, onLoadSample, onCancelImport, onOpenFolder, onOpenFiles, onOpenProject, onGoHome }: HeaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { importStatus, theme, setTheme } = useViewerStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault(); setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); };
  }, []);
  // 演示链接仍走统一导入链路，StrictMode 下每个挂载仅触发一次。
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    const sample = new URLSearchParams(window.location.search).get('sample');
    if (!sample) return;
    autoLoadedRef.current = true;
    onLoadSample(sample === '1' || sample === 'all' ? undefined : sample);
  }, [onLoadSample]);
  const selected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) onImportCandidates(files.map(fileToImportCandidate));
  };
  return <header className="workspace-header" aria-label="全局操作">
    <nav className="workspace-header-actions" aria-label="影像导入">
      <button type="button" className="workspace-brand" aria-label="OpenDicomViewer，返回首页" title="返回首页，保留当前阅片会话" onClick={onGoHome}>
        <span className="workspace-brand-mark" aria-hidden="true">ODV</span>
        <span className="workspace-brand-name" aria-hidden="true">OpenDicomViewer</span>
      </button>
      <span className="header-divider" aria-hidden="true" />
      {!onOpenFolder && <input id="odv-folder-input" ref={folderInputRef} type="file" multiple hidden onChange={selected} />}
      {!onOpenFiles && <input id="odv-file-input" ref={fileInputRef} type="file" multiple hidden onChange={selected} />}
      {importStatus.loading ? <button className="workspace-control cancel-import" onClick={onCancelImport}>
        <SpinnerIcon />取消导入</button> : <>
        <button className="workspace-control" onClick={() => onOpenFolder ? onOpenFolder() : folderInputRef.current?.click()}><FolderIcon />打开文件夹</button>
        <button className="workspace-control" onClick={() => onOpenFiles ? onOpenFiles() : fileInputRef.current?.click()}><FileIcon />打开文件</button>
        <span className="header-divider" aria-hidden="true" />
        <button className="workspace-control" onClick={() => onLoadSample()}><BookOpenIcon />示例</button>
      </>}
    </nav>
    <div className="workspace-header-preferences">
      <a className="workspace-control github-link" href={PROJECT_REPOSITORY_URL} target="_blank" rel="noopener noreferrer"
        aria-label="打开 GitHub 项目仓库（外部链接）" title="GitHub · OpenDicomViewer"
        onClick={event => { if (onOpenProject) { event.preventDefault(); onOpenProject(); } }}><GitHubIcon /></a>
      <button className="workspace-control" title="设置（Ctrl/⌘+,）" onClick={() => setSettingsOpen(true)}><SettingsIcon aria-hidden="true" />设置</button>
      <span className="header-divider" aria-hidden="true" />
      <button type="button" className="workspace-control"
        title="切换深色/浅色（教学投屏用浅色）"
        aria-label={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
        <span>{theme === 'dark' ? '浅色' : '深色'}</span>
      </button>
    </div>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </header>;
}
