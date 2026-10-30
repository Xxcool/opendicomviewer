/**
 * Cornerstone3D 自定义 ImageLoader 与 Metadata 桥接
 *
 * 遵循架构规范：
 * 1. 注册 odv:// 协议 scheme，按 imageId 反查 SeriesFrameRegistry（ADR-013）；
 * 2. 避免引入 @cornerstonejs/dicom-image-loader（规避 2 MB 的 5 个 codec wasm 静态打包）；
 * 3. 注册 metaData provider，向 CS3D 视口提供 imagePlaneModule 几何与 modalityLutModule 变换。
 */

import * as cs3d from '@cornerstonejs/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { pickAdaptiveVOI, rawToHU, type ImagePlane } from '@opendicomviewer/core';

export interface BridgeRegistration {
  readonly unregister: () => void;
}

/**
 * 计算像素缓冲的极值 [min, max]
 */
export function computeMinMax(
  pixelData: Int16Array | Uint16Array | Uint8Array | Float32Array,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const len = pixelData.length;
  for (let i = 0; i < len; i++) {
    const val = pixelData[i]!;
    if (val < min) min = val;
    if (val > max) max = val;
  }
  if (min === Infinity) {
    return [0, 0];
  }
  return [min, max];
}

/**
 * 组装 CS3D 识别的 ImagePlaneModule 元数据
 */
export function buildImagePlaneModule(
  plane: ImagePlane,
  frameOfReferenceUID: string,
): Record<string, unknown> {
  const iop = plane.imageOrientationPatient;
  return {
    imagePositionPatient: [...plane.imagePositionPatient],
    imageOrientationPatient: [...iop],
    rowCosines: [iop[0]!, iop[1]!, iop[2]!],
    columnCosines: [iop[3]!, iop[4]!, iop[5]!],
    pixelSpacing: [...plane.pixelSpacing],
    rowPixelSpacing: plane.pixelSpacing[0],
    columnPixelSpacing: plane.pixelSpacing[1],
    sliceThickness: plane.sliceThickness,
    spacingBetweenSlices: plane.spacingBetweenSlices,
    frameOfReferenceUID: plane.frameOfReferenceUID ?? frameOfReferenceUID,
    columns: plane.columns,
    rows: plane.rows,
  };
}

/**
 * 注册 odv:// 镜像加载器与元数据提供程序
 */
