/**
 * DICOM 序列内层序排序与几何校验
 *
 * 严格遵循红线 R3：序列排序禁止使用 InstanceNumber 作为主键！
 * 正确算法：基于 ImagePositionPatient 在法向向量上的投影距离进行排序。
 * 严格遵循红线 R7：缺层与几何异常必须显式冒泡告警，禁止静默跳过。
 * 修复 B1: 类型收窄与边界保护，彻底杜绝 noUncheckedIndexedAccess 报错。
 * 修复 S4: 鲁棒缺层与异常层距检测（众数抗污染、元数据优先、重复层过滤、双向告警）。
 * 修复 S5: 朝向不一致切片主动剔除至 excludedPlanes 并报错。
 * 修复 S6: 机架倾斜与非轴对齐（Gantry Tilt / Oblique）探测。
 */

import type { DataWarning, ImagePlane } from '../domain/types';
import { cross, dot, normalize } from './vector3';
import { isNonVolumetricSeries } from './image-kind';

export interface SortResult {
  readonly sortedPlanes: readonly ImagePlane[];
  readonly excludedPlanes: readonly ImagePlane[];
  readonly sliceDistances: readonly number[];
  readonly expectedSpacing: number;
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
 * 规约法向至同轴向半球（首个非零绝对值分量非负），用于平行/反平行方向聚类
 */
export function canonicalNormal(n: [number, number, number]): [number, number, number] {
  if (
    n[0] < -1e-6 ||
    (Math.abs(n[0]) <= 1e-6 &&
      (n[1] < -1e-6 || (Math.abs(n[1]) <= 1e-6 && n[2] < -1e-6)))
  ) {
    return [-n[0], -n[1], -n[2]];
  }
  return [n[0], n[1], n[2]];
}

/**
 * 基于多数投票选择序列的主导基准朝向（S5 修复：防止异向切片排在首位时误剔除全部有效切片）
 */
export function pickDominantNormal(
  planes: readonly ImagePlane[],
): [number, number, number] {
  const [firstPlane] = planes;
  if (!firstPlane) {
    return [0, 0, 1];
  }

  const buckets = new Map<
    string,
    { count: number; rawNormal: [number, number, number] }
  >();

  for (const plane of planes) {
    const rawN = computeNormal(plane.imageOrientationPatient);
    const cN = canonicalNormal(rawN);
    const key = `${(Math.round(cN[0] * 1000) / 1000).toFixed(3)},${(Math.round(cN[1] * 1000) / 1000).toFixed(3)},${(Math.round(cN[2] * 1000) / 1000).toFixed(3)}`;
    const hit = buckets.get(key);
    if (hit) {
      hit.count += 1;
    } else {
      buckets.set(key, { count: 1, rawNormal: rawN });
    }
  }

  let best: { count: number; rawNormal: [number, number, number] } | undefined;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  return best?.rawNormal ?? computeNormal(firstPlane.imageOrientationPatient);
}

/**
 * 计算间距众数（按 0.1 mm 分桶，抗大面积缺层污染，S4）
 */
export function computeSpacingMode(numbers: readonly number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  const buckets = new Map<number, number>();
  let maxCount = 0;
  let mode = numbers[0] ?? 0;

  for (const num of numbers) {
    const bucket = Math.round(num * 10) / 10;
    const count = (buckets.get(bucket) ?? 0) + 1;
    buckets.set(bucket, count);
    if (count > maxCount) {
      maxCount = count;
      mode = bucket;
    }
  }
  return mode;
}

interface ProjectablePlane {
  readonly plane: ImagePlane;
  readonly projection: number;
  readonly instance: number;
}

/**
 * 基于物理坐标投影对切片进行排序与几何校验
 */
export function sortByPosition(planes: readonly ImagePlane[]): SortResult {
  // 定位像/SC 不是断层体积。保留全部原图，绝不拿占位 IOP 判断朝向冲突。
  // 只有二维导入顺序，不赋予层间距意义；MPR 规划会显式拒绝这类序列。
  if (isNonVolumetricSeries(planes)) {
    return {
      sortedPlanes: [...planes], excludedPlanes: [], sliceDistances: [], expectedSpacing: 1,
      warnings: [{ code: 'NON_VOLUMETRIC_SERIES', severity: 'info',
        message: `序列含定位像或二次采集图像，全部 ${planes.length} 帧按导入顺序二维浏览；不作为断层体积进行 MPR`,
      }],
    };
  }
  const [firstPlane] = planes;
  if (!firstPlane) {
    return {
      sortedPlanes: [],
      excludedPlanes: [],
      sliceDistances: [],
      expectedSpacing: 0,
      warnings: [],
    };
  }

  if (planes.length === 1) {
    const thickness = firstPlane.spacingBetweenSlices ?? firstPlane.sliceThickness ?? 1.0;
    const singleWarnings: DataWarning[] = [];
    if (firstPlane.hasMissingGeometry) {
      singleWarnings.push({
        code: 'MISSING_GEOMETRY',
        message: '检测到切片缺失物理坐标 (0020,0032) 或朝向 (0020,0037)，空间几何无效',
        severity: 'warning',
        details: { missingCount: 1 },
      });
    }
    return {
      sortedPlanes: [firstPlane],
      excludedPlanes: [],
      sliceDistances: [],
      expectedSpacing: thickness,
      warnings: singleWarnings,
    };
  }

  const warnings: DataWarning[] = [];

  // P1-5: 显式检测几何缺失切片，严禁假装正常排序并静默降级为 InstanceNumber
  const missingGeomCount = planes.filter((p) => p.hasMissingGeometry).length;
  if (missingGeomCount > 0) {
    warnings.push({
      code: 'MISSING_GEOMETRY',
      message: `检测到 ${missingGeomCount} 层切片缺失物理坐标 (0020,0032) 或朝向 (0020,0037)，空间几何无效`,
      severity: 'warning',
      details: { missingCount: missingGeomCount },
    });
  }

  const baseNormal = pickDominantNormal(planes);

  // S6: 检测机架倾斜或非标准轴对齐朝向 (Gantry Tilt / Oblique)
  const maxAxisAlignment = Math.max(
    Math.abs(baseNormal[0]),
    Math.abs(baseNormal[1]),
    Math.abs(baseNormal[2]),
  );
  // 按倾角分档（2026-10-28 调整）：
  // 真实 MR 常见 5–10° 的摆位/斜切，早期用 0.999（≈2.6°）一律报 warning，
  // 导致每份正常数据都挂一条"异常"，告警随即被用户忽略。
  // 现在：≤5° 不报；5–15° 记 info 并说明不影响轴向浏览；>15° 才是 warning。
  const tiltDeg = (Math.acos(Math.min(1, Math.max(0, maxAxisAlignment))) * 180) / Math.PI;
  if (tiltDeg > 5) {
    const severe = tiltDeg > 15;
    warnings.push({
      code: 'NON_AXIAL_ORIENTATION',
      message: severe
        ? `采集方向偏离标准轴位 ${tiltDeg.toFixed(1)}°，轴向浏览仍可用，但三维重建与多序列配准需要仿射变换`
        : `采集方向与标准轴位相差 ${tiltDeg.toFixed(1)}°（常见于摆位/斜切采集），不影响轴向浏览与测量`,
      severity: severe ? 'warning' : 'info',
      details: { maxAxisAlignment, tiltDeg: Number(tiltDeg.toFixed(2)) },
    });
  }

  const candidatePlanes: ProjectablePlane[] = [];
  const excludedPlanes: ImagePlane[] = [];

  // S5: 遍历切片，方向余弦不一致的切片予以剔除，绝不混排进入主序列
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    if (!plane) continue;

    const normal = computeNormal(plane.imageOrientationPatient);
    const alignment = Math.abs(dot(baseNormal, normal));

    if (alignment < 0.95) {
      excludedPlanes.push(plane);
      continue;
    }

    const proj = dot(plane.imagePositionPatient, baseNormal);
    candidatePlanes.push({
      plane,
      projection: proj,
      instance: plane.instanceNumber ?? i,
    });
  }

