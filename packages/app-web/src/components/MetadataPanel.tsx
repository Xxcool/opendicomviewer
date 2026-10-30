import { useMemo, type ReactNode } from 'react';
import { planVolumeDownsample, type RenderBackendType } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { countBySeverity, sortBySeverity, warningBoxClass } from './warning-presentation';

const BACKEND_LABEL: Record<RenderBackendType, string> = { webgl2: 'WebGL2', webgpu: 'WebGPU', cpu: 'CPU 软件渲染' };
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="inspector-fact"><dt>{label}</dt><dd>{children || '未提供'}</dd></div>;
}

export function MetadataPanel() {
  const state = useViewerStore();
  const { studies, activeStudyUid, activeSeriesHandle, warnings, rendererCapabilities, mprStatus, inspectorTab } = state;
  const plan = useMemo(() => activeSeriesHandle ? planVolumeDownsample(activeSeriesHandle.meta) : null, [activeSeriesHandle]);
  const mprReason = !rendererCapabilities?.supportsVolume ? '当前渲染后端未接入 MPR 通路'
    : plan && !plan.ok ? plan.message : mprStatus.phase === 'error' ? mprStatus.message : undefined;
  const study = studies.find((item) => item.studyInstanceUid === activeStudyUid);
  const meta = activeSeriesHandle?.meta;
  const matrix = meta?.planes[0];
  const counts = countBySeverity(warnings);
  return <aside className="inspector-panel" aria-label="影像详情">
    <div className="inspector-tabs" role="tablist" aria-label="详情分类" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tab = event.key === 'Home' ? 'image' : event.key === 'End' ? 'warnings' : inspectorTab === 'image' ? 'warnings' : 'image';
      state.setInspectorTab(tab);
      event.currentTarget.querySelector<HTMLButtonElement>(`#${tab}-tab`)?.focus();
    }}>
      <button role="tab" id="image-tab" aria-controls="image-panel" tabIndex={inspectorTab === 'image' ? 0 : -1} aria-selected={inspectorTab === 'image'} onClick={() => state.setInspectorTab('image')}>影像</button>
      <button role="tab" id="warnings-tab" aria-controls="warnings-panel" tabIndex={inspectorTab === 'warnings' ? 0 : -1} aria-selected={inspectorTab === 'warnings'} onClick={() => state.setInspectorTab('warnings')}>提醒 <span>{warnings.length}</span></button>
      <button className="inspector-close" aria-label="收起影像详情" onClick={state.toggleInspector}>×</button>
    </div>
    <div className="inspector-scroll">
      <div id="image-panel" role="tabpanel" aria-labelledby="image-tab" hidden={inspectorTab !== 'image'}>
        <section className="inspector-section"><h2>患者与检查</h2><dl>
          <Fact label="患者">{study?.patientName}</Fact><Fact label="患者编号">{study?.patientId}</Fact>
          <Fact label="检查日期">{study?.studyDate?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}</Fact>
          <Fact label="检查描述">{study?.studyDescription}</Fact>
        </dl></section>
        <section className="inspector-section"><h2>当前序列</h2><dl>
          <Fact label="序列">{meta?.seriesDescription}</Fact><Fact label="模态">{meta?.modality}</Fact>
          <Fact label="帧数">{meta?.planes.length}</Fact><Fact label="矩阵">{matrix ? `${matrix.columns} × ${matrix.rows}` : null}</Fact>
          <Fact label="像素间距">{meta?.spacing ? `${meta.spacing[0].toFixed(2)} × ${meta.spacing[1].toFixed(2)} mm` : null}</Fact>
          <Fact label="层间距">{meta?.spacing?.[2] !== undefined ? `${meta.spacing[2].toFixed(2)} mm` : null}</Fact>
        </dl></section>
        <section className="inspector-section"><h2>空间重建</h2>
          {mprReason ? <details><summary>MPR 不可用 · 查看原因</summary><p className="inspector-note">{mprReason}</p></details>
            : <p className="inspector-note">{mprStatus.phase === 'ready' ? 'MPR 已就绪，可用十字准星与翻层联动定位' : mprStatus.phase === 'building' ? 'MPR 构建中' : '在工具栏选择 2×2 或 1+3，进入 MPR 三视图与十字准星联动'}</p>}
        </section>
        <section className="inspector-section"><h2>操作提示</h2><dl className="shortcut-list">
          <Fact label="滚轮 / Shift+滚轮">逐层 / 跨 10 层</Fact><Fact label="右键 / Shift+左键">调窗</Fact>
          <Fact label="中键">平移</Fact><Fact label="B / W / P / Z">翻页 / 调窗 / 平移 / 缩放</Fact><Fact label="F">专注阅片</Fact>
        </dl></section>
        <details className="inspector-section inspector-technical"><summary>渲染与能力说明</summary><dl>
          <Fact label="渲染器">{rendererCapabilities ? rendererCapabilities.backend ? BACKEND_LABEL[rendererCapabilities.backend] : rendererCapabilities.isSoftwareFallback ? '软件回退' : '类型未检测' : '探测中'}</Fact>
          <Fact label="体绘制">当前版本尚未实现</Fact>
        </dl><p className="inspector-note">科研、教学与非诊断参考；MPR 当前用于显示与定位。</p></details>
      </div>
      <div id="warnings-panel" role="tabpanel" aria-labelledby="warnings-tab" hidden={inspectorTab !== 'warnings'} className="inspector-section">
        <h2>数据提醒</h2><p className="inspector-note">{warnings.length ? `${counts.error} 错误 · ${counts.warning} 告警 · ${counts.info} 提示` : '当前序列未报告数据问题'}</p>
        {sortBySeverity(warnings).map((warning, index) => <div key={`${warning.code}-${index}`} className={`inspector-warning ${warningBoxClass(warning.severity)}`}>
          <span className="inspector-warning-code">{warning.code}</span><p>{warning.message}</p>
        </div>)}
      </div>
    </div>
  </aside>;
}
