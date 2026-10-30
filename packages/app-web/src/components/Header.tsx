import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { useViewerStore } from '../state/viewer-store';
import { FileIcon, FolderIcon, ImportIcon, MoonIcon, SettingsIcon, SpinnerIcon, SunIcon } from './Icons';
import { SettingsDialog } from './SettingsDialog';

interface HeaderProps {
  readonly onImportCandidates: (candidates: readonly ImportCandidate[]) => void;
  readonly onLoadSample: (datasetId?: string) => void;
  readonly onCancelImport: () => void;
}

export function Header({ onImportCandidates, onLoadSample, onCancelImport }: HeaderProps) {
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
    return () => window.removeEventListener('keydown', keydown);
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
  return <header className="workspace-header">
    <div className="workspace-brand">
      <span className="workspace-logo" aria-hidden="true">ODV</span>
      <div><span className="workspace-brand-name">OpenDicomViewer</span><span className="workspace-brand-caption">本地影像工作台</span></div>
      <span className="workspace-use-badge">科研 · 教学 · 非诊断参考</span>
    </div>
    <div className="workspace-header-actions">
      <input id="odv-folder-input" ref={folderInputRef} type="file" multiple hidden onChange={selected} />
      <input id="odv-file-input" ref={fileInputRef} type="file" multiple hidden onChange={selected} />
      {importStatus.loading ? <button className="workspace-control cancel-import" onClick={onCancelImport}>
        <SpinnerIcon className="w-4 h-4" />取消导入</button> : <>
        <button className="workspace-primary" onClick={() => folderInputRef.current?.click()}><FolderIcon className="w-4 h-4" />打开文件夹</button>
        <button className="workspace-control" onClick={() => fileInputRef.current?.click()}><FileIcon className="w-4 h-4" /><span>打开文件</span></button>
        <button className="workspace-control" onClick={() => onLoadSample()}><ImportIcon className="w-4 h-4" /><span>示例</span></button>
      </>}
      <span className="toolbar-divider" />
      <button className="workspace-control icon-control" aria-label="设置" title="设置（Ctrl/⌘+,）" onClick={() => setSettingsOpen(true)}><SettingsIcon className="w-4 h-4" /></button>
      <button className="workspace-control icon-control" aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
        title={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}</button>
    </div>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </header>;
}
