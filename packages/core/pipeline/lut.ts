/**
 * Modality LUT 与 VOI 灰度换算
 *
 * 严格遵循 GEMINI.md 5.2 灰度换算规范：
 * 任何数值计算必须确保已应用 RescaleSlope * pixel + RescaleIntercept。
 * 水 ∈ [-5, 5] HU、空气 ∈ [-1050, -950] HU、皮质骨 > 300 HU。
 */

import type { VOIBounds, VOIRange } from '../domain/types';

/**
 * 常用 CT 窗宽窗位预设
 */
export const CT_WINDOW_PRESETS: Record<string, VOIRange> = {
  LUNG: { windowCenter: -600, windowWidth: 1500 },
  MEDIASTINUM: { windowCenter: 40, windowWidth: 350 },
  BONE: { windowCenter: 400, windowWidth: 2000 },
  BRAIN: { windowCenter: 40, windowWidth: 80 },
  SOFT_TISSUE: { windowCenter: 50, windowWidth: 400 },
};

/**
 * 将原始像素值转换为 CT Hounsfield Unit (HU)
 */
export function rawToHU(
  storedPixel: number,
  rescaleSlope = 1.0,
  rescaleIntercept = 0.0,
): number {
  return storedPixel * rescaleSlope + rescaleIntercept;
}

/**
 * 窗宽窗位 (WW/WL) 转为上下限范围 (Lower/Upper)
 */
export function voiToRange(voi: VOIRange): VOIBounds {
  const half = voi.windowWidth / 2;
  return {
    lower: voi.windowCenter - half,
    upper: voi.windowCenter + half,
  };
}

/**
 * 上下限范围 (Lower/Upper) 转为窗宽窗位 (WW/WL)
 */
export function rangeToVOI(lower: number, upper: number): VOIRange {
  return {
    windowWidth: upper - lower,
    windowCenter: (upper + lower) / 2,
  };
}

/**
 * 将指定 HU 按照给定的 VOI 映射为 0-255 字节值（线性窗映射）
 */
export function mapHUToUint8(hu: number, voi: VOIRange): number {
  const { lower, upper } = voiToRange(voi);
  if (hu <= lower) {
    return 0;
  }
  if (hu >= upper) {
    return 255;
  }
  return Math.round(((hu - lower) / (upper - lower)) * 255);
}

/**
 * Phantom 物理密度基准断言（用于测试与校验）
 * 断言：水 ∈ [-5, 5] HU、空气 ∈ [-1050, -950] HU、皮质骨 > 300 HU
 */
export function assertPhantomHU(
  waterHU: number,
  airHU: number,
  boneHU: number,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (waterHU < -5 || waterHU > 5) {
    reasons.push(`水密度偏差：当前 ${waterHU.toFixed(1)} HU 不在 [-5, 5] 范围内`);
  }
  if (airHU < -1050 || airHU > -950) {
    reasons.push(`空气密度偏差：当前 ${airHU.toFixed(1)} HU 不在 [-1050, -950] 范围内`);
  }
  if (boneHU <= 300) {
    reasons.push(`骨密度偏差：当前 ${boneHU.toFixed(1)} HU 未超过 300 HU 基线`);
  }
  return {
    pass: reasons.length === 0,
    reasons,
  };
}
