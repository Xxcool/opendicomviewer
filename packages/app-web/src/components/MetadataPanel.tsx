import type { RenderBackendType } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import {
  countBySeverity,
  sortBySeverity,
  warningBoxClass,
} from './warning-presentation';
import { InfoIcon, WarningIcon } from './Icons';

const BACKEND_LABEL: Record<RenderBackendType, string> = {
  webgl2: 'WebGL2',
  webgpu: 'WebGPU',
  cpu: 'CPU 软件渲染',
};

/**
 * 隐私状态（ui-spec §7 的保守默认）
 *
 * 脱敏判定（PS3.15 白名单字段全空/伪名 + UID 重映射）尚未实现，
 * 因此当前一旦有数据就按「含身份信息」处理——宁可误报也不误判为安全。
 * 待脱敏检测接入后，这里改为根据 StudyMeta 的真实判定字段显示。
 */
type PrivacyStatus = 'unknown' | 'phi';

function privacyStatus(hasData: boolean): PrivacyStatus {
  return hasData ? 'phi' : 'unknown';
}

export function MetadataPanel() {
  const { studies, activeStudyUid, activeSeriesHandle, warnings, rendererCapabilities } =
    useViewerStore();

  const sortedWarnings = sortBySeverity(warnings);
  const counts = countBySeverity(warnings);

  const currentStudy = studies.find(
    (s) => s.studyInstanceUid === activeStudyUid,
  );
  const privacy = privacyStatus(studies.length > 0);

  return (
    <aside className="w-64 border-l border-line bg-panel flex flex-col p-4 select-none text-xs overflow-y-auto">
      <div className="flex items-center space-x-1.5 font-semibold text-txt-dim uppercase tracking-wider mb-4 pb-2 border-b border-line">
        <InfoIcon className="w-4 h-4 text-accent" />
        <span>影像信息</span>
      </div>

      {/* 患者与检查信息 */}
      <div className="space-y-3 mb-4">
        <div className="font-semibold text-txt-dim text-xs">患者与检查</div>
        <div className="space-y-1.5 bg-elevated/50 p-2.5 rounded border border-line">
          {/* 隐私状态：常显（ui-spec §7），真实数据必须一眼可见「未脱敏」 */}
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-line">
            <span className="text-txt-muted">隐私状态:</span>
            {privacy === 'unknown' ? (
              <span className="text-txt-muted">隐私状态未知</span>
            ) : (
              <span className="inline-flex items-center space-x-1 text-warn font-semibold">
                <WarningIcon className="w-3.5 h-3.5" />
                <span>含身份信息</span>
              </span>
            )}
          </div>

          <div className="flex justify-between">
            <span className="text-txt-muted">患者姓名:</span>
            <span className="text-txt font-medium">
              {currentStudy?.patientName || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-txt-muted">患者编号:</span>
            <span className="text-txt-dim font-mono text-[11px]">
              {currentStudy?.patientId || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-txt-muted">检查日期:</span>
            <span className="text-txt-dim">
              {currentStudy?.studyDate || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-txt-muted">检查描述:</span>
            <span className="text-txt-dim truncate max-w-[120px]">
              {currentStudy?.studyDescription || '--'}
            </span>
          </div>
        </div>

        {/* 未脱敏时的展开说明（ui-spec §7 右栏展开行） */}
        {privacy === 'phi' && (
          <div className="p-2 rounded border border-warn/40 bg-warn/10 text-warn text-[11px] leading-relaxed">
            ⚠ 该文件仍含原始身份信息，导出前请使用「脱敏导出」。
          </div>
        )}
      </div>

      {/* 当前序列信息 */}
      {activeSeriesHandle && (
        <div className="space-y-3 mb-4">
          <div className="font-semibold text-txt-dim text-xs">当前序列参数</div>
          <div className="space-y-1.5 bg-elevated/50 p-2.5 rounded border border-line">
            <div className="flex justify-between">
              <span className="text-txt-muted">类型 (Modality):</span>
              <span className="text-accent font-semibold">
                {activeSeriesHandle.meta.modality}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">切片数量:</span>
              <span className="text-txt font-mono">
                {activeSeriesHandle.meta.planes.length} 帧
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">矩阵尺寸:</span>
              <span className="text-txt-dim font-mono">
                {activeSeriesHandle.meta.planes[0]
                  ? `${activeSeriesHandle.meta.planes[0].columns} × ${activeSeriesHandle.meta.planes[0].rows}`
                  : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">物理间距 (Spacing):</span>
              <span className="text-txt-dim font-mono text-[11px]">
                {activeSeriesHandle.meta.spacing
                  ? `${activeSeriesHandle.meta.spacing[0].toFixed(2)}, ${activeSeriesHandle.meta.spacing[1].toFixed(2)}, ${activeSeriesHandle.meta.spacing[2].toFixed(2)} mm`
                  : '--'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 免责提示（R10 白名单豁免，ui-spec §4） */}
      <div className="p-2 rounded border border-warn/40 bg-warn/10 text-warn text-[11px] leading-relaxed mb-4">
        ⚠ 测量值仅供参考，不构成诊断依据。
      </div>

      {/* 能力与降级（ui-spec §4：当前状态的解释面板） */}
      <div className="space-y-3 mb-4">
        <div className="font-semibold text-txt-dim text-xs">能力与降级</div>
        {rendererCapabilities ? (
          <div className="space-y-1.5 bg-elevated/50 p-2.5 rounded border border-line">
            <div className="flex justify-between">
              <span className="text-txt-muted">后端:</span>
              <span className="text-txt font-mono">
                {BACKEND_LABEL[rendererCapabilities.backend]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">GPU:</span>
              <span
                className={
                  rendererCapabilities.isSoftwareFallback
                    ? 'text-warn'
                    : 'text-txt-dim'
                }
              >
                {rendererCapabilities.isSoftwareFallback ? '软件回退' : '硬件加速'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">体绘制:</span>
              <span
                className={
                  rendererCapabilities.supportsVolume
                    ? 'text-txt-dim'
                    : 'text-txt-muted'
                }
              >
                {rendererCapabilities.supportsVolume
                  ? '可用'
                  : '不可用 · 已隐藏入口'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-txt-muted">MPR:</span>
              <span
                className={
                  rendererCapabilities.supportsVolume
                    ? 'text-txt-dim'
                    : 'text-txt-muted'
                }
              >
                {rendererCapabilities.supportsVolume
                  ? '可用'
                  : '不可用 · 已隐藏入口'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-txt-muted text-[11px]">探测中…</div>
        )}
      </div>

      {/* 数据告警清单：按严重度排序，error/warning/info 分档配色 */}
      {warnings.length > 0 && (
        <div className="space-y-2 mt-auto pt-4 border-t border-line">
          <div className="flex items-center justify-between text-txt-dim font-semibold">
            <span className="flex items-center space-x-1.5">
              <WarningIcon className="w-3.5 h-3.5" />
              <span>数据提醒 ({warnings.length})</span>
            </span>
            <span className="text-[10px] font-normal text-txt-muted font-mono">
              {counts.error > 0 && `${counts.error} 错误 `}
              {counts.warning > 0 && `${counts.warning} 告警 `}
              {counts.info > 0 && `${counts.info} 提示`}
            </span>
          </div>
          <div className="space-y-1.5">
            {sortedWarnings.map((w, idx) => (
              <div
                key={`${w.code}-${idx}`}
                className={`p-2 rounded border text-[11px] leading-relaxed ${warningBoxClass(w.severity)}`}
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