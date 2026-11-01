import type {
  ImagePlane,
  PixelFrame,
  SeriesHandle,
  SeriesMeta,
  VolumeHandle,
} from '@opendicomviewer/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CornerstoneRenderer,
  SeriesFrameRegistry,
  parseImageId,
  toImageId,
  type Cs3dCacheLike,
  type Cs3dCameraLike,
  type Cs3dEngineLike,
  type Cs3dEnableElementOptions,
  type Cs3dModuleLike,
  type Cs3dViewportLike,
  type Cs3dViewportPropertiesLike,
  type Cs3dVolumeInputLike,
  type Cs3dVolumeLike,
  type Cs3dVolumeLoaderLike,
} from '../src/index';

// ── 假 CS3D（只记录调用，不做渲染） ────────────────────────────

class FakeViewport implements Cs3dViewportLike {
  public readonly stackCalls: Array<{
    imageIds: readonly string[];
    index: number | undefined;
  }> = [];
  public readonly indexCalls: number[] = [];
  public renderCount = 0;
  public resetCameraCount = 0;
  /** 模拟解码耗时：> 0 时异步方法会真的让出事件循环 */
  public stackDelayMs = 0;
  public indexDelayMs = 0;
  public onStackDone: (() => void) | null = null;
  /** 模拟 CS3D 装载失败，用于验证适配器的回滚路径 */
  public stackShouldFail = false;
  public onIndexDone: (() => void) | null = null;
  /** 按 imageId 决定本次装载耗时，用于构造"慢请求被快请求超越"的并发场景 */
  public stackDelayFor: ((imageIds: readonly string[]) => number) | null = null;
  /** 体积通路记录：setVolumes 的 volumeId、setOrientation 的方向、jumpToWorld 的落点 */
  public readonly volumeCalls: Array<readonly string[]> = [];
  public readonly orientationCalls: string[] = [];
  public readonly jumpCalls: number[][] = [];
  /** 模拟 StackViewport.jumpToWorld 找不到对应层 */
  public jumpShouldFail = false;
  /** 模拟 setVolumes 抛错（体积通路失败时的回滚） */
  public volumesShouldFail = false;
  /** 按调用序号决定 setVolumes 的耗时，用于构造并发装载 */
  public volumesDelayFor: ((callIndex: number) => number) | null = null;
  private volumesCallCount = 0;
  public camera: Cs3dCameraLike = {
    focalPoint: [0, 0, 0],
    viewPlaneNormal: [0, 0, 1],
    position: [0, 0, -1],
  };
  /** 挂载元素由 enableElement 注入；setLayout 用它判断"元素换了就必须重建" */
  public element: unknown;
  private properties: Cs3dViewportPropertiesLike = {
    voiRange: { lower: -160, upper: 239 },
  };

  public async setStack(
    imageIds: readonly string[],
    currentImageIdIndex?: number,
  ): Promise<void> {
    const extraDelay = this.stackDelayFor ? this.stackDelayFor(imageIds) : 0;
    const totalDelay = Math.max(this.stackDelayMs, extraDelay);
    if (totalDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
    if (this.stackShouldFail) {
      throw new Error('模拟 CS3D 装载失败');
    }
    this.stackCalls.push({ imageIds, index: currentImageIdIndex });
    this.onStackDone?.();
  }

  public async setImageIdIndex(index: number): Promise<void> {
    if (this.indexDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.indexDelayMs));
    }
    this.indexCalls.push(index);
    this.onIndexDone?.();
  }

  public async setVolumes(
    volumeInputs: readonly Cs3dVolumeInputLike[],
  ): Promise<void> {
    const callIndex = this.volumesCallCount;
    this.volumesCallCount += 1;
    const delay = this.volumesDelayFor?.(callIndex) ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (this.volumesShouldFail) {
      throw new Error('模拟 setVolumes 失败');
    }
    this.volumeCalls.push(volumeInputs.map((input) => input.volumeId));
  }

  public setOrientation(orientation: string): void {
    this.orientationCalls.push(orientation);
  }

  public getCamera(): Cs3dCameraLike {
    return this.camera;
  }

  public jumpToWorld(world: readonly number[]): boolean {
    if (this.jumpShouldFail) return false;
    this.jumpCalls.push([world[0] ?? 0, world[1] ?? 0, world[2] ?? 0]);
    // 与 CS3D 一致：定位成功后焦点移动到目标点
    this.camera = {
      ...this.camera,
      focalPoint: [world[0] ?? 0, world[1] ?? 0, world[2] ?? 0],
    };
    return true;
  }

  public setProperties(properties: { voiRange?: { lower: number; upper: number } }): void {
    if (properties.voiRange) {
      this.properties = { voiRange: properties.voiRange };
    }
  }

  public getProperties(): Cs3dViewportPropertiesLike {
    return this.properties;
  }

  public render(): void {
    this.renderCount += 1;
  }

  public resetCamera(): void {
    this.resetCameraCount += 1;
    this.zoom = 1;
    this.pan = [0, 0];
  }

  public zoom = 1;
  public pan = [0, 0];
  public getZoom(): number { return this.zoom; }
  public setZoom(value: number): void { this.zoom = value; }
  public getPan(): number[] { return this.pan; }
  public setPan(value: readonly number[]): void { this.pan = [...value]; }

  public worldToCanvas(world: readonly number[]): number[] {
    const x = world[0] ?? 0;
    const y = world[1] ?? 0;
    return [x + 0.5, y + 0.5];
  }

  public canvasToWorld(canvas: readonly number[]): number[] {
    return [canvas[0] ?? 0, canvas[1] ?? 0, 0];
  }
}

class FakeEngine implements Cs3dEngineLike {
  public readonly enabled: Cs3dEnableElementOptions[] = [];
  public readonly disabled: string[] = [];
  public resizeCount = 0;
  public destroyCount = 0;
  private readonly viewports = new Map<string, Cs3dViewportLike>();

  constructor(private readonly viewportFactory: () => Cs3dViewportLike = () => new FakeViewport()) {}

  public enableElement(options: Cs3dEnableElementOptions): void {
    this.enabled.push(options);
    const viewport = this.viewportFactory();
    if (viewport instanceof FakeViewport) {
      viewport.element = options.element;
    }
    this.viewports.set(options.viewportId, viewport);
  }

  public getViewport(viewportId: string): Cs3dViewportLike {
    const viewport = this.viewports.get(viewportId);
    if (!viewport) throw new Error(`FakeEngine: 未知视口 ${viewportId}`);
    return viewport;
  }

  public disableElement(viewportId: string): void {
    this.disabled.push(viewportId);
    this.viewports.delete(viewportId);
  }

  public resize(): void {
    this.resizeCount += 1;
  }

  public destroy(): void {
    this.destroyCount += 1;
  }

  public viewportOf(viewportId: string): FakeViewport {
    const viewport = this.getViewport(viewportId);
    if (!(viewport instanceof FakeViewport)) {
      throw new Error('当前视口不是 FakeViewport');
    }
    return viewport;
  }
}

/** 假体积缓存：create 即入 cache，remove 即出 cache，便于验证泄漏 */
class FakeVolumeCache implements Cs3dCacheLike {
  public readonly live = new Set<string>();
  public readonly removed: string[] = [];
  /** 与 cs3d 4.22 的 createLocalVolume 一致：每层派生一个 image 进入 image cache */
  public readonly liveImages = new Set<string>();
  public readonly removedImages: string[] = [];

