import { describe, expect, it } from 'vitest';
import type { ImagePlane, ModalityLUT } from '../domain/types';
import {
  CT_WINDOW_PRESETS,
  mapHUToUint8,
  rangeToVOI,
  rawToHU,
  voiToRange,
} from '../pipeline/lut';
import { computeNormal, sortByPosition } from '../pipeline/sort';
import { assertPhantomHU } from '../testing/phantom';

const AXIAL_IOP: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];
const SAGITTAL_IOP: [number, number, number, number, number, number] = [0, 1, 0, 0, 0, -1];

function createPlane(
  z: number,
  instance?: number,
  options?: Partial<ImagePlane>,
): ImagePlane {
  return {
    imageId: `slice-z${z}`,
    sopInstanceUid: `1.2.840.10008.5.1.4.1.1.2.${z}`,
    instanceNumber: instance,
    imagePositionPatient: [0, 0, z],
    imageOrientationPatient: AXIAL_IOP,
    pixelSpacing: [0.7, 0.7],
    sliceThickness: 2.0,
    spacingBetweenSlices: 2.0,
    rows: 512,
    columns: 512,
    ...options,
  };
}

describe('sortByPosition 几何与层序排序', () => {
  it('R3：严禁用 InstanceNumber 排序，必须以 IPP 沿法向投影物理坐标为准', () => {
    // 模拟 InstanceNumber 颠倒混乱，基准层厚 10mm
    const planes = [
      createPlane(30, 999, { sliceThickness: 10, spacingBetweenSlices: 10 }),
      createPlane(10, 100, { sliceThickness: 10, spacingBetweenSlices: 10 }),
      createPlane(20, 5,   { sliceThickness: 10, spacingBetweenSlices: 10 }),
    ];

    const result = sortByPosition(planes);
    expect(result.sortedPlanes.map((p) => p.imagePositionPatient[2])).toEqual([10, 20, 30]);
    expect(result.warnings).toHaveLength(0);
  });

  it('R7 & S4：中位距为 0（重复切片）时仍必须产生 DUPLICATE_SLICE 告警，严禁静默跳过缺层检测', () => {
    const planes = [
      createPlane(0, 1),
      createPlane(0, 2),
      createPlane(0, 3),
    ];

    const result = sortByPosition(planes);
    expect(result.warnings.some((w) => w.code === 'DUPLICATE_SLICE')).toBe(true);
  });

  it('S4：双向判定缺层（SLICE_GAP）与偏窄层距（IRREGULAR_SPACING）', () => {
    const planes = [
      createPlane(0, 1),
      createPlane(2, 2),
      createPlane(4, 3),
      // 缺层：4 -> 10 (gap 6 mm > 1.5 * 2)
      createPlane(10, 4),
      createPlane(12, 5),
      // 偏窄：12 -> 13 (gap 1 mm < 0.7 * 2)
      createPlane(13, 6),
      createPlane(15, 7),
    ];

    const result = sortByPosition(planes);
    expect(result.warnings.some((w) => w.code === 'SLICE_GAP')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'IRREGULAR_SPACING')).toBe(true);
  });

  it('S5：朝向不一致切片应被剔除至 excludedPlanes，不可混排进入主序列', () => {
    const sagittalPlane = createPlane(5, 99, {
      imageOrientationPatient: SAGITTAL_IOP,
    });
    const planes = [createPlane(0, 1), createPlane(2, 2), sagittalPlane];

    const result = sortByPosition(planes);
    expect(result.sortedPlanes).toHaveLength(2);
    expect(result.excludedPlanes).toHaveLength(1);
    expect(result.excludedPlanes[0]?.imageId).toBe(sagittalPlane.imageId);

    const mismatchWarn = result.warnings.find((w) => w.code === 'ORIENTATION_MISMATCH');
    expect(mismatchWarn).toBeDefined();
    expect(mismatchWarn?.severity).toBe('error');
  });

  it('S6：非轴对齐与机架倾斜应产生 NON_AXIAL_ORIENTATION 告警', () => {
    // 倾斜 30 度角
    const cos30 = Math.cos(Math.PI / 6);
    const sin30 = Math.sin(Math.PI / 6);
    const tiltedNormal = computeNormal([1, 0, 0, 0, cos30, sin30]);
    expect(Math.abs(tiltedNormal[2])).toBeLessThan(0.999);

    const tiltedPlane = createPlane(0, 1, {
      imageOrientationPatient: [1, 0, 0, 0, cos30, sin30],
    });
    const result = sortByPosition([tiltedPlane, createPlane(2, 2, {
      imageOrientationPatient: [1, 0, 0, 0, cos30, sin30],
    })]);

    expect(result.warnings.some((w) => w.code === 'NON_AXIAL_ORIENTATION')).toBe(true);
  });
});

