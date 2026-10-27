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
  /** 宿主挂载容器唯一标识或容器句柄（具体 Adapter 转为 HTMLDivElement 等） */
  readonly containerId: string;
  readonly element?: unknown;
}

export interface RendererPort {
  readonly backend: RenderBackendType;
  /** 初始化并挂载渲染画布至目标容器 */
  mount(target: RenderMountTarget, layout: ViewportLayout): void;
  /** 设置视口显示全分辨率 Stack 序列切片 */
  setStack(viewportId: string, handle: SeriesHandle, initialIndex?: number): Promise<void>;
  /** 切换全分辨率切片索引（滚动切片翻页） */
  setStackIndex(viewportId: string, index: number): void;
  /** 设置视口显示降采样 3D Volume（MPR 通路，严禁作测量依据） */
  setVolume(viewportId: string, volumeId: string): Promise<void>;
  /** 显存直通调窗（更新片元着色器 uniform） */
  setVOI(viewportId: string, range: VOIRange): void;
  /** 调整视口网格布局 */
  setLayout(layout: ViewportLayout): void;
  /** 重绘视口 */
  render(viewportId?: string): void;
  /** 销毁渲染引擎，释放 GPU 纹理与上下文（避免内存泄漏） */
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
