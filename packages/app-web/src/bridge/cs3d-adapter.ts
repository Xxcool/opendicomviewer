/**
 * Cornerstone3D 运行时接口适配器
 *
 * 职责：
 * 满足 renderer-cs3d 的依赖倒置契约（Cs3dModuleLike），
 * 将真实 CS3D 实例安全适配为抽象端口，零 as unknown 强转。
 */

import * as cs3d from '@cornerstonejs/core';
import type {
  Cs3dEnableElementOptions,
  Cs3dEngineLike,
  Cs3dModuleLike,
  Cs3dViewportLike,
  Cs3dViewportPropertiesLike,
  Cs3dVOIRangeLike,
} from '@opendicomviewer/renderer-cs3d';

export class Cs3dStackViewportAdapter implements Cs3dViewportLike {
  constructor(private readonly vp: cs3d.Types.IStackViewport) {}

  get canvas(): unknown {
    return this.vp.canvas;
  }

  get element(): unknown {
    return this.vp.element;
  }

  async setStack(
    imageIds: readonly string[],
    currentImageIdIndex?: number,
  ): Promise<void> {
    await this.vp.setStack([...imageIds], currentImageIdIndex);
  }

  async setImageIdIndex(index: number): Promise<void> {
    await this.vp.setImageIdIndex(index);
  }

  setProperties(properties: { voiRange?: Cs3dVOIRangeLike }): void {
    this.vp.setProperties({
      voiRange: properties.voiRange
        ? { lower: properties.voiRange.lower, upper: properties.voiRange.upper }
        : undefined,
    });
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

  worldToCanvas(world: readonly number[]): number[] {
    const pt: cs3d.Types.Point3 = [
      world[0] ?? 0,
      world[1] ?? 0,
      world[2] ?? 0,
    ];
    return this.vp.worldToCanvas(pt);
  }

  canvasToWorld(canvas: readonly number[]): number[] {
    const pt: cs3d.Types.Point2 = [canvas[0] ?? 0, canvas[1] ?? 0];
    return this.vp.canvasToWorld(pt);
  }
}

function toCs3dViewportType(type: string): cs3d.Enums.ViewportType {
  if (type === cs3d.Enums.ViewportType.ORTHOGRAPHIC) {
    return cs3d.Enums.ViewportType.ORTHOGRAPHIC;
  }
  return cs3d.Enums.ViewportType.STACK;
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
    const vp = this.raw.getStackViewport(viewportId);
    return new Cs3dStackViewportAdapter(vp);
  }

  disableElement(viewportId: string): void {
    this.raw.disableElement(viewportId);
  }

  destroy(): void {
    this.raw.destroy();
  }
}

export function createCs3dModule(): Cs3dModuleLike {
  return {
    init: async () => {
      await cs3d.init();
    },
    RenderingEngine: Cs3dEngineAdapter,
    Enums: cs3d.Enums,
  };
}
