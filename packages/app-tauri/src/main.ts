import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountViewer } from '../../app-web/src/bootstrap';
import { nativeCandidate, type SelectedFile } from './candidate';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PROJECT_REPOSITORY_URL } from '../../app-web/src/bridge/project-links';

mountViewer({
  async pick(mode) {
    const files = await invoke<SelectedFile[]>('pick_files', { mode });
    return files.map(file => nativeCandidate(file, convertFileSrc(file.path)));
  },
  async subscribe(onFiles, onError) {
    const stopFiles = await listen<SelectedFile[]>('desktop-files', ({ payload }) => {
      try { onFiles(payload.map(file => nativeCandidate(file, convertFileSrc(file.path)))); }
      catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    });
    try {
      const stopErrors = await listen<string>('desktop-import-error', ({ payload }) => onError(payload));
      return () => { stopFiles(); stopErrors(); };
    } catch (error) { stopFiles(); throw error; }
  },
}, () => openUrl(PROJECT_REPOSITORY_URL));
