/**
 * Modality LUT 与 VOI 灰度换算
 *
 * 严格遵循 DICOM PS3.3 C.11.2.1.2 线性 VOI LUT 标准规范（S1）
 * 严格遵循 GEMINI.md 5.2 灰度换算规范（S2: 优先 ModalityLUTSequence 查表，回退 Rescale）
 * 严格遵循 S3: 支持 MONOCHROME1 灰阶明暗反转
 */

import type { ModalityLUT, VOIBounds, VOIRange } from '../domain/types';

/**
 * 常用 CT 窗宽窗位预设 (N6)
 */
export const CT_WINDOW_PRESETS = {
  LUNG: { windowCenter: -600, windowWidth: 1500 },
  MEDIASTINUM: { windowCenter: 40, windowWidth: 350 },
  BONE: { windowCenter: 400, windowWidth: 2000 },
  BRAIN: { windowCenter: 40, windowWidth: 80 },
  SOFT_TISSUE: { windowCenter: 50, windowWidth: 400 },
} as const satisfies Record<string, VOIRange>;

/**
 * 将原始存储像素值应用 Modality LUT 换算（S2）
 * 规则：若存在 Modality LUT 序列查表，优先查表；否则应用 RescaleSlope * pixel + RescaleIntercept
 */
export function rawToHU(
  storedPixel: number,
  rescaleSlope = 1.0,
  rescaleIntercept = 0.0,
  modalityLUT?: ModalityLUT,
): number {
  if (modalityLUT && modalityLUT.lutData.length > 0) {
    const offset = storedPixel - modalityLUT.firstMappedPixelValue;
    const data = modalityLUT.lutData;
    if (offset <= 0) {
      const first = data[0];
      return first ?? 0;
    }
    if (offset >= data.length) {
      const last = data[data.length - 1];
      return last ?? 0;
    }
    const val = data[offset];
    return val ?? 0;
  }
  return storedPixel * rescaleSlope + rescaleIntercept;
}

/**
 * 窗宽窗位 (WW/WL) 转为上下限映射范围 (Lower/Upper)
 * 严格遵循 DICOM PS3.3 C.11.2.1.2：
 * lower = c - 0.5 - (w - 1) / 2
 * upper = c - 0.5 + (w - 1) / 2
 */
export function voiToRange(voi: VOIRange): VOIBounds {
  const w = Math.max(1, voi.windowWidth);
  const c = voi.windowCenter;
  const halfSpan = (w - 1) / 2;
  return {
    lower: c - 0.5 - halfSpan,
    upper: c - 0.5 + halfSpan,
  };
}

/**
 * 上下限映射范围 (Lower/Upper) 逆推窗宽窗位 (WW/WL)
 */
export function rangeToVOI(lower: number, upper: number): VOIRange {
  const windowWidth = Math.max(1, upper - lower + 1);
  const windowCenter = (upper + lower) / 2 + 0.5;
  return {
    windowWidth,
    windowCenter,
  };
}

/**
 * 将指定 HU 按照给定的 VOI 映射为 0-255 字节值（DICOM PS3.3 C.11.2.1.2 标准三段式映射）
 * 支持 MONOCHROME1 灰阶反转（S3: 高值显黑，如 CR/DX）
 */
export function mapHUToUint8(
  hu: number,
  voi: VOIRange,
  photometricInterpretation?: string,
): number {
  const w = Math.max(1, voi.windowWidth);
  const c = voi.windowCenter;
  const { lower, upper } = voiToRange(voi);

  let output: number;
  if (hu <= lower) {
    output = 0;
  } else if (hu > upper) {
    output = 255;
  } else {
    output = Math.round(((hu - (c - 0.5)) / (w - 1) + 0.5) * 255);
  }

  // 裁剪到 [0, 255] 范围
  if (output < 0) output = 0;
  if (output > 255) output = 255;

  // MONOCHROME1 反转处理（S3）
  if (photometricInterpretation === 'MONOCHROME1') {
    return 255 - output;
  }

  return output;
}
