/**
 * 字符集解码模块（中国场景特别设计）
 *
 * 严格遵循 GEMINI.md 5.6 规范：
 * 文件名解码与标签值解码是两个函数，禁止合并。
 * 线 1：文件名（仅用于展示路径还原）
 * 线 2：DICOM 标签值（字节解码，按 SpecificCharacterSet 派发且带 GB18030 兜底）
 */

const CHARSET_MAP: Readonly<Record<string, string>> = {
  '': 'iso-8859-1',
  'ISO_IR 6': 'ascii',
  'ISO_IR 100': 'iso-8859-1',
  'ISO_IR 192': 'utf-8',
  'GB18030': 'gb18030',
  'GBK': 'gb18030',
  'ISO 2022 IR 58': 'gb18030', // 调用前先剥离 ESC 转义序列
  'ISO_IR 13': 'shift_jis',
  'ISO_IR 149': 'euc-kr',
};

/**
 * 统计字符串中 CJK 统一表意文字码点数量，只用于择优，不参与业务逻辑 (N2 修复: codePointAt 支持增补字符集)
 */
export function scoreCjk(str: string): number {
  let score = 0;
  let i = 0;
  while (i < str.length) {
    const codePoint = str.codePointAt(i);
    if (codePoint === undefined) break;
    if (
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Extension A
      (codePoint >= 0x20000 && codePoint <= 0x2a6df)  // CJK Extension B
    ) {
      score++;
    }
    i += codePoint > 0xffff ? 2 : 1;
  }
  return score;
}

/**
 * 剥离 ISO 2022 系列的 ESC 转义序列（0x1B 开头，如 0x1B 0x24 0x29 0x41）
 */
export function stripIso2022Escapes(bytes: Uint8Array): Uint8Array {
  const result: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b) {
      // 遇到 ESC，跳过后续参数字节直到终结字节（ASCII 0x40 - 0x7E）
      i++;
      while (i < bytes.length) {
        const next = bytes[i];
        i++;
        if (next !== undefined && next >= 0x40 && next <= 0x7e) {
          break;
        }
      }
    } else if (b !== undefined) {
      result.push(b);
      i++;
    } else {
      i++;
    }
  }
  return new Uint8Array(result);
}

/**
 * 【线 1：文件名】展示路径还原
 *
 * 仅在展示路径时做还原启发式：
 * 把字符串按 latin-1 转回字节（charCodeAt(i) & 0xFF），再用 gb18030 解码。
 * 若解码后 CJK 占比/数量更高且不含替代字符，则采纳；否则保留原字符串。
 * 注意：文件能否打开与文件名完全无关，一律靠魔数判定。
 */
export function decodeFilenameForDisplay(filename: string): string {
  try {
    const rawBytes = new Uint8Array(filename.length);
    for (let i = 0; i < filename.length; i++) {
      rawBytes[i] = filename.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder('gb18030').decode(rawBytes);
    if (!decoded.includes('\uFFFD') && scoreCjk(decoded) > scoreCjk(filename)) {
      return decoded;
    }
  } catch {
    // 启发式失败直接回退原文件名
  }
  return filename;
}

/**
 * 【线 2：DICOM 标签值】真正的主战场
 *
 * 输入字节流，依据 SpecificCharacterSet 派发解码器。
 * 国产老机型常写中文却不声明字符集，或声明错误，必须进行 GB18030 兜底。
 */
export function decodeDicomText(
  bytes: Uint8Array,
  specificCharacterSet?: string,
): string {
  const trimmedCharset = (specificCharacterSet ?? '').trim();

  // 处理 ISO 2022 IR 58 特殊转义
  const cleanBytes =
    trimmedCharset === 'ISO 2022 IR 58' ? stripIso2022Escapes(bytes) : bytes;

  const label = CHARSET_MAP[trimmedCharset] ?? 'gb18030';

  let primary: string;
  try {
    primary = new TextDecoder(label).decode(cleanBytes);
  } catch {
    primary = new TextDecoder('iso-8859-1').decode(cleanBytes);
  }

  // 若无乱码且已经存在有效中文字符，则直接返回
  if (!primary.includes('\uFFFD') && trimmedCharset !== '') {
    return primary;
  }

  // 兜底策略：国产老机型未声明字符集但实际存储了 GBK/GB18030 中文字符
  try {
    const fallback = new TextDecoder('gb18030').decode(cleanBytes);
    if (!fallback.includes('\uFFFD') && scoreCjk(fallback) > scoreCjk(primary)) {
      return fallback;
    }
  } catch {
    // 保持 primary
  }

  return primary;
}
