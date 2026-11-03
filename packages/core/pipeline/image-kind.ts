import type { ImagePlane } from '../domain/types';

/** SC 的 Image Plane 模块可选；不能把缺失坐标的派生图误当作坏的断层切片。 */
export function isNonVolumetricImage(plane: ImagePlane): boolean {
  const uid = plane.sopClassUid;
  return plane.isMultiframe2D === true || plane.imageType?.[2] === 'LOCALIZER'
    || uid === '1.2.840.10008.5.1.4.1.1.7'
    || ['1', '2', '3', '4'].some(suffix => uid === `1.2.840.10008.5.1.4.1.1.7.${suffix}`);
}

/** 混有定位像或 SC 时不声称整组影像具有可重建的空间层序。 */
export function isNonVolumetricSeries(planes: readonly ImagePlane[]): boolean {
  return planes.some(isNonVolumetricImage);
}
