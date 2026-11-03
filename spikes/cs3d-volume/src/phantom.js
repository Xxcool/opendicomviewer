// 与 ARCHITECTURE §5 的目标一致：横断面与层数都压到 256 上限以内
export const DIMS = [192, 192, 192];
export const SPACING = [1, 1, 2];
export const ORIGIN = [0, 0, 0];
export const DIRECTION = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/**
 * 合成数据：三个轴上的亮线位置各不相同，
 * 这样 AX / COR / SAG 三张图一定长得不一样——用"三张图是否有差异"
 * 就能判定方向设定是否真的生效，而不是三格都画了同一个视角。
 */
export function buildScalarData() {
  const [nx, ny, nz] = DIMS;
  const data = new Uint8Array(nx * ny * nz);
  const cx = nx / 2;
  const cy = ny / 2;
  const cz = nz / 2;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const rowBase = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        let v = 20 + Math.round((k / nz) * 30); // 沿 z 的缓慢梯度

        if (Math.abs(i - (cx - 40)) <= 1) v = 240; // 只有含 x 的视角看得到
        if (Math.abs(j - (cy + 20)) <= 1) v = Math.max(v, 190);
        if (Math.abs(k - (cz + 30)) <= 1) v = Math.max(v, 150);

        const r = Math.hypot(i - cx, j - cy, (k - cz) * 2);
        if (Math.abs(r - 55) <= 1.2) v = Math.max(v, 110);

        data[rowBase + i] = v;
      }
    }
  }
  return data;
}

export const metadata = {
  BitsAllocated: 8,
  BitsStored: 8,
  HighBit: 7,
  PixelRepresentation: 0,
  SamplesPerPixel: 1,
  PhotometricInterpretation: 'MONOCHROME2',
  PixelSpacing: [SPACING[0], SPACING[1]],
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  ImagePositionPatient: ORIGIN,
  Modality: 'CT',
};

