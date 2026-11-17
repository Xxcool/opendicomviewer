import dicomParser, { type DataSet } from 'dicom-parser';
import { decodeDicomText } from './charset';
import { text, validUid, type DicomElement, type TextVR } from './dicom-write';

export interface PresentationSource {
  readonly studyUid: string;
  readonly seriesUid: string;
  readonly sopClassUid: string;
  readonly sopInstanceUid: string;
  readonly frameCount: number;
  readonly rows: number;
  readonly columns: number;
  readonly monochrome1: boolean;
  readonly identity: readonly DicomElement[];
  readonly modality: readonly DicomElement[];
  readonly pixelSpacing?: readonly [number, number];
  readonly pixelAspectRatio?: string;
}

export function parseExchangeDataSet(bytes: Uint8Array): DataSet {
  // 隐式 VR 的坐标和文字锚点均按 DICOM 数据字典使用 FL，显式 VR 保留文件中的类型校验。
  const source = dicomParser.parseDicom(bytes, {
    vrCallback: tag => tag === 'x00700022' || tag === 'x00700014' ? 'FL' : undefined,
  });
  const syntax = source.string('x00020010');
  if (syntax !== '1.2.840.10008.1.2' && syntax !== '1.2.840.10008.1.2.1') {
    throw new Error('结果读回仅支持 Explicit 或 Implicit VR Little Endian');
  }
  return source;
}

export function dicomText(source: DataSet, tag: string): string {
  const element = source.elements[tag];
  if (!element) return '';
  return decodeDicomText(source.byteArray.subarray(element.dataOffset, element.dataOffset + element.length), source.string('x00080005')).replace(/[\0 ]+$/u, '');
}

export function requiredUid(source: DataSet, tag: string): string {
  const uid = source.string(tag)?.trim() ?? '';
  if (!validUid(uid)) throw new Error('DICOM 缺少有效的源对象 UID');
  return uid;
}

function sourceIdentity(source: DataSet): DicomElement[] {
  const fields: readonly (readonly [number, TextVR])[] = [
    [0x00100010, 'PN'], [0x00100020, 'LO'], [0x00100030, 'DA'], [0x00100040, 'CS'],
    [0x00080020, 'DA'], [0x00080030, 'TM'], [0x00080050, 'SH'], [0x00080090, 'PN'], [0x00200010, 'SH'],
  ];
  return fields.map(([tag, vr]) => text(tag, vr, dicomText(source, `x${tag.toString(16).padStart(8, '0')}`)));
}

export function sequenceItems(source: DataSet, tag: string): DataSet[] {
  return source.elements[tag]?.items?.map(item => {
    if (!item.dataSet) throw new Error('DICOM 序列项缺少数据集');
    return item.dataSet;
  }) ?? [];
}

function sourceModality(source: DataSet): DicomElement[] {
  const groups = [source, ...sequenceItems(source, 'x52009229'), ...sequenceItems(source, 'x52009230')];
  if (groups.some(group => group.elements.x00289110)) throw new Error('当前 GSPS 不支持功能组像素间距');
  if (groups.some(group => group.elements.x00283000 || group.elements.x00289145)) {
    throw new Error('当前 GSPS 不支持 Modality LUT 或功能组灰度变换');
  }
  const slope = source.string('x00281053'), intercept = source.string('x00281052');
  if (slope === undefined && intercept === undefined) return [];
  if (!slope || !intercept || !Number.isFinite(Number(slope)) || Number(slope) === 0 || !Number.isFinite(Number(intercept))) {
    throw new Error('源图像 Rescale 变换不完整或无效');
  }
  return [text(0x00281053, 'DS', slope), text(0x00281052, 'DS', intercept),
    text(0x00281054, 'LO', source.string('x00281054') || 'US')];
}

function sourceAspect(source: DataSet): Pick<PresentationSource, 'pixelSpacing' | 'pixelAspectRatio'> {
  const raw = source.string('x00280030');
  if (raw !== undefined) {
    const parts = raw.split('\\').map(Number);
    if (parts.length !== 2 || !parts.every(value => Number.isFinite(value) && value > 0)) throw new Error('源图像像素间距无效');
    return { pixelSpacing: [parts[0]!, parts[1]!] };
  }
  const aspect = source.string('x00280034');
  if (aspect !== undefined && !/^[1-9]\d*\\[1-9]\d*$/u.test(aspect)) throw new Error('源图像像素比例无效');
  // 未指定间距/比例的图像按 DICOM 默认方形像素显示，不创建物理标定。
  return { pixelAspectRatio: aspect ?? '1\\1' };
}

/** Only metadata is parsed; the original pixel buffer is never written. */
export function presentationSource(bytes: Uint8Array): PresentationSource {
  const source = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
  const photo = source.string('x00280004');
  if (photo !== 'MONOCHROME1' && photo !== 'MONOCHROME2') throw new Error('GSPS 仅支持二维灰阶源图像');
  if (source.uint16('x00280002') !== 1 || !source.elements.x7fe00010) throw new Error('源图像必须包含单通道像素数据');
  const rows = source.uint16('x00280010'), columns = source.uint16('x00280011');
  const frameCount = Number(source.string('x00280008') ?? '1');
  if (!rows || !columns || !Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('源图像尺寸或帧数无效');
  return { studyUid: requiredUid(source, 'x0020000d'), seriesUid: requiredUid(source, 'x0020000e'),
    sopClassUid: requiredUid(source, 'x00080016'), sopInstanceUid: requiredUid(source, 'x00080018'),
    rows, columns, frameCount, monochrome1: photo === 'MONOCHROME1',
    identity: sourceIdentity(source), modality: sourceModality(source), ...sourceAspect(source) };
}