  public getVolume(volumeId: string): Cs3dVolumeLike | undefined {
    return this.live.has(volumeId) ? { volumeId } : undefined;
  }

  public removeVolumeLoadObject(volumeId: string): void {
    this.removed.push(volumeId);
    this.live.delete(volumeId);
  }

  public removeImageLoadObject(imageId: string): void {
    this.removedImages.push(imageId);
    this.liveImages.delete(imageId);
  }
}

function makeCs3dModule(
  viewportFactory?: () => Cs3dViewportLike,
  options: { readonly volume?: boolean } = {},
): {
  cs3d: Cs3dModuleLike;
  engine: FakeEngine;
  cache: FakeVolumeCache;
  created: string[];
} {
  const engine = new FakeEngine(viewportFactory);
  const cache = new FakeVolumeCache();
  const created: string[] = [];
  // 用类表达式而不是函数：`new (id: string) => Cs3dEngineLike` 要求构造签名
  const RenderingEngine = class implements Cs3dEngineLike {
    public enableElement(options: Cs3dEnableElementOptions): void {
      engine.enableElement(options);
    }
    public getViewport(viewportId: string): Cs3dViewportLike {
      return engine.getViewport(viewportId);
    }
    public disableElement(viewportId: string): void {
      engine.disableElement(viewportId);
    }
    public resize(): void {
      engine.resize();
    }
    public destroy(): void {
      engine.destroy();
    }
  };

  const volumeLoader: Cs3dVolumeLoaderLike = {
    createLocalVolume(volumeId: string, opts): Cs3dVolumeLike {
      // 记录入参，供用例断言几何/体素没有被改写
      created.push(
        `${volumeId}:${opts.dimensions.join('x')}:${opts.scalarData.length}`,
      );
      cache.live.add(volumeId);
      // 复刻 cs3d 4.22：每层派生出 `${volumeId}_slice_i` 并进入 image cache
      const imageIds = Array.from(
        { length: opts.dimensions[2] },
        (_, i) => `${volumeId}_slice_${i}`,
      );
      for (const imageId of imageIds) cache.liveImages.add(imageId);
      return { volumeId, imageIds };
    },
  };

  const cs3d: Cs3dModuleLike = {
    init: () => undefined,
    RenderingEngine,
    Enums: { ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic' } },
    ...(options.volume ? { volumeLoader, cache } : {}),
  };
  return { cs3d, engine, cache, created };
}

// ── 假领域对象 ────────────────────────────────────────────────

function makePlane(index: number): ImagePlane {
  return {
    imageId: `plane-${index}`,
    sopInstanceUid: `1.2.3.4.${index}`,
    imagePositionPatient: [0, 0, index],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    pixelSpacing: [0.5, 0.5],
    rows: 4,
    columns: 4,
  };
}

function makeHandle(frameCount: number, seriesUid = '1.2.3'): SeriesHandle {
  const planes = Array.from({ length: frameCount }, (_, i) => makePlane(i));
  const meta: SeriesMeta = {
    seriesInstanceUid: seriesUid,
    studyInstanceUid: '1.2',
    seriesDescription: 'test',
    modality: 'CT',
    numberOfFrames: frameCount,
    planes,
    spacing: [0.5, 0.5, 1],
    warnings: [],
  };

  return {
    meta,
    warnings: [],
    pixel: async (index: number): Promise<PixelFrame> => ({
      width: 4,
      height: 4,
      pixelData: new Uint16Array([index, index, index, index]),
      rescaleSlope: 1,
      rescaleIntercept: -1024,
    }),
    dispose: () => {},
  };
}

const ELEMENT = { id: 'el' };

/** 可手动放行的 Promise，用于构造 mount 竞态 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => {
    throw new Error('deferred 尚未初始化');
  };
  const promise = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { promise, resolve: release };
}

function makeRenderer(
  overrides: Partial<ConstructorParameters<typeof CornerstoneRenderer>[0]> = {},
  moduleOptions: { readonly volume?: boolean } = {},
): {
  renderer: CornerstoneRenderer;
  engine: FakeEngine;
  cs3d: Cs3dModuleLike;
  cache: FakeVolumeCache;
  created: string[];
} {
  const { cs3d, engine, cache, created } = makeCs3dModule(
    undefined,
    moduleOptions,
  );
  const renderer = new CornerstoneRenderer({
    cs3d,
    resolveElements: () => [ELEMENT],
    idleTimeoutMs: 20,
    ...overrides,
  });
  return { renderer, engine, cs3d, cache, created };
}

/** 假体积：2×2×4、层距 1 mm，轴向法向 [0,0,1] */
function makeVolume(overrides: Partial<VolumeHandle> = {}): VolumeHandle {
  return {
    volumeId: 'vol-1',
    seriesInstanceUid: '4.4.4',
    displayOnly: true,
    dimensions: [2, 2, 4],
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    scalarData: new Uint8Array(2 * 2 * 4),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── imageId 约定 ──────────────────────────────────────────────

describe('imageId 约定 (image-id.ts)', () => {
  it('生成与解析互为逆运算', () => {
    const id = toImageId('1.2.840.113619.2.55.3', 7);
    expect(id).toBe('odv://series/1.2.840.113619.2.55.3#7');
    expect(parseImageId(id)).toEqual({
      seriesInstanceUid: '1.2.840.113619.2.55.3',
      frameIndex: 7,
    });
  });

  it('非法输入必须报错而不是产出能被误用的 id', () => {
    expect(() => toImageId('', 0)).toThrow(/seriesInstanceUid/);
    expect(() => toImageId('1.2.3', -1)).toThrow(/帧索引非法/);
    expect(() => toImageId('1.2.3', 1.5)).toThrow(/帧索引非法/);
  });

  it('格式不符一律返回 null（由调用方抛出可见错误）', () => {
    expect(parseImageId('wadouri:http://x/1.dcm')).toBeNull();
    expect(parseImageId('odv://series/1.2.3')).toBeNull();
    expect(parseImageId('odv://series/#3')).toBeNull();
    expect(parseImageId('odv://series/1.2.3#abc')).toBeNull();
  });
});

// ── 帧登记表 ──────────────────────────────────────────────────

describe('序列帧登记表 (frame-registry.ts)', () => {
  it('按 planes 顺序生成 imageId，并能反查回像素', async () => {
    const registry = new SeriesFrameRegistry();
    const handle = makeHandle(3);
    const imageIds = registry.register(handle);

    expect(imageIds).toHaveLength(3);
    expect(imageIds[0]).toBe('odv://series/1.2.3#0');
    expect(imageIds[2]).toBe('odv://series/1.2.3#2');

    const frame = await registry.resolveFrame('odv://series/1.2.3#2');
    // pixel(index) 的返回值里第一个像素值就是 index，能验证索引没有错位
    expect(frame.pixelData[0]).toBe(2);
  });

  it('用 planes.length 而不是 numberOfFrames 生成 imageId（存在 excludedPlanes 时二者不等）', () => {
    const registry = new SeriesFrameRegistry();
    const handle = makeHandle(3, '7.7.7');
    // 模拟"声明 5 帧、但 2 张因朝向冲突被剔除"的序列
    const declaredMore: SeriesHandle = {
      ...handle,
      meta: { ...handle.meta, numberOfFrames: 5 },
    };

    const imageIds = registry.register(declaredMore);
    expect(imageIds).toHaveLength(3);
    expect(imageIds).not.toContain('odv://series/7.7.7#3');
  });

  it('未登记的 imageId 必须抛错，禁止返回空白帧', async () => {
    const registry = new SeriesFrameRegistry();
    registry.register(makeHandle(2));
    await expect(registry.resolveFrame('odv://series/9.9.9#0')).rejects.toThrow(
      /未登记的 imageId/,
    );
  });

  it('release 只清掉对应序列的条目', () => {
    const registry = new SeriesFrameRegistry();
    registry.register(makeHandle(3, '1.1.1'));
    registry.register(makeHandle(2, '2.2.2'));
    expect(registry.size).toBe(5);

    registry.release('1.1.1');
    expect(registry.size).toBe(2);
    expect(registry.imageIdsOf('1.1.1')).toHaveLength(0);
    expect(registry.imageIdsOf('2.2.2')).toHaveLength(2);
  });
});

// ── 端口行为 ──────────────────────────────────────────────────

describe('CornerstoneRenderer · 挂载与状态', () => {
  it('mount 之前任何渲染操作都必须报错（不允许静默无操作）', async () => {
    const { renderer } = makeRenderer();
    await expect(renderer.setStack('vp', makeHandle(2))).rejects.toThrow(/尚未 mount/);
    expect(() => renderer.render('vp')).toThrow(/尚未 mount/);
    expect(() => renderer.getVOI('vp')).toThrow(/尚未 mount/);
    await expect(renderer.whenIdle()).rejects.toThrow(/尚未 mount/);
  });

  it('mount 按布局启用视口，并把元素透传给引擎', async () => {
    const first = { id: 'el-1' };
    const second = { id: 'el-2' };
    const { renderer, engine } = makeRenderer({
      resolveElements: () => [first, second],
    });

    await renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 2, viewportIds: ['vp-1', 'vp-2'] },
    );

    expect(engine.enabled).toHaveLength(2);
    expect(engine.enabled[0]?.element).toBe(first);
    expect(engine.enabled[1]?.viewportId).toBe('vp-2');
    expect(engine.enabled[0]?.type).toBe('stack');
  });

  it('布局不一致或重复 mount 要立刻失败，避免泄漏 GPU 上下文', async () => {
    const { renderer } = makeRenderer();
    await expect(
      renderer.mount({ containerId: 'root' }, { rows: 2, cols: 2, viewportIds: ['a'] }),
    ).rejects.toThrow(/布局不一致/);

    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['a'] });
    await expect(
      renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['a'] }),
    ).rejects.toThrow(/重复 mount/);
  });

  it('元素数量与视口数量不符时报错', async () => {
    const { renderer } = makeRenderer({ resolveElements: () => [ELEMENT] });
    await expect(
      renderer.mount({ containerId: 'root' }, { rows: 1, cols: 2, viewportIds: ['a', 'b'] }),
    ).rejects.toThrow(/视口元素数量与布局不符/);
  });

  it('N5（交叉评审）：mount 中途失败必须回滚已启用的视口与引擎', async () => {
    const { renderer, engine } = makeRenderer({
      // 第二个视口拿不到元素 → 循环中途抛错
      resolveElements: () => [ELEMENT, undefined],
    });

    await expect(
      renderer.mount(
        { containerId: 'root' },
        { rows: 1, cols: 2, viewportIds: ['vp-1', 'vp-2'] },
      ),
    ).rejects.toThrow(/缺少挂载元素/);

    // 已启用的 vp-1 必须被 disable，engine 必须被销毁，否则每次失败都漏一个上下文
    expect(engine.disabled).toEqual(['vp-1']);
    expect(engine.destroyCount).toBe(1);
    expect(() => renderer.render()).toThrow(/尚未 mount/);
  });

  it('未知视口要报错，不能落到别的格子上', async () => {
    const { renderer } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['a'] });
    expect(() => renderer.setVOI('nope', { windowWidth: 400, windowCenter: 40 })).toThrow(
      /未知视口/,
    );
  });
});

