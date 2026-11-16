import { FileIcon, FolderIcon } from './Icons';

export function WelcomeScreen({ onOpenFolder, onOpenFiles, onLoadSample, onResume }: {
  onResume?: () => void;
  onOpenFolder?: () => void;
  onOpenFiles?: () => void;
  onLoadSample?: (id?: string) => void;
}) {
  return <div className="welcome-screen">
    <div className="welcome-content">
      <h1>打开本地影像</h1>
      <p className="welcome-description">选择文件夹、DICOM 文件或 ZIP，影像仅在本机处理。</p>
      <div className="welcome-import">
        <div className="welcome-actions">
          <button className="workspace-primary welcome-open" onClick={onOpenFolder}><FolderIcon />打开影像文件夹</button>
          <button className="workspace-control welcome-files" onClick={onOpenFiles}><FileIcon />选择文件或 ZIP</button>
        </div>
        <p>也可将文件拖入窗口，含 DICOMDIR 的光盘请选择整个文件夹。</p>
      </div>
      {onResume && <button className="workspace-control welcome-resume" onClick={onResume}>继续阅片</button>}
      <section className="welcome-samples" aria-label="示例影像">
        <div className="welcome-section-label"><span>教学样本</span></div>
        <div className="sample-grid">
          <button className="sample-card" aria-label="载入完整头部 MR 教学示例（193 层，支持 MPR 联动）" title="载入 ICBM152 平均头部三维教学示例，可选择 2×2 或 1+3 联动" onClick={() => onLoadSample?.('brain-head-mr')}>
            <span className="sample-card-image sample-cover-brain" role="img" aria-label="显示完整头部轮廓的 MR 矢状面封面示意" style={{ backgroundImage: 'url("./sample-covers/reference.png")' }} />
            <span className="sample-caption"><strong>头部 MR</strong><small>193 层 · 支持 MPR</small></span>
          </button>
          <button className="sample-card" aria-label="载入 CT 预置示例（单层）" title="载入预置单层 CT 示例；封面为影像类型示意" onClick={() => onLoadSample?.('ct-body')}>
            <span className="sample-card-image sample-cover-chest" role="img" aria-label="显示胸廓的 CT 横断面封面示意" style={{ backgroundImage: 'url("./sample-covers/reference.png")' }} />
            <span className="sample-caption"><strong>胸腹 CT</strong><small>单层 · 二维浏览</small></span>
          </button>
        </div>
      </section>
      <p className="welcome-use">仅供科研、教学与非诊断参考使用</p>
    </div>
  </div>;
}
