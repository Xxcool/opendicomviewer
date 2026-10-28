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
