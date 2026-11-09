import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountViewer } from '../../app-web/src/bootstrap';
import { nativeCandidate, type SelectedFile } from './candidate';
import { openUrl } from '@tauri-apps/plugin-opener';
import { PROJECT_REPOSITORY_URL } from '../../app-web/src/bridge/project-links';
import { createBlobSaver, isDownloadSaving, type DownloadResult } from './download-saver';
import { createOriginalSaver } from './original-saver';

const savePng = createBlobSaver({
  prepare: (id, url, size, format) => invoke('prepare_export_download', { id, url, size, format }),
  cancel: id => invoke('cancel_export_download', { id }),
  subscribe: receive => listen<DownloadResult>('desktop-export-result', ({ payload }) => receive(payload)),
  download(url, filename) {
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  },
});

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
}, () => openUrl(PROJECT_REPOSITORY_URL), file => invoke<'saved' | 'cancelled'>('save_annotation_file', { content: file.text }), async confirm => {
  const stopWindow = await getCurrentWindow().onCloseRequested(async event => {
    if (isDownloadSaving()) { event.preventDefault(); window.alert('正在保存文件，请等待完成或取消保存。'); return; }
    try { if (!await confirm()) event.preventDefault(); }
    catch { event.preventDefault(); window.alert('无法确认未保存的标注，窗口已保留，请重试。'); }
  });
  try {
    const stopExit = await listen('desktop-exit-requested', () => {
      if (isDownloadSaving()) { window.alert('正在保存文件，请等待完成或取消保存。'); return; }
      void confirm().then(allowed => { if (allowed) return invoke('finish_confirmed_exit'); })
        .catch(() => window.alert('无法确认退出，未保存的标注已保留。'));
    });
    return () => { stopWindow(); stopExit(); };
  } catch (error) { stopWindow(); throw error; }
}, createOriginalSaver(files => invoke<'saved' | 'cancelled'>('save_original_files', { files }), savePng), savePng);
