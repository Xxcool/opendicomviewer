/**
 * 切片导航的纯逻辑（与 React / DOM 解耦，便于单测与变异自检）
 *
 * 设计依据 docs/design/ui-spec.md §3.3：
 * 底栏不用滑块做主导航——1024 帧时滑块 1 像素 ≈ 5 层，物理上无法精确到第 312 层；
 * 阅片习惯是滚轮微调 + 直接输入层号。滑块只在小序列里才有意义。
 */

/** 进度条升级为可拖动滑块的帧数上限：200 帧以内拖动精度可接受（§3.3） */
export const DRAGGABLE_SLIDER_MAX_FRAMES = 200;

/** 单帧序列不显示翻页控件与进度条（§3.3「缺失表现」列） */
export function hasSliceNavigation(total: number): boolean {
  return Number.isFinite(total) && total > 1;
}

/** 小序列才把只读进度条升级为可拖动滑块 */
export function isDraggableSlider(total: number): boolean {
  return hasSliceNavigation(total) && total <= DRAGGABLE_SLIDER_MAX_FRAMES;
}

/**
 * 把任意层号钳到合法区间 `[0, total-1]`（0-based）。
 * 输入非数字或 total 非法时退到 0，绝不返回负索引——负索引会让 CS3D 取到 undefined 帧。
 */
export function clampLayer(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), total - 1);
}

/**
 * 解析用户键入的层号（1-based），返回 0-based 索引。
 *
 * - 空串 / 非纯数字 → `null`：调用方据此恢复原值（§3.3「非法输入恢复原值」）
 * - 数字越界 → 钳到 `[1, N]`（§3.3「越界自动钳到 [1, N]」），不算非法
 */
export function parseLayerInput(raw: string, total: number): number | null {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return clampLayer(Number(trimmed) - 1, total);
}

/** 按步长推进层号（滚轮 / 翻页键共用的位移逻辑） */
export function nextLayerIndex(
  current: number,
  delta: number,
  total: number,
): number {
  return clampLayer(current + delta, total);
}
