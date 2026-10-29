import { useMemo } from 'react';
import { planVolumeDownsample, type RenderBackendType } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import {
  countBySeverity,
  sortBySeverity,
  warningBoxClass,
} from './warning-presentation';
import { WarningIcon } from './Icons';

const BACKEND_LABEL: Record<RenderBackendType, string> = {
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
  cpu: 'CPU 软件渲染',
};

/**
 * 右栏单一真源（极简专业风 Figma/Xcode）：
 *
 * 关键决策：**外圈一条墙 + 区块之间一条细线**。
 * 最外层 <aside> 只画 border-l（和视口分开）；内部每个 section 之间用一条
 * border-b 分隔——这是用户明确要求的"卡片底边"，只画一条，不做卡片圆角/底色，
 * 避免回到"到处都是框、还两条线并排"的老问题。
 */
const SEC_HEAD =
  'pb-2 text-[13px] text-txt font-semibold tracking-wide shrink-0';
const ROW = 'flex justify-between items-baseline gap-3 text-[12px] leading-relaxed';
const K = 'text-txt-muted shrink-0 whitespace-nowrap';
const V = 'text-txt text-right min-w-0';
const V_NUM = `${V} font-mono text-[11px]`;
const V_LONG = `${V_NUM} truncate`;

/** 右栏的 section：自带左右内边距 + 一条底部分隔线（最后一段不画，避免尾巴多一条） */
function Sec({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col px-3 py-3 border-b border-line last:border-b-0">
      <div className={SEC_HEAD}>{title}</div>
      {children}
    </section>
  );
}

