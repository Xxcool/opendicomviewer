/**
 * JPEG Lossless 解码（1.2.840.10008.1.2.4.57 / .70）
 *
 * GEMINI §2 硬约束：解码库必须按需动态加载，禁止顶层静态 import，
 * 否则未压缩路径也会被 1MB+ 的解码包拖累（Spike A）。
 *
 * jpeg-lossless-decoder-js 未随发布提供可用类型，声明见同目录
 * jpeg-lossless-decoder-js.d.ts（由各消费方 tsconfig include 纳入）。
 */

export interface JpegLosslessContext {
  readonly rows: number;
  readonly columns: number;
  readonly bitsAllocated: number;
  readonly pixelRepresentation: number;
}

interface DecoderInstance {
  decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer;
}

type DecoderConstructor = new () => DecoderInstance;

function isDecoderConstructor(value: unknown): value is DecoderConstructor {
  return typeof value === 'function';
}

/**
 * 兼容 ESM 具名导出与 CJS default 包装两种形态。
 * 包没有 exports 字段，Vitest（Node）走 main = CJS，浏览器构建走 module = ESM。
 */
export function resolveDecoderConstructor(moduleValue: unknown): DecoderConstructor {
  if (typeof moduleValue === 'object' && moduleValue !== null) {
    const record = moduleValue as Record<string, unknown>;
    if (isDecoderConstructor(record.Decoder)) return record.Decoder;

    const fallback = record.default;
    if (isDecoderConstructor(fallback)) return fallback;
    if (typeof fallback === 'object' && fallback !== null) {
      const nested = (fallback as Record<string, unknown>).Decoder;
      if (isDecoderConstructor(nested)) return nested;
    }
  }
  throw new Error(
    'JPEG Lossless 解码器加载失败：jpeg-lossless-decoder-js 未导出 Decoder 构造器',
  );
}

export async function decodeJpegLosslessFrame(
  bitstream: Uint8Array,
  context: JpegLosslessContext,
): Promise<Int16Array | Uint16Array | Uint8Array> {
  const { rows, columns, bitsAllocated, pixelRepresentation } = context;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
    throw new Error(
      `JPEG Lossless 解码缺少有效矩阵尺寸: rows=${rows}, columns=${columns}`,
    );
  }
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(
      `JPEG Lossless 仅支持 8/16 位像素，当前 BitsAllocated=${bitsAllocated}`,
    );
  }

  const moduleValue: unknown = await import('jpeg-lossless-decoder-js');
  const Decoder = resolveDecoderConstructor(moduleValue);
  const decoder = new Decoder();

  // 复制成独立 ArrayBuffer：解封装片段可能带奇数字节填充，且不把源缓冲移交给第三方库
  const bytes = bitstream.buffer.slice(
    bitstream.byteOffset,
    bitstream.byteOffset + bitstream.byteLength,
  );
  const decoded = decoder.decompress(bytes, 0, bytes.byteLength);

  const pixels = rows * columns;
  const expectedBytes = pixels * (bitsAllocated / 8);
  if (decoded.byteLength !== expectedBytes) {
    throw new Error(
      `JPEG Lossless 解码输出长度不符：期望 ${expectedBytes} 字节，实际 ${decoded.byteLength} 字节（可能是彩色图像或位深不匹配）`,
    );
  }

  if (bitsAllocated === 16) {
    return pixelRepresentation === 1
      ? new Int16Array(decoded, 0, pixels)
      : new Uint16Array(decoded, 0, pixels);
  }
  return new Uint8Array(decoded, 0, pixels);
}
