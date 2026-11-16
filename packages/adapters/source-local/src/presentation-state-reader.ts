import dicomParser, { type DataSet } from 'dicom-parser';
import { decodeDicomText } from './charset';
import { requiredUid, sequenceItems } from './presentation-state-source';
export interface PresentationImageReference {
  readonly seriesInstanceUid: string;
  readonly sopClassUid: string;
  readonly sopInstanceUid: string;
  /** DICOM one-based frame number; absent for an entire single-frame image. */
  readonly frameNumber?: number;
}
export interface PresentationGraphic {
  readonly type: 'POLYLINE' | 'ELLIPSE';
  /** Original image pixel-center coordinates, after subtracting DICOM's 0.5 boundary offset. */
  readonly points: readonly (readonly [number, number])[];
}
export interface PresentationText { readonly value: string; readonly anchor: readonly [number, number]; readonly visible: boolean }
export interface PresentationStateReadback {
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
  readonly sopInstanceUid: string;
  readonly reference: PresentationImageReference;
  readonly annotations: readonly { readonly graphics: readonly PresentationGraphic[]; readonly texts: readonly PresentationText[] }[];
  readonly voi: { readonly windowWidth: number; readonly windowCenter: number };
  readonly displayArea: { readonly topLeft: readonly number[]; readonly bottomRight: readonly number[]; readonly pixelSpacing?: string; readonly pixelAspectRatio?: string };
  readonly rotation: number;
  readonly horizontalFlip: boolean;
  readonly presentationLutShape: 'IDENTITY' | 'INVERSE';
}

function one(source: DataSet, tag: string): DataSet {
  const entries = sequenceItems(source, tag);
  if (entries.length !== 1) throw new Error('当前 GSPS 读回仅支持单源帧呈现状态');
  return entries[0]!;
}
function floatValues(source: DataSet, tag: string, count: number): number[] {
  const element = source.elements[tag];
  if (!element || element.vr !== 'FL' || element.length !== count * 4) throw new Error('GSPS 图形坐标长度无效');
  const view = new DataView(source.byteArray.buffer, source.byteArray.byteOffset + element.dataOffset, element.length);
  const values = Array.from({ length: count }, (_, index) => view.getFloat32(index * 4, true));
  if (!values.every(Number.isFinite)) throw new Error('GSPS 坐标不是有限数值');
  return values;
}
function pixelPair(source: DataSet, tag: string): readonly [number, number] {
  const values = floatValues(source, tag, 2);
  return [values[0]! - 0.5, values[1]! - 0.5];
}
function graphic(source: DataSet): PresentationGraphic {
  const type = source.string('x00700023'), count = source.uint16('x00700021');
  if ((type !== 'POLYLINE' && type !== 'ELLIPSE') || source.string('x00700005') !== 'PIXEL'
    || source.uint16('x00700020') !== 2 || !count || count < 2 || (type === 'ELLIPSE' && count !== 4)
    || source.string('x00700024') === 'Y') throw new Error('当前 GSPS 读回不支持此图形');
  const coordinates = floatValues(source, 'x00700022', count * 2);
  const points: [number, number][] = Array.from({ length: count }, (_, index) => [coordinates[index * 2]! - 0.5, coordinates[index * 2 + 1]! - 0.5]);
  return { type, points };
}
function textObject(source: DataSet, charset: string | undefined): PresentationText {
  if (source.string('x00700004') !== 'PIXEL' || source.elements.x00700010 || source.elements.x00700011) throw new Error('当前 GSPS 读回仅支持像素坐标文字锚点');
  const element = source.elements.x00700006;
  if (!element) throw new Error('GSPS 缺少文字内容');
  // 字符集继承自顶层；sequence item 不重复 SpecificCharacterSet。
  const value = decodeDicomText(source.byteArray.subarray(element.dataOffset, element.dataOffset + element.length), charset).replace(/[\0 ]+$/u, '');
  const visible = source.string('x00700015');
  if (visible !== 'Y' && visible !== 'N') throw new Error('GSPS 文字锚点可见性无效');
  return { value, anchor: pixelPair(source, 'x00700014'), visible: visible === 'Y' };
}
function imageReference(source: DataSet): PresentationImageReference {
  const series = one(source, 'x00081115'), image = one(series, 'x00081140');
  const rawFrame = image.string('x00081160'), frameNumber = rawFrame === undefined ? undefined : Number(rawFrame);
  if (frameNumber !== undefined && (!Number.isSafeInteger(frameNumber) || frameNumber < 1 || rawFrame?.includes('\\'))) throw new Error('GSPS 帧引用无效');
  return { seriesInstanceUid: requiredUid(series, 'x0020000e'), sopClassUid: requiredUid(image, 'x00081150'),
    sopInstanceUid: requiredUid(image, 'x00081155'), frameNumber };
}
function checkLocalReference(source: DataSet, reference: PresentationImageReference): void {
  if (!source.elements.x00081140) return;
  const image = one(source, 'x00081140');
  if (image.string('x00081150') !== reference.sopClassUid || image.string('x00081155') !== reference.sopInstanceUid
    || image.string('x00081160') !== (reference.frameNumber === undefined ? undefined : String(reference.frameNumber))) throw new Error('GSPS 局部引用与源帧不一致');
}
function signedPair(source: DataSet, tag: string): readonly [number, number] {
  const element = source.elements[tag];
  const first = source.int32(tag, 0), second = source.int32(tag, 1);
  if (element?.length !== 8 || first === undefined || second === undefined) throw new Error('GSPS 显示区域无效');
  return [first, second];
}
function readVoi(source: DataSet, reference: PresentationImageReference): PresentationStateReadback['voi'] {
  const voi = one(source, 'x00283110');
  checkLocalReference(voi, reference);
  const windowWidth = voi.floatString('x00281051'), windowCenter = voi.floatString('x00281050');
  if (voi.elements.x00283010 || (voi.string('x00281056') ?? 'LINEAR') !== 'LINEAR'
    || windowWidth === undefined || windowCenter === undefined || !Number.isFinite(windowWidth)
    || !Number.isFinite(windowCenter) || windowWidth < 1 || voi.string('x00281051')?.includes('\\')
    || voi.string('x00281050')?.includes('\\')) throw new Error('当前 GSPS 读回仅支持单一线性窗宽窗位');
  return { windowWidth, windowCenter };
}
function readArea(source: DataSet, reference: PresentationImageReference): PresentationStateReadback['displayArea'] {
  const area = one(source, 'x0070005a');
  checkLocalReference(area, reference);
  if (area.string('x00700100') !== 'SCALE TO FIT' || (area.string('x00480301') ?? 'FRAME') !== 'FRAME') throw new Error('当前 GSPS 读回仅支持适应显示区域');
  const spacing = area.string('x00700101'), aspect = area.string('x00700102');
  const parts = (spacing ?? aspect ?? '').split('\\').map(Number);
  if (parts.length !== 2 || !parts.every(value => Number.isFinite(value) && value > 0)
    || (spacing === undefined && !parts.every(Number.isSafeInteger))) throw new Error('GSPS 显示像素比例无效');
  return { topLeft: signedPair(area, 'x00700052'), bottomRight: signedPair(area, 'x00700053'),
    pixelSpacing: area.string('x00700101'), pixelAspectRatio: area.string('x00700102') };
}

