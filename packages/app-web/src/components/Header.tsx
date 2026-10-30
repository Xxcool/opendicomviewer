import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ImportCandidate } from '@opendicomviewer/core';
import { fileToImportCandidate } from '../bridge/candidate';
import { useViewerStore } from '../state/viewer-store';
import { BookOpenIcon, ChevronIcon, FileIcon, FolderIcon, MoonIcon, SettingsIcon, SpinnerIcon, SunIcon } from './Icons';
import { SettingsDialog } from './SettingsDialog';

interface HeaderProps {
  readonly onImportCandidates: (candidates: readonly ImportCandidate[]) => void;
  readonly onLoadSample: (datasetId?: string) => void;
  readonly onCancelImport: () => void;
}

export function Header({ onImportCandidates, onLoadSample, onCancelImport }: HeaderProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const themeMenuRef = useRef<HTMLDetailsElement>(null);
  const { importStatus, theme, setTheme } = useViewerStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    const closeThemeMenu = (event: PointerEvent) => {
      const menu = themeMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && themeMenuRef.current) themeMenuRef.current.open = false;
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault(); setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('pointerdown', closeThemeMenu);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('pointerdown', closeThemeMenu); };
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
  const selectTheme = (value: 'dark' | 'light') => {
    setTheme(value);
    if (themeMenuRef.current) themeMenuRef.current.open = false;
  };
  return <header className="workspace-header" aria-label="全局操作">
    <nav className="workspace-header-actions" aria-label="影像导入">
      <input id="odv-folder-input" ref={folderInputRef} type="file" multiple hidden onChange={selected} />
      <input id="odv-file-input" ref={fileInputRef} type="file" multiple hidden onChange={selected} />
      {importStatus.loading ? <button className="workspace-control cancel-import" onClick={onCancelImport}>
        <SpinnerIcon />取消导入</button> : <>
        <button className="workspace-control" onClick={() => folderInputRef.current?.click()}><FolderIcon />打开文件夹</button>
        <button className="workspace-control" onClick={() => fileInputRef.current?.click()}><FileIcon />打开文件</button>
        <span className="header-divider" aria-hidden="true" />
        <button className="workspace-control" onClick={() => onLoadSample()}><BookOpenIcon />示例</button>
      </>}
    </nav>
    <div className="workspace-header-preferences">
      <button className="workspace-control" title="设置（Ctrl/⌘+,）" onClick={() => setSettingsOpen(true)}><SettingsIcon aria-hidden="true" />设置</button>
      <span className="header-divider" aria-hidden="true" />
      <details ref={themeMenuRef} className="theme-menu">
        <summary className="workspace-control" aria-label={`选择界面主题，当前${theme === 'dark' ? '深色' : '浅色'}主题`}>
          {theme === 'dark' ? <MoonIcon aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
          <span>{theme === 'dark' ? '深色主题' : '浅色主题'}</span><ChevronIcon className="theme-chevron" aria-hidden="true" />
        </summary>
        <div className="theme-options" role="group" aria-label="主题选项">
          <button className="workspace-control" aria-pressed={theme === 'dark'} onClick={() => selectTheme('dark')}><MoonIcon aria-hidden="true" />深色主题</button>
          <button className="workspace-control" aria-pressed={theme === 'light'} onClick={() => selectTheme('light')}><SunIcon aria-hidden="true" />浅色主题</button>
        </div>
      </details>
      <span className="header-divider" aria-hidden="true" />
      <div className="workspace-brand" role="img" aria-label="OpenDicomViewer">
        <span className="workspace-brand-mark" aria-hidden="true">ODV</span>
        <span className="workspace-brand-name" aria-hidden="true">OpenDicomViewer</span>
      </div>
    </div>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </header>;
}
