import type { MeasurementRecord, VOIRange } from '@opendicomviewer/core';
import { decimalString, encodePart10, numbers, sequence, text, validUid, type DicomElement } from './dicom-write';
import { annotationItems } from './presentation-state-graphics';
import { presentationSource, type PresentationSource } from './presentation-state-source';
export { readPresentationState } from './presentation-state-reader';
export type { PresentationStateReadback } from './presentation-state-reader';
export const GSPS_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.11.1';
export interface PresentationStateInput {
  readonly sourceBytes: Uint8Array;
  readonly frameIndex: number;
  readonly records: readonly MeasurementRecord[];
  readonly voi: VOIRange;
  readonly sopInstanceUid: string;
  readonly seriesInstanceUid: string;
  readonly date: string;
  readonly time: string;
  readonly rotation?: 0 | 90 | 180 | 270;
  readonly horizontalFlip?: boolean;
}

export function validateExchangeInput(input: PresentationStateInput, source: PresentationSource): void {
  if (!Number.isInteger(input.frameIndex) || input.frameIndex < 0 || input.frameIndex >= source.frameCount) throw new Error('GSPS 源帧号无效');
  if (![input.sopInstanceUid, input.seriesInstanceUid].every(validUid)
    || input.sopInstanceUid === source.sopInstanceUid || input.seriesInstanceUid === source.seriesUid
    || [source.studyUid, source.seriesUid, source.sopInstanceUid].includes(input.sopInstanceUid)
    || [source.studyUid, source.seriesUid, source.sopInstanceUid].includes(input.seriesInstanceUid)
    || input.seriesInstanceUid === input.sopInstanceUid) throw new Error('GSPS 必须使用新的 SOP 和系列 UID');
  if (!Number.isFinite(input.voi.windowCenter) || !Number.isFinite(input.voi.windowWidth) || input.voi.windowWidth < 1) throw new Error('GSPS 窗宽窗位无效');
  if (!/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/u.test(input.date)
    || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/u.test(input.time)) throw new Error('GSPS 创建日期时间无效');
  const calendar = new Date(`${input.date.slice(0, 4)}-${input.date.slice(4, 6)}-${input.date.slice(6, 8)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10).replaceAll('-', '') !== input.date) throw new Error('GSPS 创建日期不存在');
  if (![0, 90, 180, 270].includes(input.rotation ?? 0)) throw new Error('GSPS 仅支持直角旋转');
  if (input.records.length > 10000 || new Set(input.records.map(record => record.id)).size !== input.records.length) throw new Error('GSPS 标注数量或标识无效');
}

function identification(input: PresentationStateInput, source: PresentationSource): DicomElement[] {
  return [...source.identity, text(0x00080005, 'CS', 'ISO_IR 192'), text(0x0020000d, 'UI', source.studyUid),
    text(0x0020000e, 'UI', input.seriesInstanceUid), text(0x00200011, 'IS', '1'), text(0x00200013, 'IS', '1'),
    text(0x00080060, 'CS', 'PR'), text(0x00080070, 'LO', 'OpenDicomViewer'),
    text(0x00700080, 'CS', 'ANNOTATIONS'), text(0x00700081, 'LO', 'Image annotations'),
    text(0x00700082, 'DA', input.date), text(0x00700083, 'TM', input.time), text(0x00700084, 'PN', ''),
    text(0x00080012, 'DA', input.date), text(0x00080013, 'TM', input.time)];
}

export function imageReference(source: PresentationSource, frameIndex: number): DicomElement[] {
  const reference = [text(0x00081150, 'UI', source.sopClassUid), text(0x00081155, 'UI', source.sopInstanceUid)];
  if (source.frameCount > 1) reference.push(text(0x00081160, 'IS', String(frameIndex + 1)));
  return reference;
}

function displayArea(source: PresentationSource, reference: readonly DicomElement[], input: PresentationStateInput): DicomElement {
  // C.10.4: corners are selected after rotation/flip but encoded in the original pixel axes.
  const corners = [[1, 1], [source.columns, 1], [source.columns, source.rows], [1, source.rows]];
  const index = (4 - (input.rotation ?? 0) / 90 + (input.horizontalFlip ? 1 : 0)) % 4;
  const area = [sequence(0x00081140, [reference]), numbers(0x00700052, 'SL', corners[index]!),
    numbers(0x00700053, 'SL', corners[(index + 2) % 4]!), text(0x00700100, 'CS', 'SCALE TO FIT')];
  area.push(source.pixelSpacing ? text(0x00700101, 'DS', source.pixelSpacing.join('\\')) : text(0x00700102, 'IS', source.pixelAspectRatio!));
  return sequence(0x0070005a, [area]);
}

function presentation(input: PresentationStateInput, source: PresentationSource, reference: readonly DicomElement[]): DicomElement[] {
  const center = decimalString(input.voi.windowCenter), width = decimalString(input.voi.windowWidth);
  return [...source.modality, sequence(0x00081115, [[text(0x0020000e, 'UI', source.seriesUid), sequence(0x00081140, [reference])]]),
    displayArea(source, reference, input), sequence(0x00283110, [[sequence(0x00081140, [reference]),
      text(0x00281050, 'DS', center), text(0x00281051, 'DS', width), text(0x00281056, 'CS', 'LINEAR')]]),
    text(0x20500020, 'CS', source.monochrome1 ? 'INVERSE' : 'IDENTITY'),
    numbers(0x00700042, 'US', [input.rotation ?? 0]), text(0x00700041, 'CS', input.horizontalFlip ? 'Y' : 'N')];
}

/** Standard GSPS for one original grayscale frame; numeric measurement semantics belong in SR. */
export function writePresentationState(input: PresentationStateInput): Uint8Array {
  const source = presentationSource(input.sourceBytes);
  validateExchangeInput(input, source);
  const reference = imageReference(source, input.frameIndex);
  const annotations = annotationItems(input.records, source, input.frameIndex, reference);
  const elements = [...identification(input, source), ...presentation(input, source, reference)];
  if (annotations.length) elements.push(sequence(0x00700001, annotations), sequence(0x00700060, [[
    text(0x00700002, 'CS', 'ANNOTATIONS'), text(0x00700062, 'IS', '1'), numbers(0x00700066, 'US', [65535]),
  ]]));
  return encodePart10(elements, GSPS_SOP_CLASS_UID, input.sopInstanceUid);
}
