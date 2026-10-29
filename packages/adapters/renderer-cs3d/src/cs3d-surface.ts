/**
 * 本包只依赖 CS3D 的**结构形状**，不 import 它。
 *
 * 原因（架构上而不是偷懒）：
 * 1. 依赖倒置放在正确的缝上——CS3D 模块由组合根（app-web）注入，
 *    Adapter 不认识具体版本，升级时只需换注入的模块；
 * 2. 让这个包在没装 CS3D 的环境里也能 typecheck 与跑单测（CI 不需要 200 个包 + wasm）；
 * 3. 真实 API 对接由 Spike A（已实测）与 e2e 兜底，而不是靠类型断言假装正确。
 *
 * 字段来源：`spikes/cs3d-min` 实测确认存在的方法，见 README 的 Q1 表格。
 */

export interface Cs3dVOIRangeLike {
  /** 映射下限（HU） */
  readonly lower: number;
  /** 映射上限（HU） */
  readonly upper: number;
}

export interface Cs3dViewportPropertiesLike {
  readonly voiRange: Cs3dVOIRangeLike;
}

/** 相机读数（只取换算层号需要的字段） */
export interface Cs3dCameraLike {
  readonly focalPoint: readonly number[];
  readonly viewPlaneNormal: readonly number[];
  readonly position: readonly number[];
  readonly viewUp?: readonly number[];
  readonly parallelScale?: number;
}

/** `setVolumes` 的入参形状（CS3D 只要 volumeId） */
export interface Cs3dVolumeInputLike {
  readonly volumeId: string;
}

export interface Cs3dViewportLike {
  /** CS3D 中切片切换是异步的（可能触发解码），实测必须 await */
  setStack(imageIds: readonly string[], currentImageIdIndex?: number): Promise<void> | void;
  setImageIdIndex(index: number): Promise<void> | void;
  setProperties(properties: { voiRange?: Cs3dVOIRangeLike }): void;
  getProperties(): Cs3dViewportPropertiesLike;
  render(): void;
  resetCamera?(): void;
  getZoom?(): number;
  setZoom?(value: number): void;
  getPan?(): number[];
  setPan?(value: readonly number[]): void;
  /** 返回 [x, y]（画布像素坐标） */
  worldToCanvas?(world: readonly number[]): number[];
  /** 入参 [x, y]（画布像素坐标），返回 [x, y, z]（LPS） */
  canvasToWorld?(canvas: readonly number[]): number[];
  /** 仅 ORTHOGRAPHIC/Volume 视口有；STACK 视口调用直接抛错（Spike B） */
  setVolumes?(
    volumeInputs: readonly Cs3dVolumeInputLike[],
    immediate?: boolean,
    suppressEvents?: boolean,
  ): Promise<void> | void;
  setOrientation?(orientation: string, immediate?: boolean, suppressEvents?: boolean): void;
  getCamera?(): Cs3dCameraLike;
  /** 返回是否定位成功（Stack 视口找不到对应层时返回 false） */
  jumpToWorld?(world: readonly number[]): boolean;
  getCurrentImageIdIndex?(): number;
  getSliceIndex?(): number;
  getNumberOfSlices?(): number;
  readonly canvas?: unknown;
  readonly element?: unknown;
  readonly type?: string;
}

export interface Cs3dEnableElementOptions {
  readonly viewportId: string;
  readonly element: unknown;
  readonly type: string;
  readonly defaultOptions?: { background?: readonly [number, number, number] };
}

export interface Cs3dEngineLike {
  enableElement(options: Cs3dEnableElementOptions): void;
  getViewport(viewportId: string): Cs3dViewportLike;
  disableElement?(viewportId: string): void;
  /**
   * 按各视口元素的当前 CSS 尺寸重算 canvas 的 attribute 尺寸。
   *
   * CS3D 自身不监听元素尺寸：不调它时，布局切换或底栏出现会让 canvas 停在
   * 旧尺寸，画面被拉伸、按画布反算的比例尺随之失真。
   */
  resize?(immediate?: boolean, keepCamera?: boolean): void;
  destroy(): void;
}

export interface Cs3dEnumsLike {
  readonly ViewportType: {
    readonly STACK: string;
    readonly ORTHOGRAPHIC: string;
  };
}

/** 本地体积（`createLocalVolume` 的产物，只需要 id 与销毁能力） */
export interface Cs3dVolumeLike {
  readonly volumeId: string;
  /**
   * `createLocalVolume` 为每层派生的本地 imageId（CS3D 内部按 `…_slice_i` 生成）。
   * 移除体积时必须一并清理，否则同 id 重建会在 createAndCacheLocalImage
   * 里命中 "putImageSync: imageId already in cache"。
   */
  readonly imageIds?: readonly string[];
  destroy?(): void;
}

/**
 * `createLocalVolume` 的入参（Spike B 实测可用的最小集合）。
 *
 * 不在这里传 DICOM metadata：那是 CS3D 的宿主细节，由注入方（app-web）
 * 按 8-bit MONOCHROME2 自己合成，适配器只负责给出几何与体素缓冲。
 *
 * `scalarData` 是 x 最快、z 最慢的 8-bit 体素缓冲。
 */
export interface Cs3dLocalVolumeOptionsLike {
  dimensions: readonly [number, number, number];
  spacing: readonly [number, number, number];
  origin: readonly [number, number, number];
  direction: readonly number[];
  scalarData: Uint8Array;
}

export interface Cs3dVolumeLoaderLike {
  createLocalVolume(volumeId: string, options: Cs3dLocalVolumeOptionsLike): Cs3dVolumeLike;
}

/** 体积缓存（只用到查询与移除；`removeVolumeLoadObject` 在 cs3d 4.22 上才有） */
export interface Cs3dCacheLike {
  getVolume(volumeId: string): Cs3dVolumeLike | undefined;
  removeVolumeLoadObject(volumeId: string): void;
  /**
   * 清理 `createLocalVolume` 派生的层图像。
   * 不清理会让同 volumeId 重建直接失败（4.22 的派生图像也进了 image cache）。
   */
  removeImageLoadObject?(imageId: string): void;
}

/**
 * 组合根需要注入的最小 CS3D 表面。
 *
 * app-web 侧的接线大致是：
 * ```ts
 * import * as cs3d from '@cornerstonejs/core';
 * const renderer = createCornerstoneRenderer({
 *   cs3d: { init: () => cs3d.init(), RenderingEngine: cs3d.RenderingEngine, Enums: cs3d.Enums },
 * });
 * ```
 */
export interface Cs3dModuleLike {
  init(): Promise<void> | void;
  readonly RenderingEngine: new (id: string) => Cs3dEngineLike;
  readonly Enums: Cs3dEnumsLike;
  /** MPR 体积通路必需；未注入时 `capabilities().supportsVolume` 为 false */
  readonly volumeLoader?: Cs3dVolumeLoaderLike;
  readonly cache?: Cs3dCacheLike;
}