  if (excludedPlanes.length > 0) {
    warnings.push({
      code: 'ORIENTATION_MISMATCH',
      message: `检测到 ${excludedPlanes.length} 层切片与其他切片朝向不一致（余弦偏差 > 0.05），已从主序列中剔除以防三维重建畸变`,
      severity: 'error',
      details: { excludedCount: excludedPlanes.length },
    });
  }

  // 严格遵循 R3：基于物理投影距离排序，仅在投影重合微小容差内用 instanceNumber 做 tie-breaker
  candidatePlanes.sort((a, b) => {
    const diff = a.projection - b.projection;
    if (Math.abs(diff) > 1e-4) {
      return diff;
    }
    return a.instance - b.instance;
  });

  const sortedPlanes = candidatePlanes.map((item) => item.plane);
  const sliceDistances: number[] = [];
  const validDistancesForSpacing: number[] = [];

  for (let i = 0; i < candidatePlanes.length - 1; i++) {
    const current = candidatePlanes[i];
    const next = candidatePlanes[i + 1];
    if (!current || !next) continue;

    const dist = Math.abs(next.projection - current.projection);
    sliceDistances.push(dist);

    if (dist < 1e-3) {
      // 重复切片告警（S4）
      warnings.push({
        code: 'DUPLICATE_SLICE',
        message: `切片第 ${i + 1} 层与第 ${i + 2} 层物理投影重合（距离 ${dist.toFixed(4)} mm）`,
        severity: 'warning',
        details: { indexBefore: i, indexAfter: i + 1, distance: dist },
      });
    } else {
      validDistancesForSpacing.push(dist);
    }
  }

