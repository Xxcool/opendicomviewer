/**
 * 降采样 Volume 的几何与句柄类型
 *
 * 遵循 ARCHITECTURE §5.2：Volume 通路只做显示与定位，严禁作为测量依据。
 * 遵循 R6：本模块只用纯数据，不含任何宿主 API。
 */

import type { Vec3 } from '../pipeline/vector3';

/** 三轴体素尺寸，顺序固定为 [x(cols), y(rows), z(slices)]，与 CS3D 一致 */
export type VolumeDimensions = readonly [number, number, number];

/** 行主序 3×3 方向余弦矩阵：[行方向, 列方向, 法向] 各 3 个分量 */
export type DirectionMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface VolumeGeometry {
  readonly dimensions: VolumeDimensions;
  readonly spacing: Vec3;
  readonly origin: Vec3;
  readonly direction: DirectionMatrix;
}

/**
 * Volume 的 8-bit 映射区间（已换算为 HU，含 Modality 变换）。
 * 固定区间而非跟随用户调窗，避免 MPR 观感随调窗跳变（ARCHITECTURE §5.2）。
 */
export interface VolumeWindow {
  readonly lower: number;
  readonly upper: number;
}

export type VolumeRejectCode =
  | 'INSUFFICIENT_SLICES'
  | 'MISSING_GEOMETRY'
  | 'OBLIQUE_ORIENTATION'
  | 'INVALID_SPACING'
  | 'INVALID_ORIENTATION';

export interface VolumeDownsamplePlan extends VolumeGeometry {
  /** 各轴整数降采样因子 [fx, fy, fz] */
  readonly factors: VolumeDimensions;
  /** 源图像矩阵 [columns, rows, slices] */
  readonly sourceDimensions: VolumeDimensions;
  /** 源间距 [columnSpacing, rowSpacing, sliceSpacing] */
  readonly sourceSpacing: Vec3;
  /** 实际参与构建的源切片数 = dimensions[2] × factors[2]（尾部不足一块的切片被丢弃） */
  readonly usedSourceSlices: number;
  readonly voxelCount: number;
  readonly byteLength: number;
}

/**
 * 构建完成的降采样体积句柄（P2 的 `RendererPort.setVolume` 消费）。
 *
 * `scalarData` 由 Worker 以 Transferable 回传，主线程不再为它做拷贝。
 */
export interface VolumeHandle extends VolumeGeometry {
  readonly volumeId: string;
  readonly seriesInstanceUid: string;
  readonly scalarData: Uint8Array;
  /** 仅显示与定位，严禁测量（ARCHITECTURE §5.2） */
  readonly displayOnly: true;
}
