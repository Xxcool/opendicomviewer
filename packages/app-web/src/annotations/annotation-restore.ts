import { isPath, MAX_PATH_POINTS, pathStats } from './annotation-path';
import { isAngle, anglePointCount, angleStats } from './annotation-angle';
import { isRoi, roiStats } from './annotation-roi';
import { measureImageLength, type MeasurementRecord, type SeriesMeta, type DataSourcePort } from '@opendicomviewer/core';
import { calibrated } from './annotation-geometry';

export const MAX_ANNOTATION_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 10_000;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('标注文件包含不支持的字段');
}
function string(value: unknown, label: string, limit = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label}无效`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`);
  return value;
}
function pixelPoint(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(item => typeof item === 'number' && Number.isFinite(item)) || value[2] !== 0) throw new Error('标注坐标无效');
  return [value[0], value[1], 0];
}
export function parseAnnotationBackup(text: string): readonly unknown[] {
  if (new TextEncoder().encode(text).byteLength > MAX_ANNOTATION_BYTES) throw new Error('标注文件超过 10 MiB 限制');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('标注文件不是有效 JSON'); }
  if (!object(value)) throw new Error('标注文件结构无效');
  keys(value, ['format', 'version', 'records']);
  if (value.format !== 'opendicomviewer-annotations' || value.version !== 1) throw new Error('不支持的标注文件格式或版本');
  if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) throw new Error('标注数量无效或超过 10000 条限制');
  return value.records;
}
export function backupSeriesUids(records: readonly unknown[]): readonly string[] {
  return [...new Set(records.map(record => {
    if (!object(record)) throw new Error('标注记录无效');
    return string(record.seriesInstanceUid, '源序列引用');
  }))];
}
function restoreRecord(value: unknown, sources: readonly SeriesMeta[], sessionId: string): MeasurementRecord {
  if (!object(value)) throw new Error('标注记录无效');
  keys(value, ['id', 'seriesInstanceUid', 'sopInstanceUid', 'sessionId', 'frameIndex', 'coordinateSpace', 'type', 'points', 'stats', 'createdAt', 'text']);
  const id = string(value.id, '标注 ID');
  const seriesInstanceUid = string(value.seriesInstanceUid, '源序列引用');
  const sopInstanceUid = string(value.sopInstanceUid, '源影像引用');
  string(value.sessionId, '原会话引用');
  const frameIndex = integer(value.frameIndex, '源帧号');
  if (value.coordinateSpace !== 'image-pixel') throw new Error('不支持的标注坐标空间');
  const type = value.type;
  if (type !== 'length' && type !== 'arrow' && type !== 'text' && type !== 'rectangleRoi' && type !== 'ellipseRoi' && type !== 'angle' && type !== 'cobbAngle' && type !== 'polyline' && type !== 'freehand') throw new Error('标注包含当前不支持的工具类型');
  if (!Array.isArray(value.points) || (isPath({ type }) ? value.points.length > MAX_PATH_POINTS : value.points.length !== (isAngle({ type }) ? anglePointCount(type) : type === 'text' ? 1 : 2))) throw new Error('标注控制点数量无效');
  const points = value.points.map(pixelPoint);
  const matches = sources.filter(source => source.seriesInstanceUid === seriesInstanceUid)
    .flatMap(source => source.planes.filter(plane => plane.sopInstanceUid === sopInstanceUid && (plane.frameIndex ?? 0) === frameIndex));
  if (matches.length !== 1) throw new Error('找不到唯一对应的源序列、影像或帧，请先打开原始 DICOM');
  const plane = matches[0]!;
  if (points.some(point => point[0] < 0 || point[1] < 0 || point[0] > plane.columns - 1 || point[1] > plane.rows - 1)) throw new Error('标注坐标超出源影像范围');
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) throw new Error('标注创建时间无效');
  if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 8192)) throw new Error('标注备注无效或超过 8192 字符');
  if (!object(value.stats)) throw new Error('标注统计无效');
  keys(value.stats, isAngle({ type }) ? ['angleDeg'] : (type === 'length' || type === 'polyline') ? ['lengthMm'] : isRoi({ type }) ? ['areaMm2', 'count', 'mean', 'stdDev', 'min', 'max'] : []);
  let stats: MeasurementRecord['stats'] = {};
  if (isRoi({ type })) {
    for (const number of Object.values(value.stats)) if (typeof number !== 'number' || !Number.isFinite(number)) throw new Error('区域统计无效');
    stats = { ...value.stats };
  }
  if (isAngle({ type })) {
    stats = angleStats({ type, points }, plane);
    if (typeof value.stats.angleDeg !== 'number' || !Number.isFinite(value.stats.angleDeg) || Math.abs(value.stats.angleDeg - stats.angleDeg!) > 1e-6) throw new Error('角度与源影像标定不一致，无法恢复');
  }
  if (isPath({ type })) {
    stats = pathStats({ type, points }, plane);
    if (type === 'polyline' && (typeof value.stats.lengthMm !== 'number' || !Number.isFinite(value.stats.lengthMm) || Math.abs(value.stats.lengthMm - stats.lengthMm!) > Math.max(1e-6, stats.lengthMm! * 1e-9))) throw new Error('折线测距与源影像标定不一致，无法恢复');
  }
  if (type === 'length') {
    const length = measureImageLength([points[0]![0], points[0]![1]], [points[1]![0], points[1]![1]], { trusted: calibrated(plane), pixelSpacing: plane.pixelSpacing });
    if (!length.ok || typeof value.stats.lengthMm !== 'number' || !Number.isFinite(value.stats.lengthMm)
      || Math.abs(length.value - value.stats.lengthMm) > Math.max(1e-6, length.value * 1e-9)) throw new Error('测距与源影像标定不一致，无法恢复');
    stats = { lengthMm: length.value };
  } else if (type === 'arrow' && Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]) < 0.5) throw new Error('箭头控制点重合');
  return { id, seriesInstanceUid, sopInstanceUid, sessionId, frameIndex, coordinateSpace: 'image-pixel', type, points, stats, createdAt: value.createdAt,
    ...(typeof value.text === 'string' ? { text: value.text } : {}) };
}
/** 不信任存档中的测量结果：匹配原图并重算，通过后才允许替换会话。 */
export function restoreAnnotationRecords(records: readonly unknown[], sources: readonly SeriesMeta[], sessionId: string): readonly MeasurementRecord[] {
  const restored = records.map(record => restoreRecord(record, sources, sessionId));
  if (restored.some(isRoi)) throw new Error('区域恢复需要原始像素验证');
  if (new Set(restored.map(record => record.id)).size !== restored.length) throw new Error('标注 ID 重复');
  return restored;
}