  // 期望层间距确定：优先元数据声明，其次众数（抗缺层污染），再回退到单层厚度
  const metaSpacing = firstPlane.spacingBetweenSlices ?? firstPlane.sliceThickness;
  let expectedSpacing: number;
  if (metaSpacing !== undefined && metaSpacing > 0.01) {
    expectedSpacing = metaSpacing;
  } else if (validDistancesForSpacing.length > 0) {
    expectedSpacing = computeSpacingMode(validDistancesForSpacing);
  } else {
    expectedSpacing = firstPlane.sliceThickness ?? 1.0;
  }

  // 缺层与异常层距双向判定（S4）
  //
  // 聚合而非逐处上报（2026-10-28 调整）：真实 MR 一次能出现 7 处层间距跳跃，
  // 逐条上报会把右栏刷满、把"影像信息"挤出屏幕，用户反而看不到真正重要的告警。
  // 现在同类问题合并为一条，逐处细节放进 details.gaps 摘要供展开查看。
  if (expectedSpacing > 1e-4) {
    const gapSites: string[] = [];
    let estimatedMissing = 0;
    let maxGap = 0;

    const narrowSites: string[] = [];
    let minNarrow = Number.POSITIVE_INFINITY;

    for (let i = 0; i < sliceDistances.length; i++) {
      const dist = sliceDistances[i];
      if (dist === undefined) continue;

      if (dist > 1.5 * expectedSpacing) {
        gapSites.push(`${i + 1}-${i + 2}:${dist.toFixed(2)}`);
        estimatedMissing += Math.max(1, Math.round(dist / expectedSpacing) - 1);
        if (dist > maxGap) maxGap = dist;
      } else if (dist < 0.7 * expectedSpacing && dist >= 1e-3) {
        narrowSites.push(`${i + 1}-${i + 2}:${dist.toFixed(2)}`);
        if (dist < minNarrow) minNarrow = dist;
      }
    }

    if (gapSites.length > 0) {
      warnings.push({
        code: 'SLICE_GAP',
        message:
          `检测到 ${gapSites.length} 处层间距跳跃（基准 ${expectedSpacing.toFixed(2)} mm，最大 ${maxGap.toFixed(2)} mm），` +
          `按基准估算缺少约 ${estimatedMissing} 层；测量与三维重建精度可能受影响`,
        severity: 'warning',
        details: {
          gapCount: gapSites.length,
          maxGap,
          expectedSpacing,
          estimatedMissingLayers: estimatedMissing,
          gaps: gapSites.join(', '),
        },
      });
    }

    if (narrowSites.length > 0) {
      warnings.push({
        code: 'IRREGULAR_SPACING',
        message: `检测到 ${narrowSites.length} 处层距偏窄（最小 ${minNarrow.toFixed(2)} mm，基准 ${expectedSpacing.toFixed(2)} mm）`,
        severity: 'warning',
        details: {
          narrowCount: narrowSites.length,
          minSpacing: minNarrow,
          expectedSpacing,
          gaps: narrowSites.join(', '),
        },
      });
    }
  } else {
    // 无法确定间距时必须告警，严禁静默跳过（R7）
    warnings.push({
      code: 'MISSING_GEOMETRY',
      message: '无法从序列切片中计算出有效的物理切片间距',
      severity: 'warning',
    });
  }

  return {
    sortedPlanes,
    excludedPlanes,
    sliceDistances,
    expectedSpacing,
    warnings,
  };
}
