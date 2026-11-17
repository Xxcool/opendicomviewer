import dicomParser, { type DataSet } from 'dicom-parser';
import { decodeDicomText } from './charset';
import { ENHANCED_SR_CLASS } from './measurement-report';
import { GSPS_SOP_CLASS_UID, readPresentationState } from './presentation-state';
import type { PresentationImageReference } from './presentation-state-reader';
import { parseExchangeDataSet, requiredUid, sequenceItems } from './presentation-state-source';


function single(source: DataSet, tag: string): DataSet {
  const items = sequenceItems(source, tag);
  if (items.length !== 1) throw new Error('当前 SR 读回仅支持单帧测距报告');
  return items[0]!;
}
function codeValue(source: DataSet, tag: string, scheme: string): string | undefined {
  const code = single(source, tag);
  return code.string('x00080102') === scheme ? code.string('x00080100') : undefined;
}

function readMeasurement(item: DataSet, charset: string | undefined, expected: PresentationImageReference) {
  const kind = codeValue(item, 'x0040a043', 'DCM');
  if (item.string('x0040a010') !== 'CONTAINS' || item.string('x0040a040') !== 'NUM' || (kind !== '121206' && kind !== '121211')) throw new Error('SR 包含不支持的测量类型');
  const measured = single(item, 'x0040a300');
  const numeric = measured.string('x0040a30a');
  const lengthMm = Number(numeric);
  if (codeValue(measured, 'x004008ea', 'UCUM') !== 'mm' || !Number.isFinite(lengthMm) || lengthMm <= 0) throw new Error('SR 数值或毫米单位无效');
  const properties = sequenceItems(item, 'x0040a730');
  const geometry = properties.filter(entry => entry.string('x0040a040') === 'SCOORD');
  const comments = properties.filter(entry => entry.string('x0040a040') === 'TEXT');
  if (geometry.length !== 1 || comments.length > 1 || properties.length !== geometry.length + comments.length) throw new Error('SR 包含不支持的内容项');
  const shape = geometry[0]!;
  if (shape.string('x0040a010') !== 'INFERRED FROM' || shape.string('x00700023') !== 'POLYLINE') throw new Error('SR 空间坐标类型无效');
  const graphic = shape.elements.x00700022;
  if (graphic?.vr !== 'FL' || graphic.length < 16 || graphic.length > 2048 * 8 || graphic.length % 8 !== 0 || (kind === '121206' && graphic.length !== 16)) throw new Error('SR 控制点数量无效');
  const view = new DataView(shape.byteArray.buffer, shape.byteArray.byteOffset + graphic.dataOffset, graphic.length);
  const points = Array.from({ length: graphic.length / 8 }, (_, index) =>
    [view.getFloat32(index * 8, true) - 0.5, view.getFloat32(index * 8 + 4, true) - 0.5] as const);
  if (points.some(point => !point.every(Number.isFinite))) throw new Error('SR 控制点无效');
  const image = single(shape, 'x0040a730');
  const ref = single(image, 'x00081199');
  const rawFrame = ref.string('x00081160');
  const frameNumber = rawFrame === undefined ? undefined : Number(rawFrame);
  if (image.string('x0040a010') !== 'SELECTED FROM' || image.string('x0040a040') !== 'IMAGE'
    || requiredUid(ref, 'x00081150') !== expected.sopClassUid || requiredUid(ref, 'x00081155') !== expected.sopInstanceUid
    || (frameNumber !== undefined && (!Number.isSafeInteger(frameNumber) || frameNumber < 1))) throw new Error('SR 源帧引用无效');
  const comment = comments[0];
  let note = '';
  if (comment) {
    const value = comment.elements.x0040a160;
    if (comment.string('x0040a010') !== 'HAS PROPERTIES' || codeValue(comment, 'x0040a043', 'DCM') !== '121106' || !value) throw new Error('SR 备注无效');
    note = decodeDicomText(comment.byteArray.subarray(value.dataOffset, value.dataOffset + value.length), charset).trimEnd();
  }
  return { type: kind === '121206' ? '直线' : '折线', lengthMm, points, frameNumber, note };
}

function readReport(source: DataSet) {
  if (source.string('x0040a040') !== 'CONTAINER'
    || codeValue(source, 'x0040a043', 'DCM') !== '126000') throw new Error('当前仅支持 单帧测距 SR');
  const studyInstanceUid = requiredUid(source, 'x0020000d');
  const evidence = single(source, 'x0040a375');
  if (requiredUid(evidence, 'x0020000d') !== studyInstanceUid) throw new Error('SR 引用的检查与报告不一致');
  const series = single(evidence, 'x00081115');
  const instance = single(series, 'x00081199');
  const reference = { seriesInstanceUid: requiredUid(series, 'x0020000e'), sopClassUid: requiredUid(instance, 'x00081150'), sopInstanceUid: requiredUid(instance, 'x00081155') };
  const measurements = sequenceItems(source, 'x0040a730').map(item => readMeasurement(item, source.string('x00080005'), reference));
  if (!measurements.length || measurements.some(item => item.frameNumber !== measurements[0]!.frameNumber)) throw new Error('SR 必须引用同一源帧');
  return { kind: 'SR' as const, sopInstanceUid: requiredUid(source, 'x00080018'), studyInstanceUid, reference: { ...reference, frameNumber: measurements[0]!.frameNumber }, measurements };
}

export function readExchangeDocument(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('结果文件大小须为 1 字节至 10 MiB');
  const header = dicomParser.parseDicom(bytes, { untilTag: 'x00080018' });
  const type = header.string('x00080016');
  if (type === GSPS_SOP_CLASS_UID) return { kind: 'GSPS' as const, ...readPresentationState(bytes) };
  if (type === ENHANCED_SR_CLASS) return readReport(parseExchangeDataSet(bytes));
  throw new Error('请选择灰阶 GSPS 或 Enhanced SR 测距文件');
}