describe('CornerstoneRenderer · 序列与翻页', () => {
  async function mounted(): Promise<{
    renderer: CornerstoneRenderer;
    viewport: FakeViewport;
  }> {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    return { renderer, viewport: engine.viewportOf('vp') };
  }

  it('setStack 装载全部 imageId 并透传初始索引', async () => {
    const { renderer, viewport } = await mounted();
    await renderer.setStack('vp', makeHandle(4), 2);

    expect(viewport.stackCalls).toHaveLength(1);
    expect(viewport.stackCalls[0]?.imageIds).toEqual([
      'odv://series/1.2.3#0',
      'odv://series/1.2.3#1',
      'odv://series/1.2.3#2',
      'odv://series/1.2.3#3',
    ]);
    expect(viewport.stackCalls[0]?.index).toBe(2);
  });

  it('空序列与越界初始索引必须拒绝，不能画出黑屏还宣称成功', async () => {
    const { renderer } = await mounted();
    await expect(renderer.setStack('vp', makeHandle(0))).rejects.toThrow(/没有可渲染切片/);
    await expect(renderer.setStack('vp', makeHandle(3), 5)).rejects.toThrow(/初始切片索引越界/);
  });

  it('setStackIndex 是异步的且 await 之后才继续（旧端口签名是 void，属回归项）', async () => {
    const { renderer, viewport } = await mounted();
    await renderer.setStack('vp', makeHandle(5));

    const result = renderer.setStackIndex('vp', 3);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(viewport.indexCalls).toEqual([3]);
  });

  it('setStackIndex 必须等 CS3D 异步切换真正完成才返回（不能只发不候）', async () => {
    const { renderer, viewport } = await mounted();
    await renderer.setStack('vp', makeHandle(3));

    viewport.indexDelayMs = 5;
    const order: string[] = [];
    viewport.onIndexDone = () => order.push('viewport-done');

    await renderer.setStackIndex('vp', 2);
    order.push('caller-resumed');

    expect(order).toEqual(['viewport-done', 'caller-resumed']);
  });

  it('setStack 必须等装载真正完成才返回', async () => {
    const { renderer, viewport } = await mounted();
    viewport.stackDelayMs = 5;
    const order: string[] = [];
    viewport.onStackDone = () => order.push('stack-done');

    await renderer.setStack('vp', makeHandle(2));
    order.push('caller-resumed');

    expect(order).toEqual(['stack-done', 'caller-resumed']);
  });

  it('setStackIndex 越界在进入 CS3D 之前就拦住', async () => {
    const { renderer, viewport } = await mounted();
    await renderer.setStack('vp', makeHandle(3));
    await expect(renderer.setStackIndex('vp', 3)).rejects.toThrow(/切片索引越界/);
    expect(viewport.indexCalls).toHaveLength(0);
  });

  it('STACK 视口拒绝 setVolume，不静默降级成体积渲染', async () => {
    const { renderer } = await mounted();
    await expect(renderer.setVolume('vp', makeVolume())).rejects.toThrow(
      /STACK 类型，不支持体积渲染/,
    );
  });
});

