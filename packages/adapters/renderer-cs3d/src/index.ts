/**
 * @opendicomviewer/renderer-cs3d
 *
 * Cornerstone3D 渲染适配器。只实现 RendererPort，不解析 DICOM；
 * CS3D 模块由组合根注入（见 cs3d-surface.ts 的依赖倒置说明）。
 */

export {
  CornerstoneRenderer,
  createCornerstoneRenderer,
  type CornerstoneRendererOptions,
} from './cornerstone-renderer';
export { SeriesFrameRegistry, type FrameRef } from './frame-registry';
export { parseImageId, toImageId, type ParsedImageId } from './image-id';
export type {
  Cs3dCacheLike,
  Cs3dCameraLike,
  Cs3dEnableElementOptions,
  Cs3dEngineLike,
  Cs3dEnumsLike,
  Cs3dLocalVolumeOptionsLike,
  Cs3dModuleLike,
  Cs3dViewportLike,
  Cs3dViewportPropertiesLike,
  Cs3dVolumeInputLike,
  Cs3dVolumeLike,
  Cs3dVolumeLoaderLike,
  Cs3dVOIRangeLike,
} from './cs3d-surface';
