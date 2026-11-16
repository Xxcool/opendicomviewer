import type { SeriesHandle, MeasurementRecord, VOIRange, ImagePlane } from '@opendicomviewer/core';
import { readExchangeDocument, writeMeasurementReport, writePresentationState } from '@opendicomviewer/source-local';
import { frameResultArchive } from './original-dicom';
import { pathStats } from '../annotations/annotation-path';
import { belongsToFrame } from '../annotations/annotation-geometry';

export type ExchangeDocument = ReturnType<typeof readExchangeDocument>;

export function checkExchangeReference(result: ExchangeDocument, handle: SeriesHandle, plane: ImagePlane) {
  const ref = result.reference;
  if (result.studyInstanceUid !== handle.meta.studyInstanceUid || ref.seriesInstanceUid !== handle.meta.seriesInstanceUid
    || ref.sopInstanceUid !== plane.sopInstanceUid || ref.sopClassUid !== plane.sopClassUid
    || ref.frameNumber !== (plane.frameIndex === undefined ? undefined : plane.frameIndex + 1)) throw new Error('文件引用的源影像与当前帧不匹配，请定位到对应原始帧后重试');
}
function newUid(): string {
  return '2.25.' + BigInt('0x' + crypto.randomUUID().replaceAll('-', '')).toString();
}

export async function buildFrameExchange(kind: 'GSPS' | 'SR' | 'bundle', handle: SeriesHandle, index: number, sessionId: string,
  records: readonly MeasurementRecord[], voi: VOIRange, signal: AbortSignal) {
  const plane = handle.meta.planes[index];
  const originals = handle.originalCandidates?.(index);
  if (!plane || originals?.length !== 1) throw new Error('无法取得当前帧的唯一原始实例');
  const file = originals[0]!;
  const bytes = await file.read(undefined, undefined, signal);
  signal.throwIfAborted();
  if (bytes.byteLength !== file.size) throw new Error('原始文件读取不完整，请重新导入');
  const current = records.filter(record => belongsToFrame(record, sessionId, handle.meta.seriesInstanceUid, plane));
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const input = {
    sourceBytes: new Uint8Array(bytes), frameIndex: plane.frameIndex ?? 0, records: current,
    voi, sopInstanceUid: newUid(), seriesInstanceUid: newUid(), date: String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()),
    time: pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()),
  };
  function encode(type: 'GSPS' | 'SR') {
    const output = type === 'SR'
      ? writeMeasurementReport({ ...input, sopInstanceUid: newUid(), seriesInstanceUid: newUid(),
          records: current.filter(record => record.type === 'length' || record.type === 'polyline') })
      : writePresentationState(input);
    checkExchangeReference(readExchangeDocument(output), handle, plane!);
    return output;
  }
  if (kind === 'bundle') {
    const entries: Parameters<typeof frameResultArchive>[0][number][] = [
      { name: 'source.dcm', bytes: input.sourceBytes },
      { name: 'presentation-state.dcm', bytes: encode('GSPS') },
    ];
    if (current.some(record => record.type === 'length' || record.type === 'polyline')) {
      entries.push({ name: 'distance-report.dcm', bytes: encode('SR') });
    }
    return frameResultArchive(entries, signal);
  }
  return new Blob([encode(kind)], { type: 'application/dicom' });
}

export function reportRecords(report: Extract<ExchangeDocument, { kind: 'SR' }>, handle: SeriesHandle, plane: ImagePlane, sessionId: string): MeasurementRecord[] {
  checkExchangeReference(report, handle, plane);
  return report.measurements.map((item, index) => {
    const type = item.type === '直线' ? 'length' : 'polyline';
    const points = item.points.map<[number, number, number]>(([x, y]) => [x, y, 0]);
    const stats = pathStats({ type, points }, plane);
    // SCOORD 使用 float32，允许序列化精度损失，同时验证毫米值与原图标定。
    if (Math.abs(stats.lengthMm! - item.lengthMm) > Math.max(0.001, item.lengthMm * 1e-5)) {
      throw new Error('SR 测距与源帧标定不一致，无法加入标注');
    }
    return { id: `sr-${report.sopInstanceUid}-${index}`, type, points, stats, text: item.note,
      seriesInstanceUid: handle.meta.seriesInstanceUid, sopInstanceUid: plane.sopInstanceUid,
      frameIndex: plane.frameIndex ?? 0, coordinateSpace: 'image-pixel', createdAt: Date.now(), sessionId };
  });
}