describe('CornerstoneRenderer · 调窗与坐标', () => {
  async function mounted(): Promise<{ renderer: CornerstoneRenderer; viewport: FakeViewport }> {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    return { renderer, viewport: engine.viewportOf('vp') };
  }

  it('setVOI 按 DICOM 公式换算成上下限后再下发，并触发重绘', async () => {
    const { renderer, viewport } = await mounted();
    renderer.setVOI('vp', { windowWidth: 400, windowCenter: 40 });

    // PS3.3 C.11.2.1.2：lower = c-0.5-(w-1)/2 = -160，upper = c-0.5+(w-1)/2 = 239
    expect(viewport.getProperties().voiRange).toEqual({ lower: -160, upper: 239 });
    expect(viewport.renderCount).toBe(1);
  });

  it('getVOI 是 setVOI 的逆变换（与 Spike A 实测读回值互验）', async () => {
    const { renderer } = await mounted();
    // Spike A 里 CS3D 读回 {-160, 239}，逆推必须回到 {400, 40}
    const voi = renderer.getVOI('vp');
    expect(voi.windowWidth).toBe(400);
    expect(voi.windowCenter).toBe(40);

    renderer.setVOI('vp', { windowWidth: 80, windowCenter: 40 });
    const brain = renderer.getVOI('vp');
    expect(brain.windowWidth).toBe(80);
    expect(brain.windowCenter).toBe(40);
  });

  it('窗宽小于 1 时拒绝下发（否则 shader 里会出现除零）', async () => {
    const { renderer } = await mounted();
    expect(() => renderer.setVOI('vp', { windowWidth: 0, windowCenter: 0 })).toThrow(
      /窗宽非法/,
    );
    expect(() => renderer.setVOI('vp', { windowWidth: Number.NaN, windowCenter: 0 })).toThrow(
      /窗宽非法/,
    );
  });

  it('坐标变换透传，缺能力时报错而不是返回 0 坐标', async () => {
    const { renderer } = await mounted();
    expect(renderer.worldToCanvas('vp', [10, 20, 30])).toEqual({ x: 10.5, y: 20.5 });
    expect(renderer.canvasToWorld('vp', { x: 1, y: 2 })).toEqual([1, 2, 0]);
  });

  it('后端不支持坐标变换时报错，绝不静默返回 (0,0)', async () => {
    const stripped = (): Cs3dViewportLike => {
      const base = new FakeViewport();
      return {
        setStack: base.setStack.bind(base),
        setImageIdIndex: base.setImageIdIndex.bind(base),
        setProperties: base.setProperties.bind(base),
        getProperties: base.getProperties.bind(base),
        render: base.render.bind(base),
      };
    };
    const { cs3d } = makeCs3dModule(stripped);
    const renderer = new CornerstoneRenderer({
      cs3d,
      resolveElements: () => [ELEMENT],
      idleTimeoutMs: 20,
    });
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });

    expect(() => renderer.worldToCanvas('vp', [0, 0, 0])).toThrow(/不支持 worldToCanvas/);
    expect(() => renderer.canvasToWorld('vp', { x: 0, y: 0 })).toThrow(/不支持 canvasToWorld/);
  });

  it('resetView 复位相机但不改调窗', async () => {
    const { renderer, viewport } = await mounted();
    renderer.setVOI('vp', { windowWidth: 400, windowCenter: 40 });
    const before = viewport.getProperties().voiRange;

    renderer.resetView('vp');
    expect(viewport.resetCameraCount).toBe(1);
    expect(viewport.getProperties().voiRange).toEqual(before);
  });

  it('新序列首帧就绪后按当前尺寸适配，翻层保留用户缩放和平移', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    const viewport = engine.viewportOf('vp');
    const resize = vi.spyOn(engine, 'resize');
    const reset = vi.spyOn(viewport, 'resetCamera');
    viewport.onStackDone = () => { viewport.zoom = 3; viewport.pan = [40, -20]; };
    await renderer.setStack('vp', makeHandle(3));
    expect(viewport.zoom).toBe(1);
    expect(viewport.pan).toEqual([0, 0]);
    expect(resize.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]!);
    viewport.zoom = 2;
    viewport.pan = [5, 10];
    await renderer.setStackIndex('vp', 1);
    expect(viewport.zoom).toBe(2);
    expect(viewport.pan).toEqual([5, 10]);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('缩放相对于当前相机，限制极值，复位后恢复适应窗口且不改 VOI', async () => {
    const { renderer, viewport } = await mounted();
    const voi = renderer.getVOI('vp');
    renderer.zoomBy('vp', 2);
    renderer.zoomBy('vp', 1.5);
    expect(viewport.zoom).toBe(3);
    renderer.zoomBy('vp', 100);
    expect(viewport.zoom).toBe(20);
    renderer.zoomBy('vp', 0.0001);
    expect(viewport.zoom).toBe(0.05);
    renderer.resetView('vp');
    expect(viewport.zoom).toBe(1);
    expect(renderer.getVOI('vp')).toEqual(voi);
  });

  it('平移使用画布像素增量，非法相机输入在调用 CS3D 前拒绝', async () => {
    const { renderer, viewport } = await mounted();
    renderer.panBy('vp', { x: 14, y: -7 });
    renderer.panBy('vp', { x: -4, y: 3 });
    expect(viewport.pan).toEqual([10, -4]);
    expect(() => renderer.zoomBy('vp', 0)).toThrow(/正数/);
    expect(() => renderer.zoomBy('vp', NaN)).toThrow(/正数/);
    expect(() => renderer.panBy('vp', { x: Infinity, y: 1 })).toThrow(/有限/);
    expect(viewport.pan).toEqual([10, -4]);
  });
});

describe('CornerstoneRenderer · whenIdle 与销毁', () => {
  async function mounted(): Promise<{ renderer: CornerstoneRenderer }> {
    const { renderer } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    return { renderer };
  }

  it('无 rAF 环境（Node / 某些 WebView）下立刻返回，不得永久挂起', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const { renderer } = await mounted();
    await expect(renderer.whenIdle('vp')).resolves.toBeUndefined();
  });

  it('rAF 不回调时靠超时兜底返回（无头虚拟时间下 rAF 可能 0 帧）', async () => {
    const neverCalls = vi.fn(() => 0);
    vi.stubGlobal('requestAnimationFrame', neverCalls);
    const { renderer } = await mounted();

    const started = Date.now();
    await expect(renderer.whenIdle('vp')).resolves.toBeUndefined();
    expect(neverCalls).toHaveBeenCalledTimes(1);
    // 兜底必须真的生效：远小于用例超时，说明是 idleTimeoutMs 放行的
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rAF 正常时等两帧再返回', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    const { renderer } = await mounted();
    const pending = renderer.whenIdle('vp');

    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    const first = callbacks.shift();
    first?.(0);
    await Promise.resolve();
    expect(settled).toBe(false);

    const second = callbacks.shift();
    second?.(0);
    await pending;
    expect(settled).toBe(true);
  });

  it('destroy 幂等，销毁后再用必须报错', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });

    renderer.destroy();
    renderer.destroy();
    expect(engine.destroyCount).toBe(1);
    expect(engine.disabled).toEqual(['vp']);

    expect(() => renderer.render()).toThrow(/已销毁/);
    await expect(renderer.setStack('vp', makeHandle(1))).rejects.toThrow(/已销毁/);
  });

  it('disposeViewport 不释放帧登记表：CS3D 在视口销毁后仍可能读取在途装载', async () => {
    const { renderer, engine } = makeRenderer({
      resolveElements: () => [ELEMENT, ELEMENT],
    });
    await renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 2, viewportIds: ['vp-1', 'vp-2'] },
    );

    const handle = makeHandle(3, '9.9.9');
    await renderer.setStack('vp-1', handle);
    await renderer.setStack('vp-2', handle);
    expect(renderer.frameRegistry.size).toBe(3);

    renderer.disposeViewport('vp-1');
    // vp-2 还在用同一条序列，不能把帧表清掉
    expect(renderer.frameRegistry.size).toBe(3);

    renderer.disposeViewport('vp-2');
    // disableElement 不会取消已排队的装载：立即释放会让它们报"未登记的 imageId"。
    // 回收时机改为装载新序列时（见下一条用例）。
    expect(renderer.frameRegistry.size).toBe(3);
    expect(engine.disabled).toEqual(['vp-1', 'vp-2']);
  });
});

