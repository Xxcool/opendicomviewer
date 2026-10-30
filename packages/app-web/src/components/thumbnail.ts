import { mapHUToUint8, rawToHU, type PixelFrame } from '@opendicomviewer/core';

/** 缩略图仅用于选序列，复用核心灰度流水线，保留宽高比和 MONOCHROME1 语义。 */
export function makeThumbnail(frame: PixelFrame, maxEdge = 64) {
  const { width, height, pixelData } = frame;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || pixelData.length < width * height || !Number.isSafeInteger(maxEdge) || maxEdge <= 0) {
    throw new Error('缩略图像素或尺寸无效');
  }
  const intensity = (index: number) => rawToHU(pixelData[index]!, frame.rescaleSlope, frame.rescaleIntercept, frame.modalityLUT);
  let voi = frame.defaultVOI;
  if (!voi || !Number.isFinite(voi.windowCenter) || !Number.isFinite(voi.windowWidth) || voi.windowWidth < 1) {
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < width * height; i++) { const value = intensity(i); min = Math.min(min, value); max = Math.max(max, value); }
    voi = { windowWidth: max - min + 1, windowCenter: (min + max + 1) / 2 };
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    // 首尾采样覆盖完整矩阵边界，避免缩放取整丢掉最后几行/列。
    const sourceX = outWidth === 1 ? Math.floor(width / 2) : Math.round(x * (width - 1) / (outWidth - 1));
    const sourceY = outHeight === 1 ? Math.floor(height / 2) : Math.round(y * (height - 1) / (outHeight - 1));
    const index = sourceY * width + sourceX;
    const gray = mapHUToUint8(intensity(index), voi, frame.photometricInterpretation);
    const offset = (y * outWidth + x) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = gray; rgba[offset + 3] = 255;
  }
  return { width: outWidth, height: outHeight, rgba };
}
