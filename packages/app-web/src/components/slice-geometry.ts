/**
 * 切面几何计算（纯函数）
 *
 * 为什么单独成模块：IPP 沿法向的投影是数值判断（第几层、与层间距是否一致），
 * 按 GEMINI §10.1 必须能被单测覆盖，不能埋在组件的事件回调里。
 */

export type Vec3 = readonly [number, number, number];

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