describe('CornerstoneRenderer · 能力探测', () => {
  it('默认不承诺 Volume（未探测前不吹能力），由组合根显式开启', () => {
    const { renderer } = makeRenderer();
    expect(renderer.backend).toBe('webgl2');
    // 原则 5「诚实的边界」：没探测过就说支持，降级矩阵等于空话
    expect(renderer.capabilities()).toMatchObject({
      backend: 'webgl2',
      supportsVolume: false,
      isSoftwareFallback: false,
    });

    const { renderer: enabled } = makeRenderer({
      capabilities: { supportsVolume: true },
    });
    expect(enabled.capabilities().supportsVolume).toBe(true);

    const { renderer: degraded } = makeRenderer({
      capabilities: { isSoftwareFallback: true },
    });
    expect(degraded.capabilities().isSoftwareFallback).toBe(true);
  });
});

describe('CornerstoneRenderer · 生命周期泄漏防护', () => {
  async function mountedViewports(
    viewportIds: string[],
  ): Promise<{ renderer: CornerstoneRenderer; engine: FakeEngine }> {
    const { renderer, engine } = makeRenderer({
      resolveElements: () => viewportIds.map((id) => ({ id })),
    });
    await renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: viewportIds.length, viewportIds },
    );
    return { renderer, engine };
  }

  it('同一视口换序列时释放旧序列，登记表不随切换增长', async () => {
    const { renderer } = await mountedViewports(['vp']);
    await renderer.setStack('vp', makeHandle(3, '1.1.1'));
    expect(renderer.frameRegistry.size).toBe(3);

    await renderer.setStack('vp', makeHandle(2, '2.2.2'));
    // 旧序列 3 帧必须被释放，只剩新序列 2 帧
    expect(renderer.frameRegistry.size).toBe(2);
    expect(renderer.frameRegistry.imageIdsOf('1.1.1')).toHaveLength(0);
    expect(renderer.frameRegistry.imageIdsOf('2.2.2')).toHaveLength(2);
  });

  it('旧序列仍被另一视口使用时不得释放（多视口对比同序列）', async () => {
    const { renderer } = await mountedViewports(['vp-1', 'vp-2']);
    const shared = makeHandle(3, '3.3.3');
    await renderer.setStack('vp-1', shared);
    await renderer.setStack('vp-2', shared);

    await renderer.setStack('vp-1', makeHandle(1, '4.4.4'));
    // vp-2 还在看 3.3.3，它的 3 帧不能动
    expect(renderer.frameRegistry.imageIdsOf('3.3.3')).toHaveLength(3);
    expect(renderer.frameRegistry.size).toBe(4);
  });

  it('初始索引越界时登记表保持干净（错误路径不得留残留）', async () => {
    const { renderer } = await mountedViewports(['vp']);
    await renderer.setStack('vp', makeHandle(2, '5.5.5'));
    const sizeBefore = renderer.frameRegistry.size;

    await expect(renderer.setStack('vp', makeHandle(3, '6.6.6'), 9)).rejects.toThrow(
      /初始切片索引越界/,
    );
    expect(renderer.frameRegistry.size).toBe(sizeBefore);
    expect(renderer.frameRegistry.imageIdsOf('6.6.6')).toHaveLength(0);
  });

  /**
   * P1-1（交叉评审 CR-2026-10-28-selfcode）：并发 setStack 缺视口级版本控制。
   * 慢请求 A 在快请求 B 之后归来时，会把归属写回 A，并导致 B 的帧无人释放。
   */
  it('并发 setStack：慢请求不得覆盖快请求，也不得留下无法释放的帧', async () => {
    const { renderer, engine } = await mountedViewports(['vp']);
    const viewport = engine.viewportOf('vp');
    viewport.stackDelayFor = (imageIds: readonly string[]) =>
      imageIds[0]?.includes('series-A') ? 15 : 2;

    const slowA = renderer.setStack('vp', makeHandle(3, 'series-A'));
    const fastB = renderer.setStack('vp', makeHandle(3, 'series-B'));

    // 被取代的那次必须明确拒绝，而不是悄悄把状态改回去
    await expect(slowA).rejects.toThrow(/被更新的装载请求取代/);
    await expect(fastB).resolves.toBeUndefined();

    // 只有胜出的 B 留在登记表；A 的帧必须被清掉
    expect(renderer.frameRegistry.imageIdsOf('series-A')).toHaveLength(0);
    expect(renderer.frameRegistry.imageIdsOf('series-B')).toHaveLength(3);
    expect(renderer.frameRegistry.size).toBe(3);

    // 越界判断按 B 的帧数生效（3 帧 → 索引 2 合法）
    await expect(renderer.setStackIndex('vp', 2)).resolves.toBeUndefined();
  });

  it('CS3D 装载失败时回滚：登记表与视口归属都回到调用前', async () => {
    const { renderer, engine } = await mountedViewports(['vp']);
    const viewport = engine.viewportOf('vp');

    await renderer.setStack('vp', makeHandle(3, '7.7.7'));
    const sizeBefore = renderer.frameRegistry.size;

    viewport.stackShouldFail = true;
    await expect(renderer.setStack('vp', makeHandle(2, '8.8.8'))).rejects.toThrow(
      /模拟 CS3D 装载失败/,
    );

    // 新序列必须被回滚掉，旧序列原样保留
    expect(renderer.frameRegistry.size).toBe(sizeBefore);
    expect(renderer.frameRegistry.imageIdsOf('8.8.8')).toHaveLength(0);
    expect(renderer.frameRegistry.imageIdsOf('7.7.7')).toHaveLength(3);

    // 视口归属仍是旧序列：越界判断继续按旧帧数生效
    viewport.stackShouldFail = false;
    await expect(renderer.setStackIndex('vp', 3)).rejects.toThrow(/切片索引越界/);
  });
});

