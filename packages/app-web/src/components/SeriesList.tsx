import { useEffect, useState } from 'react';
import type { DataSourcePort, SeriesSummary } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { LayersIcon, SpinnerIcon } from './Icons';

interface SeriesListProps {
  readonly dataSource: DataSourcePort;
}

export function SeriesList({ dataSource }: SeriesListProps) {
  const {
    studies,
    activeSeriesUid,
    setActiveSeries,
    setImportStatus,
  } = useViewerStore();

  const [seriesList, setSeriesList] = useState<readonly SeriesSummary[]>([]);
  const [switchingSeriesUid, setSwitchingSeriesUid] = useState<string | null>(
    null,
  );
  /** 点击"当前已选中"的序列时给一次短暂高亮，避免用户以为点击无效 */
  const [pulseUid, setPulseUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSeries() {
      if (studies.length === 0) {
        setSeriesList([]);
        return;
      }
      try {
        // 不按 activeStudyUid 过滤：多 study（如示例的 MR + CT）时按 study 分组列出，
        // 否则另一个 study 的序列在左栏里根本看不到，等于无法切换。
        const list = await dataSource.listSeries();
        if (!cancelled) {
          setSeriesList(list);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setImportStatus({
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : `枚举序列失败：${String(err)}`,
          });
        }
      }
    }

    void fetchSeries();

    return () => {
      cancelled = true;
    };
  }, [studies, dataSource, setImportStatus]);

  // 按 study 分组：只有一组时省略组标题（单 study 场景不增加视觉噪音）
  const groups = (() => {
    const byStudy = new Map<string, SeriesSummary[]>();
    for (const item of seriesList) {
      const list = byStudy.get(item.studyInstanceUid);
      if (list) list.push(item);
      else byStudy.set(item.studyInstanceUid, [item]);
    }
    return [...byStudy.entries()].map(([studyUid, items]) => {
      const study = studies.find((s) => s.studyInstanceUid === studyUid);
      return {
        studyUid,
        label: study?.studyDescription || study?.modalities?.join('/') || '未命名检查',
        date: study?.studyDate,
        items,
      };
    });
  })();

  const handleSelectSeries = async (summary: SeriesSummary) => {
    if (summary.seriesInstanceUid === activeSeriesUid) {
      // 已经在该序列：不做重复装载，但必须给可见反馈（静默 return 会被当成"点不动"）
      setPulseUid(summary.seriesInstanceUid);
      window.setTimeout(() => setPulseUid(null), 320);
      return;
    }

    setSwitchingSeriesUid(summary.seriesInstanceUid);
    try {
      const handle = await dataSource.openSeries({
        studyInstanceUid: summary.studyInstanceUid,
        seriesInstanceUid: summary.seriesInstanceUid,
      });
      setActiveSeries(handle);
    } catch (err: unknown) {
      setImportStatus({
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : `切换序列失败：${String(err)}`,
      });
    } finally {
      setSwitchingSeriesUid(null);
    }
  };

  if (studies.length === 0) {
    return (
      <aside className="w-64 border-r border-gray-800 bg-[#0D111A] flex flex-col p-4 text-gray-500 text-xs select-none shrink-0">
        <div className="font-semibold text-gray-400 uppercase tracking-wider mb-2">
          序列列表
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <LayersIcon className="w-8 h-8 mb-2 opacity-40" />
          <p>暂无载入的序列</p>
          <p className="mt-1 text-[11px] text-gray-600">
            请点击上方“打开文件夹”导入光盘或本地 DICOM 数据
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r border-gray-800 bg-[#0D111A] flex flex-col select-none shrink-0">
      <div className="p-3 border-b border-gray-800 flex items-center justify-between">
        <span className="font-semibold text-gray-300 text-xs uppercase tracking-wider">
          序列列表 ({seriesList.length})
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {groups.map((group) => (
          <div key={group.studyUid} className="space-y-1.5">
            {groups.length > 1 && (
              <div className="px-1 pt-1.5 pb-0.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-400 truncate">
                  {group.label}
                </span>
                {group.date && (
                  <span className="text-[10px] text-gray-600 font-mono shrink-0 ml-2">
                    {group.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}
                  </span>
                )}
              </div>
            )}
            {group.items.map((item) => {
          const isActive = item.seriesInstanceUid === activeSeriesUid;
          const isSwitching = item.seriesInstanceUid === switchingSeriesUid;

          return (
            <button
              key={item.seriesInstanceUid}
              type="button"
              onClick={() => handleSelectSeries(item)}
              disabled={isSwitching}
              className={`w-full text-left p-2.5 rounded border transition cursor-pointer flex flex-col space-y-1 ${
                isActive
                  ? 'bg-blue-950/60 border-blue-600 text-white shadow-sm'
                  : 'bg-gray-900/40 border-gray-800 hover:bg-gray-800/60 text-gray-300 hover:border-gray-700'
              } ${pulseUid === item.seriesInstanceUid ? 'ring-2 ring-blue-400/70' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-gray-800 text-blue-400 border border-gray-700">
                  {item.modality}
                  {item.seriesNumber !== undefined ? ` #${item.seriesNumber}` : ''}
                </span>
                <span className="text-[11px] text-gray-400 font-mono">
                  {item.numberOfFrames} 帧
                </span>
              </div>

              <div className="text-xs font-medium truncate w-full text-gray-200">
                {item.seriesDescription || '未命名序列'}
              </div>

              {isSwitching && (
                <div className="flex items-center space-x-1 text-[11px] text-blue-400 pt-1">
                  <SpinnerIcon className="w-3 h-3" />
                  <span>正在装载切片...</span>
                </div>
              )}
            </button>
          );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
