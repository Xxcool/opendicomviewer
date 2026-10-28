import { useViewerStore } from '../state/viewer-store';
import { InfoIcon, WarningIcon } from './Icons';

export function MetadataPanel() {
  const { studies, activeStudyUid, activeSeriesHandle, warnings } =
    useViewerStore();

  const currentStudy = studies.find(
    (s) => s.studyInstanceUid === activeStudyUid,
  );

  return (
    <aside className="w-64 border-l border-gray-800 bg-[#0D111A] flex flex-col p-4 select-none text-xs overflow-y-auto">
      <div className="flex items-center space-x-1.5 font-semibold text-gray-400 uppercase tracking-wider mb-4 pb-2 border-b border-gray-800">
        <InfoIcon className="w-4 h-4 text-blue-400" />
        <span>影像信息</span>
      </div>

      {/* 患者与检查信息 */}
      <div className="space-y-3 mb-6">
        <div className="font-semibold text-gray-300 text-xs">患者与检查</div>
        <div className="space-y-1.5 bg-gray-900/40 p-2.5 rounded border border-gray-800/80">
          <div className="flex justify-between">
            <span className="text-gray-500">患者姓名:</span>
            <span className="text-gray-200 font-medium">
              {currentStudy?.patientName || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">患者编号:</span>
            <span className="text-gray-300 font-mono text-[11px]">
              {currentStudy?.patientId || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">检查日期:</span>
            <span className="text-gray-300">
              {currentStudy?.studyDate || '--'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">检查描述:</span>
            <span className="text-gray-300 truncate max-w-[120px]">
              {currentStudy?.studyDescription || '--'}
            </span>
          </div>
        </div>
      </div>

      {/* 当前序列信息 */}
      {activeSeriesHandle && (
        <div className="space-y-3 mb-6">
          <div className="font-semibold text-gray-300 text-xs">当前序列参数</div>
          <div className="space-y-1.5 bg-gray-900/40 p-2.5 rounded border border-gray-800/80">
            <div className="flex justify-between">
              <span className="text-gray-500">类型 (Modality):</span>
              <span className="text-blue-400 font-semibold">
                {activeSeriesHandle.meta.modality}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">切片数量:</span>
              <span className="text-gray-200 font-mono">
                {activeSeriesHandle.meta.planes.length} 帧
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">矩阵尺寸:</span>
              <span className="text-gray-300 font-mono">
                {activeSeriesHandle.meta.planes[0]
                  ? `${activeSeriesHandle.meta.planes[0].columns} × ${activeSeriesHandle.meta.planes[0].rows}`
                  : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">物理间距 (Spacing):</span>
              <span className="text-gray-300 font-mono text-[11px]">
                {activeSeriesHandle.meta.spacing
                  ? `${activeSeriesHandle.meta.spacing[0].toFixed(2)}, ${activeSeriesHandle.meta.spacing[1].toFixed(2)}, ${activeSeriesHandle.meta.spacing[2].toFixed(2)} mm`
                  : '--'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 数据告警清单 */}
      {warnings.length > 0 && (
        <div className="space-y-2 mt-auto pt-4 border-t border-gray-800">
          <div className="flex items-center space-x-1.5 text-amber-400 font-semibold">
            <WarningIcon className="w-3.5 h-3.5" />
            <span>数据异常提醒 ({warnings.length})</span>
          </div>
          <div className="space-y-1.5">
            {warnings.map((w, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-amber-950/40 border border-amber-900/60 text-amber-300 text-[11px] leading-relaxed"
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
