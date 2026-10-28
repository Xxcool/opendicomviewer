/**
 * 渲染层内部 imageId 约定
 *
 * 为什么需要：CS3D 的 `StackViewport.setStack()` 只认 `imageId` 字符串，
 * 像素由它自己的 imageLoader 解析。我们不使用 `@cornerstonejs/dicom-image-loader`
 * （它会把 5 个 codec 的 wasm 一起打进产物，见 ARCHITECTURE §14.1.1），
 * 而是注册一个自定义 loader，用这里的 imageId 反查 `SeriesHandle.pixel(index)`。
 *
 * 格式：`odv://series/<seriesInstanceUid>#<frameIndex>`
 * - 用 `#` 分隔索引：seriesInstanceUid 里不会出现 `#`（DICOM UI 只允许数字与点）
 * - 解析失败一律返回 null，调用方据此抛出可见错误（R7），不做静默兜底
 */

const PREFIX = 'odv://series/';
const INDEX_SEPARATOR = '#';

export interface ParsedImageId {
  readonly seriesInstanceUid: string;
  readonly frameIndex: number;
}

export function toImageId(seriesInstanceUid: string, frameIndex: number): string {
  if (!seriesInstanceUid) {
    throw new Error('无法生成 imageId：seriesInstanceUid 为空');
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error(`无法生成 imageId：帧索引非法（${frameIndex}）`);
  }
  return `${PREFIX}${seriesInstanceUid}${INDEX_SEPARATOR}${frameIndex}`;
}

export function parseImageId(imageId: string): ParsedImageId | null {
  if (!imageId.startsWith(PREFIX)) return null;

  const rest = imageId.slice(PREFIX.length);
  const sep = rest.lastIndexOf(INDEX_SEPARATOR);
  if (sep <= 0) return null;

  const seriesInstanceUid = rest.slice(0, sep);
  const frameIndexText = rest.slice(sep + 1);
  const frameIndex = Number(frameIndexText);
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return null;

  return { seriesInstanceUid, frameIndex };
}
