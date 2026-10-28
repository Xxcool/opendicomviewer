/**
 * 测试用最小 ZIP 构造器（stored 方式，无压缩）
 *
 * 为什么自己造而不用第三方 zip 库：
 * - 零依赖纪律（GEMINI §2）；
 * - 需要精确控制 General Purpose Bit Flag 的 bit 11 与 EOCD 里的 ZIP64 占位值，
 *   现成库不给你这种控制力，而这正是 N5 / N6 两个缺陷的触发条件。
 *
 * 只实现 store（compressionMethod = 0）路径，足够覆盖文件名编码与 ZIP64 判定。
 */

export interface ZipFixtureEntry {
  /** 文件名原始字节（要测 GBK 就传 GBK 字节） */
  readonly nameBytes: Uint8Array;
  /** 文件内容 */
  readonly data: Uint8Array;
  /** 是否置 bit 11（声明文件名为 UTF-8），默认 false —— 与国产打包工具行为一致 */
  readonly utf8FilenameFlag?: boolean;
}

/** "胸部CT平扫.dcm" 的 GBK 字节，供文件名编码用例复用 */
export const GBK_CHEST_CT_FILENAME = new Uint8Array([
  0xd0, 0xd8, 0xb2, 0xbf, 0x43, 0x54, 0xc6, 0xbd, 0xc9, 0xa8, 0x2e, 0x64, 0x63,
  0x6d,
]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 构造一个合法 ZIP（LFH + 中央目录 + EOCD）
 */
export function buildZip(entries: readonly ZipFixtureEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameLen = entry.nameBytes.length;
    const size = entry.data.length;
    const gpFlag = entry.utf8FilenameFlag ? 0x0800 : 0x0000;
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + nameLen + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, gpFlag, true);
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x21, true); // mod date (1980-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameLen, true);
    lv.setUint16(28, 0, true);
    local.set(entry.nameBytes, 30);
    local.set(entry.data, 30 + nameLen);

    const central = new Uint8Array(46 + nameLen);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, gpFlag, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameLen, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true);
    central.set(entry.nameBytes, 46);

    localChunks.push(local);
    centralChunks.push(central);
    localOffset += local.length;
  }

  const cdSize = centralChunks.reduce((acc, c) => acc + c.length, 0);
  const totalLocal = localChunks.reduce((acc, c) => acc + c.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, totalLocal, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(totalLocal + cdSize + eocd.length);
  let p = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

/**
 * 构造一个"看起来是 ZIP64"的包：EOCD 里 CD 大小与偏移写成 0xFFFFFFFF 占位值。
 *
 * 这不需要真的生成 4 GB 文件——真实 ZIP64 包在经典 EOCD 里就是这个样子，
 * 而旧的读取实现会拿占位值当偏移，最终静默返回 0 个条目（N6）。
 */
export function buildZip64PlaceholderZip(): Uint8Array {
  const entries = buildZip([
    {
      nameBytes: new TextEncoder().encode('CT0001.dcm'),
      data: new Uint8Array([1, 2, 3, 4]),
    },
  ]);

  // 定位 EOCD（末尾 22 字节），改写 cdSize / cdOffset 为 ZIP64 占位值
  const eocdStart = entries.length - 22;
  const view = new DataView(entries.buffer, entries.byteOffset, entries.byteLength);
  if (view.getUint32(eocdStart, true) !== 0x06054b50) {
    throw new Error('fixture 构造失败：未找到 EOCD');
  }
  view.setUint32(eocdStart + 12, 0xffffffff, true);
  view.setUint32(eocdStart + 16, 0xffffffff, true);
  return entries;
}
