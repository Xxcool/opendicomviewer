/**
 * DICOM 文件魔数识别与路径辅助
 *
 * 严格遵循 ARCHITECTURE.md §7.5：
 * 判定 DICOM 文件不依赖扩展名（光盘文件常无扩展名），严格读取偏移 128 处的 "DICM" (0x44, 0x49, 0x43, 0x4D) 魔数。
 */

const DICM_MAGIC = [0x44, 0x49, 0x43, 0x4d] as const;

/**
 * 校验字节流在偏移 128 处是否包含 "DICM" 魔数
 */
export function hasDicomPrefix(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 132) {
    return false;
  }

  return (
    bytes[128] === DICM_MAGIC[0] &&
    bytes[129] === DICM_MAGIC[1] &&
    bytes[130] === DICM_MAGIC[2] &&
    bytes[131] === DICM_MAGIC[3]
  );
}

/**
 * 判断文件名是否可能是 DICOMDIR 索引文件
 * 兼容 ISO 9660 光盘常见命名（如 "DICOMDIR", "dicomdir", "DICOMDIR.;1" 等）
 */
export function isDicomdirCandidate(filename: string): boolean {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const clean = base.replace(/[.;].*$/, '').trim().toUpperCase();
  return clean === 'DICOMDIR';
}