describe('CornerstoneRenderer · mount 竞态', () => {
  it('并发 mount 只允许一次成功，被取代的那次必须抛错而不是静默返回', async () => {
    const initGate = deferred();

    const { cs3d } = makeCs3dModule();
    const gatedCs3d: Cs3dModuleLike = {
      ...cs3d,
      init: async () => {
        await initGate.promise;
      },
    };
    const renderer = new CornerstoneRenderer({
      cs3d: gatedCs3d,
      resolveElements: () => [ELEMENT],
      idleTimeoutMs: 20,
    });

    const layout = { rows: 1, cols: 1, viewportIds: ['vp'] } as const;
    const first = renderer.mount({ containerId: 'root' }, layout);
    const second = renderer.mount({ containerId: 'root' }, layout);

    initGate.resolve();

    await expect(second).resolves.toBeUndefined();
    await expect(first).rejects.toThrow(/更新的 mount 请求/);
  });

  it('mount 进行中被 destroy 时必须抛错，不能假装挂载成功', async () => {
    const initGate = deferred();

    const { cs3d } = makeCs3dModule();
    const renderer = new CornerstoneRenderer({
      cs3d: {
        ...cs3d,
        init: async () => {
          await initGate.promise;
        },
      },
      resolveElements: () => [ELEMENT],
      idleTimeoutMs: 20,
    });

    const mounting = renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 1, viewportIds: ['vp'] },
    );
    renderer.destroy();
    initGate.resolve();

    await expect(mounting).rejects.toThrow(/被销毁/);
    expect(() => renderer.render()).toThrow(/已销毁/);
  });
});

