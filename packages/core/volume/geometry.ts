import type { ImagePlane, SeriesMeta } from '../domain/types';
import { distance, dot, sub, type Vec3 } from '../pipeline/vector3';
import type { VolumeRejectCode } from './types';

type GridValidation =
  | { readonly ok: true; readonly sliceSpacing: number }
  | { readonly ok: false; readonly code: VolumeRejectCode; readonly message: string };

function invalid(code: VolumeRejectCode, message: string): GridValidation {
  return { ok: false, code, message: `${message}，暂不支持 MPR；仍可浏览原始切片` };
}

/** 单一体积方向矩阵要求每层的行列方向一致，只有法向相同并不足够。 */
function sameOrientation(plane: ImagePlane, first: ImagePlane): boolean {
  const iop = plane.imageOrientationPatient;
  const row: Vec3 = [iop[0], iop[1], iop[2]];
  const col: Vec3 = [iop[3], iop[4], iop[5]];
  return iop.every((value, i) =>
    Number.isFinite(value) && Math.abs(value - first.imageOrientationPatient[i]!) <= 1e-4,
  ) && Math.abs(dot(row, row) - 1) <= 1e-4
    && Math.abs(dot(col, col) - 1) <= 1e-4 && Math.abs(dot(row, col)) <= 1e-4;
}

/**
 * 当前采样器只支持规则网格；逐层核对真实 IPP，禁止把缺层、层距变化或机架剪切压成均匀体积。
 * 允许 0.001 mm 的坐标舍入；层距取真实坐标跨度，避免元数据分桶舍入改变物理尺寸。
 */
export function validateVolumeGrid(meta: SeriesMeta, first: ImagePlane, normal: Vec3): GridValidation {
  if (meta.planes.some((plane) => !plane.imagePositionPatient.every(Number.isFinite))) {
    return invalid('MISSING_GEOMETRY', '切片物理位置包含非有限数值');
  }
  const last = meta.planes[meta.planes.length - 1]!;
  const sliceSpacing = dot(sub(last.imagePositionPatient, first.imagePositionPatient), normal)
    / (meta.planes.length - 1);
  if (!Number.isFinite(sliceSpacing) || sliceSpacing <= 0) {
    return invalid('INVALID_SPACING', '切片位置重复或层序与采集方向不一致');
  }
  for (const [i, plane] of meta.planes.entries()) {
    if (!sameOrientation(plane, first)) {
      return invalid('INVALID_ORIENTATION', `第 ${i + 1} 层的方向余弦无效或与首层不一致`);
    }
    if (plane.rows !== first.rows || plane.columns !== first.columns) {
      return invalid('INVALID_SPACING', `第 ${i + 1} 层的像素矩阵与首层不一致`);
    }
    if (plane.pixelSpacing.some((value, axis) => !Number.isFinite(value)
      || value <= 0 || Math.abs(value - meta.spacing[axis]!) > 1e-5)) {
      return invalid('INVALID_SPACING', `第 ${i + 1} 层的像素间距与序列不一致`);
    }
    const expected: Vec3 = [
      first.imagePositionPatient[0] + normal[0] * sliceSpacing * i,
      first.imagePositionPatient[1] + normal[1] * sliceSpacing * i,
      first.imagePositionPatient[2] + normal[2] * sliceSpacing * i,
    ];
    if (distance(plane.imagePositionPatient, expected) > 0.001) {
      return invalid('INVALID_SPACING', `第 ${i + 1} 层不在均匀网格上，存在缺层、层距变化或平面偏移`);
    }
  }
  return { ok: true, sliceSpacing };
}
