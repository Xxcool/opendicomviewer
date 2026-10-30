import { FolderIcon } from './Icons';
import { WorkspaceIcon } from './WorkspaceIcon';

export function WelcomeScreen({ onOpenFolder, onOpenFiles, onLoadSample }: {
  onOpenFolder?: () => void;
  onOpenFiles?: () => void;
  onLoadSample?: (id?: string) => void;
}) {
  return <div className="welcome-screen">
    <div className="welcome-content">
      <h1>打开本地影像</h1>
      <p className="welcome-description">影像留在当前设备，无需上传</p>
      <button className="workspace-primary welcome-open" onClick={onOpenFolder}><FolderIcon />打开影像文件夹</button>
      <section className="welcome-samples" aria-label="示例影像">
        <div className="welcome-section-label"><span>或者试试示例影像</span></div>
        <div className="sample-grid">
          <button className="sample-card" aria-label="载入 MR 脑部示例（36 帧）" onClick={() => onLoadSample?.('brain-mr')}>
            <img src="./sample-previews/brain-mr.png" width="232" height="256" alt="MR 脑部真实示例切片" draggable={false} />
            <span className="sample-caption"><strong>MR 脑部影像</strong><small>36 帧 · 切片浏览</small></span>
          </button>
          <button className="sample-card" aria-label="载入 CT 示例（单层）" onClick={() => onLoadSample?.('ct-body')}>
            <img src="./sample-previews/ct-body.png" width="512" height="512" alt="CT 真实示例切片" draggable={false} />
            <span className="sample-caption"><strong>CT 示例影像</strong><small>单层 · 基础操作</small></span>
          </button>
        </div>
      </section>
      <button className="welcome-drop-zone" onClick={onOpenFiles} aria-label="选择 DICOM 文件或 ZIP，也可拖入窗口">
        <WorkspaceIcon name="upload" />
        <strong>拖放 DICOM 文件或 ZIP 到这里</strong>
        <span>支持 DICOMDIR、.dcm 及常见 DICOM 文件；文件夹请通过上方按钮选择</span>
      </button>
      <section className="welcome-steps" aria-label="使用步骤">
        <div className="welcome-steps-label">使用步骤</div>
        <ol>
          <li><span className="welcome-step-number">1</span><div><strong>打开影像</strong><p>选择本地 DICOM 文件或文件夹</p></div></li>
          <li><span className="welcome-step-number">2</span><div><strong>浏览序列</strong><p>选择序列，滚轮逐层查看图像</p></div></li>
          <li><span className="welcome-step-number">3</span><div><strong>调整视图</strong><p>调窗、平移、缩放与专注阅片</p></div></li>
        </ol>
      </section>
      <p className="welcome-use">仅供科研、教学与非诊断参考使用</p>
    </div>
  </div>;
}