describe('CornerstoneRenderer · P2 混合布局与体积通路', () => {
  /** 元素表：同一 id 复用同一 DOM 对象，模拟真实 defaultResolveElements 的"已有子 div" */
  function stableElements(): {
    resolve: (
      target: unknown,
      layout: { readonly viewportIds: readonly string[] },
    ) => readonly unknown[];
  } {
    const map = new Map<string, { id: string }>();
    const resolve = (
      _target: unknown,
      layout: { readonly viewportIds: readonly string[] },
    ): readonly unknown[] =>
      layout.viewportIds.map((viewportId) => {
        const existing = map.get(viewportId);
        if (existing) return existing;
        const created = { id: viewportId };
        map.set(viewportId, created);
        return created;
      });
    return { resolve };
  }

  const ORTHO_AXIAL = {
    rows: 1,
    cols: 1,
    viewportIds: ['vp'],
    cells: [{ viewportId: 'vp', kind: 'orthographic', orientation: 'axial' }],
  } as const;

  async function mountedOrtho(options: { volume?: boolean } = {}) {
    const { renderer, engine, cache, created } = makeRenderer(
      {},
      { volume: true, ...options },
    );
    await renderer.mount({ containerId: 'root' }, ORTHO_AXIAL);
    return { renderer, engine, cache, created, viewport: engine.viewportOf('vp') };
  }

  it('混合布局：STACK 与 ORTHOGRAPHIC 同时启用，且只对 ORTHOGRAPHIC 预热', async () => {
    const { renderer, engine } = makeRenderer({
      resolveElements: () => [{ id: 'stack' }, { id: 'ortho' }],
    });

    await renderer.mount(
      { containerId: 'root' },
      {
        rows: 1,
        cols: 2,
        viewportIds: ['vp-stack', 'vp-ortho'],
        cells: [
          { viewportId: 'vp-stack', kind: 'stack' },
          { viewportId: 'vp-ortho', kind: 'orthographic', orientation: 'axial' },
        ],
      },
    );

    expect(engine.enabled.map((options) => options.type)).toEqual([
      'stack',
      'orthographic',
    ]);
    // Spike B 坑 1：ORTHOGRAPHIC 必须空渲染一次预热，否则首帧全黑
    expect(engine.viewportOf('vp-ortho').renderCount).toBe(1);
    expect(engine.viewportOf('vp-stack').renderCount).toBe(0);
  });

  it('setLayout 增删视口：保留未变的、关闭去掉的，不重建健康的视口', async () => {
    const { resolve } = stableElements();
    const { renderer, engine } = makeRenderer({ resolveElements: resolve });

    await renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 2, viewportIds: ['a', 'b'] },
    );
    const originalA = engine.viewportOf('a');

    await renderer.setLayout({ rows: 1, cols: 3, viewportIds: ['a', 'b', 'c'] });
    expect(engine.disabled).toEqual([]);
    // 元素与类型都没变 → 必须复用原视口（重建会丢序列/相机状态）
    expect(engine.viewportOf('a')).toBe(originalA);

    await renderer.setLayout({ rows: 1, cols: 1, viewportIds: ['a'] });
    expect(engine.disabled.sort()).toEqual(['b', 'c']);
    expect(engine.viewportOf('a')).toBe(originalA);
  });

  it('setLayout 后必须调 engine.resize，否则画布停在旧布局的尺寸（画面被拉伸）', async () => {
    const { resolve } = stableElements();
    const { renderer, engine } = makeRenderer({ resolveElements: resolve });
    await renderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 2, viewportIds: ['a', 'b'] },
    );

    // 复用同一批元素、只改网格尺寸：CS3D 不会自己更新 canvas，必须显式 resize
    await renderer.setLayout({ rows: 1, cols: 3, viewportIds: ['a', 'b', 'c'] });
    expect(engine.resizeCount).toBe(1);
  });

  it('三个 MPR 方向均在载入及布局变更后适配，不沿用旧格子的放大状态', async () => {
    const { resolve } = stableElements();
    const { renderer, engine } = makeRenderer({ resolveElements: resolve }, { volume: true });
    const cells = [
      { viewportId: 'ax', kind: 'orthographic', orientation: 'axial' },
      { viewportId: 'co', kind: 'orthographic', orientation: 'coronal' },
      { viewportId: 'sa', kind: 'orthographic', orientation: 'sagittal' },
    ] as const;
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 3, viewportIds: ['ax', 'co', 'sa'], cells });
    const resize = vi.spyOn(engine, 'resize');
    for (const id of ['ax', 'co', 'sa']) {
      const viewport = engine.viewportOf(id);
      viewport.zoom = 3;
      const reset = vi.spyOn(viewport, 'resetCamera');
      await renderer.setVolume(id, makeVolume());
      expect(viewport.zoom).toBe(1);
      expect(resize.mock.invocationCallOrder.at(-1)).toBeLessThan(reset.mock.invocationCallOrder.at(-1)!);
      viewport.zoom = 4;
    }
    await renderer.setLayout({ rows: 3, cols: 1, viewportIds: ['ax', 'co', 'sa'], cells });
    for (const id of ['ax', 'co', 'sa']) expect(engine.viewportOf(id).zoom).toBe(1);
  });

  it('元素被替换时必须重建视口，避免两个视口抢同一元素', async () => {
    // 每次解析都返回新对象：对应 1×1 → 2×2 时挂载点从容器换成子 div
    const { renderer, engine } = makeRenderer({
      resolveElements: () => [{ id: 'fresh' }],
    });
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    const original = engine.viewportOf('vp');

    await renderer.setLayout({ rows: 1, cols: 1, viewportIds: ['vp'] });
    expect(engine.disabled).toEqual(['vp']);
    expect(engine.viewportOf('vp')).not.toBe(original);
  });

  it('视口类型变化（STACK → ORTHOGRAPHIC）必须重建并重新预热', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    const original = engine.viewportOf('vp');

    await renderer.setLayout(ORTHO_AXIAL);

    expect(engine.disabled).toEqual(['vp']);
    expect(engine.enabled.at(-1)?.type).toBe('orthographic');
    const rebuilt = engine.viewportOf('vp');
    expect(rebuilt).not.toBe(original);
    // 预热 1 次 + setLayout 末尾统一重绘 1 次
    expect(rebuilt.renderCount).toBe(2);
  });

  it('布局校验：ORTHOGRAPHIC 必须指定方向，cells 不得越界', async () => {
    const { renderer } = makeRenderer();
    await expect(
      renderer.mount(
        { containerId: 'root' },
        {
          rows: 1,
          cols: 1,
          viewportIds: ['a'],
          cells: [{ viewportId: 'a', kind: 'orthographic' }],
        },
      ),
    ).rejects.toThrow(/必须指定方向/);

    await expect(
      renderer.mount(
        { containerId: 'root' },
        {
          rows: 1,
          cols: 1,
          viewportIds: ['a'],
          cells: [{ viewportId: 'b', kind: 'stack' }],
        },
      ),
    ).rejects.toThrow(/不在 viewportIds 内/);
  });

  it('体积通路未注入时明确报错，不静默降级', async () => {
    const { renderer } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, ORTHO_AXIAL);
    await expect(renderer.setVolume('vp', makeVolume())).rejects.toThrow(
      /未注入 volumeLoader\/cache/,
    );
  });

  it('setVolume 创建本地体积、挂到视口并固定 8-bit 显示区间', async () => {
    const { renderer, cache, created, viewport } = await mountedOrtho();

    await renderer.setVolume('vp', makeVolume());

    expect(created).toEqual(['vol-1:2x2x4:16']);
    expect(cache.live.has('vol-1')).toBe(true);
    expect(viewport.volumeCalls).toEqual([['vol-1']]);
    expect(viewport.orientationCalls).toEqual(['axial']);
    expect(viewport.getProperties().voiRange).toEqual({ lower: 0, upper: 255 });
    expect(viewport.resetCameraCount).toBe(1);
    // 相机在原点、层距 1 mm → 第 0 层
    expect(renderer.currentSliceIndex('vp')).toBe(0);
  });

  it('体素长度与尺寸不一致时拒绝，且不创建体积', async () => {
    const { renderer, cache, created } = await mountedOrtho();
    await expect(
      renderer.setVolume('vp', makeVolume({ scalarData: new Uint8Array(3) })),
    ).rejects.toThrow(/体积数据与尺寸不一致/);
    expect(created).toEqual([]);
    expect(cache.live.size).toBe(0);
  });

  it('setVolumes 失败时把刚创建的体积移出 cache（错误路径不泄漏）', async () => {
    const { renderer, cache, viewport } = await mountedOrtho();
    viewport.volumesShouldFail = true;

    await expect(renderer.setVolume('vp', makeVolume())).rejects.toThrow(
      /模拟 setVolumes 失败/,
    );
    expect(cache.removed).toEqual(['vol-1']);
    expect(cache.live.size).toBe(0);
  });

  it('同一视口并发 setVolume：被取代的那次不得回收体积，后一次仍能正常定向', async () => {
    const { renderer, cache, viewport } = await mountedOrtho();
    // 第一次装载比第二次慢：ACK 归来时后一次已经把它挂上视口并在使用 imageData
    viewport.volumesDelayFor = (callIndex) => (callIndex === 0 ? 30 : 0);

    const volume = makeVolume();
    const slow = renderer.setVolume('vp', volume);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fast = renderer.setVolume('vp', volume);

    await expect(fast).resolves.toBeUndefined();
    await expect(slow).rejects.toThrow(/被更新的请求取代/);

    // 关键：被取代的请求若在此 purge，会让后一次的 actor 指向已销毁的 imageData
    expect(cache.removed).toEqual([]);
    expect(cache.live.has('vol-1')).toBe(true);
    expect(cache.liveImages.size).toBe(4);
    expect(viewport.orientationCalls).toEqual(['axial']);
  });

  it('换体积时释放旧体积；同 id 重建先移出旧体积再创建', async () => {
    const { renderer, cache, created } = await mountedOrtho();

    await renderer.setVolume('vp', makeVolume({ volumeId: 'vol-1' }));
    await renderer.setVolume('vp', makeVolume({ volumeId: 'vol-2' }));
    expect(cache.removed).toEqual(['vol-1']);
    expect(cache.live.has('vol-1')).toBe(false);
    expect(cache.live.has('vol-2')).toBe(true);

    // 同 id：必须先移除旧体积，否则重建时拿到的是旧尺寸/旧像素
    await renderer.setVolume('vp', makeVolume({ volumeId: 'vol-2' }));
    expect(cache.removed).toEqual(['vol-1', 'vol-2']);
    expect(cache.live.has('vol-2')).toBe(true);
    expect(created).toHaveLength(3);
    // 派生层图像也必须一起清掉，否则 createLocalVolume 会报 imageId 已在 cache
    expect(cache.removedImages).toEqual([
      'vol-1_slice_0',
      'vol-1_slice_1',
      'vol-1_slice_2',
      'vol-1_slice_3',
      'vol-2_slice_0',
      'vol-2_slice_1',
      'vol-2_slice_2',
      'vol-2_slice_3',
    ]);
    expect(cache.liveImages.size).toBe(4);
  });

  it('布局切走再切回：体积不随视口销毁，同 id 直接复用而不重建', async () => {
    const { resolve } = stableElements();
    const { renderer, cache, created } = makeRenderer(
      { resolveElements: resolve },
      { volume: true },
    );
    const MPR_LAYOUT = {
      rows: 1,
      cols: 3,
      viewportIds: ['ax', 'co', 'sa'],
      cells: [
        { viewportId: 'ax', kind: 'orthographic', orientation: 'axial' },
        { viewportId: 'co', kind: 'orthographic', orientation: 'coronal' },
        { viewportId: 'sa', kind: 'orthographic', orientation: 'sagittal' },
      ],
    } as const;
    await renderer.mount({ containerId: 'root' }, MPR_LAYOUT);

    const volume = makeVolume();
    for (const viewportId of ['ax', 'co', 'sa']) {
      await renderer.setVolume(viewportId, volume);
    }
    expect(created).toHaveLength(1);
    expect(cache.liveImages.size).toBe(4);

    // 切到单视口：三个 MPR 视口全部销毁，但体积与派生层图像必须保留
    // （CS3D 的在途渲染仍持有它们；删掉会让切回时拿到已销毁的 imageData）
    await renderer.setLayout({ rows: 1, cols: 1, viewportIds: ['ax'] });
    expect(cache.live.has('vol-1')).toBe(true);
    expect(cache.liveImages.size).toBe(4);
    expect(cache.removed).toEqual([]);

    // 切回 MPR：同一句柄复用已缓存的体积，不应再次 createLocalVolume
    await renderer.setLayout(MPR_LAYOUT);
    await expect(renderer.setVolume('ax', volume)).resolves.toBeUndefined();
    expect(created).toHaveLength(1);
    expect(cache.removed).toEqual([]);
    expect(cache.liveImages.size).toBe(4);
  });

  it('同一体积挂到 MPR 三视图：只创建一次，不从前一个视口抽走 cache', async () => {
    const { resolve } = stableElements();
    const { renderer, engine, cache, created } = makeRenderer(
      { resolveElements: resolve },
      { volume: true },
    );
    await renderer.mount(
      { containerId: 'root' },
      {
        rows: 1,
        cols: 3,
        viewportIds: ['ax', 'co', 'sa'],
        cells: [
          { viewportId: 'ax', kind: 'orthographic', orientation: 'axial' },
          { viewportId: 'co', kind: 'orthographic', orientation: 'coronal' },
          { viewportId: 'sa', kind: 'orthographic', orientation: 'sagittal' },
        ],
      },
    );

    const volume = makeVolume();
    await renderer.setVolume('ax', volume);
    await renderer.setVolume('co', volume);
    await renderer.setVolume('sa', volume);

    expect(created).toEqual(['vol-1:2x2x4:16']);
    expect(cache.removed).toEqual([]);
    expect(cache.live.has('vol-1')).toBe(true);
    expect(engine.viewportOf('co').volumeCalls).toEqual([['vol-1']]);
    expect(engine.viewportOf('sa').orientationCalls).toEqual(['sagittal']);

    // 给其中一个视口换新体积：另两格仍在用旧体积，不能删 cache
    await renderer.setVolume('ax', makeVolume({ volumeId: 'vol-2' }));
    expect(cache.removed).toEqual([]);
    expect(cache.live.has('vol-1')).toBe(true);
  });

  it('ORTHOGRAPHIC 层号按相机焦点投影换算，stepSlice 通过 jumpToWorld 移动', async () => {
    const { renderer, viewport } = await mountedOrtho();
    await renderer.setVolume('vp', makeVolume());

    await renderer.stepSlice('vp', 1);
    expect(viewport.jumpCalls).toEqual([[0, 0, 1]]);
    expect(renderer.currentSliceIndex('vp')).toBe(1);

    await renderer.stepSlice('vp', 2);
    expect(renderer.currentSliceIndex('vp')).toBe(3);

    // 已到末层，再往下必须静默夹紧，不能越界定位
    await renderer.stepSlice('vp', 1);
    expect(viewport.jumpCalls).toHaveLength(2);
  });

  it('STACK 翻层在边界夹紧，且不产生越界调用', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    const viewport = engine.viewportOf('vp');
    await renderer.setStack('vp', makeHandle(4));

    await renderer.stepSlice('vp', 2);
    expect(viewport.indexCalls).toEqual([2]);
    expect(renderer.currentSliceIndex('vp')).toBe(2);

    await renderer.stepSlice('vp', 99);
    expect(viewport.indexCalls).toEqual([2, 3]);
    await renderer.stepSlice('vp', 1);
    expect(viewport.indexCalls).toEqual([2, 3]);

    await expect(renderer.stepSlice('vp', 1.5)).rejects.toThrow(/步进量必须为整数/);
  });

  it('未装载时读层号/翻层必须报错，不能返回 0 假装成功', async () => {
    const { renderer: stackRenderer } = makeRenderer();
    await stackRenderer.mount(
      { containerId: 'root' },
      { rows: 1, cols: 1, viewportIds: ['vp'] },
    );
    expect(() => stackRenderer.currentSliceIndex('vp')).toThrow(/尚未装载序列/);
    await expect(stackRenderer.stepSlice('vp', 1)).rejects.toThrow(/尚未装载序列/);

    const { renderer: orthoRenderer } = await mountedOrtho();
    expect(() => orthoRenderer.currentSliceIndex('vp')).toThrow(/尚未装载体积/);
    await expect(orthoRenderer.stepSlice('vp', 1)).rejects.toThrow(/尚未装载体积/);
  });

  it('focusAt 定位失败必须报错；成功则等渲染就绪', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    const viewport = engine.viewportOf('vp');
    await renderer.setStack('vp', makeHandle(4));

    await expect(renderer.focusAt('vp', [1, 2, 3])).resolves.toBeUndefined();
    expect(viewport.jumpCalls).toEqual([[1, 2, 3]]);

    viewport.jumpShouldFail = true;
    await expect(renderer.focusAt('vp', [9, 9, 9])).rejects.toThrow(/不在视口 vp 的可定位范围/);
  });

  it('CS3D 联动定位后层号读取实际视口，不能停留在 setStackIndex 的旧缓存', async () => {
    const { renderer, engine } = makeRenderer();
    await renderer.mount({ containerId: 'root' }, { rows: 1, cols: 1, viewportIds: ['vp'] });
    await renderer.setStack('vp', makeHandle(4));
    const viewport = engine.viewportOf('vp');
    // StackViewport.jumpToWorld 在内部调用 setImageIdIndex，不经过外层缓存。
    Object.assign(viewport, { getCurrentImageIdIndex: () => 2 });
    await renderer.focusAt('vp', [1, 2, 3]);
    expect(renderer.currentSliceIndex('vp')).toBe(2);
    await renderer.stepSlice('vp', 1);
    expect(viewport.indexCalls).toEqual([3]);
  });

  it('destroy 时把本适配器创建过的体积从 cache 清掉', async () => {
    const { renderer, cache } = await mountedOrtho();
    await renderer.setVolume('vp', makeVolume());
    expect(cache.live.has('vol-1')).toBe(true);

    renderer.destroy();
    expect(cache.removed).toEqual(['vol-1']);
    expect(cache.live.size).toBe(0);
  });
});

