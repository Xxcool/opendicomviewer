import { describe, expect, it } from 'vitest';
import type { ImagePlane } from '../domain/types';
import { rawToHU } from '../pipeline/lut';
import { sortByPosition } from '../pipeline/sort';

const AXIAL_IOP: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];

function createPlane(z: number, instance?: number): ImagePlane {
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
  };
}

describe('P0 验证：真实源码导入与排序算法', () => {
  it('R3：严禁用 InstanceNumber 排序，必须以 IPP 沿法向投影物理坐标为准', () => {
    const planes = [
      createPlane(30, 999),
      createPlane(10, 100),
      createPlane(20, 5),
    ];

    const result = sortByPosition(planes);
    expect(result.sortedPlanes.map((p) => p.imagePositionPatient[2])).toEqual([10, 20, 30]);
  });

  it('R7：缺层检测当相邻层间距 > 1.5 倍中位数时必须产生告警', () => {
    const planes = [
      createPlane(0, 1),
      createPlane(2, 2),
      createPlane(4, 3),
      // 缺层：4 -> 10 (gap 6 > 1.5 * 2)
      createPlane(10, 4),
      createPlane(12, 5),
    ];

    const result = sortByPosition(planes);
    expect(result.warnings.some((w) => w.code === 'SLICE_GAP')).toBe(true);
  });

  it('5.2 灰度换算：基础线性 Rescale 计算', () => {
    expect(rawToHU(1024, 1.0, -1024.0)).toBe(0);
    expect(rawToHU(24, 1.0, -1024.0)).toBe(-1000);
    expect(rawToHU(1524, 1.0, -1024.0)).toBe(500);
  });
});
