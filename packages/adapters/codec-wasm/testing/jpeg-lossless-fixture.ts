/**
 * JPEG Lossless（SOF3，Process 14，Selection Value 1）码流生成器（仅测试用）
 *
 * 本机 ffmpeg 的 ljpeg 编码器只支持 8 位彩色，无法生成 16 位单通道样本，
 * 所以这里按 ITU T.81 最小子集手写：单分量、预测器 1、自定义等长 Huffman 表。
 * 它只负责造码流，解码正确性仍由 src/jpeg-lossless.ts 承担。
 */

export interface LosslessJpegFixtureOptions {
  readonly rows: number;
  readonly columns: number;
  /** 8 或 16 */
  readonly precision: number;
  /** 无符号采样值，长度必须等于 rows × columns */
  readonly samples: readonly number[];
}

export function buildLosslessJpeg(options: LosslessJpegFixtureOptions): Uint8Array {
  const { rows, columns, precision, samples } = options;
  const pixelCount = rows * columns;
  if (samples.length !== pixelCount) {
    throw new Error(`JPEG Lossless fixture 采样数不符: ${samples.length} != ${pixelCount}`);
  }
  if (precision !== 8 && precision !== 16) {
    throw new Error(`JPEG Lossless fixture 仅支持 8/16 位，收到 ${precision}`);
  }

  const output: number[] = [];
  // SOI
  output.push(0xff, 0xd8);

  // SOF3：精度、尺寸、单分量
  const sof: number[] = [];
  sof.push(precision); // precision 为单字节
  pushUint16BE(sof, rows);
  pushUint16BE(sof, columns);
  sof.push(0x01); // 分量数
  sof.push(0x01, 0x11, 0x00); // id / 采样因子 / 量化表
  pushSegment(output, 0xc3, sof);

  // DHT：DC 表 0，类别 0..16 全部 5 位等长码
  const dht: number[] = [0x00];
  for (let length = 1; length <= 16; length++) {
    dht.push(length === 5 ? 17 : 0);
  }
  for (let category = 0; category <= 16; category++) {
    dht.push(category);
  }
  pushSegment(output, 0xc4, dht);

  // SOS：单分量、预测器 1、Se=0、AhAl=0
  const sos: number[] = [0x01, 0x01, 0x00, 0x01, 0x00, 0x00];
  pushSegment(output, 0xda, sos);

  const writer = new EntropyWriter();
  let x = 0;
  let y = 0;
  for (const sample of samples) {
    const prediction = predict(samples, x, y, columns, precision);
    // 16 位精度下差分按模 2^16 折算到 [-32768, 32767]（T.81 无损预测的差值域）
    const diff = precision === 16 ? toSigned16(sample - prediction) : sample - prediction;
    const category = magnitudeCategory(diff);
    // 等长表：类别 c 的码字就是 c 的 5 位二进制
    writer.write(category, 5);
    // 类别 16 是标准特例：不携带额外位，取值由预测值符号决定（本 fixture 仅产生 -32768）
    if (category > 0 && category < 16) {
      const encoded = diff >= 0 ? diff : diff + (1 << category) - 1;
      writer.write(encoded, category);
    }
    x += 1;
    if (x === columns) {
      x = 0;
      y += 1;
    }
  }
  output.push(...writer.finish());

  // EOI
  output.push(0xff, 0xd9);
  return new Uint8Array(output);
}

/** 预测器 1（Ra）；行首用上方样本，首像素用 2^(P-1)（ITU T.81 A.2.1） */
function predict(
  samples: readonly number[],
  x: number,
  y: number,
  columns: number,
  precision: number,
): number {
  if (x === 0 && y === 0) return 1 << (precision - 1);
  if (x === 0) {
    const above = samples[(y - 1) * columns];
    if (above === undefined) throw new Error('JPEG Lossless fixture 上方样本越界');
    return above;
  }
  const left = samples[y * columns + x - 1];
  if (left === undefined) throw new Error('JPEG Lossless fixture 左侧样本越界');
  return left;
}

function magnitudeCategory(diff: number): number {
  if (diff === 0) return 0;
  let magnitude = Math.abs(diff);
  let bits = 0;
  while (magnitude > 0) {
    magnitude >>= 1;
    bits += 1;
  }
  return bits;
}

/** 把差分折算到 16 位无损 JPEG 的差值域 [-32768, 32767]（模 2^16） */
function toSigned16(diff: number): number {
  if (diff < -32768) return diff + 65536;
  if (diff > 32767) return diff - 65536;
  return diff;
}

class EntropyWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private bitCount = 0;

  write(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((value >> i) & 1);
      this.bitCount += 1;
      if (this.bitCount === 8) {
        this.flush(this.current);
        this.current = 0;
        this.bitCount = 0;
      }
    }
  }

  /** 末尾不足一字节时用 1 填充（JPEG 规范要求） */
  finish(): number[] {
    if (this.bitCount > 0) {
      const padding = 8 - this.bitCount;
      this.flush((this.current << padding) | ((1 << padding) - 1));
      this.current = 0;
      this.bitCount = 0;
    }
    return this.bytes;
  }

  private flush(byte: number): void {
    this.bytes.push(byte);
    // 熵编码段内的 0xFF 必须插入 0x00，避免被误认为标记
    if (byte === 0xff) this.bytes.push(0x00);
  }
}

function pushSegment(target: number[], marker: number, body: number[]): void {
  target.push(0xff, marker);
  pushUint16BE(target, body.length + 2);
  target.push(...body);
}

function pushUint16BE(target: number[], value: number): void {
  target.push((value >> 8) & 0xff, value & 0xff);
}
