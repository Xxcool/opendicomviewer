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
  MeasurementRecord,
  PixelFrame,
  SeriesMeta,
  StudyMeta,
  VOIRange,
} from '../domain/types';

export interface ImportCandidate {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  /** 由具体的 SourceAdapter 提供读取方法，支持分段 Range 读取与中止取消 (N9) */
  read(start?: number, end?: number, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export interface ImportInput {
  readonly files: readonly ImportCandidate[];
}

export interface SeriesRef {
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
}

export interface SeriesHandle {
  readonly meta: SeriesMeta;
  readonly warnings: readonly DataWarning[];
  /** 按排序后的索引获取原始帧像素（全分辨率 Stack 通路） */
  pixel(layerIndex: number): Promise<PixelFrame>;
  /** 批量方向性预取指定切片索引（N8: 支撑 p95 帧时间 < 16.7ms 指标） */
  prefetch?(layerIndices: readonly number[]): Promise<void>;
  /** 释放资源（图片纹理缓存、解码缓冲等） */
  dispose(): void;
}

export interface DataSourcePort {
  readonly kind: 'local' | 'dicomweb';
  /** 扫描探测文件集合，产出 Study 摘要列表，支持中止取消 (N9) */
  probe(input: ImportInput, signal?: AbortSignal): Promise<readonly StudyMeta[]>;
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

export interface ViewportLayout {
  readonly rows: number;
  readonly cols: number;
  readonly viewportIds: readonly string[];
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
 */
export interface RendererPort {
  readonly backend: RenderBackendType;
  /** 运行时能力探测，mount 之前也应可调用 */
  capabilities(): RendererCapabilities;

  /** 初始化并挂载渲染画布至目标容器，按 layout 建立各视口 */
  mount(target: RenderMountTarget, layout: ViewportLayout): Promise<void>;
  /** 调整视口网格布局（已挂载的前提下） */
  setLayout(layout: ViewportLayout): Promise<void>;

  /** 设置视口显示全分辨率 Stack 序列切片 */
  setStack(
    viewportId: string,
    handle: SeriesHandle,
    initialIndex?: number,
  ): Promise<void>;
  /** 切换全分辨率切片索引（滚动翻页），必须 await */
  setStackIndex(viewportId: string, index: number): Promise<void>;
  /** 设置视口显示降采样 3D Volume（MPR 通路，严禁作测量依据） */
  setVolume(viewportId: string, volumeId: string): Promise<void>;

  /** 显存直通调窗（更新片元着色器 uniform） */
  setVOI(viewportId: string, range: VOIRange): void;
  /** 读回当前调窗（用于预设切换与"复位到默认窗"） */
  getVOI(viewportId: string): VOIRange;
  /** 复位相机与缩放（不改 VOI） */
  resetView(viewportId: string): void;

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
