import type {
  ImagePlane,
  PixelFrame,
  SeriesHandle,
  SeriesMeta,
} from '@opendicomviewer/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CornerstoneRenderer,
  SeriesFrameRegistry,
  parseImageId,
  toImageId,
  type Cs3dEngineLike,
  type Cs3dEnableElementOptions,
  type Cs3dModuleLike,
  type Cs3dViewportLike,
  type Cs3dViewportPropertiesLike,
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
  public onIndexDone: (() => void) | null = null;
  private properties: Cs3dViewportPropertiesLike = {
    voiRange: { lower: -160, upper: 239 },
  };

  public async setStack(
    imageIds: readonly string[],
    currentImageIdIndex?: number,
  ): Promise<void> {
    if (this.stackDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.stackDelayMs));
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
  }

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
  public destroyCount = 0;
  private readonly viewports = new Map<string, Cs3dViewportLike>();

  constructor(private readonly viewportFactory: () => Cs3dViewportLike = () => new FakeViewport()) {}

  public enableElement(options: Cs3dEnableElementOptions): void {
    this.enabled.push(options);
    this.viewports.set(options.viewportId, this.viewportFactory());
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

function makeCs3dModule(
  viewportFactory?: () => Cs3dViewportLike,
): { cs3d: Cs3dModuleLike; engine: FakeEngine } {
  const engine = new FakeEngine(viewportFactory);
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
    public destroy(): void {
      engine.destroy();
    }
  };

  const cs3d: Cs3dModuleLike = {
    init: () => undefined,
    RenderingEngine,
    Enums: { ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic' } },
  };
  return { cs3d, engine };
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

function makeRenderer(
  overrides: Partial<ConstructorParameters<typeof CornerstoneRenderer>[0]> = {},
): { renderer: CornerstoneRenderer; engine: FakeEngine; cs3d: Cs3dModuleLike } {
  const { cs3d, engine } = makeCs3dModule();
  const renderer = new CornerstoneRenderer({
    cs3d,
    resolveElements: () => [ELEMENT],
    idleTimeoutMs: 20,
    ...overrides,
  });
  return { renderer, engine, cs3d };
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

  it('Volume 通路未接入时明确报错，不静默降级成 Stack', async () => {
    const { renderer } = await mounted();
    await expect(renderer.setVolume('vp', 'vol-1')).rejects.toThrow(/Volume 通路尚未接入/);
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

  it('disposeViewport 释放独占序列；多视口共用同序列时不释放', async () => {
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
    expect(renderer.frameRegistry.size).toBe(0);
    expect(engine.disabled).toEqual(['vp-1', 'vp-2']);
  });
});

describe('CornerstoneRenderer · 能力探测', () => {
  it('默认声明 webgl2 且支持 Volume，可被组合根覆盖', () => {
    const { renderer } = makeRenderer();
    expect(renderer.backend).toBe('webgl2');
    expect(renderer.capabilities()).toMatchObject({
      backend: 'webgl2',
      supportsVolume: true,
      isSoftwareFallback: false,
    });

    const { renderer: degraded } = makeRenderer({
      capabilities: { supportsVolume: false, isSoftwareFallback: true },
    });
    expect(degraded.capabilities()).toMatchObject({
      supportsVolume: false,
      isSoftwareFallback: true,
    });
  });
});