/** 只读元数据，不解码像素；临时句柄始终释放，不占用当前显示句柄。 */
export async function loadBackupSources(records: readonly unknown[], source: Pick<DataSourcePort, 'listSeries' | 'openSeries'>): Promise<readonly SeriesMeta[]> {
  const uids = backupSeriesUids(records);
  const listed = await source.listSeries();
  const metadata: SeriesMeta[] = [];
  for (const uid of uids) {
    const matches = listed.filter(item => item.seriesInstanceUid === uid);
    if (matches.length !== 1) throw new Error('找不到唯一对应的源序列，请先打开原始 DICOM');
    const summary = matches[0]!;
    const handle = await source.openSeries({ studyInstanceUid: summary.studyInstanceUid, seriesInstanceUid: uid });
    try { metadata.push(handle.meta); } finally { handle.dispose(); }
  }
  return metadata;
}

/** 区域结果必须重读原图校验；不允许将备份中的灰度统计当作真源。 */
export async function restoreWithPixels(records: readonly unknown[], sources: readonly SeriesMeta[], sessionId: string, source: Pick<DataSourcePort, 'openSeries'>): Promise<readonly MeasurementRecord[]> {
  const restored = records.map(record => restoreRecord(record, sources, sessionId));
  if (new Set(restored.map(record => record.id)).size !== restored.length) throw new Error('标注 ID 重复');
  const result: MeasurementRecord[] = [];
  for (const record of restored) {
    if (!isRoi(record)) { result.push(record); continue; }
    const meta = sources.find(item => item.seriesInstanceUid === record.seriesInstanceUid)!;
    const index = meta.planes.findIndex(plane => plane.sopInstanceUid === record.sopInstanceUid && (plane.frameIndex ?? 0) === record.frameIndex);
    const handle = await source.openSeries({ studyInstanceUid: meta.studyInstanceUid, seriesInstanceUid: meta.seriesInstanceUid });
    try {
      const stats = roiStats(record, await handle.pixel(index), meta.planes[index]!);
      const entries = Object.entries(stats);
      if (Object.keys(record.stats).length !== entries.length || entries.some(([key, value]) => {
        const stored = Object.entries(record.stats).find(([name]) => name === key)?.[1];
        return typeof stored !== 'number' || value === undefined || Math.abs(stored - value) > Math.max(1e-6, Math.abs(value) * 1e-9);
      })) throw new Error('区域统计与原始像素不一致，无法恢复');
      result.push({ ...record, stats });
    } finally { handle.dispose(); }
  }
  return result;
}
