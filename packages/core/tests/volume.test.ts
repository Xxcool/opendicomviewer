import { describe, expect, it } from 'vitest';
import type { ImagePlane, PixelFrame, SeriesMeta } from '../domain/types';
import { computeNormal } from '../pipeline/sort';
import {
  CT_VOLUME_WINDOW,
  MAX_VOLUME_TILT_DEG,
  VolumeSampler,
  buildVolumeScalarData,
  planVolumeDownsample,
  resolveVolumeWindow,
} from '../volume/downsample';

const AXIAL_IOP: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];

interface MetaOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly slices?: number;
  readonly spacing?: [number, number, number];
  readonly iop?: [number, number, number, number, number, number];
  readonly modality?: SeriesMeta['modality'];
  readonly planeOverrides?: Partial<ImagePlane>;
  readonly metaOverrides?: Partial<SeriesMeta>;
}

function createMeta(options: MetaOptions = {}): SeriesMeta {
  const {
    columns = 512,
    rows = 512,
    slices = 3,
    spacing = [0.7, 0.7, 1.0],
    iop = AXIAL_IOP,
    modality = 'CT',
    planeOverrides,
    metaOverrides,
  } = options;

  const normal = computeNormal(iop);
  const planes: ImagePlane[] = Array.from({ length: slices }, (_, i) => ({
    imageId: `slice-${i}`,
    sopInstanceUid: `1.2.840.10008.5.1.4.1.1.2.${i}`,
    imagePositionPatient: [
      normal[0] * i * spacing[2], normal[1] * i * spacing[2], normal[2] * i * spacing[2],
    ],
    imageOrientationPatient: iop,
    pixelSpacing: [spacing[0], spacing[1]],
    sliceThickness: spacing[2],
    spacingBetweenSlices: spacing[2],
    rows,
    columns,
    ...planeOverrides,
  }));

  return {
    seriesInstanceUid: '1.2.3.4',
    studyInstanceUid: '1.2.3',
    seriesDescription: 'test',
    modality,
    numberOfFrames: slices,
    planes,
    spacing,
    warnings: [],
    ...metaOverrides,
  };
}

function createFrame(values: number[], width: number, height: number): PixelFrame {
  return {
    width,
    height,
    pixelData: Int16Array.from(values),
    rescaleSlope: 1,
    rescaleIntercept: 0,
  };
}

