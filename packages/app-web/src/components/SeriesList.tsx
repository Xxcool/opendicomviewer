import { useEffect, useState } from 'react';
import type {
  DataSourcePort,
  DataWarning,
  Modality,
  SeriesSummary,
} from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { badgeClass, seriesBadge } from './warning-presentation';
import { ChevronIcon, LayersIcon, SearchIcon, SpinnerIcon } from './Icons';

interface SeriesListProps {
  readonly dataSource: DataSourcePort;
}

/**
 * 模态缩略块配色：无渲染器缩略图可用时，用模态首字母 + 色调区分，
 * 比空白色块更容易在长列表里快速定位（参考 DICOM Vision / Voxenra 的缩略块）。
 */
const MODALITY_TINT: Record<string, string> = {
  MR: 'bg-accent/15 text-accent border-accent/25',
  CT: 'bg-info/15 text-info border-info/25',
  US: 'bg-warn/15 text-warn border-warn/25',
  CR: 'bg-txt-muted/15 text-txt-dim border-line-strong',
  DX: 'bg-txt-muted/15 text-txt-dim border-line-strong',
  PT: 'bg-danger/15 text-danger border-danger/25',
};

function modalityTint(modality: Modality): string {
  return MODALITY_TINT[modality] ?? 'bg-txt-muted/15 text-txt-dim border-line-strong';
}