export function registerCs3dBridge(
  renderer: CornerstoneRenderer,
): BridgeRegistration {
  const metaDataProvider = (type: string, query: unknown): unknown => {
    const imageId = typeof query === 'string' ? query : undefined;
    if (!imageId || !imageId.startsWith('odv://')) {
      return undefined;
    }

    const ref = renderer.frameRegistry.lookup(imageId);
    if (!ref) {
      return undefined;
    }

    const { handle, frameIndex } = ref;
    const plane = handle.meta.planes[frameIndex];
    if (!plane) {
      return undefined;
    }

    if (type === 'imagePlaneModule') {
      // 合成值：仅在原图缺失 FrameOfReferenceUID 时按序列隔离派生，绝不借用 StudyUID（P1-4）
      const forUid = plane.frameOfReferenceUID ?? `${handle.meta.seriesInstanceUid}.for`;
      return buildImagePlaneModule(plane, forUid);
    }

    if (type === 'imagePixelModule') {
      return {
        bitsAllocated: plane.bitsAllocated ?? 16,
        bitsStored: plane.bitsStored ?? 16,
        pixelRepresentation: plane.pixelRepresentation ?? 0,
        samplesPerPixel: 1,
        photometricInterpretation:
          plane.photometricInterpretation ?? 'MONOCHROME2',
        rows: plane.rows,
        columns: plane.columns,
      };
    }

    if (type === 'generalSeriesModule') {
      return {
        modality: handle.meta.modality,
        seriesInstanceUID: handle.meta.seriesInstanceUid,
        seriesNumber: handle.meta.seriesNumber,
      };
    }

    if (type === 'voiLutModule') {
      return {
        windowWidth:
          plane.windowWidth !== undefined ? [plane.windowWidth] : undefined,
        windowCenter:
          plane.windowCenter !== undefined ? [plane.windowCenter] : undefined,
      };
    }

    if (type === 'modalityLutModule') {
      return {
        rescaleSlope: plane.rescaleSlope ?? 1,
        rescaleIntercept: plane.rescaleIntercept ?? 0,
      };
    }

    return undefined;
  };

  cs3d.metaData.addProvider(metaDataProvider, 1000);

  const loaderFn = (imageId: string) => {
    const promise = (async () => {
      const frame = await renderer.frameRegistry.resolveFrame(imageId);
      const ref = renderer.frameRegistry.lookup(imageId);
      const plane = ref ? ref.handle.meta.planes[ref.frameIndex] : undefined;

      const slope = frame.rescaleSlope ?? plane?.rescaleSlope ?? 1;
      const intercept = frame.rescaleIntercept ?? plane?.rescaleIntercept ?? 0;
      const modalityLUT = frame.modalityLUT ?? plane?.modalityLUT;
      // GPU Stack 直接用 scalarData 映射物理窗，不会替自定义 loader 应用 slope/intercept。
      // 仅创建显示副本，原始帧继续作为数据计算真源；标记已缩放以避免 CPU 再次换算。
      const scaled = slope !== 1 || intercept !== 0 || modalityLUT !== undefined;
      const displayPixels = scaled
        ? Float32Array.from(frame.pixelData, (value) => rawToHU(value, slope, intercept, modalityLUT))
        : frame.pixelData;
      const [min, max] = computeMinMax(displayPixels);
      const automatic = pickAdaptiveVOI({ ...frame, rescaleSlope: slope, rescaleIntercept: intercept, modalityLUT,
        defaultVOI: frame.defaultVOI ?? (plane?.windowWidth !== undefined && plane.windowCenter !== undefined
          ? { windowWidth: plane.windowWidth, windowCenter: plane.windowCenter } : undefined),
      });
      const defaultCenter = automatic.voi.windowCenter;
      const defaultWidth = automatic.voi.windowWidth;

      const invert =
        frame.photometricInterpretation === 'MONOCHROME1' ||
        plane?.photometricInterpretation === 'MONOCHROME1';

      const dataType: cs3d.Types.PixelDataTypedArrayString =
        displayPixels instanceof Float32Array
          ? 'Float32Array'
          : displayPixels instanceof Int16Array
            ? 'Int16Array'
            : displayPixels instanceof Uint8Array
              ? 'Uint8Array'
              : 'Uint16Array';

      const image: cs3d.Types.IImage = {
        imageId,
        minPixelValue: min,
        maxPixelValue: max,
        slope: 1,
        intercept: 0,
        preScale: {
          enabled: true, scaled,
          scalingParameters: { rescaleSlope: slope, rescaleIntercept: intercept, modality: ref?.handle.meta.modality ?? 'OT' },
        },
        windowCenter: defaultCenter,
        windowWidth: defaultWidth,
        voiLUTFunction: cs3d.Enums.VOILUTFunctionType.LINEAR,
        getPixelData: () => displayPixels,
        getCanvas: () => {
          // 提供离屏 canvas 避免内部路径访问空抛错 (N6)
          const canvas = document.createElement('canvas');
          canvas.width = frame.width;
          canvas.height = frame.height;
          return canvas;
        },
        rows: frame.height,
        columns: frame.width,
        height: frame.height,
        width: frame.width,
        color: false,
        rgba: false,
        numberOfComponents: 1,
        columnPixelSpacing: plane?.pixelSpacing?.[1] ?? 1,
        rowPixelSpacing: plane?.pixelSpacing?.[0] ?? 1,
        sliceThickness: plane?.sliceThickness,
        invert,
        sizeInBytes: displayPixels.byteLength,
        dataType,
      };

      return image;
    })();

    return {
      promise,
      cancelFn: () => {},
    };
  };

  cs3d.imageLoader.registerImageLoader('odv', loaderFn);

  return {
    unregister: () => {
      cs3d.metaData.removeProvider(metaDataProvider);
      // CS3D 4.x 不提供单项反注册，覆盖为空加载器以阻断请求 (N7)
      cs3d.imageLoader.registerImageLoader('odv', () => ({
        promise: Promise.reject(new Error('odv 镜像加载器已注销')),
      }));
    },
  };
}
