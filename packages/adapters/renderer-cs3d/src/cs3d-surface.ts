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

export interface Cs3dViewportLike {
  /** CS3D 中切片切换是异步的（可能触发解码），实测必须 await */
  setStack(imageIds: readonly string[], currentImageIdIndex?: number): Promise<void> | void;
  setImageIdIndex(index: number): Promise<void> | void;
  setProperties(properties: { voiRange?: Cs3dVOIRangeLike }): void;
  getProperties(): Cs3dViewportPropertiesLike;
  render(): void;
  resetCamera?(): void;
  /** 返回 [x, y]（画布像素坐标） */
  worldToCanvas?(world: readonly number[]): number[];
  /** 入参 [x, y]（画布像素坐标），返回 [x, y, z]（LPS） */
  canvasToWorld?(canvas: readonly number[]): number[];
  readonly canvas?: unknown;
  readonly element?: unknown;
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
  destroy(): void;
}

export interface Cs3dEnumsLike {
  readonly ViewportType: {
    readonly STACK: string;
    readonly ORTHOGRAPHIC: string;
  };
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
}