export function SeriesList({ dataSource }: SeriesListProps) {
  const {
    studies,
    activeSeriesUid,
    setActiveSeries,
    setImportStatus,
    warnings: activeWarnings,
  } = useViewerStore();

  const [seriesList, setSeriesList] = useState<readonly SeriesSummary[]>([]);
  const [switchingSeriesUid, setSwitchingSeriesUid] = useState<string | null>(
    null,
  );
  /** 点击"当前已选中"的序列时给一次短暂高亮，避免用户以为点击无效 */
  const [pulseUid, setPulseUid] = useState<string | null>(null);
  /** 搜索关键词：匹配患者姓名/编号、检查描述、序列描述、模态 */
  const [query, setQuery] = useState('');
  /** 折叠中的检查分组（默认全部展开；只记录被收起的那几个） */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * 已打开过的序列告警缓存。
   *
   * `SeriesSummary` 不含告警，告警只有 `openSeries()` 排序后才知道，
   * 因此未打开过的序列无法预判——对应项显示"未检测"而不是假装没问题。
   */
  const [warningsBySeries, setWarningsBySeries] = useState<
    Record<string, readonly DataWarning[]>
  >({});

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

  // 按 study 分组 + 搜索过滤（匹配检查级与序列级文本）
  const groups = (() => {
    const needle = query.trim().toLowerCase();
    const byStudy = new Map<string, SeriesSummary[]>();
    for (const item of seriesList) {
      const list = byStudy.get(item.studyInstanceUid);
      if (list) list.push(item);
      else byStudy.set(item.studyInstanceUid, [item]);
    }

    return [...byStudy.entries()]
      .map(([studyUid, items]) => {
        const study = studies.find((s) => s.studyInstanceUid === studyUid);
        const label =
          study?.patientName?.trim() ||
          study?.studyDescription ||
          study?.modalities?.join('/') ||
          '未命名检查';
        return { studyUid, label, study, items };
      })
      .filter((group) => {
        if (!needle) return true;
        const head = [
          group.label,
          group.study?.patientId,
          group.study?.studyDescription,
          group.study?.studyDate,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const hitStudy = head.includes(needle);
        const hitSeries = group.items.some((item) =>
          [item.seriesDescription, item.modality, `#${item.seriesNumber ?? ''}`]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        );
        return hitStudy || hitSeries;
      })
      .map((group) => ({
        ...group,
        items: query.trim()
          ? group.items.filter((item) =>
              [
                item.seriesDescription,
                item.modality,
                `#${item.seriesNumber ?? ''}`,
              ]
                .join(' ')
                .toLowerCase()
                .includes(needle),
            )
          : group.items,
      }))
      .filter((group) => group.items.length > 0);
  })();

  const totalShown = groups.reduce((n, g) => n + g.items.length, 0);

  const toggleGroup = (studyUid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(studyUid)) next.delete(studyUid);
      else next.add(studyUid);
      return next;
    });
  };

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
      setWarningsBySeries((prev) => ({
        ...prev,
        [summary.seriesInstanceUid]: handle.warnings,
      }));
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

  /** 面板头：与中间 vp-bar / 右栏 panel-head 同高同 border-b，三栏顶部对齐 */
  const head = (
    <div
      className="flex items-center justify-between px-3 border-b border-line shrink-0 text-[12px] text-txt-dim tracking-wide bg-panel"
      style={{ height: 'var(--vp-bar-h)' }}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <LayersIcon className="w-3.5 h-3.5 text-txt-muted" />
        <span>序列</span>
      </span>
      <span className="font-mono text-txt-muted text-[11px]">
        {query.trim() ? `${totalShown}/${seriesList.length}` : seriesList.length}
      </span>
    </div>
  );

  if (studies.length === 0) {
    return (
      <aside className="flex flex-col text-txt-muted text-[12px] select-none overflow-hidden">
        {head}
        <div className="flex-1 flex flex-col items-center justify-center text-center p-5 gap-2">
          <LayersIcon className="w-7 h-7 opacity-30" />
          <p className="text-txt-dim text-[12px]">暂无载入的序列</p>
          <p className="text-[11px] text-txt-muted leading-relaxed">
            点击上方「打开文件夹」导入本地 DICOM
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col select-none overflow-hidden">
      {head}

      {/* 搜索框：匹配患者/检查/序列，参考 DICOM Vision 顶部搜索条 */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 text-txt-muted pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索患者 / 检查 / 序列"
            aria-label="搜索患者、检查或序列"
            className="w-full h-7 pl-7 pr-2 rounded-md bg-app border border-line text-[12px] text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 transition"
          />
        </div>
      </div>

      {/* 树形列表：检查分组（可折叠）→ 序列行 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] text-txt-muted">
            没有匹配「{query}」的序列
          </p>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.studyUid);
          return (
            <div key={group.studyUid} className="mb-1">
              {/* 检查分组头：点击折叠/展开 */}
              <button
                type="button"
                onClick={() => toggleGroup(group.studyUid)}
                aria-expanded={!isCollapsed}
                className="w-full h-7 px-1.5 flex items-center gap-1.5 rounded-md text-[11px] text-txt-dim hover:bg-hover/60 transition cursor-pointer"
              >
                <ChevronIcon
                  className={`shrink-0 text-txt-muted transition-transform duration-150 ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                />
                <span className="truncate font-medium">{group.label}</span>
                <span className="ml-auto shrink-0 font-mono text-txt-muted">
                  {group.study?.studyDate
                    ? group.study.studyDate.replace(
                        /^(\d{4})(\d{2})(\d{2})$/,
                        '$1-$2-$3',
                      )
                    : '日期未知'}
                </span>
                <span className="shrink-0 text-txt-muted">({group.items.length})</span>
              </button>

              {!isCollapsed && (
                <div className="flex flex-col gap-px pl-1">
                  {group.items.map((item) => {
                    const isActive = item.seriesInstanceUid === activeSeriesUid;
                    const isSwitching =
                      item.seriesInstanceUid === switchingSeriesUid;

                    const seriesWarnings = isActive
                      ? activeWarnings
                      : warningsBySeries[item.seriesInstanceUid];
                    const badge = seriesWarnings
                      ? seriesBadge(seriesWarnings)
                      : undefined;

                    return (
                      <button
                        key={item.seriesInstanceUid}
                        type="button"
                        onClick={() => handleSelectSeries(item)}
                        disabled={isSwitching}
                        aria-selected={isActive}
                        title={item.seriesDescription || '未命名序列'}
                        /* 选中态：淡 accent 底 + 左侧 2px accent 竖条（DICOM Vision 同款），
                           不加整体边框，避免与分组头/相邻行叠出双层线 */
                        className={`relative w-full text-left pl-2 pr-2 py-1.5 flex items-center gap-2 rounded-md transition-colors cursor-pointer ${
                          isActive ? 'bg-accent/10' : 'hover:bg-hover/70'
                        } ${pulseUid === item.seriesInstanceUid ? 'ring-1 ring-accent/50' : ''} ${
                          isSwitching ? 'opacity-60 cursor-wait' : ''
                        }`}
                      >
                        {/* 选中竖条：用独立绝对定位元素而不是 inset shadow，
                            圆角更自然，也便于在浏览器里核对 */}
                        {isActive && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
                          />
                        )}

                        {/* 模态缩略块：无逐帧缩略图时用模态字母 + 色调区分 */}
                        <span
                          className={`w-9 h-9 shrink-0 rounded border flex items-center justify-center text-[10px] font-semibold ${modalityTint(item.modality)}`}
                          aria-hidden
                        >
                          {item.modality}
                        </span>

                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span
                            className={`text-[12px] truncate ${
                              isActive ? 'text-txt font-medium' : 'text-txt'
                            }`}
                          >
                            {item.seriesDescription || '未命名序列'}
                          </span>
                          <span className="flex items-center gap-1.5 text-[10px] text-txt-muted font-mono">
                            <span className="truncate">
                              {item.seriesNumber !== undefined
                                ? `#${item.seriesNumber}`
                                : '—'}
                              {' · '}
                              {item.numberOfFrames} 帧
                            </span>
                            {isSwitching && (
                              <SpinnerIcon className="w-2.5 h-2.5 shrink-0 text-accent" />
                            )}
                          </span>
                        </span>

                        {/* 告警徽标（ui-spec §2：用户在左栏挑序列时就该看到） */}
                        {badge ? (
                          <span
                            className={`shrink-0 text-[9px] px-1 py-px rounded-sm border ${badgeClass(badge.severity)}`}
                          >
                            {badge.text}
                          </span>
                        ) : !seriesWarnings ? (
                          <span className="shrink-0 text-[9px] text-txt-muted">
                            未检测
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
