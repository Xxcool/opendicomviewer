import type { MeasurementRecord } from '@opendicomviewer/core';
import { numbers, sequence, text, type DicomElement } from './dicom-write';
import type { PresentationSource } from './presentation-state-source';
type Point = readonly [number, number];

function graphic(type: 'POLYLINE' | 'ELLIPSE', points: readonly Point[]): DicomElement[] {
  return [text(0x00700005, 'CS', 'PIXEL'), numbers(0x00700020, 'US', [2]),
    numbers(0x00700021, 'US', [points.length]), numbers(0x00700022, 'FL', points.flatMap(point => [...point])),
    text(0x00700023, 'CS', type), text(0x00700024, 'CS', 'N')];
}

function roiGraphic(type: MeasurementRecord['type'], a: Point, b: Point): DicomElement[] {
  if (a[0] === b[0] || a[1] === b[1]) throw new Error('GSPS 区域不能退化为线');
  const left = Math.min(a[0], b[0]), right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]), bottom = Math.max(a[1], b[1]);
  if (type === 'rectangleRoi') return graphic('POLYLINE', [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]);
  const horizontal: readonly Point[] = [[left, (top + bottom) / 2], [right, (top + bottom) / 2]];
  const vertical: readonly Point[] = [[(left + right) / 2, top], [(left + right) / 2, bottom]];
  return graphic('ELLIPSE', right - left >= bottom - top ? [...horizontal, ...vertical] : [...vertical, ...horizontal]);
}

function arrowGraphics(a: Point, b: Point, source: PresentationSource): DicomElement[][] {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (length === 0) throw new Error('GSPS 箭头不能为零长度');
  const edge = Math.min(a[0], a[1], source.columns - a[0], source.rows - a[1]);
  const size = Math.min(8, length / 4, edge / 1.5), ux = dx / length, uy = dy / length;
  // 领域箭头的起点是箭头尖端，head 两侧保持在线段邻域。
  return [graphic('POLYLINE', [a, b]), graphic('POLYLINE', [
    [a[0] + size * (ux - uy / 2), a[1] + size * (uy + ux / 2)], a,
    [a[0] + size * (ux + uy / 2), a[1] + size * (uy - ux / 2)],
  ])];
}

function recordGraphics(record: MeasurementRecord, points: readonly Point[], source: PresentationSource): DicomElement[][] {
  if (record.type === 'text') return [];
  const a = points[0]!, b = points[1]!;
  if (record.type === 'rectangleRoi' || record.type === 'ellipseRoi') return [roiGraphic(record.type, a, b)];
  if (record.type === 'arrow') return arrowGraphics(a, b, source);
  if (record.type === 'cobbAngle') return [graphic('POLYLINE', points.slice(0, 2)), graphic('POLYLINE', points.slice(2, 4))];
  return [graphic('POLYLINE', record.type === 'freehand' ? [...points, points[0]!] : points)];
}

export function validatedPoints(record: MeasurementRecord, source: PresentationSource, frameIndex: number): Point[] {
  if (record.coordinateSpace !== 'image-pixel' || record.seriesInstanceUid !== source.seriesUid
    || record.sopInstanceUid !== source.sopInstanceUid || record.frameIndex !== frameIndex) throw new Error('标注不属于选定源影像帧');
  const counts: Partial<Record<MeasurementRecord['type'], number>> = { text: 1, length: 2, arrow: 2, rectangleRoi: 2, ellipseRoi: 2, angle: 3, cobbAngle: 4 };
  if (record.type === 'probe' || (!(record.type in counts) && record.type !== 'polyline' && record.type !== 'freehand')) throw new Error('GSPS 不支持此工具类型');
  if (counts[record.type] !== undefined ? record.points.length !== counts[record.type] : record.points.length < (record.type === 'freehand' ? 3 : 2) || record.points.length > 2048) throw new Error('GSPS 控制点数量无效');
  if (record.points.some(([x, y, z]) => ![x, y, z].every(Number.isFinite) || z !== 0 || x < 0 || y < 0 || x > source.columns - 1 || y > source.rows - 1)) throw new Error('GSPS 控制点超出源帧');
  if (record.type !== 'text' && record.points.slice(1).some((point, index) => point[0] === record.points[index]![0] && point[1] === record.points[index]![1] && (record.type !== 'cobbAngle' || index !== 1))) throw new Error('GSPS 图形包含零长度线段');
  // C.10.5 PIXEL 原点在像素边界；领域坐标原点在第一个像素中心。
  return record.points.map(([x, y]) => [x + 0.5, y + 0.5]);
}

function recordText(record: MeasurementRecord, anchor: Point): DicomElement[][] {
  const value = record.text?.replace(/\r\n|\r|\n/gu, '\r\n');
  if (record.type === 'text' && !value?.trim()) throw new Error('GSPS 文字标注不能为空');
  if (!value) return [];
  if (Array.from(value).some(character => { const code = character.charCodeAt(0); return (code < 32 && code !== 10 && code !== 13) || code === 127; }) || new TextEncoder().encode(value).length > 1024) throw new Error('GSPS 文字包含无效控制字符或过长');
  return [[text(0x00700004, 'CS', 'PIXEL'), text(0x00700006, 'ST', value),
    numbers(0x00700014, 'FL', anchor), text(0x00700015, 'CS', record.type === 'arrow' ? 'Y' : 'N')]];
}

export function annotationItems(records: readonly MeasurementRecord[], source: PresentationSource, frameIndex: number, reference: readonly DicomElement[]): DicomElement[][] {
  return records.map(record => {
    const points = validatedPoints(record, source, frameIndex);
    const graphics = recordGraphics(record, points, source), texts = recordText(record, points[0]!);
    const items = [text(0x00700002, 'CS', 'ANNOTATIONS'), sequence(0x00081140, [reference])];
    if (graphics.length) items.push(sequence(0x00700009, graphics));
    if (texts.length) items.push(sequence(0x00700008, texts));
    return items;
  });
}