describe('planVolumeDownsample 几何规划', () => {
  it.each([
    { imageType: ['ORIGINAL', 'PRIMARY', 'LOCALIZER'] },
    { sopClassUid: '1.2.840.10008.5.1.4.1.1.7' },
  ])('几何完整且数量足够的定位像/SC 仍不能冒充断层体积：%j', planeOverrides => {
    const result = planVolumeDownsample(createMeta({ slices: 3, planeOverrides }));
    expect(result).toMatchObject({ ok: false, code: 'NON_VOLUMETRIC_SERIES' });
  });

  it('512×512×300 按整数因子 2 降采样到 256×256×150，间距同比放大', () => {
    const meta = createMeta({ slices: 300, spacing: [0.7, 0.7, 2.0] });
    const result = planVolumeDownsample(meta);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.factors).toEqual([2, 2, 2]);
    expect(result.plan.dimensions).toEqual([256, 256, 150]);
    expect(result.plan.sourceDimensions).toEqual([512, 512, 300]);
    expect(result.plan.spacing[0]).toBeCloseTo(1.4, 6);
    expect(result.plan.spacing[1]).toBeCloseTo(1.4, 6);
    expect(result.plan.spacing[2]).toBeCloseTo(4.0, 6);
    expect(result.plan.usedSourceSlices).toBe(300);
    expect(result.plan.byteLength).toBe(256 * 256 * 150);
  });

  it('origin 按块中心修正：各轴偏移 (factor-1)/2 个体素', () => {
    const meta = createMeta({ slices: 300, spacing: [0.5, 0.5, 3] });
    const result = planVolumeDownsample(meta);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 三轴 factors 均为 2：x/y 偏移 0.5 × 0.5 = 0.25 mm，z 偏移 0.5 × 3 = 1.5 mm
    expect(result.plan.origin[0]).toBeCloseTo(0.25, 6);
    expect(result.plan.origin[1]).toBeCloseTo(0.25, 6);
    expect(result.plan.origin[2]).toBeCloseTo(1.5, 6);
  });

  it('方向矩阵保持 [行方向, 列方向, 法向] 三轴顺序', () => {
    const meta = createMeta();
    const result = planVolumeDownsample(meta);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('大矩阵按维度独立裁剪，任意轴不超过上限', () => {
    const meta = createMeta({ columns: 700, rows: 700, slices: 1000, spacing: [0.3, 0.3, 0.5] });
    const result = planVolumeDownsample(meta, { maxDim: 256 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const dim of result.plan.dimensions) {
      expect(dim).toBeLessThanOrEqual(256);
      expect(dim).toBeGreaterThan(0);
    }
    expect(result.plan.factors).toEqual([3, 3, 4]);
    expect(result.plan.usedSourceSlices).toBe(1000);
    expect(result.plan.voxelCount).toBe(
      result.plan.dimensions[0] * result.plan.dimensions[1] * result.plan.dimensions[2],
    );
  });

  it('10° 摆位倾斜仍然接受（与排序告警的 info 阈值一致）', () => {
    const tilt = (10 * Math.PI) / 180;
    const iop: [number, number, number, number, number, number] = [
      1, 0, 0, 0, Math.cos(tilt), Math.sin(tilt),
    ];
    const result = planVolumeDownsample(createMeta({ slices: 5, iop }));
    expect(result.ok).toBe(true);
  });

  it('超过 15° 的斜位采集显式拒绝并给出中文原因', () => {
    const tilt = (30 * Math.PI) / 180;
    const iop: [number, number, number, number, number, number] = [
      1, 0, 0, 0, Math.cos(tilt), Math.sin(tilt),
    ];
    const result = planVolumeDownsample(createMeta({ slices: 5, iop }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('OBLIQUE_ORIENTATION');
    expect(result.message).toContain('斜位');
    expect(MAX_VOLUME_TILT_DEG).toBe(15);
  });

  it('缺失空间几何必须拒绝，禁止静默降级', () => {
    const meta = createMeta({ slices: 5, planeOverrides: { hasMissingGeometry: true } });
    const result = planVolumeDownsample(meta);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_GEOMETRY');
  });

  it('少于 3 层无法构建多平面重建', () => {
    const result = planVolumeDownsample(createMeta({ slices: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INSUFFICIENT_SLICES');
  });

  it('层间距非正数时拒绝', () => {
    const result = planVolumeDownsample(createMeta({ slices: 5, spacing: [0.7, 0.7, 0] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_SPACING');
  });

  it.each([
    ['缺层', [[0, 0, 0], [0, 0, 1], [0, 0, 3]]],
    ['重叠层', [[0, 0, 0], [0, 0, 1], [0, 0, 1.25]]],
    ['平面偏移', [[0, 0, 0], [0.2, 0, 1], [0.4, 0, 2]]],
  ] as const)('%s 不能按均匀网格静默构建', (_, positions) => {
    const meta = createMeta();
    const planes = meta.planes.map((plane, i): ImagePlane => ({
      ...plane,
      imagePositionPatient: [...positions[i]!],
    }));
    const result = planVolumeDownsample({ ...meta, planes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_SPACING');
    expect(result.message).toContain('原始切片');
  });

  it('逐层像素间距不同不能共用首层的几何', () => {
    const meta = createMeta();
    const planes = meta.planes.map((plane, i): ImagePlane => ({
      ...plane,
      pixelSpacing: i === 1 ? [0.5, 0.5] : plane.pixelSpacing,
    }));
    const result = planVolumeDownsample({ ...meta, planes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_SPACING');
  });

  it('法向相同但平面内翻转的切片不能共用同一方向矩阵', () => {
    const meta = createMeta();
    const planes = meta.planes.map((plane, i): ImagePlane => ({
      ...plane,
      imageOrientationPatient: i === 1 ? [-1, 0, 0, 0, -1, 0] : AXIAL_IOP,
    }));
    const result = planVolumeDownsample({ ...meta, planes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_ORIENTATION');
  });

  it('位置含非有限值必须拒绝', () => {
    const meta = createMeta({ planeOverrides: { imagePositionPatient: [NaN, 0, 0] } });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_GEOMETRY');
  });

  it('允许坐标写入时亚微米级的舍入误差', () => {
    const meta = createMeta();
    const planes = meta.planes.map((plane, i): ImagePlane => ({
      ...plane,
      imagePositionPatient: [0, 0, i + (i === 1 ? 0.0002 : 0)],
    }));
    expect(planVolumeDownsample({ ...meta, planes }).ok).toBe(true);
  });

  it('规则序列使用真实 IPP 层距，不能沿用分桶舍入后的间距', () => {
    const meta = createMeta({ spacing: [0.7, 0.7, 0.78], metaOverrides: { spacing: [0.7, 0.7, 0.8] } });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.spacing[2]).toBeCloseTo(0.78, 8);
  });
});

describe('resolveVolumeWindow 固定映射区间', () => {
  it('非 CT 切片自带窗宽窗位时按其上下限', () => {
    const meta = createMeta({
      modality: 'MR',
      planeOverrides: { windowWidth: 100, windowCenter: 50 },
    });
    const win = resolveVolumeWindow(meta);
    // DICOM 线性 VOI：lower = 50 - 0.5 - 49.5 = 0，upper = 99
    expect(win.lower).toBeCloseTo(0, 6);
    expect(win.upper).toBeCloseTo(99, 6);
  });

  it('CT 无窗口信息时退回固定 -1024 ~ 3071', () => {
    expect(resolveVolumeWindow(createMeta())).toEqual(CT_VOLUME_WINDOW);
  });

  it('CT 即使带有窄窗也使用固定体积区间，保留窗外组织信息', () => {
    expect(resolveVolumeWindow(createMeta({
      planeOverrides: { windowWidth: 100, windowCenter: 50 },
    }))).toEqual(CT_VOLUME_WINDOW);
  });

  it('非 CT 无窗口信息时按存储位深与 Rescale 推全量程', () => {
    const meta = createMeta({
      modality: 'MR',
      planeOverrides: { bitsStored: 12, pixelRepresentation: 0 },
    });
    const win = resolveVolumeWindow(meta);
    expect(win.lower).toBe(0);
    expect(win.upper).toBe(4095);
  });
});

describe('VolumeSampler 块平均降采样', () => {
  it('二维块和多层同时平均时，各输出体素对应正确的原始区域', () => {
    const planned = planVolumeDownsample(createMeta({
      rows: 4, columns: 4, slices: 4, spacing: [1, 1, 1],
    }), { maxDim: 2 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const frames = [0, 16, 32, 48].map((offset) =>
      createFrame(Array.from({ length: 16 }, (_, i) => i + offset), 4, 4),
    );
    expect(Array.from(buildVolumeScalarData(planned.plan, { lower: 0, upper: 255 }, frames)))
      .toEqual([11, 13, 19, 21, 43, 45, 51, 53]);
  });

  it('跨多行采样时 RescaleIntercept 每个体素只应用一次', () => {
    const planned = planVolumeDownsample(createMeta({
      rows: 2, columns: 2, slices: 3, spacing: [1, 1, 1],
    }), { maxDim: 1 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const frames = Array.from({ length: 3 }, () => ({
      ...createFrame([100, 100, 100, 100], 2, 2),
      rescaleSlope: 2, rescaleIntercept: -100,
    }));
    expect(Array.from(buildVolumeScalarData(planned.plan, { lower: 0, upper: 255 }, frames)))
      .toEqual([100]);
  });

  it('非线性 Modality LUT 必须逐像素查表再平均，不用小数均值查表', () => {
    const planned = planVolumeDownsample(createMeta({
      rows: 2, columns: 2, slices: 3, spacing: [1, 1, 1],
    }), { maxDim: 1 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const frames = Array.from({ length: 3 }, () => ({
      ...createFrame([0, 2, 0, 2], 2, 2),
      modalityLUT: { firstMappedPixelValue: 0, bitsStored: 16, lutData: new Uint16Array([0, 20, 200]) },
    }));
    expect(Array.from(buildVolumeScalarData(planned.plan, { lower: 0, upper: 255 }, frames)))
      .toEqual([100]);
  });

  it('沿 x 与 z 做块平均，输出按 x 最快、z 最慢排列', () => {
    const meta = createMeta({
      columns: 4,
      rows: 2,
      slices: 4,
      spacing: [1, 1, 1],
      planeOverrides: { bitsStored: 8 },
    });
    const result = planVolumeDownsample(meta, { maxDim: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.factors).toEqual([2, 1, 2]);
    expect(result.plan.dimensions).toEqual([2, 2, 2]);

    const base = [0, 1, 2, 3, 10, 11, 12, 13];
    const frames = [0, 50, 100, 150].map((offset) =>
      createFrame(
        base.map((v) => v + offset),
        4,
        2,
      ),
    );

    const data = buildVolumeScalarData(result.plan, { lower: 0, upper: 255 }, frames);
    expect(data.length).toBe(8);
    // z=0 为 frame0/1 的块均值（25.5 / 27.5 / 35.5 / 37.5），z=1 为 frame2/3
    expect(Array.from(data)).toEqual([26, 28, 36, 38, 126, 128, 136, 138]);
  });

  it('映射区间外的 HU 被裁剪到 0 / 255', () => {
    const meta = createMeta({ columns: 2, rows: 2, slices: 3, spacing: [1, 1, 1] });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const frames = [
      createFrame([1000, 1000, 1000, 1000], 2, 2),
      createFrame([-50, -50, -50, -50], 2, 2),
      createFrame([50, 50, 50, 50], 2, 2),
    ];
    const data = buildVolumeScalarData(result.plan, { lower: 0, upper: 100 }, frames);
    expect(data[0]).toBe(255);
    expect(data[4]).toBe(0);
    expect(data[8]).toBe(Math.round((50 / 100) * 255));
  });

  it('线性 Rescale 在块平均后统一应用', () => {
    const meta = createMeta({ columns: 2, rows: 2, slices: 3, spacing: [1, 1, 1] });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const frame = createFrame([0, 0, 0, 0], 2, 2);
    const frames = [
      { ...frame, rescaleSlope: 2, rescaleIntercept: -100 },
      { ...frame, rescaleSlope: 2, rescaleIntercept: -100 },
      { ...frame, rescaleSlope: 2, rescaleIntercept: -100 },
    ];
    const data = buildVolumeScalarData(result.plan, { lower: -100, upper: 155 }, frames);
    // HU = 0 × 2 − 100 = −100 → 下限 0
    expect(data[0]).toBe(0);
  });

  it('增量喂入的层数超出方案时显式报错', () => {
    const meta = createMeta({ columns: 2, rows: 2, slices: 3 });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sampler = new VolumeSampler(result.plan, { lower: 0, upper: 100 });
    for (let i = 0; i < result.plan.usedSourceSlices; i++) {
      sampler.addSlice(createFrame([1, 1, 1, 1], 2, 2));
    }
    expect(() => sampler.addSlice(createFrame([1, 1, 1, 1], 2, 2))).toThrow(/不能再追加/);
    expect(sampler.finish().length).toBe(result.plan.voxelCount);
  });

  it('未喂满全部层就 finish 必须报错，不能静默返回半成品', () => {
    const meta = createMeta({ columns: 2, rows: 2, slices: 3 });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sampler = new VolumeSampler(result.plan, { lower: 0, upper: 100 });
    sampler.addSlice(createFrame([1, 1, 1, 1], 2, 2));
    expect(() => sampler.finish()).toThrow(/不完整/);
  });

  it('切片矩阵与序列几何不一致时拒绝', () => {
    const meta = createMeta({ columns: 2, rows: 2, slices: 3 });
    const result = planVolumeDownsample(meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sampler = new VolumeSampler(result.plan, { lower: 0, upper: 100 });
    expect(() => sampler.addSlice(createFrame([1, 1, 1, 1], 4, 4))).toThrow(/不一致/);
  });
});
