declare module 'dicom-parser' {
  export interface Fragment {
    readonly offset: number;
    readonly position: number;
    readonly length: number;
  }

  export interface DicomElement {
    readonly tag: string;
    readonly vr?: string;
    readonly length: number;
    readonly dataOffset: number;
    readonly items?: readonly DicomItem[];
    /** 封装（压缩）像素数据标记，仅 (7FE0,0010) 可能为 true */
    readonly encapsulatedPixelData?: boolean;
    /** 基本偏移表：每帧首片段在 fragments 中的字节偏移 */
    readonly basicOffsetTable?: readonly number[];
    readonly fragments?: readonly Fragment[];
  }

  export interface DicomItem {
    readonly dataSet: DataSet;
    readonly tag?: string;
    readonly length?: number;
    readonly dataOffset?: number;
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

  /**
   * 取出封装像素数据中指定帧的压缩码流（按基本偏移表拼接该帧的全部片段）。
   */
  export function readEncapsulatedImageFrame(
    dataSet: DataSet,
    pixelDataElement: DicomElement,
    frameIndex: number,
    basicOffsetTable?: readonly number[],
    fragments?: readonly Fragment[],
  ): Uint8Array;

  /**
   * 从指定片段起拼接 numFragments 个片段的字节。
   * 空 Basic Offset Table 时按 dicom-parser 既有语义把全部片段视为同一帧。
   */
  export function readEncapsulatedPixelDataFromFragments(
    dataSet: DataSet,
    pixelDataElement: DicomElement,
    startFragmentIndex: number,
    numFragments?: number,
    fragments?: readonly Fragment[],
  ): Uint8Array;
}
