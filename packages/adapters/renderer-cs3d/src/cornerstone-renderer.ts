/**
 * Cornerstone3D 渲染适配器
 *
 * 契约见 `@opendicomviewer/core` 的 `RendererPort`，本文件只负责把端口翻成 CS3D 调用。
 * 三条容易写错的点（Spike A 实测，见 spikes/cs3d-min/README.md）：
 *
 * 1. `setStack` / `setImageIdIndex` 可能是异步的 → 端口签名是 `Promise<void>`，这里必须 await；
 * 2. `viewport.render()` 只做提交，同步返回不代表已呈现 → 需要"已呈现"时用 `whenIdle()`；
 * 3. 调窗用上下限（lower/upper）而不是窗宽窗位 → 用 core 的 `voiToRange` / `rangeToVOI`
 *    换算，保证与 core 的像素映射公式同一口径。
 */

import {
  type CanvasPoint,
  type RenderBackendType,
  type RendererCapabilities,
  type RenderMountTarget,
  type RendererPort,
  type SeriesHandle,
  type ViewportLayout,
  type VOIRange,
  type WorldPoint,
  rangeToVOI,
  voiToRange,
} from '@opendicomviewer/core';
import type {
  Cs3dEngineLike,
  Cs3dModuleLike,
  Cs3dViewportLike,
} from './cs3d-surface';
import { SeriesFrameRegistry } from './frame-registry';

export interface CornerstoneRendererOptions {
  /** 组合根注入的 CS3D 模块（见 cs3d-surface.ts 的说明） */
  readonly cs3d: Cs3dModuleLike;
  /**
   * 视口 DOM 元素解析。默认在 container 内按 layout 创建/复用子 div。
   * 单测注入假元素，避免依赖 jsdom。
   */
  readonly resolveElements?: (
    target: RenderMountTarget,
    layout: ViewportLayout,
  ) => readonly unknown[];
  /** `whenIdle` 的兜底超时，默认 400 ms（无头环境 rAF 可能完全不驱动） */
  readonly idleTimeoutMs?: number;
  readonly engineId?: string;
  /** 覆盖能力探测结果（真机上由更高层根据 GPU 信息回填） */
  readonly capabilities?: Partial<RendererCapabilities>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 400;

export class CornerstoneRenderer implements RendererPort {
  public readonly backend: RenderBackendType = 'webgl2';

  private readonly cs3d: Cs3dModuleLike;
  private readonly resolveElements: (
    target: RenderMountTarget,
    layout: ViewportLayout,
  ) => readonly unknown[];
  private readonly idleTimeoutMs: number;
  private readonly engineId: string;
  private readonly capabilityOverrides: Partial<RendererCapabilities>;

  private readonly viewports = new Map<string, Cs3dViewportLike>();
  private readonly viewportSeries = new Map<string, string>();
  private readonly viewportFrameCounts = new Map<string, number>();
  /** 视口级装载版本号：慢请求归来时用它判断自己是否已被新请求取代 */
  private readonly viewportTokens = new Map<string, number>();
  private readonly frames = new SeriesFrameRegistry();

  private engine: Cs3dEngineLike | null = null;
  private mounted = false;
  private destroyed = false;
  private mountToken = 0;

  constructor(options: CornerstoneRendererOptions) {
    this.cs3d = options.cs3d;
    this.resolveElements = options.resolveElements ?? defaultResolveElements;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.engineId = options.engineId ?? 'opendicomviewer';
    this.capabilityOverrides = options.capabilities ?? {};
  }

  /** CS3D 的 imageLoader 需要反查像素时用这个登记表 */
  public get frameRegistry(): SeriesFrameRegistry {
    return this.frames;
  }

  public capabilities(): RendererCapabilities {
    return {
      backend: this.backend,
      // 默认不承诺 Volume：原则 5「诚实的边界」——没探测过就说支持，等于把降级矩阵
      // 变成一句空话。组合根在确认真实能力后显式覆盖。
      supportsVolume: false,
      isSoftwareFallback: false,
      ...this.capabilityOverrides,
    };
  }

