/**
 * Cornerstone3D 运行时接口适配器
 *
 * 职责：
 * 满足 renderer-cs3d 的依赖倒置契约（Cs3dModuleLike），
 * 将真实 CS3D 实例适配为抽象端口，零 as unknown 强转。
 *
 * P2 起一个视口可能是 STACK，也可能是 ORTHOGRAPHIC（MPR）：
 * - `setStack` 只存在于 StackViewport，`setVolumes/setOrientation` 只存在于 VolumeViewport；
 * - 因此这里用 `instanceof` 收敛分支，而不是用类型断言假装某个方法一定存在——
 *   调错类型时抛明确错误（R7），不静默降级。
 */

import * as cs3d from '@cornerstonejs/core';
import type {
  Cs3dCameraLike,
  Cs3dEnableElementOptions,
  Cs3dEngineLike,
  Cs3dLocalVolumeOptionsLike,
  Cs3dModuleLike,
  Cs3dViewportLike,
  Cs3dViewportPropertiesLike,
  Cs3dVolumeInputLike,
  Cs3dVolumeLike,
  Cs3dVOIRangeLike,
} from '@opendicomviewer/renderer-cs3d';

function toPoint3(values: readonly number[]): cs3d.Types.Point3 {
  const [x, y, z] = values;
  return [x ?? 0, y ?? 0, z ?? 0];
}

/** CS3D 的 Mat3 是 9 元组（不是任意长度数组），这里显式建元组才能通过类型检查 */
type DirectionTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** direction 必须 9 个分量；长度不对说明上游几何有 bug，直接抛错 */
function toMat3(values: readonly number[]): DirectionTuple {
  if (values.length !== 9) {
    throw new Error(`体积方向必须是 9 个分量，实际收到 ${values.length} 个`);
  }
  const [a, b, c, d, e, f, g, h, i] = values;
  return [a ?? 0, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0, g ?? 0, h ?? 0, i ?? 0];
}

function toCs3dViewportType(type: string): cs3d.Enums.ViewportType {
  if (type === cs3d.Enums.ViewportType.ORTHOGRAPHIC) {
    return cs3d.Enums.ViewportType.ORTHOGRAPHIC;
  }
  return cs3d.Enums.ViewportType.STACK;
}

function toOrientationAxis(orientation: string): cs3d.Enums.OrientationAxis {
  if (orientation === cs3d.Enums.OrientationAxis.AXIAL) {
    return cs3d.Enums.OrientationAxis.AXIAL;
  }
  if (orientation === cs3d.Enums.OrientationAxis.CORONAL) {
    return cs3d.Enums.OrientationAxis.CORONAL;
  }
  if (orientation === cs3d.Enums.OrientationAxis.SAGITTAL) {
    return cs3d.Enums.OrientationAxis.SAGITTAL;
  }
  throw new Error(`不支持的朝向：${orientation}`);
}

/** 单个视口的适配器：按实例类型暴露对应方法，调用方用错通路立刻报错 */
export class Cs3dViewportAdapter implements Cs3dViewportLike {
  constructor(private readonly vp: cs3d.Types.IViewport) {}

  get canvas(): unknown {
    return this.vp.canvas;
  }

  get element(): unknown {
    return this.vp.element;
  }

  get type(): string {
    return this.vp.type;
  }

  async setStack(
    imageIds: readonly string[],
    currentImageIdIndex?: number,
  ): Promise<void> {
    await this.requireStack('setStack').setStack(
      [...imageIds],
      currentImageIdIndex,
    );
  }

  async setImageIdIndex(index: number): Promise<void> {
    await this.requireStack('setImageIdIndex').setImageIdIndex(index);
  }

  async setVolumes(
    volumeInputs: readonly Cs3dVolumeInputLike[],
    immediate?: boolean,
    suppressEvents?: boolean,
  ): Promise<void> {
    const inputs: cs3d.Types.IVolumeInput[] = volumeInputs.map((input) => ({
      volumeId: input.volumeId,
    }));
    await this.requireVolume('setVolumes').setVolumes(
      inputs,
      immediate,
      suppressEvents,
    );
  }

  setOrientation(
    orientation: string,
    immediate?: boolean,
    suppressEvents?: boolean,
  ): void {
    this.requireVolume('setOrientation').setOrientation(
      toOrientationAxis(orientation),
      immediate,
      suppressEvents,
    );
  }

  getCamera(): Cs3dCameraLike {
    const camera = this.vp.getCamera();
    return {
      // ICamera 的字段在类型上可选，但运行期一定存在；这里给 LPS 原点兜底只为满足类型
      focalPoint: camera.focalPoint ?? [0, 0, 0],
      viewPlaneNormal: camera.viewPlaneNormal ?? [0, 0, 1],
      position: camera.position ?? [0, 0, 0],
      viewUp: camera.viewUp,
      parallelScale: camera.parallelScale,
    };
  }

  jumpToWorld(world: readonly number[]): boolean {
    const point = toPoint3(world);
    if (this.vp instanceof cs3d.StackViewport) {
      return this.vp.jumpToWorld(point);
    }
    if (this.vp instanceof cs3d.VolumeViewport) {
      return this.vp.jumpToWorld(point);
    }
    throw new Error(`视口 ${this.vp.id} 不支持 jumpToWorld`);
  }

  getCurrentImageIdIndex(): number {
    return this.vp.getCurrentImageIdIndex();
  }

  getSliceIndex(): number {
    return this.vp.getSliceIndex();
  }

  getNumberOfSlices(): number {
    return this.vp.getNumberOfSlices();
  }

