import { useViewerStore } from '../state/viewer-store';
import {
  countBySeverity,
  sortBySeverity,
  warningBoxClass,
} from './warning-presentation';
import { InfoIcon, WarningIcon } from './Icons';

export function MetadataPanel() {
  const { studies, activeStudyUid, activeSeriesHandle, warnings } =
    useViewerStore();

  const sortedWarnings = sortBySeverity(warnings);
  const counts = countBySeverity(warnings);

  const currentStudy = studies.find(
    (s) => s.studyInstanceUid === activeStudyUid,
  );

  return (
    <aside className="w-64 border-l border-line bg-panel flex flex-col p-4 select-none text-xs overflow-y-auto">
      <div className="flex items-center space-x-1.5 font-semibold text-txt-dim uppercase tracking-wider mb-4 pb-2 border-b border-line">
        <InfoIcon className="w-4 h-4 text-accent" />
        <span>影像信息</span>
      </div>

      {/* 患者与检查信息 */}
      <div className="space-y-3 mb-6">
        <div className="font-semibold text-txt-dim text-xs">患者与检查</div>
        <div className="space-y-1.5 bg-elevated/50 p-2.5 rounded border border-line">
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
      </div>

      {/* 当前序列信息 */}
      {activeSeriesHandle && (
        <div className="space-y-3 mb-6">
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
