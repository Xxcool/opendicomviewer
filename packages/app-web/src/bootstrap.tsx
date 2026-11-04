import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { HostFilePicker } from './bridge/host-file-picker';
import type { HostCloseGuard } from './bridge/host-close-guard';
import type { HostFileSaver } from './bridge/host-file-saver';
import './index.css';

export function mountViewer(filePicker?: HostFilePicker, openProject?: () => Promise<void>, saveFile?: HostFileSaver, closeGuard?: HostCloseGuard): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 root 挂载节点');
  createRoot(container).render(<StrictMode><App filePicker={filePicker} openProject={openProject} saveFile={saveFile} closeGuard={closeGuard} /></StrictMode>);
}