// 普通分屏复用多个 Stack；共享源图像不应共享切片索引、VOI 或相机。
describe('多个 Stack 独立浏览', () => {
  it('同一序列的四格分别翻层、调窗，移除一格不影响其他格登记', async () => {
    const { renderer } = makeRenderer({ resolveElements: () => [{id:'a'}, {id:'b'}, {id:'c'}, {id:'d'}] });
    const ids = ['a','b','c','d'];
    await renderer.mount({containerId:'root'}, {rows:2,cols:2,viewportIds:ids});
    const handle = makeHandle(4);
    for (let i=0;i<ids.length;i++) await renderer.setStack(ids[i]!,handle,i);
    const originalVoi = renderer.getVOI('b');
    renderer.setVOI('a',{windowWidth:1500,windowCenter:-600});
    await renderer.setStackIndex('a',3);
    expect(ids.map(id=>renderer.currentSliceIndex(id))).toEqual([3,1,2,3]);
    expect(renderer.getVOI('b')).toEqual(originalVoi);
    expect(renderer.getVOI('a')).toEqual({windowWidth:1500,windowCenter:-600});
    await renderer.setStack('a',makeHandle(1,'ct-single'));
    expect(renderer.currentSliceIndex('b')).toBe(1);
    await renderer.setStackIndex('b',2);
    expect(renderer.currentSliceIndex('b')).toBe(2);
    renderer.destroy();
  });
  it('平移一格只更新它自己的相机', async () => {
    const { renderer, engine } = makeRenderer({resolveElements:()=>[{id:'a'},{id:'b'}]});
    await renderer.mount({containerId:'root'}, {rows:1,cols:2,viewportIds:['a','b']});
    await renderer.setStack('a',makeHandle(2)); await renderer.setStack('b',makeHandle(2));
    renderer.panBy('a',{x:20,y:10});
    renderer.zoomBy('a',2);
    expect(engine.viewportOf('b').pan).toEqual([0,0]);
    expect(engine.viewportOf('b').zoom).toBe(1);
    expect(engine.viewportOf('a').pan).toEqual([20,10]);
    expect(engine.viewportOf('a').zoom).toBe(2);
    renderer.destroy();
  });
});
