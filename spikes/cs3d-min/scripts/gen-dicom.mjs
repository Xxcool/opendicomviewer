/**
 * Spike A 数据生成器
 *
 * 复用主仓已测的 fixture builder 生成 3 张合成 CT（不是真实患者数据），
 * 写进 public/series/ 作为静态文件，让 CS3D 走真实的 URL → fetch → 解码 路径。
 *
 * 运行：npm run gen
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDicomBuffer } from '../../../packages/adapters/source-local/testing/dicom-fixture.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'series');

const SIZE = 128;
const SLICE_SPACING_MM = 5;

/** Shepp-Logan 风格简版：空气底 + 水椭圆 + 骨环 + 两个内结构 */
function makePhantom(sliceIndex) {
  const pixels = new Uint16Array(SIZE * SIZE);
  const cx = (SIZE - 1) / 2;
  const cy = (SIZE - 1) / 2;
  const bodyRx = SIZE * 0.42;
  const bodyRy = SIZE * 0.34;

  // 沿 z 方向让椭球半径变化，翻页时肉眼可见差异
  const shrink = 1 - Math.abs(sliceIndex - 1) * 0.12;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = (x - cx) / (bodyRx * shrink);
      const ny = (y - cy) / (bodyRy * shrink);
      const r = nx * nx + ny * ny;

      let hu = -1000; // 空气
      if (r <= 1) hu = 0; // 水
      if (r <= 0.62) hu = 60; // 软组织
      if (r <= 0.28) hu = 900; // 骨
      if (r <= 0.1) hu = 40; // 脑室

      // 顶部开一个缺口，验证图像方向没有被上下翻转
      if (y < SIZE * 0.18 && Math.abs(x - cx) < SIZE * 0.1) hu = -1000;

      // stored value = HU - intercept（intercept = -1024）
      pixels[y * SIZE + x] = Math.max(0, Math.min(65535, hu + 1024));
    }
  }
  return new Uint8Array(pixels.buffer);
}

mkdirSync(outDir, { recursive: true });

for (let i = 0; i < 3; i++) {
  const bytes = buildDicomBuffer({
    patientId: 'SPIKE-A',
    patientName: 'SPIKE^PHANTOM',
    studyInstanceUid: '1.2.826.0.1.3680043.10.1214.1',
    seriesInstanceUid: '1.2.826.0.1.3680043.10.1214.1.1',
    sopInstanceUid: `1.2.826.0.1.3680043.10.1214.1.1.${i + 1}`,
    sopClassUid: '1.2.840.10008.5.1.4.1.1.2', // CT Image Storage
    modality: 'CT',
    instanceNumber: i + 1,
    rows: SIZE,
    columns: SIZE,
    pixelSpacing: [0.5, 0.5],
    imagePositionPatient: [0, 0, (i - 1) * SLICE_SPACING_MM],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    pixelData: makePhantom(i),
    bitsAllocated: 16,
    bitsStored: 16,
    pixelRepresentation: 0,
    photometricInterpretation: 'MONOCHROME2',
    rescaleIntercept: -1024,
    rescaleSlope: 1,
    windowCenter: 40,
    windowWidth: 400,
    transferSyntaxUid: '1.2.840.10008.1.2.1',
  });

  const file = join(outDir, `slice-${String(i + 1).padStart(3, '0')}.dcm`);
  writeFileSync(file, bytes);
  console.log(`written ${file} (${bytes.byteLength} bytes)`);
}
