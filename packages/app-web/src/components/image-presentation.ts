import { isNonVolumetricSeries, type SeriesMeta } from '@opendicomviewer/core';
import { describeSliceOrientation } from './slice-geometry';

/** 显示占位网格和真实物理信息分开：不能把 SC 的 1×1 显示网格写成毫米。 */
export function describeSeriesImages(meta: SeriesMeta | undefined) {
  const planes = meta?.planes ?? [];
  const first = planes[0];
  const nonVolumetric = isNonVolumetricSeries(planes);
  const missingSpacing = planes.some(plane => plane.hasMissingPixelSpacing
    || plane.pixelSpacing.some(value => !Number.isFinite(value) || value <= 0));
  const variedSpacing = !!first && planes.some(plane => plane.pixelSpacing.some((value, i) => value !== first.pixelSpacing[i]));
  return {
    nonVolumetric,
    orientation: nonVolumetric
      ? { label: planes.some(plane => plane.isMultiframe2D) ? '多帧影像（二维）' : '定位像 / 二次采集（二维）', top: '', bottom: '', left: '', right: '' }
      : describeSliceOrientation(first?.imageOrientationPatient, first?.hasMissingGeometry),
    physicalScale: !!first && !nonVolumetric && !missingSpacing && !variedSpacing,
    pixelSpacing: !first ? undefined : missingSpacing ? '部分影像未提供或无效'
      : variedSpacing ? '各帧不同' : `${first.pixelSpacing[0].toFixed(2)} × ${first.pixelSpacing[1].toFixed(2)} mm`,
    layerSpacing: nonVolumetric ? '不适用（二维影像）'
      : !meta || !first || planes.some(plane => plane.hasMissingGeometry)
        || (planes.length < 2 && first.spacingBetweenSlices === undefined) ? undefined
        : `${meta.spacing[2].toFixed(2)} mm`,
  };
}
