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
  type ViewportKind,
  type ViewportLayout,
  type ViewportOrientation,
  type VolumeHandle,
  type VOIRange,
  type WorldPoint,
  rangeToVOI,
  voiToRange,
} from '@opendicomviewer/core';
import type {
  Cs3dCameraLike,
  Cs3dEngineLike,
  Cs3dModuleLike,
  Cs3dViewportLike,
  Cs3dVolumeLike,
} from './cs3d-surface';
import { SeriesFrameRegistry } from './frame-registry';

/** 8-bit 降采样体积的固定显示区间（scalarData 已被 core 映射到 0–255） */
const VOLUME_VOI_RANGE = { lower: 0, upper: 255 } as const;

interface ResolvedCell {
  readonly kind: ViewportKind;
  readonly orientation?: ViewportOrientation;
}


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
  private readonly viewportKinds = new Map<string, ViewportKind>();
  private readonly viewportOrientations = new Map<string, ViewportOrientation>();
  private readonly viewportSeries = new Map<string, string>();
  private readonly viewportFrameCounts = new Map<string, number>();
  /** STACK 视口的真实层号（对外语义；与 CS3D 的 imageId 索引一致） */
  private readonly viewportStackIndex = new Map<string, number>();
  /** ORTHOGRAPHIC 视口当前挂载的体积（含几何，供层号换算） */
  private readonly viewportVolumes = new Map<string, VolumeHandle>();
  /** 本适配器创建过的体积 id：销毁/重建时据此清理 cache */
  private readonly createdVolumeIds = new Set<string>();
  /** 创建过的体积对象：移除时据此清理 CS3D 为每层派生的本地 imageId */
  private readonly createdVolumes = new Map<string, Cs3dVolumeLike>();
  /**
   * 已写入 cache 的体积句柄。
   *
   * 同一体积会被多个 ORTHOGRAPHIC 视口共用（MPR 三视图），因此只有当
   * 传入的是**同 id、不同句柄**（重建）时才能移除旧对象；仅凭 id 存在就删，
   * 会把前一个视口正在渲染的体积从 cache 里抽走。
   */
  private readonly volumeHandles = new Map<string, VolumeHandle>();
  /**
   * 正在装载中的体积引用计数。
   *
   * 并发 setVolume（StrictMode 双调用、快速切换布局）时会有多次装载重叠；
   * 只有计数归零且没有视口挂载，才能判定"真的没人用"并回收 cache。
   */
  private readonly volumeInFlight = new Map<string, number>();
  /** 视口级装载版本号：慢请求归来时用它判断自己是否已被新请求取代 */
  private readonly viewportTokens = new Map<string, number>();
  /**
   * 视口上仍在进行中的装载目标序列。
   *
   * 用途：并发 setStack 时，被取代的旧请求**不能**释放帧登记表——
   * 新请求（同序列）还需要它。没有这个表时，旧请求会删掉新请求刚登记的
   * imageId，CS3D 随后报 "未登记的 imageId"（StrictMode 双调用即可触发）。
   */
  private readonly viewportPendingSeries = new Map<string, string>();
  private readonly frames = new SeriesFrameRegistry();

  private engine: Cs3dEngineLike | null = null;
  /**
   * 视口元素尺寸观察器。
   *
   * CS3D 不监听元素尺寸：1×1 装载完成出现底栏、窗口缩放这类"非 setLayout"
   * 的高度变化同样会让画布与 CSS 尺寸脱节，因此这里统一收敛到 `engine.resize()`。
   */
  private resizeObserver: ResizeObserver | null = null;
  private mountTarget: RenderMountTarget | null = null;
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
      // 变成一句空话。只有组合根真的注入了体积通路（volumeLoader + cache）才成立。
      supportsVolume: Boolean(this.cs3d.volumeLoader && this.cs3d.cache),
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

    const cells = this.resolveCells(layout);
    const enabled: string[] = [];
    try {
      layout.viewportIds.forEach((viewportId, index) => {
        const element = elements[index];
        if (element === undefined) {
          throw new Error(`视口 ${viewportId} 缺少挂载元素`);
        }
        this.enableViewport(engine, viewportId, element, cells.get(viewportId) ?? { kind: 'stack' });
        enabled.push(viewportId);
      });

      this.mountTarget = target;
      this.mounted = true;
      // Spike B 坑 1：首个 ORTHOGRAPHIC 视口不预热会渲染成纯黑。
      await this.warmupOrthographic(enabled);
    } catch (err: unknown) {
      // 中途失败必须回滚：否则已启用的视口与 engine 泄漏（交叉评审 N5）
      this.mounted = false;
      this.mountTarget = null;
      for (const viewportId of enabled) {
        engine.disableElement?.(viewportId);
      }
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.viewports.clear();
      this.viewportKinds.clear();
      this.viewportOrientations.clear();
      engine.destroy();
      this.engine = null;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  public async setLayout(layout: ViewportLayout): Promise<void> {
    this.assertLayout(layout);
    this.assertMounted();
    const engine = this.engine;
    const target = this.mountTarget;
    if (!engine || !target) {
      throw new Error('渲染引擎状态不一致，请重新 mount');
    }

    const cells = this.resolveCells(layout);
    const elements = this.resolveElements(target, layout);
    if (elements.length !== layout.viewportIds.length) {
      throw new Error(
        `视口元素数量与布局不符：期望 ${layout.viewportIds.length}，实际 ${elements.length}`,
      );
    }

    // 1. 先关闭"不再需要 / 类型变了 / 元素换了"的格子。
    //    元素必须一并比对：1×1 时视口挂在容器上，切到 2×2 后每格换成子 div，
    //    不重建就会有两个视口抢同一个元素。
    const desired = new Map<string, ResolvedCell>();
    layout.viewportIds.forEach((id) => {
      desired.set(id, cells.get(id) ?? { kind: 'stack' });
    });
    for (const [viewportId, viewport] of [...this.viewports.entries()]) {
      const want = desired.get(viewportId);
      const element = elements[layout.viewportIds.indexOf(viewportId)];
      if (
        !want ||
        want.kind !== this.viewportKinds.get(viewportId) ||
        (viewport.element !== undefined && viewport.element !== element)
      ) {
        this.disposeViewport(viewportId);
      }
    }

    // 2. 启用新增/重建的格子；中途失败要把本次新启用的回滚掉。
    const added: string[] = [];
    try {
      layout.viewportIds.forEach((viewportId, index) => {
        if (this.viewports.has(viewportId)) return;
        const element = elements[index];
        if (element === undefined) {
          throw new Error(`视口 ${viewportId} 缺少挂载元素`);
        }
        this.enableViewport(
          engine,
          viewportId,
          element,
          desired.get(viewportId) ?? { kind: 'stack' },
        );
        added.push(viewportId);
      });
      await this.warmupOrthographic(added);
    } catch (err: unknown) {
      for (const viewportId of added) {
        engine.disableElement?.(viewportId);
        this.viewports.delete(viewportId);
        this.viewportKinds.delete(viewportId);
        this.viewportOrientations.delete(viewportId);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }

    // 3. 宿主 CSS 已把格子改到新尺寸；必须让 CS3D 重算画布 attribute 尺寸。
    //    只调 render 会保留上一个布局的画布尺寸（1+3 ↔ 2×2 实测 564×758 贴在
    //    423×378 的格子里），画面被拉伸，按画布反算的比例尺也跟着错。
    this.resizeNow();
    for (const viewportId of layout.viewportIds) {
      this.viewports.get(viewportId)?.render();
    }
  }

  public async setStack(
    viewportId: string,
    handle: SeriesHandle,
    initialIndex = 0,
  ): Promise<void> {
    const viewport = this.viewportOf(viewportId);
    if (this.kindOf(viewportId) !== 'stack') {
      throw new Error(
        `视口 ${viewportId} 是 ORTHOGRAPHIC 类型，不支持 setStack；请改用 setVolume（两条通路不可互换）`,
      );
    }
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
    const previousIndex = this.viewportStackIndex.has(viewportId) ? this.currentSliceIndex(viewportId) : undefined;

    // 视口级版本号：并发 setStack 时只让最后一次生效。
    // 没有它的话，慢请求 A 会在快请求 B 之后归来并把归属写回 A，
    // 导致 B 的帧再也没人释放（内存泄漏）+ 越界判断用错帧数（状态串扰）。
    const token = (this.viewportTokens.get(viewportId) ?? 0) + 1;
    this.viewportTokens.set(viewportId, token);
    this.viewportPendingSeries.set(viewportId, nextSeriesUid);

    const imageIds = this.frames.register(handle);
    try {
      await viewport.setStack(imageIds, initialIndex);
    } catch (err: unknown) {
      // CS3D 装载失败时必须回滚登记表，否则这个视口"看起来装着 B、实际还是 A"，
      // 而 B 的帧再也没人释放。
      // 先清 pending 再做丢弃判定：本条已是最新请求时才能真的释放帧；
      // 若已被同序列的新请求取代（token 不匹配），pending 属于对方，不得释放。
      this.clearPendingSeries(viewportId, token, nextSeriesUid);
      this.discardRegistration(nextSeriesUid, viewportId);
      this.restoreViewportSeries(viewportId, previousSeriesUid, previousFrameCount);
      this.restoreStackIndex(viewportId, previousIndex);
      throw err instanceof Error ? err : new Error(String(err));
    }

    // await 归来后先查版本号：被更新的请求取代时，本次登记作废、归属一律不动。
    // 注意这里是"写入归属之前"的最后一道闸，顺序不能调。
    if (token !== this.viewportTokens.get(viewportId)) {
      this.discardRegistration(nextSeriesUid, viewportId);
      this.clearPendingSeries(viewportId, token, nextSeriesUid);
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
    this.viewportStackIndex.set(viewportId, initialIndex);
    this.clearPendingSeries(viewportId, token, nextSeriesUid);
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
    this.viewportStackIndex.set(viewportId, index);
  }

  public async setVolume(viewportId: string, volume: VolumeHandle): Promise<void> {
    const viewport = this.viewportOf(viewportId);
    if (this.kindOf(viewportId) !== 'orthographic') {
      throw new Error(
        `视口 ${viewportId} 是 STACK 类型，不支持体积渲染；请改用 setStack（禁止静默降级）`,
      );
    }
    const loader = this.cs3d.volumeLoader;
    const cache = this.cs3d.cache;
    if (!loader || !cache) {
      throw new Error('CS3D 模块未注入 volumeLoader/cache，体积通路不可用');
    }
    if (!viewport.setVolumes) {
      throw new Error(`视口 ${viewportId} 不支持 setVolumes，体积通路不可用`);
    }

    const [width, height, depth] = volume.dimensions;
    if (volume.scalarData.length !== width * height * depth) {
      throw new Error(
        `体积数据与尺寸不一致：${volume.scalarData.length} 字节，期望 ${width * height * depth}`,
      );
    }

    const token = (this.viewportTokens.get(viewportId) ?? 0) + 1;
    this.viewportTokens.set(viewportId, token);

    // 同 id 的体积只有在**数据句柄变了**（重建）时才需要移出 cache；
    // 三个 MPR 视口共用同一个句柄时直接复用，否则后一个视口会把前一个的
    // cache 对象删掉再重建，画面与体积归属都会错乱。
    const cached = cache.getVolume(volume.volumeId);
    let created: Cs3dVolumeLike;
    if (cached !== undefined && this.volumeHandles.get(volume.volumeId) === volume) {
      created = cached;
    } else {
      if (cached !== undefined) {
        // 同 id 重建：连派生的层图像一起清掉，否则 createLocalVolume 会因
        // imageId 已在 cache 而失败
        this.purgeVolume(volume.volumeId);
        if (cache.getVolume(volume.volumeId) !== undefined) {
          cache.removeVolumeLoadObject(volume.volumeId);
        }
      }
      try {
        created = loader.createLocalVolume(volume.volumeId, {
          dimensions: [width, height, depth],
          spacing: [volume.spacing[0], volume.spacing[1], volume.spacing[2]],
          origin: [volume.origin[0], volume.origin[1], volume.origin[2]],
          direction: [...volume.direction],
          scalarData: volume.scalarData,
        });
      } catch (err: unknown) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      this.volumeHandles.set(volume.volumeId, volume);
      this.createdVolumeIds.add(created.volumeId);
      this.createdVolumes.set(created.volumeId, created);
    }

    this.retainInFlight(created.volumeId);
    let failure: Error | null = null;
    let superseded = false;
    try {
      await viewport.setVolumes([{ volumeId: created.volumeId }]);
      if (token !== this.viewportTokens.get(viewportId)) {
        superseded = true;
        throw new Error(
          `装载体积 ${volume.volumeId} 被更新的请求取代，本次结果已丢弃`,
        );
      }
    } catch (err: unknown) {
      failure = err instanceof Error ? err : new Error(String(err));
    } finally {
      this.releaseInFlight(created.volumeId);
    }

    if (failure) {
      // 被更新的请求取代时**不能**回收：新请求接下来还要把同一个体积挂到
      // 其他 MPR 视口，这里一删，对方的 actor 就指向已销毁的 imageData
      // （`model.extent is not iterable`）。同 id 重建时新请求会自行清理旧体积。
      if (!superseded) this.releaseVolumeIfUnused(created.volumeId, viewportId);
      throw failure;
    }

    const orientation = this.viewportOrientations.get(viewportId);
    if (orientation) {
      viewport.setOrientation?.(orientation, true);
    }
    // 8-bit 显示区间固定，不跟随用户调窗（ARCHITECTURE §5.2）
    viewport.setProperties({ voiRange: VOLUME_VOI_RANGE });
    viewport.resetCamera?.();
    viewport.render();

    const previous = this.viewportVolumes.get(viewportId);
    this.viewportVolumes.set(viewportId, volume);
    if (previous && previous.volumeId !== volume.volumeId) {
      this.releaseVolumeIfUnused(previous.volumeId, viewportId);
    }
    // 换序列后旧体积可能已经没有任何 MPR 视口在用（例如停留在 1×1 时换了序列），
    // 这里顺手回收，避免它为等待重建而长期占 cache。
    this.pruneUnusedVolumes(volume.volumeId);
  }

  public async stepSlice(viewportId: string, delta: number): Promise<void> {
    if (!Number.isInteger(delta)) {
      throw new Error(`步进量必须为整数：${delta}`);
    }
    const viewport = this.viewportOf(viewportId);

    if (this.kindOf(viewportId) === 'stack') {
      const count = this.viewportFrameCounts.get(viewportId);
      if (count === undefined) {
        throw new Error(`视口 ${viewportId} 尚未装载序列，无法翻层`);
      }
      const current = this.currentSliceIndex(viewportId);
      const target = clamp(current + delta, 0, count - 1);
      if (target === current) return;
      await viewport.setImageIdIndex(target);
      this.viewportStackIndex.set(viewportId, target);
      return;
    }

    const volume = this.viewportVolumes.get(viewportId);
    if (!volume) {
      throw new Error(`视口 ${viewportId} 尚未装载体积，无法翻层`);
    }
    const current = this.volumeSliceOf(viewportId, viewport, volume);
    const axis = axisForView(viewportId, viewport, volume);
    const target = clamp(current + delta, 0, volume.dimensions[axis] - 1);
    if (target === current) return;

    if (!viewport.jumpToWorld) {
      throw new Error(`视口 ${viewportId} 不支持 jumpToWorld，无法翻层`);
    }
    const focalPoint = requireCamera(viewport, viewportId).focalPoint;
    const dir = axisVector(volume, axis);
    const offset = (target - current) * volume.spacing[axis];
    viewport.jumpToWorld([
      (focalPoint[0] ?? 0) + dir[0] * offset,
      (focalPoint[1] ?? 0) + dir[1] * offset,
      (focalPoint[2] ?? 0) + dir[2] * offset,
    ]);
    viewport.render();
  }

  public currentSliceIndex(viewportId: string): number {
    this.assertMounted();
    const viewport = this.viewportOf(viewportId);

    if (this.kindOf(viewportId) === 'stack') {
      const index = this.viewportStackIndex.get(viewportId);
      if (index === undefined) {
        throw new Error(`视口 ${viewportId} 尚未装载序列，无法读取层号`);
      }
      // jumpToWorld 会在 CS3D 内部改层号，真源必须读实际视口，缓存仅服务最小测试表面。
      const actual = viewport.getCurrentImageIdIndex?.() ?? index;
      const count = this.viewportFrameCounts.get(viewportId) ?? 0;
      if (!Number.isInteger(actual) || actual < 0 || actual >= count) {
        throw new Error(`视口 ${viewportId} 返回了无效层号：${actual}`);
      }
      this.viewportStackIndex.set(viewportId, actual);
      return actual;
    }

    const volume = this.viewportVolumes.get(viewportId);
    if (!volume) {
      throw new Error(`视口 ${viewportId} 尚未装载体积，无法读取层号`);
    }
    return this.volumeSliceOf(viewportId, viewport, volume);
  }

  public async focusAt(viewportId: string, world: WorldPoint): Promise<void> {
    const viewport = this.viewportOf(viewportId);
    if (!viewport.jumpToWorld) {
      throw new Error(`视口 ${viewportId} 不支持 jumpToWorld，无法按世界坐标定位`);
    }
    const moved = viewport.jumpToWorld([world[0], world[1], world[2]]);
    if (!moved) {
      throw new Error(
        `世界坐标 (${world[0].toFixed(1)}, ${world[1].toFixed(1)}, ${world[2].toFixed(1)}) 不在视口 ${viewportId} 的可定位范围内`,
      );
    }
    await this.whenIdle(viewportId);
  }

  /**
   * ORTHOGRAPHIC 视口的当前层号。
   *
   * 不使用 CS3D 的 `getSliceIndex()`（Spike B：它与世界 z 反向），而是把相机
   * 焦点投影到体积对应轴的物理坐标上——正反、倾斜都不会算错。
   */
  private volumeSliceOf(
    viewportId: string,
    viewport: Cs3dViewportLike,
    volume: VolumeHandle,
  ): number {
    const camera = requireCamera(viewport, viewportId);
    const axis = axisForView(viewportId, viewport, volume);
    const dir = axisVector(volume, axis);
    const origin = volume.origin;
    const projected =
      ((camera.focalPoint[0] ?? 0) - origin[0]) * dir[0] +
      ((camera.focalPoint[1] ?? 0) - origin[1]) * dir[1] +
      ((camera.focalPoint[2] ?? 0) - origin[2]) * dir[2];
    const spacing = volume.spacing[axis];
    return clamp(Math.round(projected / spacing), 0, volume.dimensions[axis] - 1);
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

  public zoomBy(viewportId: string, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('缩放倍数必须为正数');
    const viewport = this.viewportOf(viewportId);
    if (!viewport.getZoom || !viewport.setZoom) throw new Error('当前视口不支持缩放');
    const current = viewport.getZoom();
    if (!Number.isFinite(current) || current <= 0) throw new Error('当前相机缩放无效');
    viewport.setZoom(Math.min(20, Math.max(0.05, current * factor)));
    viewport.render();
  }

  public panBy(viewportId: string, delta: CanvasPoint): void {
    if (![delta.x, delta.y].every(Number.isFinite)) throw new Error('平移坐标必须为有限数值');
    const viewport = this.viewportOf(viewportId);
    if (!viewport.getPan || !viewport.setPan) throw new Error('当前视口不支持平移');
    const [x, y] = viewport.getPan();
    if (x === undefined || y === undefined || ![x, y].every(Number.isFinite)) {
      throw new Error('当前相机平移无效');
    }
    viewport.setPan([x + delta.x, y + delta.y]);
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
    const element = this.viewports.get(viewportId)?.element;
    this.engine?.disableElement?.(viewportId);
    this.unobserveElement(element);
    this.viewports.delete(viewportId);
    this.viewportKinds.delete(viewportId);
    this.viewportOrientations.delete(viewportId);
    this.viewportStackIndex.delete(viewportId);

    // 帧登记表与体积都不随视口销毁释放：
    // CS3D 在 `disableElement` 之后仍会跑完已经排队的装载（实测会继续读 imageId、
    // 继续用体积 actor），此时释放登记表/删 cache 会让重建后的 MPR 视口拿到
    // 已销毁的 imageData（`model.extent is not iterable`）或报"未登记的 imageId"。
    // 二者的回收改为：换序列时释放旧序列、换体积/销毁渲染器时清体积。
    this.viewportSeries.delete(viewportId);
    this.viewportFrameCounts.delete(viewportId);
    this.viewportVolumes.delete(viewportId);
    // 版本号也清掉，但先自增一次：让仍在 await 的旧请求明确作废
    this.viewportTokens.set(viewportId, (this.viewportTokens.get(viewportId) ?? 0) + 1);
    this.viewportTokens.delete(viewportId);
    this.viewportPendingSeries.delete(viewportId);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mounted = false;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    for (const viewportId of [...this.viewports.keys()]) {
      this.engine?.disableElement?.(viewportId);
    }
    this.viewports.clear();
    this.viewportKinds.clear();
    this.viewportOrientations.clear();
    this.viewportSeries.clear();
    this.viewportFrameCounts.clear();
    this.viewportStackIndex.clear();
    this.viewportVolumes.clear();
    this.viewportTokens.clear();
    this.viewportPendingSeries.clear();
    this.volumeHandles.clear();
    this.volumeInFlight.clear();
    this.frames.clear();

    // 先销毁引擎再清 cache：反序会让视口持有已失效的体积
    this.engine?.destroy();
    this.engine = null;
    this.mountTarget = null;

    for (const volumeId of [...this.createdVolumeIds]) {
      this.purgeVolume(volumeId);
    }
    this.createdVolumes.clear();
  }

  // ── 视口装配与体积生命周期 ────────────────────────────────

  private kindOf(viewportId: string): ViewportKind {
    return this.viewportKinds.get(viewportId) ?? 'stack';
  }

  private resolveCells(layout: ViewportLayout): Map<string, ResolvedCell> {
    const cells = new Map<string, ResolvedCell>();
    for (const id of layout.viewportIds) {
      cells.set(id, { kind: 'stack' });
    }
    for (const cell of layout.cells ?? []) {
      cells.set(cell.viewportId, {
        kind: cell.kind ?? 'stack',
        orientation: cell.orientation,
      });
    }
    return cells;
  }

  private enableViewport(
    engine: Cs3dEngineLike,
    viewportId: string,
    element: unknown,
    cell: ResolvedCell,
  ): void {
    engine.enableElement({
      viewportId,
      element,
      type:
        cell.kind === 'orthographic'
          ? this.cs3d.Enums.ViewportType.ORTHOGRAPHIC
          : this.cs3d.Enums.ViewportType.STACK,
      defaultOptions: { background: [0, 0, 0] },
    });
    this.viewports.set(viewportId, engine.getViewport(viewportId));
    this.viewportKinds.set(viewportId, cell.kind);
    if (cell.orientation) {
      this.viewportOrientations.set(viewportId, cell.orientation);
    } else {
      this.viewportOrientations.delete(viewportId);
    }
    this.observeElement(element);
  }

  /**
   * 观察视口元素尺寸。非 DOM 元素（单测注入的假元素）直接跳过，
   * 缺 ResizeObserver 的运行时也不报错——此时只剩 setLayout 的显式 resize 兜底。
   */
  private observeElement(element: unknown): void {
    if (typeof ResizeObserver === 'undefined') return;
    if (typeof Element === 'undefined' || !(element instanceof Element)) return;
    if (!this.resizeObserver) {
      // 同步 resize：RO 回调按观察器创建顺序执行，本观察器先于 UI 层比例尺
      // 的观察器创建，先 resize 才能让同帧的比例尺测量读到正确的画布/相机。
      // engine.resize 对未变化的尺寸是空操作，重复调用不会重建纹理。
      this.resizeObserver = new ResizeObserver(() => this.resizeNow());
    }
    this.resizeObserver.observe(element);
  }

  private unobserveElement(element: unknown): void {
    if (!this.resizeObserver || element === undefined) return;
    if (typeof Element === 'undefined' || !(element instanceof Element)) return;
    this.resizeObserver.unobserve(element);
  }

  /** CS3D 发现显示尺寸与画布尺寸一致时内部会直接跳过，这里不必自己判重 */
  private resizeNow(): void {
    if (this.destroyed) return;
    this.engine?.resize?.(true, true);
  }

  /**
   * Spike B 坑 1：首个 ORTHOGRAPHIC 视口在 `enableElement` 后不空渲染一次，
   * 相机不会初始化，随后挂体积只会得到一张纯黑图。
   */
  private async warmupOrthographic(viewportIds: readonly string[]): Promise<void> {
    const ortho = viewportIds.filter((id) => this.kindOf(id) === 'orthographic');
    if (ortho.length === 0) return;
    for (const id of ortho) {
      this.viewports.get(id)?.render();
    }
    await this.whenIdle(ortho[0]);
  }

  private retainInFlight(volumeId: string): void {
    this.volumeInFlight.set(volumeId, (this.volumeInFlight.get(volumeId) ?? 0) + 1);
  }

  private releaseInFlight(volumeId: string): void {
    const remaining = (this.volumeInFlight.get(volumeId) ?? 1) - 1;
    if (remaining > 0) this.volumeInFlight.set(volumeId, remaining);
    else this.volumeInFlight.delete(volumeId);
  }

  /** 没有别的视口在用这个体积时，把它从 cache 里清掉（只清本适配器创建的） */
  private releaseVolumeIfUnused(volumeId: string, exceptViewportId: string): void {
    // 还有装载在途：对方可能马上就把它挂上视口，不能提前销毁 imageData
    if ((this.volumeInFlight.get(volumeId) ?? 0) > 0) return;
    for (const [viewportId, volume] of this.viewportVolumes) {
      if (viewportId !== exceptViewportId && volume.volumeId === volumeId) return;
    }
    this.purgeVolume(volumeId);
  }

  /** 回收所有既不是 `keepVolumeId`、也没有 MPR 视口在用的本适配器体积 */
  private pruneUnusedVolumes(keepVolumeId?: string): void {
    for (const volumeId of [...this.createdVolumeIds]) {
      if (volumeId === keepVolumeId) continue;
      if ((this.volumeInFlight.get(volumeId) ?? 0) > 0) continue;
      let inUse = false;
      for (const volume of this.viewportVolumes.values()) {
        if (volume.volumeId === volumeId) {
          inUse = true;
          break;
        }
      }
      if (!inUse) this.purgeVolume(volumeId);
    }
  }

  /**
   * 彻底移除一个本适配器创建的体积。
   *
   * 只删 volume cache 不够：`createLocalVolume` 会为每层派生本地 image，
   * 层 image 留在 image cache 里，同 id 重建时 createAndCacheLocalImage 会
   * 直接抛 "putImageSync: imageId already in cache"，MPR 全部黑屏（实测）。
   */
  private purgeVolume(volumeId: string): void {
    if (!this.createdVolumeIds.delete(volumeId)) return;
    this.volumeHandles.delete(volumeId);

    const cache = this.cs3d.cache;
    const volume = this.createdVolumes.get(volumeId);
    this.createdVolumes.delete(volumeId);
    if (cache && volume?.imageIds) {
      for (const imageId of volume.imageIds) {
        cache.removeImageLoadObject?.(imageId);
      }
    }
    if (cache?.getVolume(volumeId) !== undefined) {
      cache.removeVolumeLoadObject(volumeId);
    }
  }

  private restoreStackIndex(viewportId: string, previousIndex: number | undefined): void {
    if (previousIndex === undefined) {
      this.viewportStackIndex.delete(viewportId);
    } else {
      this.viewportStackIndex.set(viewportId, previousIndex);
    }
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
    // 本视口还有更新的同序列请求在飞：它刚登记的帧正被 CS3D 读取，不能删
    if (this.viewportPendingSeries.get(viewportId) === seriesInstanceUid) return;
    if (this.isSeriesInUse(seriesInstanceUid, viewportId)) return;
    this.frames.release(seriesInstanceUid);
  }

  /** 只有最新一次请求才能清掉 pending；被取代的旧请求不得改状态 */
  private clearPendingSeries(
    viewportId: string,
    token: number,
    seriesInstanceUid: string,
  ): void {
    if (token !== this.viewportTokens.get(viewportId)) return;
    if (this.viewportPendingSeries.get(viewportId) !== seriesInstanceUid) return;
    this.viewportPendingSeries.delete(viewportId);
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

    const known = new Set(layout.viewportIds);
    const seen = new Set<string>();
    for (const cell of layout.cells ?? []) {
      if (!known.has(cell.viewportId)) {
        throw new Error(`格子 ${cell.viewportId} 不在 viewportIds 内`);
      }
      if (seen.has(cell.viewportId)) {
        throw new Error(`布局中重复声明了视口 ${cell.viewportId}`);
      }
      seen.add(cell.viewportId);
      const kind = cell.kind ?? 'stack';
      if (kind !== 'stack' && kind !== 'orthographic') {
        throw new Error(`未知视口类型：${String(kind)}`);
      }
      if (kind === 'orthographic' && cell.orientation === undefined) {
        throw new Error(
          `ORTHOGRAPHIC 视口 ${cell.viewportId} 必须指定方向（axial/coronal/sagittal）`,
        );
      }
      if (
        cell.orientation !== undefined &&
        cell.orientation !== 'axial' &&
        cell.orientation !== 'coronal' &&
        cell.orientation !== 'sagittal'
      ) {
        throw new Error(`未知切面方向：${String(cell.orientation)}`);
      }
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

type AxisIndex = 0 | 1 | 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 体积第 axis 轴的方向余弦（direction 按 [x, y, z] 三段排布） */
function axisVector(
  volume: VolumeHandle,
  axis: AxisIndex,
): readonly [number, number, number] {
  const base = axis * 3;
  return [
    volume.direction[base] ?? 0,
    volume.direction[base + 1] ?? 0,
    volume.direction[base + 2] ?? 0,
  ];
}

/**
 * 当前视口在切哪个轴：取相机法向与体积三轴里点积最大的那一个。
 * 这样 axial/coronal/sagittal 共用一套换算，不依赖 CS3D 的层号方向约定。
 */
function axisForView(
  viewportId: string,
  viewport: Cs3dViewportLike,
  volume: VolumeHandle,
): AxisIndex {
  const normal = requireCamera(viewport, viewportId).viewPlaneNormal;
  let best: AxisIndex = 2;
  let bestDot = -1;
  for (const axis of [0, 1, 2] as const) {
    const dir = axisVector(volume, axis);
    const dot = Math.abs(
      (normal[0] ?? 0) * dir[0] +
        (normal[1] ?? 0) * dir[1] +
        (normal[2] ?? 0) * dir[2],
    );
    if (dot > bestDot) {
      bestDot = dot;
      best = axis;
    }
  }
  return best;
}

function requireCamera(viewport: Cs3dViewportLike, viewportId: string): Cs3dCameraLike {
  const camera = viewport.getCamera?.();
  if (!camera) {
    throw new Error(`视口 ${viewportId} 缺少相机读数，无法换算层号`);
  }
  return camera;
}

export function createCornerstoneRenderer(
  options: CornerstoneRendererOptions,
): CornerstoneRenderer {
  return new CornerstoneRenderer(options);
}
