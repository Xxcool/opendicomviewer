/**
 * 截图像素采样器（Spike A 的 Q2 证据）
 *
 * 为什么要这个脚本：页内 `drawImage(webglCanvas)` 拿到的是**已被清空**的
 * drawing buffer，永远全黑。要证明"像素真的画到屏幕上"，只能对合成后的
 * 截图做解码采样。这样得到的断言也只依赖 Node 内置 zlib，不引入任何依赖。
 *
 * 用法：node scripts/sample-screenshot.mjs /tmp/shot.png
 * 退出码：0 = 通过（非全黑且存在灰度层次），1 = 失败
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

  // 逐行反滤波（PNG filter type 0..4）
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

/** 只看画布区域（页面上方 640×640），排除文字区的干扰 */
function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: node scripts/sample-screenshot.mjs <png>');
    process.exit(2);
  }

  const { width, height, channels, pixels } = decodePng(readFileSync(file));
  const cropW = Math.min(width, 640);
  const cropH = Math.min(height, 640);

  let nonBlack = 0;
  let min = 255;
  let max = 0;
  let sum = 0;
  const levels = new Set();

  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const i = (y * width + x) * channels;
      const luma = Math.round(
        0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
      );
      if (luma > 8) nonBlack++;
      if (luma < min) min = luma;
      if (luma > max) max = luma;
      sum += luma;
      levels.add(luma);
    }
  }

  const total = cropW * cropH;
  const stats = {
    file,
    imageSize: `${width}x${height}`,
    sampled: `${cropW}x${cropH}`,
    nonBlackRatio: Number((nonBlack / total).toFixed(4)),
    min,
    max,
    mean: Number((sum / total).toFixed(2)),
    distinctLevels: levels.size,
  };
  console.log(JSON.stringify(stats, null, 2));

  // 判据：非全黑 + 有灰度层次（这正是不做像素级回归也能证明"真的渲染了"的最小集合）
  const pass = stats.nonBlackRatio > 0.05 && stats.distinctLevels >= 4;
  console.log(pass ? 'PASS: 画布确实渲染出内容' : 'FAIL: 画布疑似空白');
  process.exit(pass ? 0 : 1);
}

main();
