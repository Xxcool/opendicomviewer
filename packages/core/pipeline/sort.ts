/**
 * DICOM 序列内层序排序与几何校验
 *
 * 严格遵循红线 R3：序列排序禁止使用 InstanceNumber 作为主键！
 * 正确算法：基于 ImagePositionPatient 在法向向量上的投影距离进行排序。
 * 严格遵循红线 R7：缺层与几何异常必须显式冒泡告警，禁止静默处理。
 * 修复 B1: 类型收窄与边界保护，彻底杜绝 noUncheckedIndexedAccess 报错。
 */

import type { DataWarning, ImagePlane } from '../domain/types';
import { cross, dot, normalize } from './vector3';

export interface SortResult {
  readonly sortedPlanes: readonly ImagePlane[];
  readonly sliceDistances: readonly number[];
  readonly medianSpacing: number;
  readonly warnings: readonly DataWarning[];
}

export function computeNormal(
  iop: readonly [number, number, number, number, number, number],
): [number, number, number] {
  const rowDir: [number, number, number] = [iop[0], iop[1], iop[2]];
  const colDir: [number, number, number] = [iop[3], iop[4], iop[5]];
  return normalize(cross(rowDir, colDir));
}

/**
 * 计算一组数字的中位数
 */
export function computeMedian(numbers: readonly number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midVal = sorted[mid];
  if (sorted.length % 2 === 0) {
    const prevVal = sorted[mid - 1];
    if (prevVal !== undefined && midVal !== undefined) {
      return (prevVal + midVal) / 2;
    }
  }
  return midVal ?? 0;
}

interface ProjectablePlane {
  readonly plane: ImagePlane;
  readonly projection: number;
  readonly instance: number;
}

/**
 * 基于物理坐标投影对切片进行排序并进行缺层检测
 */
export function sortByPosition(planes: readonly ImagePlane[]): SortResult {
  const [firstPlane] = planes;
  if (!firstPlane) {
    return {
      sortedPlanes: [],
      sliceDistances: [],
      medianSpacing: 0,
      warnings: [],
    };
  }

  if (planes.length === 1) {
    const thickness = firstPlane.sliceThickness ?? firstPlane.spacingBetweenSlices ?? 1.0;
    return {
      sortedPlanes: [firstPlane],
      sliceDistances: [],
      medianSpacing: thickness,
      warnings: [],
    };
  }

  // 1. 基准法向量计算（取第一层）
  const baseNormal = computeNormal(firstPlane.imageOrientationPatient);
  const warnings: DataWarning[] = [];

  const projectables: ProjectablePlane[] = [];

  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    if (!plane) continue;

    const normal = computeNormal(plane.imageOrientationPatient);
    const alignment = Math.abs(dot(baseNormal, normal));

    // 方向余弦一致性检查：若法向量夹角偏差过大说明序列混合了不同朝向切片
    if (alignment < 0.95) {
      warnings.push({
        code: 'ORIENTATION_MISMATCH',
        message: `切片 #${plane.instanceNumber ?? i} 方向余弦与其他切片不一致（夹角余弦 ${alignment.toFixed(3)}），可能存在混合体位`,
        severity: 'warning',
        details: { instanceIndex: i },
      });
    }

    const proj = dot(plane.imagePositionPatient, baseNormal);
    projectables.push({
      plane,
      projection: proj,
      instance: plane.instanceNumber ?? i,
    });
  }

  // 3. 严格遵循 R3：按投影排序，仅在投影距离微小差别内以 instanceNumber 作为 tie-breaker
  projectables.sort((a, b) => {
    const diff = a.projection - b.projection;
    if (Math.abs(diff) > 1e-4) {
      return diff;
    }
    return a.instance - b.instance;
  });

  const sortedPlanes = projectables.map((item) => item.plane);

  // 4. 层间距计算与缺层（Gap）异常检测
  const sliceDistances: number[] = [];
  for (let i = 0; i < projectables.length - 1; i++) {
    const current = projectables[i];
    const next = projectables[i + 1];
    if (!current || !next) continue;
    const dist = Math.abs(next.projection - current.projection);
    sliceDistances.push(dist);
  }

  const medianSpacing = computeMedian(sliceDistances);

  if (medianSpacing > 1e-4) {
    for (let i = 0; i < sliceDistances.length; i++) {
      const dist = sliceDistances[i];
      if (dist === undefined) continue;
      // 缺层判定：相邻层距超过中位数的 1.5 倍（ARCHITECTURE.md 7.4）
      if (dist > 1.5 * medianSpacing) {
        warnings.push({
          code: 'SLICE_GAP',
          message: `切片第 ${i + 1} 层与第 ${i + 2} 层之间存在疑似缺层：间距为 ${dist.toFixed(2)} mm（序列中位间距 ${medianSpacing.toFixed(2)} mm）`,
          severity: 'warning',
          details: {
            indexBefore: i,
            indexAfter: i + 1,
            actualDistance: dist,
            medianSpacing,
          },
        });
      }
    }
  }

  return {
    sortedPlanes,
    sliceDistances,
    medianSpacing: medianSpacing > 0 ? medianSpacing : (firstPlane.sliceThickness ?? 1.0),
    warnings,
  };
}
