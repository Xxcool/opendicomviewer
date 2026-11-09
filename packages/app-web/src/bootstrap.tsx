import type { HostOriginalSaver } from './bridge/host-original-saver';
import type { HostPngSaver } from './bridge/host-png-saver';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { HostFilePicker } from './bridge/host-file-picker';
import type { HostCloseGuard } from './bridge/host-close-guard';
import type { HostFileSaver } from './bridge/host-file-saver';
import './index.css';

export function mountViewer(filePicker?: HostFilePicker, openProject?: () => Promise<void>, saveFile?: HostFileSaver, closeGuard?: HostCloseGuard, saveOriginals?: HostOriginalSaver, savePng?: HostPngSaver): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 root 挂载节点');
  createRoot(container).render(<StrictMode><App savePng={savePng} saveOriginals={saveOriginals} filePicker={filePicker} openProject={openProject} saveFile={saveFile} closeGuard={closeGuard} /></StrictMode>);
}
