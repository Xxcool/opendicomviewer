/**
 * OpenDicomViewer Core Port Definitions
 *
 * 六边形架构（Ports & Adapters）：
 * 核心层仅定义端口接口，不导入任何平台具体实现。
 * 遵循 R6：核心包内无 DOM、无宿主环境全局对象。
 */

import type {
  DataWarning,
  ImagePlane,
  ImportFailure,
  MeasurementRecord,
  PixelFrame,
  SeriesMeta,
  SeriesSummary,
  StudyMeta,
  VOIRange,
} from '../domain/types';
import type { VolumeHandle } from '../volume/types';

export interface ImportCandidate {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** 由具体的 SourceAdapter 提供读取方法，支持分段 Range 读取与中止取消 (N9) */
  read(start?: number, end?: number, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export interface ImportProgress {
  readonly stage: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface ImportInput {
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly files: readonly ImportCandidate[];
}

export interface SeriesRef {
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
}

export interface SeriesHandle {
  readonly meta: SeriesMeta;
  readonly warnings: readonly DataWarning[];
  /** 原始完整实例来源；省略层号返回当前序列全部已导入实例，多帧只返回一次，不包含标注。 */
  originalCandidates?(layerIndex?: number): readonly ImportCandidate[];
  /** 按排序后的索引获取原始帧像素（全分辨率 Stack 通路） */
  pixel(layerIndex: number): Promise<PixelFrame>;
  /** 批量方向性预取指定切片索引（N8: 支撑 p95 帧时间 < 16.7ms 指标） */
  prefetch?(layerIndices: readonly number[]): Promise<void>;
  /** 释放资源（图片纹理缓存、解码缓冲等） */
  dispose(): void;
}

/**
 * 最近一次 probe 的导入结果概览（R7：部分失败必须可见，禁止静默）。
 *
 * 为什么 succeeded 与 failures 必须一起返回：
 * 分开取的话 UI 只能拿"候选文件总数 − 失败数"去凑成功数，
 * 而 ZIP 会展开、非 DICOM 文件会被跳过，两个数字会各说各话。
 */
export interface ImportOutcome {
  /** 成功解析并纳入序列的文件数（按实际解析出的实例计，不含被跳过的非 DICOM 文件） */
  readonly succeeded: number;
  /** 解析失败的文件清单，逐项含文件名与可直接展示的原因 */
  readonly failures: readonly ImportFailure[];
}

export interface DataSourcePort {
  readonly kind: 'local' | 'dicomweb';
  /** 扫描探测文件集合，产出 Study 摘要列表，支持中止取消 (N9) */
  probe(input: ImportInput, signal?: AbortSignal): Promise<readonly StudyMeta[]>;
  /** 枚举指定 Study 或所有 Study 下已索引的序列摘要清单 */
  listSeries(studyInstanceUid?: string): Promise<readonly SeriesSummary[]>;
  /**
   * 最近一次 probe 的导入结果（同步，与 listSeries 对称）。
   *
   * 为什么必须在端口上：失败文件不暴露出去，UI 就只能说"导入了 35 层"，
   * 用户不知道少了哪 1 个、为什么少——这属于 R7 的静默失效。
   */
  importOutcome(): ImportOutcome;
  /** 加载指定序列并排好序返回 SeriesHandle */
  openSeries(ref: SeriesRef, signal?: AbortSignal): Promise<SeriesHandle>;
}

export interface CodecPort {
  /** 检查是否支持特定 Transfer Syntax UID */
  canDecode(transferSyntaxUid: string): boolean;
  /**
   * 解码压缩像素缓冲并直接产出完整的领域对象 PixelFrame (S7)。
   * 调用方不再需要靠猜或二次查询元数据拼接像素表示与斜率截距。
   */
  decode(
    buffer: ArrayBuffer,
    transferSyntaxUid: string,
    planeMeta?: Partial<ImagePlane>,
  ): Promise<PixelFrame>;
  /** 当前运行时是否优先支持 SharedArrayBuffer（根据 COOP/COEP 探测结果） */
  readonly prefersSharedMemory: boolean;
}

export type RenderBackendType = 'webgl2' | 'webgpu' | 'cpu';

/**
 * 视口通路类型。
 *
 * - `stack`：全分辨率原始切片（2×2 的轴位格、单序列浏览）；
 * - `orthographic`：降采样体积的正交切面（MPR），只用于显示与定位。
 *
 * 两条通路不是可互换的：STACK 视口没有 `setVolumes`，体积视口也没有 `setStack`（Spike B）。
 */
export type ViewportKind = 'stack' | 'orthographic';

/** MPR 切面方向（患者坐标轴，不是相机自由朝向） */
export type ViewportOrientation = 'axial' | 'coronal' | 'sagittal';

export interface ViewportCellSpec {
  readonly viewportId: string;
  /** 省略时为 `stack` */
  readonly kind?: ViewportKind;
  /** `kind === 'orthographic'` 时必填；`stack` 视口忽略此字段 */
  readonly orientation?: ViewportOrientation;
}

export interface ViewportLayout {
  readonly rows: number;
  readonly cols: number;
  readonly viewportIds: readonly string[];
  /**
   * 逐格类型/方向声明（P2 起的 2×2 MPR 布局）。
   *
   * 不提供时全部按 `stack` 处理（P1 行为不变）。提供时只允许覆盖
   * `viewportIds` 里的格子，不允许出现布局外的 id。
   */
  readonly cells?: readonly ViewportCellSpec[];
}

export interface RenderMountTarget {
  /** 宿主挂载容器唯一标识（找不到元素时的回退查找键） */
  readonly containerId: string;
  /** 宿主元素句柄（具体 Adapter 自行收窄为 HTMLDivElement），优先于 containerId */
  readonly element?: unknown;
}

/**
 * 渲染器能力与降级信息（§5.3 设备 × 功能降级矩阵的运行时依据）
 */
export interface RendererCapabilities {
  readonly backend: RenderBackendType;
  /** 是否支持降采样 Volume 通路（MPR / 体绘制）。false 时 UI 必须隐藏对应入口 */
  readonly supportsVolume: boolean;
  /** GPU 最大纹理边长；未知为 undefined。超大矩阵需据此决定是否分块 */
  readonly maxTextureSize?: number;
  /** 是否落了软件渲染回退；为 true 时禁止对外宣传性能指标 */
  readonly isSoftwareFallback: boolean;
}

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/** 患者坐标 [x, y, z]，单位 mm（LPS） */
export type WorldPoint = readonly [number, number, number];

/**
 * 渲染端口
 *
 * 契约（违反即视为 Adapter 缺陷，Spike A 已实测确认以下语义）：
 *
 * 1. **渲染器不解析 DICOM**。它只消费 `SeriesHandle.pixel()` 产出的 `PixelFrame`
 *    与 `SeriesMeta.planes` 的几何，不得引入 DICOM 解析库（见 GEMINI.md 层级规则）。
 * 2. **`render()` 只提交，不代表已呈现**。CS3D 内部走 requestAnimationFrame，
 *    `render()` 返回后同步计时常为 0。需要"画面已更新"时必须 `await whenIdle()`。
 * 3. **`setStackIndex()` 必须 await**。切换切片可能触发异步解码，返回 void 会让
 *    调用方在旧帧上做测量。
 * 4. **端口层的调窗口径统一是 `VOIRange`（窗宽/窗位），不是上下限**。
 *    Adapter 内部用 `voiToRange()` 换算成渲染器需要的 lower/upper，
 *    `getVOI()` 再用 `rangeToVOI()` 逆变换回来，保证与 core 的像素映射同一口径
 *    （Spike A 实测 CS3D 读回值与该公式一致）。上下限只存在于 Adapter 内部，
 *    不得出现在端口签名里。
 * 5. **不得在渲染循环里触发状态管理**（R4）。
 * 6. **ORTHOGRAPHIC 视口必须先预热**：`enableElement` 后首次出图前要空 `render()`
 *    一次，否则首个体积视口会渲染成纯黑（Spike B 实测，适配器在 `mount` 内完成）。
 * 7. **层号方向以端口为准**：CS3D 的 `getSliceIndex()` 与世界 z 反向，适配器必须
 *    换算成"真实层号"再对外的 `currentSliceIndex/stepSlice`。STACK 视口没有
 *    `setVolumes`，体积视口也没有 `setStack`——两条通路不可互换。
 */
export interface RendererPort {
  readonly backend: RenderBackendType;
  /** 运行时能力探测，mount 之前也应可调用 */
  capabilities(): RendererCapabilities;

  /** 初始化并挂载渲染画布至目标容器，按 layout 建立各视口 */
  mount(target: RenderMountTarget, layout: ViewportLayout): Promise<void>;
  /**
   * 调整视口网格布局（已挂载的前提下）。
   *
   * 支持增删视口：新增格子走 `enableElement`，移除格子走 `disableElement`。
   * 与已挂载视口类型不一致的格子会被重建（先禁用再启用）。
   */
  setLayout(layout: ViewportLayout): Promise<void>;

  /** 设置视口显示全分辨率 Stack 序列切片 */
  setStack(
    viewportId: string,
    handle: SeriesHandle,
    initialIndex?: number,
  ): Promise<void>;
  /** 切换全分辨率切片索引（滚动翻页），必须 await */
  setStackIndex(viewportId: string, index: number): Promise<void>;
  /**
   * 设置视口显示降采样 3D Volume（MPR 通路，严禁作测量依据）。
   *
   * 只接受 `orthographic` 视口；STACK 视口调用会明确抛错，不会静默降级为 Stack。
   */
  setVolume(viewportId: string, volume: VolumeHandle): Promise<void>;

  /**
   * 在视口当前切面上步进 `delta` 层（负数向前）。
   *
   * 层号语义统一为**真实层号**（与 `SeriesMeta.planes` 排序一致），
   * 适配器内部负责与 CS3D 的相机层号互相换算。到达边界时夹紧并返回，不抛错。
   */
  stepSlice(viewportId: string, delta: number): Promise<void>;
  /**
   * 读取当前真实层号。
   *
   * 未装载序列/体积、或视口无法给出层号时抛错：返回 0 会让准星静默跑到错误位置。
   */
  currentSliceIndex(viewportId: string): number;
  /**
   * 定位到包含指定患者坐标的切面（MPR 准星联动）。
   *
   * 坐标超出视口可定位范围时抛错，由调用方决定是否忽略该方向。
   */
  focusAt(viewportId: string, world: WorldPoint): Promise<void>;

  /** 显存直通调窗（更新片元着色器 uniform） */
  setVOI(viewportId: string, range: VOIRange): void;
  /** 读回当前调窗（用于预设切换与"复位到默认窗"） */
  getVOI(viewportId: string): VOIRange;
  /** 复位相机与缩放（不改 VOI） */
  resetView(viewportId: string): void;
  /** 相对于当前相机缩放；factor > 1 放大，factor < 1 缩小。 */
  zoomBy(viewportId: string, factor: number): void;
  /** 以画布 CSS 像素平移，保持世界坐标与物理标尺由渲染器管理。 */
  panBy(viewportId: string, delta: CanvasPoint): void;

  /** 患者坐标 → 画布像素坐标（测量工具绘制用） */
  worldToCanvas(viewportId: string, world: WorldPoint): CanvasPoint;
  /** 画布像素坐标 → 患者坐标（点击取点用） */
  canvasToWorld(viewportId: string, canvas: CanvasPoint): WorldPoint;

  /** 提交重绘。返回不代表已呈现，见契约第 2 条 */
  render(viewportId?: string): void;
  /**
   * 等待画面真正呈现（双帧 + 超时兜底的尽力而为实现）。
   * 性能埋点、截图断言、导出图像之前必须 await；超时也 resolve，不抛错。
   */
  whenIdle(viewportId?: string): Promise<void>;

  /** 释放单个视口（多视口布局下关闭某个格子） */
  disposeViewport(viewportId: string): void;
  /** 销毁渲染引擎，释放 GPU 纹理与上下文（幂等） */
  destroy(): void;
}

export interface StoragePort {
  putAnnotation(record: MeasurementRecord): Promise<void>;
  listAnnotations(seriesInstanceUid: string): Promise<readonly MeasurementRecord[]>;
  removeAnnotation(id: string): Promise<void>;
  purgeAll(): Promise<void>;
}

/**
 * 当前激活的测量工具。`none` 表示"只定位、不绘制"——这是**默认态**，
 * 左键在默认态下不产生任何测量（见 ADR-014 与 ARCHITECTURE §10.2）。
 */
export type MeasurementTool = 'none' | MeasurementRecord['type'];

/**
 * 测量端口：**测量数据的唯一真源**（ADR-014）
 *
 * 为什么不让渲染层持有：CS3D 的 annotation state 是渲染器私有结构，
 * 换后端即失效，且无法直接持久化/导出。因此由本端口持有 `MeasurementRecord`，
 * 渲染层订阅 `subscribe` 后负责绘制；用户拖拽结束时，渲染层把换算好的
 * 世界坐标/像素值写回 `add()`。
 *
 * 与 `StoragePort` 的分工：本端口管**运行时状态**（内存模型 + 变更广播），
 * 持久化由 `StoragePort` 落库，两者不合并（前者要同步、后者要异步）。
 */
export interface MeasurementPort {
  readonly activeTool: MeasurementTool;
  setActiveTool(tool: MeasurementTool): void;
  /** 按序列过滤；不传则返回全部 */
  list(seriesInstanceUid?: string): readonly MeasurementRecord[];
  add(record: MeasurementRecord): void;
  update(record: MeasurementRecord): void;
  remove(id: string): void;
  clear(seriesInstanceUid?: string): void;
  /** 变更订阅，返回取消订阅函数（渲染层据此重绘，UI 据此刷新右栏） */
  subscribe(listener: (records: readonly MeasurementRecord[]) => void): () => void;
}

/**
 * 空测量实现（尚未接入测量工具时的默认注入，避免 UI 判空）
 */
export const NullMeasurementPort: MeasurementPort = {
  activeTool: 'none',
  setActiveTool: () => {},
  list: () => [],
  add: () => {},
  update: () => {},
  remove: () => {},
  clear: () => {},
  subscribe: () => () => {},
};

export interface TelemetrySpan {
  end(): void;
}

export interface TelemetryPort {
  /**
   * 两段式追踪 span。
   * 支持同步和异步生命周期跨度管理，避免包装式对执行上下文的侵入 (S8)。
   */
  span(name: string): TelemetrySpan;
  recordMetric(name: string, value: number): void;
}

/**
 * 默认空 Telemetry 实例（R5: 零外部网络请求，严禁引入第三方埋点/错误上报）
 */
export const NullTelemetry: TelemetryPort = {
  span: () => ({ end: () => {} }),
  recordMetric: () => {},
};
