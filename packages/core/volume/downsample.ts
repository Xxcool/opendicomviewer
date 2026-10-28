/**
 * 降采样 Volume 几何规划与体素采样（P1 数据通路）
 *
 * 遵循 ARCHITECTURE §5.2 双精度渲染路径：
 * - 全分辨率 Stack 是唯一测量真源；
 * - 本模块产出的 8-bit Volume 只做显示与定位，`VolumeHandle.displayOnly` 恒为 true。
 *
 * 遵循 R6：纯 TS，无 DOM / Worker / CS3D 依赖。
 * 遵循 R7：几何不合格时显式拒绝并给出可直接展示的中文原因，绝不静默降级。
 */

import type { PixelFrame, SeriesMeta } from '../domain/types';
import { rawToHU, voiToRange } from '../pipeline/lut';
import { computeNormal } from '../pipeline/sort';
import type { Vec3 } from '../pipeline/vector3';
import type {
  DirectionMatrix,
  VolumeDimensions,
  VolumeDownsamplePlan,
  VolumeRejectCode,
  VolumeWindow,
} from './types';

/** 单轴体素上限，超过则按整数因子降采样（ARCHITECTURE §5.2 的 256³ 口径） */
export const VOLUME_MAX_DIM = 256;

/** 超过该倾角的序列拒绝构建体积（与 sort 的 NON_AXIAL_ORIENTATION warning 阈值一致） */
export const MAX_VOLUME_TILT_DEG = 15;

/** 少于该层数的序列无法给出有意义的多平面重建 */
export const MIN_VOLUME_SLICES = 3;

/** 无窗口信息时的 CT 默认映射区间（固定区间，避免 MPR 观感随调窗跳变） */
export const CT_VOLUME_WINDOW: VolumeWindow = { lower: -1024, upper: 3071 };

export type VolumePlanResult =
  | { readonly ok: true; readonly plan: VolumeDownsamplePlan }
  | {
      readonly ok: false;
      readonly code: VolumeRejectCode;
      readonly message: string;
    };

export interface VolumePlanOptions {
  /** 单轴体素上限，默认 256 */
  readonly maxDim?: number;
  /** 允许的最大倾斜角（度），默认 15 */
  readonly maxTiltDeg?: number;
}

function reject(code: VolumeRejectCode, message: string): VolumePlanResult {
  return { ok: false, code, message };
}

function isFiniteVec(v: Vec3): boolean {
  return v.every((n) => Number.isFinite(n));
}

/** 最小整数因子，使 floor(size / factor) <= maxDim */
function axisFactor(size: number, maxDim: number): number {
  if (!Number.isFinite(size) || size <= 0) return 1;
  return Math.max(1, Math.ceil(size / maxDim));
}

/**
 * 由序列元数据计算降采样方案（不触碰像素数据）。
 *
 * 轴向约定与 CS3D 一致：
 * x = columns（沿行方向余弦增长），y = rows（沿列方向余弦增长），z = slices。
 */
