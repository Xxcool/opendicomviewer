/**
 * 四象限截图像素采样器（Spike B 的证据）
 *
 * 为什么要按象限采样：三向 MPR 的关键结论不是"有像素"，而是
 * "三格画的是三个不同方向的图像"。只看全图非黑比例无法区分
 * "三个方向都正确" 与 "三格都画了同一个视角"。
 *
 * 用法：node scripts/sample-screenshot.mjs /tmp/shot.png
 * 退出码：0 = 通过，1 = 失败
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('暂不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`只支持 8bit，实际 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) throw new Error(`不支持的 colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const v = line[x];
      let value;
      switch (filter) {
        case 0:
          value = v;
          break;
        case 1:
          value = v + a;
          break;
        case 2:
          value = v + b;
          break;
        case 3:
          value = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`未知 PNG filter ${filter}`);
      }
      out[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels: out };
}

function statsOf(img, ox, oy, w, h) {
  const { width, channels, pixels } = img;
  let nonBlack = 0;
  let min = 255;
  let max = 0;
  let sum = 0;
  const levels = new Set();

  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) {
      const i = (y * width + x) * channels;
      const luma = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
      if (luma > 8) nonBlack++;
      if (luma < min) min = luma;
      if (luma > max) max = luma;
      sum += luma;
      levels.add(luma);
    }
  }

  const total = w * h;
  return {
    nonBlackRatio: Number((nonBlack / total).toFixed(4)),
    min,
    max,
    mean: Number((sum / total).toFixed(2)),
    distinctLevels: levels.size,
  };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/sample-screenshot.mjs <png>');
    process.exit(2);
  }

  const img = decodePng(readFileSync(file));
  // 网格固定 640×640，四格各 320×320
  const half = 320;
  const quads = {
    axial: statsOf(img, 0, 0, half, half),
    coronal: statsOf(img, half, 0, half, half),
    sagittal: statsOf(img, 0, half, half, half),
    stack: statsOf(img, half, half, half, half),
  };

  const rendered = (s) => s.nonBlackRatio > 0.02 && s.distinctLevels >= 4;
  const mprOk = rendered(quads.axial) && rendered(quads.coronal) && rendered(quads.sagittal);

  // 三张图必须互不相同：两两 mean 差值至少有一对 > 0.5
  const means = [quads.axial.mean, quads.coronal.mean, quads.sagittal.mean];
  const spread = Math.max(...means) - Math.min(...means);
  const distinctOk = spread > 0.5;

  console.log(
    JSON.stringify(
      {
        file,
        imageSize: `${img.width}x${img.height}`,
        quadrants: quads,
        meanSpread: Number(spread.toFixed(2)),
      },
      null,
      2,
    ),
  );

  const pass = mprOk && distinctOk;
  console.log(
    pass
      ? 'PASS: 三个 MPR 象限都渲染出内容，且互不相同'
      : `FAIL: mprOk=${mprOk} distinctOk=${distinctOk}`,
  );
  process.exit(pass ? 0 : 1);
}

main();
