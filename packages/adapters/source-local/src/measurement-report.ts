import type { MeasurementRecord } from '@opendicomviewer/core';
import { decimalString, encodePart10, numbers, sequence, text, type DicomElement } from './dicom-write';
import { imageReference, validateExchangeInput, type PresentationStateInput } from './presentation-state';
import { validatedPoints } from './presentation-state-graphics';
import { presentationSource, type PresentationSource } from './presentation-state-source';

export const ENHANCED_SR_CLASS = '1.2.840.10008.5.1.4.1.1.88.22';
const CONTENT = 0x0040a730;

function code(tag: number, value: string, scheme: string, meaning: string) {
  return sequence(tag, [[text(0x00080100, 'SH', value), text(0x00080102, 'SH', scheme), text(0x00080104, 'LO', meaning)]]);
}

function contentItem(relation: string, type: string): DicomElement[] {
  return [text(0x0040a010, 'CS', relation), text(0x0040a040, 'CS', type)];
}

function measurement(record: MeasurementRecord, source: PresentationSource, frameIndex: number, ref: DicomElement[]): DicomElement[] {
  if (record.type !== 'length' && record.type !== 'polyline') throw new Error('测距 SR 仅支持直线和折线');
  const points = validatedPoints(record, source, frameIndex);
  const length = record.stats.lengthMm;
  if (!source.pixelSpacing || length === undefined || !Number.isFinite(length) || length <= 0) throw new Error('SR 测距需要经过标定的毫米数值');
  const [rows, columns] = source.pixelSpacing;
  const measured = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(
    (point[0] - points[index]![0]) * columns, (point[1] - points[index]![1]) * rows), 0);
  if (Math.abs(measured - length) > Math.max(1e-6, measured * 1e-6)) throw new Error('测距与源帧标定或控制点不一致');

  const coordinates = [...contentItem('INFERRED FROM', 'SCOORD'), text(0x00700023, 'CS', 'POLYLINE'),
    numbers(0x00700022, 'FL', points.flatMap(point => [...point])), sequence(CONTENT, [
      [...contentItem('SELECTED FROM', 'IMAGE'), sequence(0x00081199, [ref])],
    ])];
  const properties = [coordinates];
  if (record.text) properties.push([...contentItem('HAS PROPERTIES', 'TEXT'),
    code(0x0040a043, '121106', 'DCM', 'Comment'), text(0x0040a160, 'UT', record.text)]);
  const name = record.type === 'length' ? code(0x0040a043, '121206', 'DCM', 'Distance') : code(0x0040a043, '121211', 'DCM', 'Path length');
  return [...contentItem('CONTAINS', 'NUM'), name, sequence(0x0040a300, [[text(0x0040a30a, 'DS', decimalString(length)),
    code(0x004008ea, 'mm', 'UCUM', 'millimeter')]]), sequence(CONTENT, properties)];
}

/** By-value Enhanced SR with one referenced frame. No TID 1500 conformance claim. */
export function writeMeasurementReport(input: PresentationStateInput): Uint8Array {
  const source = presentationSource(input.sourceBytes);
  validateExchangeInput(input, source);
  if (!input.records.length) throw new Error('当前帧没有可导出的测距');
  const ref = imageReference(source, input.frameIndex);
  // Evidence lists SOP instances. Frame selection belongs to the IMAGE content item.
  const evidence = [text(0x0020000d, 'UI', source.studyUid), sequence(0x00081115, [[text(0x0020000e, 'UI', source.seriesUid),
    sequence(0x00081199, [ref.filter(element => element.tag !== 0x00081160)])]])];
  return encodePart10([...source.identity, text(0x00080005, 'CS', 'ISO_IR 192'), text(0x0020000d, 'UI', source.studyUid),
    text(0x0020000e, 'UI', input.seriesInstanceUid), text(0x00200011, 'IS', '1'), text(0x00200013, 'IS', '1'),
    text(0x00080060, 'CS', 'SR'), text(0x00080070, 'LO', 'OpenDicomViewer'), sequence(0x00081111, []),
    text(0x00080023, 'DA', input.date), text(0x00080033, 'TM', input.time), sequence(0x0040a372, []),
    text(0x0040a491, 'CS', 'COMPLETE'), text(0x0040a493, 'CS', 'UNVERIFIED'), sequence(0x0040a375, [evidence]),
    text(0x0040a040, 'CS', 'CONTAINER'), text(0x0040a050, 'CS', 'SEPARATE'), code(0x0040a043, '126000', 'DCM', 'Imaging Measurement Report'),
    sequence(CONTENT, input.records.map(record => measurement(record, source, input.frameIndex, ref)))], ENHANCED_SR_CLASS, input.sopInstanceUid);
}
