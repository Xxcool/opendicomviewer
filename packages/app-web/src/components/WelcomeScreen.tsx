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
          <button className="sample-card" aria-label="载入完整头部 MR 教学示例（193 层，支持 MPR 联动）" title="载入 ICBM152 平均头部三维教学示例，可选择 2×2 或 1+3 联动" onClick={() => onLoadSample?.('brain-head-mr')}>
            <span className="sample-card-image sample-cover-brain" role="img" aria-label="显示完整头部轮廓的 MR 矢状面封面示意" style={{ backgroundImage: 'url("./sample-covers/reference.png")' }} />
            <span className="sample-caption"><strong>MR 脑部影像</strong></span>
          </button>
          <button className="sample-card" aria-label="载入 CT 预置示例（单层）" title="载入预置单层 CT 示例；封面为影像类型示意" onClick={() => onLoadSample?.('ct-body')}>
            <span className="sample-card-image sample-cover-chest" role="img" aria-label="显示胸廓的 CT 横断面封面示意" style={{ backgroundImage: 'url("./sample-covers/reference.png")' }} />
            <span className="sample-caption"><strong>CT 胸腹影像</strong></span>
          </button>
        </div>
        <p className="sample-cover-note">MR：193 层，支持 2×2 / MPR 联动；CT：单层浏览</p>
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