export function MetadataPanel() {
  const { studies, activeStudyUid, activeSeriesHandle, warnings, rendererCapabilities, mprStatus } =
    useViewerStore();

  const mprPlan = useMemo(() => activeSeriesHandle
    ? planVolumeDownsample(activeSeriesHandle.meta) : null, [activeSeriesHandle]);
  const mprReason = !rendererCapabilities?.supportsVolume
    ? '当前渲染后端未接入 MPR 通路'
    : mprPlan && !mprPlan.ok ? mprPlan.message
      : mprStatus.phase === 'error' ? mprStatus.message : undefined;

  const sortedWarnings = sortBySeverity(warnings);
  const counts = countBySeverity(warnings);

  const currentStudy = studies.find(
    (s) => s.studyInstanceUid === activeStudyUid,
  );

  // 先把可能很长的值算成字符串：右侧面板宽度由 CSS var(--right-w) 控制，
  // 长值必须能截断且用 title 兜底，否则会把左侧 label 挤掉。
  const matrix = activeSeriesHandle?.meta.planes[0];
  const matrixText = matrix ? `${matrix.columns} × ${matrix.rows}` : '--';
  const spacing = activeSeriesHandle?.meta.spacing;
  const spacingText = spacing
    ? `${spacing[0].toFixed(2)} × ${spacing[1].toFixed(2)} mm`
    : '--';
  const sliceGap = spacing && spacing[2] !== undefined
    ? `${spacing[2].toFixed(2)} mm`
    : '--';

  return (
    // 右栏唯一的 border：这条 border-l 把右栏和中间视口区分开，是"外围墙"
    <aside
      className="border-l border-line bg-panel overflow-y-auto overflow-x-hidden flex flex-col select-none shrink-0"
      style={{ width: 'var(--right-w)' }}
    >
      {/* panel-head：和左栏 SeriesList / 中间 vp-bar 同高 + 同 border-b，三栏顶部对齐 */}
      <div
        className="flex items-center justify-between px-3 border-b border-line shrink-0 text-[12px] text-txt-dim tracking-wide bg-panel"
        style={{ height: 'var(--vp-bar-h)' }}
      >
        <span>影像信息</span>
        <span className="text-txt-muted text-[11px] font-mono">
          {activeSeriesHandle ? activeSeriesHandle.meta.modality : '—'}
        </span>
      </div>

      {/* 内部：每个 section 自带底边；最后一段不画，避免尾部多一条线 */}
      <div className="flex flex-1 flex-col">
        {/* ══ 1. 患者与检查 ══ */}
        <Sec title="患者与检查">
          <div className="flex flex-col gap-1.5">
            {/* 患者姓名：隐私角标只保留视口那一处，这里不再重复 */}
            <div className={ROW}>
              <span className={K}>患者</span>
              <span
                className={V_LONG}
                title={currentStudy?.patientName || '--'}
              >
                {currentStudy?.patientName || '--'}
              </span>
            </div>

            <div className={ROW}>
              <span className={K}>检查</span>
              <span className={V_LONG} title={currentStudy?.studyDescription || '--'}>
                {currentStudy?.studyDescription || '--'}
              </span>
            </div>

            <div className={ROW}>
              <span className={K}>检查日期</span>
              <span className={V_NUM}>{currentStudy?.studyDate || '--'}</span>
            </div>

            <div className={ROW}>
              <span className={K}>患者编号</span>
              <span
                className={`${V_LONG} text-txt-dim`}
                title={currentStudy?.patientId || '--'}
              >
                {currentStudy?.patientId || '--'}
              </span>
            </div>
          </div>
        </Sec>

        {/* ══ 2. 当前序列（有数据才显示） ══ */}
        {activeSeriesHandle && (
          <Sec title="当前序列">
            <div className="flex flex-col gap-1.5">
              <div className={ROW}>
                <span className={K}>Modality</span>
                <span className={V_NUM}>{activeSeriesHandle.meta.modality}</span>
              </div>
              <div className={ROW}>
                <span className={K}>切片数</span>
                <span className={V_NUM}>
                  {activeSeriesHandle.meta.planes.length}
                </span>
              </div>
              <div className={ROW}>
                <span className={K}>矩阵</span>
                <span className={V_NUM}>{matrixText}</span>
              </div>
              <div className={ROW}>
                <span className={K}>像素间距</span>
                <span className={V_LONG} title={spacingText}>
                  {spacingText}
                </span>
              </div>
              {sliceGap !== '--' && (
                <div className={ROW}>
                  <span className={K}>层间距</span>
                  <span className={V_NUM}>{sliceGap}</span>
                </div>
              )}
            </div>
          </Sec>
        )}

        {/* ══ 3. 测量与工具（Phase 2 才补真实数据） ══ */}
        <Sec title="测量与工具">
          <div className="flex flex-col gap-1.5">
            <div className={ROW}>
              <span className={K}>当前工具</span>
              <span className={`${V} text-txt-muted`}>未启用</span>
            </div>
            <div className={ROW}>
              <span className={K}>直线</span>
              <span className={`${V} text-txt-muted`}>—</span>
            </div>
            <div className={ROW}>
              <span className={K}>ROI 均值</span>
              <span className={`${V} text-txt-muted`}>—</span>
            </div>
          </div>
          {/* 免责（R10 白名单）：弱警示，不画 border */}
          <div className="pt-1.5 text-[11px] text-warn leading-relaxed">
            ⚠ 测量值仅供参考，不构成诊断依据。
          </div>
        </Sec>

        {/* ══ 4. 能力与降级 ══ */}
        <Sec title="能力与降级">
          {rendererCapabilities ? (
            <div className="flex flex-col gap-1.5">
              <div className={ROW}>
                <span className={K}>渲染后端</span>
                <span className={V_NUM}>
                  {BACKEND_LABEL[rendererCapabilities.backend]}
                </span>
              </div>
              <div className={ROW}>
                <span className={K}>GPU</span>
                <span
                  className={`${V} ${
                    rendererCapabilities.isSoftwareFallback
                      ? 'text-warn'
                      : 'text-txt-dim'
                  }`}
                >
                  {rendererCapabilities.isSoftwareFallback
                    ? '软件回退'
                    : '类型未检测'}
                </span>
              </div>
              <div className={ROW}>
                <span className={K}>体绘制</span>
                <details className={`${V} text-disabled leading-snug`}>
                  <summary className="cursor-pointer">不可用 · 查看原因</summary>
                  <p>当前版本尚未实现体绘制</p>
                </details>
              </div>
              <div className={ROW}>
                <span className={K}>MPR</span>
                {mprReason ? (
                  <details className={`${V} text-disabled leading-snug`}>
                    <summary className="cursor-pointer">不可用 · 查看原因</summary>
                    <p>{mprReason}</p>
                  </details>
                ) : (
                  <span className={V}>{!activeSeriesHandle ? '待载入序列'
                    : mprStatus.phase === 'ready' ? '可用'
                      : mprStatus.phase === 'building' ? '构建中' : '可构建'}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-txt-muted">探测中…</div>
          )}
        </Sec>
      </div>

      {/* ══ 5. 数据告警清单：mt-auto 钉底部；内部唯一"画框"的区域 ══ */}
      {warnings.length > 0 && (
        <div className="mt-auto shrink-0 border-t border-line px-3 py-3">
          <div className="flex items-center justify-between text-[13px] font-semibold text-txt tracking-wide mb-2">
            <span className="flex items-center gap-1.5">
              <WarningIcon className="w-3.5 h-3.5" />
              <span>数据提醒</span>
              <span className="text-txt-muted text-[11px] font-normal">({warnings.length})</span>
            </span>
            <span className="text-[10px] font-normal font-mono text-txt-muted">
              {counts.error > 0 && `${counts.error} 错误 `}
              {counts.warning > 0 && `${counts.warning} 告警 `}
              {counts.info > 0 && `${counts.info} 提示`}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {sortedWarnings.map((w, idx) => (
              <div
                key={`${w.code}-${idx}`}
                className={`px-2 py-1.5 rounded-md text-[11px] leading-relaxed ${warningBoxClass(w.severity)}`}
              >
                {w.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