  setProperties(properties: { voiRange?: Cs3dVOIRangeLike }): void {
    // setProperties 只在 StackViewport / VolumeViewport 上声明，基类没有
    const voiRange = properties.voiRange
      ? { lower: properties.voiRange.lower, upper: properties.voiRange.upper }
      : undefined;
    if (this.vp instanceof cs3d.StackViewport) {
      this.vp.setProperties({ voiRange });
      return;
    }
    if (this.vp instanceof cs3d.VolumeViewport) {
      this.vp.setProperties({ voiRange });
      return;
    }
    throw new Error(`视口 ${this.vp.id} 不支持 setProperties`);
  }

  getProperties(): Cs3dViewportPropertiesLike {
    const props = this.vp.getProperties();
    return {
      voiRange: {
        lower: props.voiRange?.lower ?? 0,
        upper: props.voiRange?.upper ?? 255,
      },
    };
  }

  render(): void {
    this.vp.render();
  }

  resetCamera(): void {
    this.vp.resetCamera();
  }

  getZoom(): number { return this.vp.getZoom(); }
  setZoom(value: number): void { this.vp.setZoom(value); }
  getPan(): number[] { return this.vp.getPan(); }
  setPan(value: readonly number[]): void {
    const [x, y] = value;
    this.vp.setPan([x ?? 0, y ?? 0]);
  }

  worldToCanvas(world: readonly number[]): number[] {
    return this.vp.worldToCanvas(toPoint3(world));
  }

  canvasToWorld(canvas: readonly number[]): number[] {
    const [x, y] = canvas;
    return this.vp.canvasToWorld([x ?? 0, y ?? 0]);
  }

  private requireStack(method: string): cs3d.StackViewport {
    if (!(this.vp instanceof cs3d.StackViewport)) {
      throw new Error(`视口 ${this.vp.id} 不是 STACK 类型，不支持 ${method}`);
    }
    return this.vp;
  }

  private requireVolume(method: string): cs3d.VolumeViewport {
    if (!(this.vp instanceof cs3d.VolumeViewport)) {
      throw new Error(`视口 ${this.vp.id} 不是体积视口，不支持 ${method}`);
    }
    return this.vp;
  }
}

export class Cs3dEngineAdapter implements Cs3dEngineLike {
  private readonly raw: cs3d.RenderingEngine;

  constructor(id: string) {
    this.raw = new cs3d.RenderingEngine(id);
  }

  enableElement(options: Cs3dEnableElementOptions): void {
    const element = options.element;
    if (!(element instanceof HTMLDivElement)) {
      throw new Error('挂载元素必须为 HTMLDivElement');
    }

    const type = toCs3dViewportType(options.type);
    const background = options.defaultOptions?.background;

    this.raw.enableElement({
      viewportId: options.viewportId,
      element,
      type,
      defaultOptions: background
        ? { background: [background[0] ?? 0, background[1] ?? 0, background[2] ?? 0] }
        : undefined,
    });
  }

  getViewport(viewportId: string): Cs3dViewportLike {
    // 必须用 getViewport：getStackViewport 只认 STACK，ORTHOGRAPHIC 视口会直接抛错
    return new Cs3dViewportAdapter(this.raw.getViewport(viewportId));
  }

  disableElement(viewportId: string): void {
    this.raw.disableElement(viewportId);
  }

  resize(immediate = true, keepCamera = true): void {
    this.raw.resize(immediate, keepCamera);
  }

  destroy(): void {
    this.raw.destroy();
  }
}

/**
 * 本地体积需要的 DICOM 元数据：core 侧的体素已统一映射为 8-bit 无符号，
 * 因此这里按 MONOCHROME2 / 8 bit 合成，而不是假装来自原始文件。
 */
function buildLocalVolumeMetadata(
  options: Cs3dLocalVolumeOptionsLike,
): cs3d.Types.Metadata {
  const [columns, rows] = options.dimensions;
  const [columnSpacing, rowSpacing] = options.spacing;
  const [r0, r1, r2, c0, c1, c2] = toMat3(options.direction);
  return {
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    Modality: '',
    FrameOfReferenceUID: '',
    PixelSpacing: [columnSpacing ?? 1, rowSpacing ?? 1],
    ImageOrientationPatient: [r0, r1, r2, c0, c1, c2],
    Columns: columns,
    Rows: rows,
    voiLut: [],
    VOILUTFunction: 'LINEAR',
  };
}

export function createCs3dModule(): Cs3dModuleLike {
  return {
    init: async () => {
      await cs3d.init();
    },
    RenderingEngine: Cs3dEngineAdapter,
    Enums: cs3d.Enums,
    // 体积通路：没有它 capabilities().supportsVolume 就是 false（不承诺没探测过的能力）
    volumeLoader: {
      createLocalVolume(
        volumeId: string,
        options: Cs3dLocalVolumeOptionsLike,
      ): Cs3dVolumeLike {
        return cs3d.volumeLoader.createLocalVolume(volumeId, {
          metadata: buildLocalVolumeMetadata(options),
          dimensions: toPoint3(options.dimensions),
          spacing: toPoint3(options.spacing),
          origin: toPoint3(options.origin),
          direction: toMat3(options.direction),
          scalarData: options.scalarData,
        });
      },
    },
    cache: {
      getVolume: (volumeId: string) => cs3d.cache.getVolume(volumeId),
      removeVolumeLoadObject: (volumeId: string) =>
        cs3d.cache.removeVolumeLoadObject(volumeId),
      removeImageLoadObject: (imageId: string) => {
        // 层图像可能已被缓存淘汰：不存在时跳过，不能让清理流程中途抛错。
        // force：本体积即将销毁，派生层图像不应再被 sharedCacheKey 保护。
        if (cs3d.cache.getImageLoadObject(imageId) !== undefined) {
          cs3d.cache.removeImageLoadObject(imageId, { force: true });
        }
      },
    },
  };
}
