/**
 * 告警展示的统一口径（颜色 / 图标 / 排序）
 *
 * 为什么单独成文件：同一份 `DataWarning[]` 会在两个地方出现（视口顶条、右栏清单），
 * 两处各写一套颜色映射就会出现"同一条告警两种颜色"，用户会以为是两件事。
 */

import type { DataWarning } from '@opendicomviewer/core';

type Severity = DataWarning['severity'];

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** 越严重越靠前；同级保持原顺序（稳定排序） */
export function sortBySeverity(warnings: readonly DataWarning[]): DataWarning[] {
  return [...warnings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function countBySeverity(warnings: readonly DataWarning[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const w of warnings) counts[w.severity] += 1;
  return counts;
}

/** 单条告警的容器样式（右栏清单用） */
export function warningBoxClass(severity: Severity): string {
  if (severity === 'error') return 'bg-danger/10 border-danger/40 text-danger';
  if (severity === 'warning') return 'bg-warn/10 border-warn/40 text-warn';
  return 'bg-info/10 border-info/40 text-info';
}

/** 视口顶条样式（整条横幅） */
export function warningBannerClass(severity: Severity): string {
  if (severity === 'error') return 'bg-danger/15 border-danger/50 text-danger';
  if (severity === 'warning') return 'bg-warn/15 border-warn/50 text-warn';
  return 'bg-info/15 border-info/50 text-info';
}

export function severityLabel(severity: Severity): string {
  if (severity === 'error') return '数据错误';
  if (severity === 'warning') return '数据告警';
  return '数据提示';
}

/** 顶条只展示最有代表性的一条，避免长文案把整行撑爆 */
export function primaryWarning(warnings: readonly DataWarning[]): DataWarning | undefined {
  return sortBySeverity(warnings)[0];
}

/**
 * 列表项徽标文案（ui-spec §6.2 映射表）
 *
 * 徽标必须出现在列表项里——用户是先在左栏挑序列的，
 * 只把告警放在视口顶部等于让人先点进去才知道有问题。
 */
const BADGE_LABEL: Record<DataWarning['code'], string> = {
  SLICE_GAP: '⚠ 缺层',
  IRREGULAR_SPACING: '⚠ 层距异常',
  DUPLICATE_SLICE: '⚠ 重复切片',
  ORIENTATION_MISMATCH: '⚠ 朝向不一致',
  NON_AXIAL_ORIENTATION: '⚠ 非轴位',
  MISSING_GEOMETRY: '⚠ 几何缺失',
  NON_VOLUMETRIC_SERIES: '二维影像',
  BURNED_IN_INFO: '⚠ 含烧录信息',
  UNSUPPORTED_TRANSFER_SYNTAX: '⚠ 语法不支持',
  DECODE_PARTIAL_FAILURE: '⚠ 部分解码失败',
  MULTI_FRAME_GEOMETRY_UNAVAILABLE: '⚠ 多帧仅二维',
  MULTI_FRAME_ORIENTATION_VARIED: '⚠ 逐帧方向不一致',
};

export interface SeriesBadge {
  readonly text: string;
  readonly severity: Severity;
}

/** 只取最高级一条；多条用 `+N` 收口，避免徽标把序列项撑变形 */
export function seriesBadge(
  warnings: readonly DataWarning[],
): SeriesBadge | undefined {
  const sorted = sortBySeverity(warnings);
  const first = sorted[0];
  if (!first) return undefined;
  const label = BADGE_LABEL[first.code] ?? '⚠ 数据告警';
  const extra = sorted.length - 1;
  return {
    text: extra > 0 ? `${label} +${extra}` : label,
    severity: first.severity,
  };
}

/** 徽标配色：与右栏清单同一套语义色 */
export function badgeClass(severity: Severity): string {
  if (severity === 'error') return 'bg-danger/10 border-danger/40 text-danger';
  if (severity === 'warning') return 'bg-warn/10 border-warn/40 text-warn';
  return 'bg-info/10 border-info/40 text-info';
}