  public async mount(
    target: RenderMountTarget,
    layout: ViewportLayout,
  ): Promise<void> {
    this.assertAlive();
    if (this.mounted) {
      throw new Error('渲染器已挂载，重复 mount 会泄漏 GPU 上下文');
    }

    this.assertLayout(layout);
    const elements = this.resolveElements(target, layout);
    if (elements.length !== layout.viewportIds.length) {
      throw new Error(
        `视口元素数量与布局不符：期望 ${layout.viewportIds.length}，实际 ${elements.length}`,
      );
    }

    // 并发 mount 时只让最后一次生效，避免建出两个引擎。
    // 失败必须**抛错**而不是 return：静默返回会让调用方以为挂载成功（R7）。
    const token = ++this.mountToken;
    await this.cs3d.init();
    if (this.destroyed) {
      throw new Error('mount 过程中渲染器被销毁，本次挂载未生效');
    }
    if (token !== this.mountToken) {
      throw new Error('已存在更新的 mount 请求，本次挂载被放弃');
    }

    const engine = new this.cs3d.RenderingEngine(this.engineId);
    this.engine = engine;

    const stackType = this.cs3d.Enums.ViewportType.STACK;
    const enabled: string[] = [];
    try {
      layout.viewportIds.forEach((viewportId, index) => {
        const element = elements[index];
        if (element === undefined) {
          throw new Error(`视口 ${viewportId} 缺少挂载元素`);
        }
        engine.enableElement({
          viewportId,
          element,
          type: stackType,
          defaultOptions: { background: [0, 0, 0] },
        });
        enabled.push(viewportId);
        this.viewports.set(viewportId, engine.getViewport(viewportId));
      });
    } catch (err: unknown) {
      // 中途失败必须回滚：否则已启用的视口与 engine 泄漏（交叉评审 N5）
      for (const viewportId of enabled) {
        engine.disableElement?.(viewportId);
      }
      this.viewports.clear();
      engine.destroy();
      this.engine = null;
      throw err instanceof Error ? err : new Error(String(err));
    }

    this.mounted = true;
  }

  public async setLayout(layout: ViewportLayout): Promise<void> {
    this.assertLayout(layout);
    const known = layout.viewportIds.every((id) => this.viewports.has(id));
    if (!known) {
      throw new Error('setLayout 只支持已挂载的视口集合，新增格子请重新 mount');
    }
    // 布局容器尺寸由宿主 CSS 决定；这里统一触发一次重绘
    for (const viewportId of layout.viewportIds) {
      this.viewportOf(viewportId).render();
    }
  }

  public async setStack(
    viewportId: string,
    handle: SeriesHandle,
    initialIndex = 0,
  ): Promise<void> {
    const viewport = this.viewportOf(viewportId);
    const nextSeriesUid = handle.meta.seriesInstanceUid;
    const frameCount = handle.meta.planes.length;

    // 先校验再登记：否则越界抛错时帧已经进了登记表，而 viewportSeries 没更新，
    // 这条序列之后谁都释放不掉（错误路径上的泄漏）。
    if (frameCount === 0) {
      throw new Error(`序列 ${nextSeriesUid} 没有可渲染切片，拒绝装载空序列`);
    }
    if (
      !Number.isInteger(initialIndex) ||
      initialIndex < 0 ||
      initialIndex >= frameCount
    ) {
      throw new Error(
        `初始切片索引越界：${initialIndex} 不在 [0, ${frameCount - 1}] 内`,
      );
    }

    const previousSeriesUid = this.viewportSeries.get(viewportId);
    const previousFrameCount = this.viewportFrameCounts.get(viewportId);

    // 视口级版本号：并发 setStack 时只让最后一次生效。
    // 没有它的话，慢请求 A 会在快请求 B 之后归来并把归属写回 A，
    // 导致 B 的帧再也没人释放（内存泄漏）+ 越界判断用错帧数（状态串扰）。
    const token = (this.viewportTokens.get(viewportId) ?? 0) + 1;
    this.viewportTokens.set(viewportId, token);

    const imageIds = this.frames.register(handle);
    try {
      await viewport.setStack(imageIds, initialIndex);
    } catch (err: unknown) {
      // CS3D 装载失败时必须回滚登记表，否则这个视口"看起来装着 B、实际还是 A"，
      // 而 B 的帧再也没人释放。
      this.discardRegistration(nextSeriesUid, viewportId);
      this.restoreViewportSeries(viewportId, previousSeriesUid, previousFrameCount);
      throw err instanceof Error ? err : new Error(String(err));
    }

    // await 归来后先查版本号：被更新的请求取代时，本次登记作废、归属一律不动。
    // 注意这里是"写入归属之前"的最后一道闸，顺序不能调。
    if (token !== this.viewportTokens.get(viewportId)) {
      this.discardRegistration(nextSeriesUid, viewportId);
      throw new Error(
        `装载 ${nextSeriesUid} 被更新的装载请求取代，本次结果已丢弃`,
      );
    }

    // 成功之后才切归属，并释放已经没有任何视口在用的旧序列。
    if (
      previousSeriesUid &&
      previousSeriesUid !== nextSeriesUid &&
      !this.isSeriesInUse(previousSeriesUid, viewportId)
    ) {
      this.frames.release(previousSeriesUid);
    }
    this.viewportSeries.set(viewportId, nextSeriesUid);
    this.viewportFrameCounts.set(viewportId, frameCount);
  }