export function planVolumeDownsample(
  meta: SeriesMeta,
  options: VolumePlanOptions = {},
): VolumePlanResult {
  const maxDim = Math.max(1, Math.floor(options.maxDim ?? VOLUME_MAX_DIM));
  const maxTiltDeg = options.maxTiltDeg ?? MAX_VOLUME_TILT_DEG;
  const planeCount = meta.planes.length;

  if (planeCount < MIN_VOLUME_SLICES) {
    return reject(
      'INSUFFICIENT_SLICES',
      `序列仅 ${planeCount} 层，至少需要 ${MIN_VOLUME_SLICES} 层才能构建多平面重建体积`,
    );
  }

  const first = meta.planes[0];
  if (!first) {
    return reject('INSUFFICIENT_SLICES', '序列不含任何切片，无法构建体积');
  }

  if (meta.planes.some((p) => p.hasMissingGeometry)) {
    return reject(
      'MISSING_GEOMETRY',
      '切片缺失物理坐标 (0020,0032) 或朝向 (0020,0037)，无法构建三维体积',
    );
  }

  if (first.columns <= 0 || first.rows <= 0) {
    return reject(
      'INVALID_ORIENTATION',
      `切片矩阵尺寸无效（${first.columns}×${first.rows}），无法构建体积`,
    );
  }

  const [rowSpacing, colSpacing, sliceSpacing] = meta.spacing;
  if (![rowSpacing, colSpacing, sliceSpacing].every((v) => Number.isFinite(v) && v > 0)) {
    return reject(
      'INVALID_SPACING',
      `序列间距无效（行 ${rowSpacing} / 列 ${colSpacing} / 层 ${sliceSpacing} mm），无法构建体积`,
    );
  }

  const iop = first.imageOrientationPatient;
  const rowDir: Vec3 = [iop[0], iop[1], iop[2]];
  const colDir: Vec3 = [iop[3], iop[4], iop[5]];
  const normal = computeNormal(iop);

  if (!isFiniteVec(rowDir) || !isFiniteVec(colDir) || !isFiniteVec(normal)) {
    return reject('INVALID_ORIENTATION', '切片朝向包含非有限数值 (0020,0037)，无法构建体积');
  }

  const maxAxisAlignment = Math.max(
    Math.abs(normal[0]),
    Math.abs(normal[1]),
    Math.abs(normal[2]),
  );
  if (maxAxisAlignment < 1e-6) {
    return reject('INVALID_ORIENTATION', '行方向与列方向余弦平行，无法确定层法向 (0020,0037)');
  }

  const tiltDeg = (Math.acos(Math.min(1, maxAxisAlignment)) * 180) / Math.PI;
  if (tiltDeg > maxTiltDeg) {
    return reject(
      'OBLIQUE_ORIENTATION',
      `采集方向偏离标准轴位 ${tiltDeg.toFixed(1)}°（上限 ${maxTiltDeg}°），暂不支持斜位多平面重建`,
    );
  }

  const sourceDimensions: VolumeDimensions = [
    first.columns,
    first.rows,
    planeCount,
  ];

  const factors: VolumeDimensions = [
    axisFactor(sourceDimensions[0], maxDim),
    axisFactor(sourceDimensions[1], maxDim),
    axisFactor(sourceDimensions[2], maxDim),
  ];

  const dimensions: VolumeDimensions = [
    Math.max(1, Math.floor(sourceDimensions[0] / factors[0])),
    Math.max(1, Math.floor(sourceDimensions[1] / factors[1])),
    Math.max(1, Math.floor(sourceDimensions[2] / factors[2])),
  ];

  const sourceSpacing: Vec3 = [colSpacing, rowSpacing, sliceSpacing];
  const spacing: Vec3 = [
    colSpacing * factors[0],
    rowSpacing * factors[1],
    sliceSpacing * factors[2],
  ];

  // 块平均后新体素中心落在原块中心，原点头需沿三轴各偏移 (factor - 1) / 2 个体素，
  // 否则体积会整体向负方向漂移半个降采样步长，准星定位随之偏移。
  const origin = first.imagePositionPatient;
  const half = (f: number): number => (f - 1) / 2;
  const shiftedOrigin: Vec3 = [
    origin[0] +
      rowDir[0] * half(factors[0]) * colSpacing +
      colDir[0] * half(factors[1]) * rowSpacing +
      normal[0] * half(factors[2]) * sliceSpacing,
    origin[1] +
      rowDir[1] * half(factors[0]) * colSpacing +
      colDir[1] * half(factors[1]) * rowSpacing +
      normal[1] * half(factors[2]) * sliceSpacing,
    origin[2] +
      rowDir[2] * half(factors[0]) * colSpacing +
      colDir[2] * half(factors[1]) * rowSpacing +
      normal[2] * half(factors[2]) * sliceSpacing,
  ];

  const direction: DirectionMatrix = [
    rowDir[0],
    rowDir[1],
    rowDir[2],
    colDir[0],
    colDir[1],
    colDir[2],
    normal[0],
    normal[1],
    normal[2],
  ];

  const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
  const usedSourceSlices = dimensions[2] * factors[2];

  return {
    ok: true,
    plan: {
      dimensions,
      spacing,
      origin: shiftedOrigin,
      direction,
      factors,
      sourceDimensions,
      sourceSpacing,
      usedSourceSlices,
      voxelCount,
      byteLength: voxelCount,
    },
  };
}

/**
 * 解析体积的 8-bit 固定映射区间（HU 口径）。
 *
 * 优先级：切片自带 WindowCenter/Width → CT 固定区间 → 按存储位深与 Rescale 推全量程。
 * 一旦确定就不再随用户调窗变化，MPR 观感才不会跳。
 */
export function resolveVolumeWindow(meta: SeriesMeta): VolumeWindow {
  const first = meta.planes[0];
  if (
    first &&
    first.windowWidth !== undefined &&
    first.windowWidth > 0 &&
    first.windowCenter !== undefined
  ) {
    const bounds = voiToRange({
      windowWidth: first.windowWidth,
      windowCenter: first.windowCenter,
    });
    return { lower: bounds.lower, upper: bounds.upper };
  }

  if (meta.modality === 'CT') {
    return CT_VOLUME_WINDOW;
  }

  const bits = first?.bitsStored ?? first?.bitsAllocated ?? 16;
  const signed = first?.pixelRepresentation === 1;
  const maxRaw = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  const minRaw = signed ? -(2 ** (bits - 1)) : 0;
  const slope = first?.rescaleSlope ?? 1;
  const intercept = first?.rescaleIntercept ?? 0;
  const lut = first?.modalityLUT;

  const lower = rawToHU(minRaw, slope, intercept, lut);
  const upper = rawToHU(maxRaw, slope, intercept, lut);
  if (!(upper > lower)) {
    return { lower, upper: lower + 1 };
  }
  return { lower, upper };
}

