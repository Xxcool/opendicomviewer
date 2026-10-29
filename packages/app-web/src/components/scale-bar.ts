/**
 * 比例尺换算（ui-spec §3.2）
 *
 * 纯计算，便于单测：
 * 1. `measureMmPerPx` 用两个画布点反查世界坐标，得到「每 CSS 像素多少毫米」；
 *    不需要渲染器新增端口方法（`canvasToWorld` 已存在）。
 * 2. `pickScaleBar` 在 1-2-5 系列里挑一个物理长度取整、像素长度可读的刻度。
 * 拿不到物理信息时返回 null，由调用方显示「无物理标尺」，绝不编造刻度（R7）。
 */

import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';

export interface ScaleBarSize {
  readonly millimeters: number;
  readonly pixels: number;
}

/** 1-2-5 系列（毫米） */
const NICE_MILLIMETERS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const;

/** 刻度最短像素：再短就读不出长度 */
export const MIN_SCALE_BAR_PX = 24;

/**
 * 用画布中心附近两点反算 mm/px。
 *
 * 视口尚未装载（相机/图像都没就绪）时 `canvasToWorld` 会抛错，这里吞掉并返回
 * null——比例尺属于辅助读数，不能因为它让整格报错。
 */
export function measureMmPerPx(
  renderer: CornerstoneRenderer | null,
  viewportId: string,
  width: number,
  height: number,
): number | null {
  if (!renderer || width <= 0 || height <= 0) return null;

  const probe = Math.max(MIN_SCALE_BAR_PX, Math.min(120, width * 0.5));
  const x = (width - probe) / 2;
  const y = height / 2;
  try {
    const a = renderer.canvasToWorld(viewportId, { x, y });
    const b = renderer.canvasToWorld(viewportId, { x: x + probe, y });
    const mm = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return Number.isFinite(mm) && mm > 0 ? mm / probe : null;
  } catch {
    return null;
  }
}

/**
 * 选一个比例尺刻度。
 *
 * 优先挑「像素长度落在 [minPx, maxPx] 内」的最长物理长度；都比 minPx 短时
 * 退而求其次用最长的可容纳刻度（例如 CT 0.7 mm/px、小格子 150px 时会出现）。
 */
export function pickScaleBar(
  mmPerPx: number | null,
  maxPx: number,
  minPx: number = MIN_SCALE_BAR_PX,
): ScaleBarSize | null {
  if (mmPerPx === null || !Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
  if (!Number.isFinite(maxPx) || maxPx <= 0) return null;

  let fallback: ScaleBarSize | null = null;
  for (let i = NICE_MILLIMETERS.length - 1; i >= 0; i -= 1) {
    const millimeters = NICE_MILLIMETERS[i]!;
    const pixels = millimeters / mmPerPx;
    if (pixels > maxPx) continue;
    if (pixels >= minPx) return { millimeters, pixels };
    fallback ??= { millimeters, pixels };
  }
  if (fallback) return fallback;

  // 连 1 mm 都超过 maxPx（极高分辨率）：按可用宽度取一个小数刻度，
  // 保证「标签数字」与「画出来的长度」一致，不把刻度硬压窄。
  const millimeters = Math.max(0.1, Math.round(mmPerPx * maxPx * 10) / 10);
  return { millimeters, pixels: millimeters / mmPerPx };
}