  public async setStackIndex(viewportId: string, index: number): Promise<void> {
    const viewport = this.viewportOf(viewportId);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`切片索引非法：${index}`);
    }
    const count = this.viewportFrameCounts.get(viewportId);
    if (count !== undefined && index >= count) {
      throw new Error(
        `切片索引越界：${index} 不在 [0, ${count - 1}] 内（视口 ${viewportId}）`,
      );
    }
    await viewport.setImageIdIndex(index);
  }

  public async setVolume(viewportId: string, volumeId: string): Promise<void> {
    this.viewportOf(viewportId);
    throw new Error(
      `Volume 通路尚未接入（requested ${volumeId}）：MPR 属 Phase 2，当前禁止静默降级为 Stack`,
    );
  }

  public setVOI(viewportId: string, range: VOIRange): void {
    const viewport = this.viewportOf(viewportId);
    if (!Number.isFinite(range.windowWidth) || range.windowWidth < 1) {
      throw new Error(`窗宽非法：${range.windowWidth}（必须 >= 1）`);
    }
    viewport.setProperties({ voiRange: voiToRange(range) });
    viewport.render();
  }

  public getVOI(viewportId: string): VOIRange {
    const viewport = this.viewportOf(viewportId);
    const { lower, upper } = viewport.getProperties().voiRange;
    return rangeToVOI(lower, upper);
  }

  public resetView(viewportId: string): void {
    const viewport = this.viewportOf(viewportId);
    viewport.resetCamera?.();
    viewport.render();
  }

  public worldToCanvas(viewportId: string, world: WorldPoint): CanvasPoint {
    const viewport = this.viewportOf(viewportId);
    if (!viewport.worldToCanvas) {
      throw new Error('当前视口不支持 worldToCanvas，测量工具不可用');
    }
    const point = viewport.worldToCanvas([world[0], world[1], world[2]]);
    return { x: point[0] ?? 0, y: point[1] ?? 0 };
  }

  public canvasToWorld(viewportId: string, canvas: CanvasPoint): WorldPoint {
    const viewport = this.viewportOf(viewportId);
    if (!viewport.canvasToWorld) {
      throw new Error('当前视口不支持 canvasToWorld，取点工具不可用');
    }
    const point = viewport.canvasToWorld([canvas.x, canvas.y]);
    return [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
  }

  public render(viewportId?: string): void {
    this.assertMounted();
    if (viewportId !== undefined) {
      this.viewportOf(viewportId).render();
      return;
    }
    for (const viewport of this.viewports.values()) {
      viewport.render();
    }
  }

  /**
   * 等待画面呈现：等两帧再返回。
   *
   * 兜底很关键——无头浏览器 + `--virtual-time-budget` 下 rAF 可能完全不触发
   * （Spike A 实测 200 ms 内 0 帧），纯 rAF 实现会让调用方永久挂起。
   * 因此这里用 `Promise.race`，超时也 resolve（语义是"尽力而为"）。
   */
  public async whenIdle(viewportId?: string): Promise<void> {
    this.assertMounted();
    if (viewportId !== undefined) {
      this.viewportOf(viewportId);
    }

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    if (!raf) {
      await delay(0);
      return;
    }

    // 必须显式清掉落败的定时器：高频调窗/翻页时 Promise.race 会留下大量孤儿 timer
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        twoFrames(raf),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.idleTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  public disposeViewport(viewportId: string): void {
    if (!this.mounted) return;
    this.engine?.disableElement?.(viewportId);
    this.viewports.delete(viewportId);

    const seriesUid = this.viewportSeries.get(viewportId);
    if (seriesUid) {
      // 仅当没有别的视口还在用同一条序列时才释放（多视口对比同序列是常见场景）
      if (!this.isSeriesInUse(seriesUid, viewportId)) {
        this.frames.release(seriesUid);
      }
      this.viewportSeries.delete(viewportId);
    }
    this.viewportFrameCounts.delete(viewportId);
    // 版本号也清掉，但先自增一次：让仍在 await 的旧请求明确作废
    this.viewportTokens.set(viewportId, (this.viewportTokens.get(viewportId) ?? 0) + 1);
    this.viewportTokens.delete(viewportId);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mounted = false;

    for (const viewportId of [...this.viewports.keys()]) {
      this.engine?.disableElement?.(viewportId);
    }
    this.viewports.clear();
    this.viewportSeries.clear();
    this.viewportFrameCounts.clear();
    this.viewportTokens.clear();
    this.frames.clear();

    this.engine?.destroy();
    this.engine = null;
  }

  // ── 内部断言 ──────────────────────────────────────────────

  /** 该序列是否仍被"除 exceptViewportId 之外"的视口使用 */
  private isSeriesInUse(seriesInstanceUid: string, exceptViewportId: string): boolean {
    for (const [viewportId, uid] of this.viewportSeries.entries()) {
      if (viewportId !== exceptViewportId && uid === seriesInstanceUid) {
        return true;
      }
    }
    return false;
  }

  /**
   * 丢弃一次"未生效"的登记。
   * 两道保护：①当前归属就是它时不能删（同序列并发时，赢家已经写入了）；
   * ②别的视口还在用它时不能删（多视口对比同序列）。
   */
  private discardRegistration(seriesInstanceUid: string, viewportId: string): void {
    if (this.viewportSeries.get(viewportId) === seriesInstanceUid) return;
    if (this.isSeriesInUse(seriesInstanceUid, viewportId)) return;
    this.frames.release(seriesInstanceUid);
  }

  private restoreViewportSeries(
    viewportId: string,
    previousSeriesUid: string | undefined,
    previousFrameCount: number | undefined,
  ): void {
    if (previousSeriesUid === undefined) {
      this.viewportSeries.delete(viewportId);
    } else {
      this.viewportSeries.set(viewportId, previousSeriesUid);
    }
    if (previousFrameCount === undefined) {
      this.viewportFrameCounts.delete(viewportId);
    } else {
      this.viewportFrameCounts.set(viewportId, previousFrameCount);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error('渲染器已销毁，不能复用；请重新创建实例');
    }
  }

  private assertMounted(): void {
    this.assertAlive();
    if (!this.mounted) {
      throw new Error('渲染器尚未 mount，请先调用 mount(target, layout)');
    }
  }

  private assertLayout(layout: ViewportLayout): void {
    if (layout.viewportIds.length === 0) {
      throw new Error('布局至少需要一个视口');
    }
    if (layout.viewportIds.length !== layout.rows * layout.cols) {
      throw new Error(
        `布局不一致：${layout.rows}×${layout.cols} 需要 ${layout.rows * layout.cols} 个视口，实际 ${layout.viewportIds.length}`,
      );
    }
    if (new Set(layout.viewportIds).size !== layout.viewportIds.length) {
      throw new Error('布局中存在重复的 viewportId');
    }
  }

  private viewportOf(viewportId: string): Cs3dViewportLike {
    this.assertMounted();
    const viewport = this.viewports.get(viewportId);
    if (!viewport) {
      throw new Error(`未知视口：${viewportId}`);
    }
    return viewport;
  }
}

/** 默认元素解析：单视口直接用容器，多视口在容器内建子 div */
function defaultResolveElements(
  target: RenderMountTarget,
  layout: ViewportLayout,
): readonly unknown[] {
  const resolved =
    target.element ??
    (typeof document === 'undefined'
      ? undefined
      : document.getElementById(target.containerId));

  if (!isContainerLike(resolved)) {
    throw new Error(`找不到可用的挂载容器：${target.containerId}`);
  }

  if (layout.viewportIds.length === 1) {
    return [resolved];
  }

  if (typeof document === 'undefined') {
    throw new Error('多视口布局需要 DOM 环境来创建子容器');
  }

  return layout.viewportIds.map((viewportId) => {
    const existing = resolved.querySelector(`[data-odv-viewport="${viewportId}"]`);
    if (existing) return existing;

    const child = document.createElement('div');
    child.dataset.odvViewport = viewportId;
    resolved.appendChild(child);
    return child;
  });
}

/**
 * 运行时收窄，替代 `as HTMLElement`（GEMINI §10 禁止用 as 绕过类型检查）。
 */
function isContainerLike(value: unknown): value is HTMLElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    'querySelector' in value &&
    'appendChild' in value
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function twoFrames(raf: (callback: FrameRequestCallback) => number): Promise<void> {
  return new Promise((resolve) => {
    raf(() => {
      raf(() => {
        resolve();
      });
    });
  });
}

export function createCornerstoneRenderer(
  options: CornerstoneRendererOptions,
): CornerstoneRenderer {
  return new CornerstoneRenderer(options);
}
