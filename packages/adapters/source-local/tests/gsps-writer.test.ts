import { describe, expect, it } from 'vitest';
import dicomParser from 'dicom-parser';
import { encodePart10, numbers, sequence, text, validUid } from '../src/dicom-write';
const CLASS = '1.2.840.10008.5.1.4.1.1.11.1', INSTANCE = '2.25.1234';
describe('Part 10 Explicit VR LE encoder', () => {
  it('writes exact preamble, file meta length, ordered tags, VR lengths and even padding', () => {
    const bytes = encodePart10([text(0x0020000d, 'UI', '2.25.1'), text(0x00080005, 'CS', 'ISO_IR 192'), text(0x00100010, 'PN', '李明')], CLASS, INSTANCE);
    expect([...bytes.subarray(0, 128)]).toEqual(Array(128).fill(0));
    expect(new TextDecoder().decode(bytes.subarray(128, 132))).toBe('DICM');
    expect([...bytes.subarray(132, 140)]).toEqual([2, 0, 0, 0, 85, 76, 4, 0]);
    const parsed = dicomParser.parseDicom(bytes), length = parsed.uint32('x00020000')!;
    expect(new DataView(bytes.buffer).getUint16(144 + length, true)).toBe(8);
    expect(parsed.string('x00020002')).toBe(CLASS);
    expect(parsed.string('x00080018')).toBe(INSTANCE);
    const uid = parsed.elements.x0020000d!;
    expect(uid.length).toBe(6); expect(bytes[uid.dataOffset + uid.length - 1]).toBe(49);
    const name = parsed.elements.x00100010!;
    expect(new TextDecoder().decode(bytes.subarray(name.dataOffset, name.dataOffset + name.length))).toBe('李明');
    expect(text(1, 'UI', '1.2').value).toEqual(new Uint8Array([49, 46, 50, 0]));
    expect(text(1, 'LO', 'a').value).toEqual(new Uint8Array([97, 32]));
  });
  it('writes defined-length nested SQ items and LE numeric payloads', () => {
    const bytes = encodePart10([sequence(0x00700001, [[numbers(0x00700020, 'US', [2]), sequence(0x00700009, [[numbers(0x00700022, 'FL', [0.5, 511.5])]])]])], CLASS, INSTANCE);
    const parsed = dicomParser.parseDicom(bytes), outer = parsed.elements.x00700001!;
    expect(outer.length).toBeGreaterThan(8); expect(outer.length).not.toBe(0xffffffff);
    const item = outer.items![0]!.dataSet; expect(item.uint16('x00700020')).toBe(2);
    const nested = item.elements.x00700009!.items![0]!.dataSet;
    const graphic = nested.elements.x00700022!;
    expect([...bytes.subarray(graphic.dataOffset, graphic.dataOffset + 8)]).toEqual([0, 0, 0, 63, 0, 192, 255, 67]);
  });
  it('rejects duplicates, identity mismatch, invalid numeric ranges and overlong short VR', () => {
    expect(() => encodePart10([text(0x00080018, 'UI', '2.25.9')], CLASS, INSTANCE)).toThrow(/identity/);
    expect(() => encodePart10([text(0x00020010, 'UI', '1.2')], CLASS, INSTANCE)).toThrow(/meta/);
    expect(() => encodePart10([text(0x00080005, 'CS', 'a'), text(0x00080005, 'CS', 'b')], CLASS, INSTANCE)).toThrow(/Duplicate/);
    for (const value of [NaN, Infinity, -1, 65536, 1.5]) expect(() => numbers(1, 'US', [value])).toThrow();
    expect(() => numbers(1, 'FL', [1e39])).toThrow();
    expect(() => encodePart10([text(0x00100020, 'LO', 'a'.repeat(65535))], CLASS, INSTANCE)).toThrow(/too long/);
    expect(validUid('2.25.001')).toBe(false); expect(validUid('2.25.1')).toBe(true);
  });
});
