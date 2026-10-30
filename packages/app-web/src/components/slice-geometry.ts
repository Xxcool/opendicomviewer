/**
 * 切面几何计算（纯函数）
 *
 * 为什么单独成模块：IPP 沿法向的投影是数值判断（第几层、与层间距是否一致），
 * 按 GEMINI §10.1 必须能被单测覆盖，不能埋在组件的事件回调里。
 */

export type Vec3 = readonly [number, number, number];

/** 仅在有效、轴对齐的 IOP 下标注解剖方向；不把矢状面误写成固定轴位。 */
export function describeSliceOrientation(iop: ReadonlyArray<number> | undefined, missing = false) {
  const unknown = { label: '切面未知', top: '', bottom: '', left: '', right: '' };
  if (missing || !iop || iop.length !== 6 || !iop.every(Number.isFinite)) return unknown;
  const row = iop.slice(0, 3);
  const col = iop.slice(3, 6);
  if (Math.abs(Math.hypot(...row) - 1) > 0.001 || Math.abs(Math.hypot(...col) - 1) > 0.001
    || Math.abs(row.reduce((sum, value, i) => sum + value * col[i]!, 0)) > 0.001) return unknown;
  const normal = sliceNormal(iop);
  const axisOf = (vector: ReadonlyArray<number>) => vector.findIndex((value) => Math.abs(value) > 0.999);
  const axis = axisOf(normal);
  const rowAxis = axisOf(row);
  const colAxis = axisOf(col);
  if (axis < 0 || rowAxis < 0 || colAxis < 0) return { ...unknown, label: '斜切面 (Oblique)' };
  const direction = (vector: ReadonlyArray<number>, index: number, sign: number) =>
    (vector[index]! * sign > 0 ? ['L', 'P', 'S'] : ['R', 'A', 'I'])[index]!;
  return {
    label: ['矢状面 (Sagittal)', '冠状面 (Coronal)', '横断面 (Axial)'][axis]!,
    top: direction(col, colAxis, -1), bottom: direction(col, colAxis, 1),
    left: direction(row, rowAxis, -1), right: direction(row, rowAxis, 1),
  };
}

/**
 * 切面法向 = row × col（右手系），与 core 排序管线是同一方向。
 * IOP 缺失或退化时返回单位 +Z，避免除零得到 NaN。
 */
export function sliceNormal(iop: ReadonlyArray<number>): Vec3 {
  const [rx = 1, ry = 0, rz = 0, cx = 0, cy = 1, cz = 0] = iop;
  const nx = ry * cz - rz * cy;
  const ny = rz * cx - rx * cz;
  const nz = rx * cy - ry * cx;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * IPP 沿法向的投影值（单位 mm）。
 *
 * 斜切序列的 IPP 三个分量都在变，只有沿法向的距离才是真实的"层位置"，
 * 直接读 z 会把斜切距离算短。
 * 几何是否可信由调用方按 `hasMissingGeometry` 单独判断，这里不做兜底。
 */
export function sliceProjection(
  ipp: ReadonlyArray<number>,
  iop: ReadonlyArray<number>,
): number {
  const [px = 0, py = 0, pz = 0] = ipp;
  const [nx, ny, nz] = sliceNormal(iop);
  return px * nx + py * ny + pz * nz;
}
