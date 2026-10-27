declare module 'dicom-parser' {
  export interface DicomElement {
    readonly tag: string;
    readonly vr?: string;
    readonly length: number;
    readonly dataOffset: number;
    readonly items?: readonly DicomItem[];
  }

  export interface DicomItem {
    readonly dataSet: DataSet;
  }

  export interface DataSet {
    readonly byteArray: Uint8Array;
    readonly elements: Record<string, DicomElement | undefined>;
    string(tag: string, index?: number): string | undefined;
    text(tag: string, index?: number): string | undefined;
    uint16(tag: string, index?: number): number | undefined;
    int16(tag: string, index?: number): number | undefined;
    uint32(tag: string, index?: number): number | undefined;
    int32(tag: string, index?: number): number | undefined;
    floatString(tag: string, index?: number): number | undefined;
    intString(tag: string, index?: number): number | undefined;
    element(tag: string): DicomElement | undefined;
  }

  export interface ParseOptions {
    readonly untilTag?: string;
    readonly maxBytesToParse?: number;
  }

  export function parseDicom(
    byteArray: Uint8Array,
    options?: ParseOptions,
  ): DataSet;
}
