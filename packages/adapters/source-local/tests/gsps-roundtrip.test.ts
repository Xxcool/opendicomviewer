import { describe, expect, it } from 'vitest';
import dicomParser from 'dicom-parser';
import type { MeasurementRecord } from '@opendicomviewer/core';
import { writePresentationState, readPresentationState, GSPS_SOP_CLASS_UID, type PresentationStateInput } from '../src/presentation-state';
import { writeMeasurementReport } from '../src/measurement-report';
import { readExchangeDocument } from '../src/exchange-reader';
import { sequence, text } from '../src/dicom-write';
import { buildDicomBuffer, type DicomFixtureOptions } from '../testing/dicom-fixture';
function source(options: DicomFixtureOptions = {}): Uint8Array {
  return buildDicomBuffer({ studyInstanceUid: '2.25.1', seriesInstanceUid: '2.25.2', sopInstanceUid: '2.25.3',
    rows: 64, columns: 80, pixelData: new Uint8Array(64 * 80 * 2), pixelSpacing: [2, 0.5],
    specificCharacterSet: 'ISO_IR 192', patientName: '合成^测试', patientId: 'SYNTHETIC', ...options });
}
function record(type: MeasurementRecord['type'], points: readonly [number, number, number][], text?: string): MeasurementRecord {
  return { id: type, seriesInstanceUid: '2.25.2', sopInstanceUid: '2.25.3', sessionId: 'fixture', frameIndex: 0,
    coordinateSpace: 'image-pixel', type, points, stats: {}, createdAt: 0, text };
}
function input(records: readonly MeasurementRecord[] = [], options: Partial<PresentationStateInput> = {}): PresentationStateInput {
  return { sourceBytes: source(), frameIndex: 0, records, voi: { windowCenter: 40, windowWidth: 400 },
    sopInstanceUid: '2.25.4', seriesInstanceUid: '2.25.5', date: '20261109', time: '153000', ...options };
}
const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [79, 63, 0];
describe('GSPS standard-byte roundtrip', () => {
  it('preserves source references and source bytes; creates a separate UTF-8 GSPS identity', () => {
    const request = input([record('text', [a], '中文备注')]), before = request.sourceBytes.slice();
    const bytes = writePresentationState(request), parsed = dicomParser.parseDicom(bytes), result = readPresentationState(bytes);
    expect(request.sourceBytes).toEqual(before);
    expect(parsed.string('x00080016')).toBe(GSPS_SOP_CLASS_UID); expect(parsed.string('x00080060')).toBe('PR');
    expect(parsed.string('x00080005')).toBe('ISO_IR 192'); expect(parsed.elements.x7fe00010).toBeUndefined();
    expect(result.studyInstanceUid).toBe('2.25.1'); expect(result.seriesInstanceUid).toBe('2.25.5'); expect(result.sopInstanceUid).toBe('2.25.4');
    expect(result.reference).toEqual({ seriesInstanceUid: '2.25.2', sopClassUid: '1.2.840.10008.5.1.4.1.1.2', sopInstanceUid: '2.25.3', frameNumber: undefined });
    expect(result.annotations[0]!.texts[0]).toEqual({ value: '中文备注', anchor: [0, 0], visible: false });
    const name = parsed.elements.x00100010!;
    expect(new TextDecoder().decode(bytes.subarray(name.dataOffset, name.dataOffset + name.length)).trim()).toBe('合成^测试');
    expect(result.voi).toEqual({ windowCenter: 40, windowWidth: 400 });
    expect(result.displayArea).toEqual({ topLeft: [1, 1], bottomRight: [80, 64], pixelSpacing: '2\\0.5', pixelAspectRatio: undefined });
  });
  it('encodes all supported geometries with boundary coordinates rather than private JSON', () => {
    const records = [record('length', [a, b]), record('arrow', [a, b], '箭头'), record('polyline', [a, [20, 30, 0], b]),
      record('rectangleRoi', [a, b]), record('ellipseRoi', [a, b]), record('angle', [a, [20, 30, 0], b]),
      record('cobbAngle', [a, [20, 10, 0], [40, 40, 0], b]), record('freehand', [a, [10, 20, 0], b])];
    const bytes = writePresentationState(input(records)), result = readPresentationState(bytes);
    expect(result.annotations).toHaveLength(8);
    expect(result.annotations.map(item => item.graphics.length)).toEqual([1, 2, 1, 1, 1, 1, 2, 1]);
    expect(result.annotations[0]!.graphics[0]!.points).toEqual([[0, 0], [79, 63]]);
    expect(result.annotations[3]!.graphics[0]!.points).toEqual([[0, 0], [79, 0], [79, 63], [0, 63], [0, 0]]);
    expect(result.annotations[4]!.graphics[0]!.type).toBe('ELLIPSE');
    const parsed = dicomParser.parseDicom(bytes), graphic = parsed.elements.x00700001!.items![0]!.dataSet.elements.x00700009!.items![0]!.dataSet;
    const element = graphic.elements.x00700022!, view = new DataView(bytes.buffer, element.dataOffset, element.length);
    expect([view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true), view.getFloat32(12, true)]).toEqual([0.5, 0.5, 79.5, 63.5]);
    expect(Object.keys(parsed.elements).some(tag => parseInt(tag.slice(1, 5), 16) % 2)).toBe(false);
  });
  it('keeps frame references one-based, MONOCHROME1 inversion, rotation, flip and window boundary', () => {
    const multi = source({ photometricInterpretation: 'MONOCHROME1', extraElements: [{ tag: [0x0028, 0x0008], vr: 'IS', value: '3' }] });
    const current = { ...record('length', [a, b]), frameIndex: 2 };
    const result = readPresentationState(writePresentationState(input([current], { sourceBytes: multi, frameIndex: 2, rotation: 90, horizontalFlip: true, voi: { windowCenter: -1024, windowWidth: 1 } })));
    expect(result.reference.frameNumber).toBe(3); expect(result.presentationLutShape).toBe('INVERSE');
    expect(result.displayArea.topLeft).toEqual([1, 1]); expect(result.displayArea.bottomRight).toEqual([80, 64]);
    expect(result.rotation).toBe(90); expect(result.horizontalFlip).toBe(true); expect(result.voi.windowWidth).toBe(1);
  });
  it('encodes displayed corners after each clockwise rotation before optional horizontal flip', () => {
    const rotations = [0, 90, 180, 270] satisfies NonNullable<PresentationStateInput['rotation']>[];
    const expected = [[1, 1], [1, 64], [80, 64], [80, 1]];
    rotations.forEach((rotation, index) => {
      const result = readPresentationState(writePresentationState(input([], { rotation })));
      expect(result.displayArea.topLeft).toEqual(expected[index]);
    });
  });
  it('allows VOI-only state without inventing measurements', () => {
    const result = readPresentationState(writePresentationState(input()));
    expect(result.annotations).toEqual([]); expect(result.presentationLutShape).toBe('IDENTITY');
  });
});
describe('GSPS rejects unsupported or inconsistent inputs explicitly', () => {
  it('rejects color, missing source identity, missing pixels, invalid source scaling and LUT', () => {
    for (const options of [{ photometricInterpretation: 'RGB', samplesPerPixel: 3 }, { studyInstanceUid: '' }, { seriesInstanceUid: '' },
      { sopInstanceUid: '' }, { sopClassUid: '' }, { pixelData: undefined }, { rescaleSlope: 0 },
      { extraElements: [{ tag: [0x0028, 0x3000], vr: 'SQ', value: new Uint8Array() }] }] satisfies DicomFixtureOptions[]) {
      expect(() => writePresentationState(input([], { sourceBytes: source(options) }))).toThrow();
    }
  });
  it('rejects foreign frame/series/SOP, probe, bad point counts, out-of-frame and degenerate geometry', () => {
    for (const changed of [{ seriesInstanceUid: '2.25.99' }, { sopInstanceUid: '2.25.99' }, { frameIndex: 1 },
      { points: [[-0.01, 0, 0], b] }, { points: [a, [80, 2, 0]] }, { points: [a, [1, 1, 1]] },
      { points: [a, [NaN, 1, 0]] }, { points: [a] }, { points: [a, a] }] satisfies Partial<MeasurementRecord>[]) {
      expect(() => writePresentationState(input([{ ...record('length', [a, b]), ...changed }]))).toThrow();
    }
    expect(() => writePresentationState(input([record('probe', [a])]))).toThrow(/工具/);
    expect(() => writePresentationState(input([record('text', [a], '')]))).toThrow(/为空/);
    expect(() => writePresentationState(input([record('text', [a], 'a\tb')]))).toThrow(/控制字符/);
    expect(() => writePresentationState(input([record('ellipseRoi', [a, [10, 0, 0]])]))).toThrow(/退化/);
  });
  it('rejects identity reuse, invalid frame/window/date and duplicate annotation identifiers', () => {
    for (const options of [{ sopInstanceUid: '2.25.3' }, { seriesInstanceUid: '2.25.2' }, { sopInstanceUid: 'bad' },
      { frameIndex: -1 }, { frameIndex: 1 }, { frameIndex: 0.5 }, { date: '20261301' }, { date: '20260230' }, { time: '250000' },
      { voi: { windowCenter: 0, windowWidth: 0 } }, { voi: { windowCenter: Infinity, windowWidth: 1 } }] satisfies Partial<PresentationStateInput>[]) {
      expect(() => writePresentationState(input([], options))).toThrow();
    }
    expect(() => writePresentationState(input([record('length', [a, b]), record('length', [a, b])]))).toThrow(/标识/);
  });
  it('rejects functional-group scaling and spacing instead of assuming top-level values', () => {
    for (const nested of [sequence(0x00289145, [[text(0x00281053, 'DS', '2')]]), sequence(0x00289110, [[text(0x00280030, 'DS', '2\\1')]])]) {
      const frames = sequence(0x52009230, [[nested]]);
      const bytes = source({ extraElements: [{ tag: [0x5200, 0x9230], vr: 'SQ', value: frames.value }] });
      expect(() => writePresentationState(input([], { sourceBytes: bytes }))).toThrow(/功能组/);
    }
  });
  it('reader rejects inconsistent standard references and unsupported graphic units', () => {
    const bytes = writePresentationState(input([record('length', [a, b])]));
    const parsed = dicomParser.parseDicom(bytes), annotation = parsed.elements.x00700001!.items![0]!.dataSet;
    const image = annotation.elements.x00081140!.items![0]!.dataSet, uid = image.elements.x00081155!;
    const foreign = bytes.slice(); foreign[uid.dataOffset + 5] = 57;
    expect(() => readPresentationState(foreign)).toThrow(/局部引用/);
    const graphic = annotation.elements.x00700009!.items![0]!.dataSet, units = graphic.elements.x00700005!;
    const wrongUnits = bytes.slice(); wrongUnits[units.dataOffset] = 68;
    expect(() => readPresentationState(wrongUnits)).toThrow(/不支持此图形/);
    const flip = parsed.elements.x00700041!, wrongFlip = bytes.slice(); wrongFlip[flip.dataOffset] = 88;
    expect(() => readPresentationState(wrongFlip)).toThrow(/翻转/);
  });
  it('reader rejects non-GSPS bytes and truncated GSPS', () => {
    expect(() => readPresentationState(source())).toThrow(/GSPS/);
    const bytes = writePresentationState(input([record('length', [a, b])]));
    expect(() => readPresentationState(bytes.subarray(0, bytes.length - 9))).toThrow();
  });
});

describe('单帧毫米测距 SR', () => {
  it('保留各向异性毫米数值、像素坐标、中文备注与源实例引用', () => {
    const segment = { ...record('length', [a, [4, 0, 0]], '教学备注'), stats: { lengthMm: 2 } };
    const path = { ...record('polyline', [a, [4, 0, 0], [4, 3, 0]]), stats: { lengthMm: 8 } };
    const report = readExchangeDocument(writeMeasurementReport(input([segment, path])));
    expect(report.kind).toBe('SR');
    if (report.kind !== 'SR') throw new Error('缺少测距报告');
    expect(report.reference.sopInstanceUid).toBe('2.25.3');
    expect(report.measurements.map(item => item.lengthMm)).toEqual([2, 8]);
    expect(report.measurements[1]!.points).toEqual([[0, 0], [4, 0], [4, 3]]);
    expect(report.measurements[0]!.note).toBe('教学备注');
    expect(() => writeMeasurementReport(input([{ ...segment, stats: { lengthMm: 4 } }]))).toThrow(/标定/);
    expect(() => writeMeasurementReport(input([]))).toThrow(/没有/);
  });
});
