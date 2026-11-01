import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { HostFilePicker } from './bridge/host-file-picker';
import './index.css';

export function mountViewer(filePicker?: HostFilePicker, openProject?: () => Promise<void>): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 root 挂载节点');
  createRoot(container).render(<StrictMode><App filePicker={filePicker} openProject={openProject} /></StrictMode>);
}
