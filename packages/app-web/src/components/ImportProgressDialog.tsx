const bodyImage = new URL('../assets/import-body-soft.png', import.meta.url).href;
import { useEffect, useRef } from 'react';
import type { ImportStatus } from '../state/viewer-store';

/** 扫描光带是活动指示，只有真实可计数阶段才显示百分比。 */
export function ImportProgressDialog({ status, onCancel }: { status: ImportStatus; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const { completed, total } = status.progress ?? {};
  const percent = completed !== undefined && total !== undefined && total > 0
    ? Math.max(0, Math.min(100, Math.floor(completed / total * 100))) : null;
  const rawStage = status.progress?.stage ?? status.message ?? '正在准备影像';
  const stage = rawStage.includes('扫描') ? '扫描与解析' : rawStage.includes('示例文件') ? '读取示例影像'
    : rawStage.includes('几何') ? '校验空间信息' : rawStage.includes('DICOMDIR') ? '读取影像索引' : rawStage;
  return <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-title"
    onKeyDown={event => {
      if (event.key === 'Tab') { event.preventDefault(); cancel.current?.focus(); }
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    }}>
    <section className="import-panel">
      <div className="import-scan" aria-hidden="true">
        <div className="import-scan-window">
          <img src={bodyImage} alt="" draggable={false} />
          <div className="import-body-grid" />
          <div className="import-body-beam" />
        </div>
        <span className="import-scan-caption">本地影像处理</span>
      </div>
      <div className="import-content">
        <div className="import-eyebrow"><i /> OPENDICOMVIEWER</div>
        <h2 id="import-title">正在导入影像</h2>
        <div className="import-percent">{percent === null ? <span className="import-working">处理中<span>…</span></span> : <>{percent}<span>%</span></>}</div>
        <p className="import-stage" role="status">{stage}</p>
        <div className={`import-track ${percent === null ? 'is-indeterminate' : ''}`} role="progressbar" aria-label={stage}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <div style={percent === null ? undefined : { width: `${percent}%` }} />
        </div>
        <div className="import-footer"><span>无需上传 · 影像留在本机</span><button ref={cancel} className="import-cancel" onClick={onCancel}>取消导入</button></div>
      </div>
    </section>
  </div>;
}