/** Reads the supported standard GSPS subset, never private JSON or implied measurement values. */
export function readPresentationState(bytes: Uint8Array): PresentationStateReadback {
  const source = dicomParser.parseDicom(bytes);
  if (source.string('x00080016') !== '1.2.840.10008.5.1.4.1.1.11.1'
    || source.string('x00020010') !== '1.2.840.10008.1.2.1') throw new Error('当前读回仅支持 Explicit VR Little Endian GSPS');
  const reference = imageReference(source), rotation = source.uint16('x00700042') ?? 0;
  const presentationLutShape = source.string('x20500020'), flip = source.string('x00700041');
  if (flip !== 'Y' && flip !== 'N') throw new Error('GSPS 水平翻转标志无效');
  if (source.elements.x00286100 || source.elements.x00181600 || source.elements.x00700061
    || source.elements.x20500010) throw new Error('当前 GSPS 读回不支持遮罩、减影、覆盖层或查表呈现');
  if (![0, 90, 180, 270].includes(rotation) || (presentationLutShape !== 'IDENTITY' && presentationLutShape !== 'INVERSE')) throw new Error('当前 GSPS 读回不支持此显示变换');
  const annotations = sequenceItems(source, 'x00700001').map(annotation => {
    checkLocalReference(annotation, reference);
    if (annotation.elements.x00700209) throw new Error('当前 GSPS 读回不支持 Compound Graphic');
    const graphics = sequenceItems(annotation, 'x00700009').map(graphic);
    const texts = sequenceItems(annotation, 'x00700008').map(item => textObject(item, source.string('x00080005')));
    if (!graphics.length && !texts.length) throw new Error('GSPS 包含空标注');
    return { graphics, texts };
  });
  return { studyInstanceUid: requiredUid(source, 'x0020000d'), seriesInstanceUid: requiredUid(source, 'x0020000e'),
    sopInstanceUid: requiredUid(source, 'x00080018'), reference, annotations, voi: readVoi(source, reference),
    displayArea: readArea(source, reference), rotation, horizontalFlip: flip === 'Y', presentationLutShape };
}