/**
 * 增量式体积采样器：逐层喂入原始帧，按块平均降采样并映射为 8-bit。
 *
 * 为什么增量而不是一次性吃全部帧：512×512×1000 的原始像素约 512 MB，
 * 一次性结构化克隆进 Worker 会直接击穿内存预算（ARCHITECTURE §5.1）。
 * 调用方按层/小批喂入，Worker 只保留一个降采样输出缓冲（256³ ≈ 16.8 MB）。
 */
export class VolumeSampler {
  private readonly plan: VolumeDownsamplePlan;
  private readonly window: VolumeWindow;
  private readonly output: Uint8Array;
  private readonly sliceAcc: Float32Array;
  private readonly planeSize: number;
  private readonly blockSize: number;
  private blockSlices = 0;
  private outputZ = 0;
  private processed = 0;
  private finished = false;

  constructor(plan: VolumeDownsamplePlan, window: VolumeWindow) {
    if (!Number.isFinite(window.lower) || !Number.isFinite(window.upper) || !(window.upper > window.lower)) {
      throw new Error(
        `Volume 映射区间无效（lower ${window.lower} / upper ${window.upper}），必须满足 upper > lower`,
      );
    }
    this.plan = plan;
    this.window = window;
    this.planeSize = plan.dimensions[0] * plan.dimensions[1];
    this.blockSize = plan.factors[2];
    this.output = new Uint8Array(plan.voxelCount);
    this.sliceAcc = new Float32Array(this.planeSize);
  }

  get processedSlices(): number {
    return this.processed;
  }

  get expectedSlices(): number {
    return this.plan.usedSourceSlices;
  }

  /** 追加一帧原始切片（必须按层序连续调用） */
  addSlice(frame: PixelFrame): void {
    if (this.finished) {
      throw new Error('Volume 已构建完成，不能再追加切片');
    }
    if (this.processed >= this.plan.usedSourceSlices) {
      throw new Error(
        `已接收全部 ${this.plan.usedSourceSlices} 层，不能再追加切片`,
      );
    }

    const [dx, dy] = this.plan.dimensions;
    const [fx, fy] = this.plan.factors;
    const [srcX, srcY] = this.plan.sourceDimensions;

    if (frame.width !== srcX || frame.height !== srcY) {
      throw new Error(
        `切片矩阵 ${frame.width}×${frame.height} 与序列几何 ${srcX}×${srcY} 不一致`,
      );
    }

    const pixels = frame.pixelData;
    const slope = frame.rescaleSlope;
    const intercept = frame.rescaleIntercept;
    const lut = frame.modalityLUT;
    const inv = 1 / (fx * fy);
    const acc = this.sliceAcc;

    for (let oy = 0; oy < dy; oy++) {
      const outRow = oy * dx;
      for (let ky = 0; ky < fy; ky++) {
        const rowBase = (oy * fy + ky) * srcX;
        for (let ox = 0; ox < dx; ox++) {
          const base = rowBase + ox * fx;
          let sum = 0;
          for (let kx = 0; kx < fx; kx++) {
            sum += pixels[base + kx]!;
          }
          const mean = sum * inv;
          const hu = lut
            ? rawToHU(mean, slope, intercept, lut)
            : mean * slope + intercept;
          const idx = outRow + ox;
          acc[idx] = (acc[idx] ?? 0) + hu;
        }
      }
    }

    this.processed += 1;
    this.blockSlices += 1;
    if (this.blockSlices === this.blockSize) {
      this.flushBlock();
    }
  }

  /** 全部层喂入后取回 8-bit 体素缓冲（Transferable 回主线程） */
  finish(): Uint8Array {
    if (this.finished) {
      throw new Error('Volume 已构建完成，不能重复 finish');
    }
    if (this.outputZ !== this.plan.dimensions[2] || this.blockSlices !== 0) {
      throw new Error(
        `Volume 构建不完整：期望 ${this.plan.usedSourceSlices} 层，实际 ${this.processed} 层`,
      );
    }
    this.finished = true;
    return this.output;
  }

  private flushBlock(): void {
    const { lower, upper } = this.window;
    const span = upper - lower;
    const inv = 1 / this.blockSize;
    const acc = this.sliceAcc;
    const out = this.output;
    const base = this.outputZ * this.planeSize;

    for (let i = 0; i < this.planeSize; i++) {
      const hu = (acc[i] ?? 0) * inv;
      const mapped = Math.round(((hu - lower) / span) * 255);
      out[base + i] = mapped < 0 ? 0 : mapped > 255 ? 255 : mapped;
      acc[i] = 0;
    }

    this.outputZ += 1;
    this.blockSlices = 0;
  }
}

/** 同步一次性构建（无 Worker 运行时，以及单测使用） */
export function buildVolumeScalarData(
  plan: VolumeDownsamplePlan,
  window: VolumeWindow,
  frames: readonly PixelFrame[],
): Uint8Array {
  if (frames.length !== plan.usedSourceSlices) {
    throw new Error(
      `切片数与方案不符：期望 ${plan.usedSourceSlices} 层，实际 ${frames.length} 层`,
    );
  }
  const sampler = new VolumeSampler(plan, window);
  for (const frame of frames) {
    sampler.addSlice(frame);
  }
  return sampler.finish();
}