describe('lut.ts 灰度换算与 DICOM PS3.3 C.11.2.1.2 VOI 映射', () => {
  it('S1 Golden Test：脑窗 (ww=80, wc=40) 严格对齐 DICOM 标准公式（HU=79 必须映射为 255）', () => {
    const brain = CT_WINDOW_PRESETS.BRAIN;
    const bounds = voiToRange(brain);
    // 标准下界：40 - 0.5 - (80 - 1) / 2 = 39.5 - 39.5 = 0
    // 标准上界：40 - 0.5 + (80 - 1) / 2 = 39.5 + 39.5 = 79
    expect(bounds.lower).toBe(0);
    expect(bounds.upper).toBe(79);

    // 边界值映射验证
    expect(mapHUToUint8(-10, brain)).toBe(0);
    expect(mapHUToUint8(0, brain)).toBe(0);
    // 标准公式：((40 - 39.5) / 79 + 0.5) * 255 = 129.11 -> 129
    expect(mapHUToUint8(40, brain)).toBe(129);
    // 关键回归断言：HU=79 是标准上限，必须精确映射为 255（旧公式会算出 252 产生 3 阶偏差）
    expect(mapHUToUint8(79, brain)).toBe(255);
    expect(mapHUToUint8(80, brain)).toBe(255);

    // 逆推窗宽窗位验证
    const inverted = rangeToVOI(bounds.lower, bounds.upper);
    expect(inverted.windowWidth).toBe(80);
    expect(inverted.windowCenter).toBe(40);
  });

  it('S2：ModalityLUTSequence 存在时优先查表，缺失时回退线性 Rescale', () => {
    const sampleLUT: ModalityLUT = {
      firstMappedPixelValue: 100,
      bitsStored: 12,
      lutData: [500, 600, 700, 800, 900],
    };

    // 优先查表：输入 102 对应 offset 2 -> 700
    expect(rawToHU(102, 1.0, 0.0, sampleLUT)).toBe(700);
    // 下限裁剪：输入 50 对应 offset < 0 -> 500
    expect(rawToHU(50, 1.0, 0.0, sampleLUT)).toBe(500);
    // 上限裁剪：输入 200 对应 offset >= 5 -> 900
    expect(rawToHU(200, 1.0, 0.0, sampleLUT)).toBe(900);

    // 无 LUT 时回退 Rescale
    expect(rawToHU(1024, 1.0, -1024.0)).toBe(0);
  });

  it('S3：MONOCHROME1 灰阶高值显黑反转处理', () => {
    const brain = CT_WINDOW_PRESETS.BRAIN;
    // MONOCHROME2 默认：HU=0 -> 0; HU=79 -> 255; HU=40 -> 129
    expect(mapHUToUint8(0, brain, 'MONOCHROME2')).toBe(0);
    expect(mapHUToUint8(79, brain, 'MONOCHROME2')).toBe(255);
    expect(mapHUToUint8(40, brain, 'MONOCHROME2')).toBe(129);

    // MONOCHROME1 反转：HU=0 -> 255; HU=79 -> 0; HU=40 -> 255 - 129 = 126
    expect(mapHUToUint8(0, brain, 'MONOCHROME1')).toBe(255);
    expect(mapHUToUint8(79, brain, 'MONOCHROME1')).toBe(0);
    expect(mapHUToUint8(40, brain, 'MONOCHROME1')).toBe(126);
  });

  it('GEMINI.md 5.2：CT Phantom 物理密度基准断言（水/空气/骨）', () => {
    const water = rawToHU(1024, 1.0, -1024.0);
    const air = rawToHU(24, 1.0, -1024.0);
    const bone = rawToHU(1524, 1.0, -1024.0);

    expect(water).toBe(0);
    expect(air).toBe(-1000);
    expect(bone).toBe(500);

    const assertion = assertPhantomHU(water, air, bone);
    expect(assertion.pass).toBe(true);
    expect(assertion.reasons).toHaveLength(0);
  });
});
