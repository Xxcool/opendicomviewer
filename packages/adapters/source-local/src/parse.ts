/**
 * 单文件 DICOM 元数据解析（纯函数，无宿主依赖）
 *
 * 单独成模块的两个原因：
 * 1. **解开循环依赖**：worker 原本 import `scanner`，而 `scanner` 又 import `parser-pool`，
 *    形成 worker → scanner → pool → worker 的环，只是靠"恰好没人调用"才没炸；
 * 2. **控制 worker 包体积**：worker 只该带 `dicom-parser` + 本文件，
 *    不该把 zip 解包、扫描主流程一起打进去，否则与主线程重复打包（P1-1 缺陷 g）。
 *
 * 严格遵循：
 * - P1-2：调用方传 `untilTag`，不把像素数据读进来；
 * - P1-5：空间几何缺失显式标记 `hasMissingGeometry`，禁止静默编造。
 */

import {
  type ImagePlane,
  type Modality,
} from '@opendicomviewer/core';
import type { ImportCandidate } from '@opendicomviewer/core';
import dicomParser, { type ParseOptions } from 'dicom-parser';
import { decodeDicomText } from './charset';
import { resolveMultiframePlanes } from './frame-geometry';
import { parseModalityLUT } from './modality-lut';
import { pixelEncoding } from './pixel-values';

/**
 * 单文件元数据解析结果（唯一事实来源）
 *
 * Worker 通道与主线程回退通道共用此类型，避免两处各写一份结构体导致漂移。
 */
export interface ParsedDicomMeta {
  plane: ImagePlane;
  studyUid: string;
  patientId: string;
  patientName: string;
  studyDate?: string;
  studyDescription: string;
  seriesUid: string;
  seriesNumber?: number;
  seriesDescription: string;
  modality: Modality;
  /** 本文件内的帧数 (0028,0008)，单帧文件为 1（D5） */
  numberOfFramesInFile: number;
  /** 标准功能组解析后的逐帧元数据；只用于单文件多帧。 */
  frames?: readonly ImagePlane[];
  frameGeometryUnavailable: boolean;
  frameOrientationVaried: boolean;
}

export function parseFloats(
  raw: string | undefined,
  expectedCount: number,
): number[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split('\\').map((p) => parseFloat(p.trim()));
  if (parts.length < expectedCount || parts.some((n) => isNaN(n))) {
    return undefined;
  }
  return parts;
}

/**
 * 解析单个 DICOM 文件元数据（使用 untilTag: 'x7fe00010' 避免读取大像素数据，P1-2）
 */
export function parseDicomMetadata(
  bytes: Uint8Array,
  candidate: Pick<ImportCandidate, 'id'>,
  options: ParseOptions = { untilTag: 'x7fe00010' },
): ParsedDicomMeta {
  const dataSet = dicomParser.parseDicom(bytes, options);

  const sopInstanceUid = dataSet.string('x00080018');
  if (!sopInstanceUid) {
    throw new Error('缺少 SOPInstanceUID (0008,0018)');
  }

  const studyUid = dataSet.string('x0020000d') || 'UNKNOWN_STUDY';
  const seriesUid = dataSet.string('x0020000e') || 'UNKNOWN_SERIES';
  const modality = dataSet.string('x00080060') || 'OT';
  const patientId = dataSet.string('x00100020') || 'ANONYMOUS';

  const charset = dataSet.string('x00080005');
  let patientName = patientId;
  const pnElem = dataSet.elements.x00100010;
  if (pnElem) {
    const pnBytes = dataSet.byteArray.slice(
      pnElem.dataOffset,
      pnElem.dataOffset + pnElem.length,
    );
    patientName = decodeDicomText(pnBytes, charset);
  }

  // P1-5: 空间几何缺失校验，不得静默编造默认值
  const ippFloats = parseFloats(dataSet.string('x00200032'), 3);
  const iopFloats = parseFloats(dataSet.string('x00200037'), 6);
  const hasMissingGeometry = !ippFloats || !iopFloats;

  const ipp: [number, number, number] = ippFloats
    ? [ippFloats[0] ?? 0, ippFloats[1] ?? 0, ippFloats[2] ?? 0]
    : [0, 0, 0];

  const iop: [number, number, number, number, number, number] = iopFloats
    ? [
        iopFloats[0] ?? 1,
        iopFloats[1] ?? 0,
        iopFloats[2] ?? 0,
        iopFloats[3] ?? 0,
        iopFloats[4] ?? 1,
        iopFloats[5] ?? 0,
      ]
    : [1, 0, 0, 0, 1, 0];

  const psFloats = parseFloats(dataSet.string('x00280030'), 2);
  const pixelSpacing: [number, number] = [
    psFloats?.[0] ?? 1.0,
    psFloats?.[1] ?? 1.0,
  ];

  // D5: 单文件多帧的帧数与逐帧位置（(0028,0008) 缺省为 1）
  const rawFrames = dataSet.string('x00280008')?.trim();
  const numberOfFramesInFile = rawFrames === undefined ? 1 : Number(rawFrames);
  if ((rawFrames !== undefined && !/^\+?\d+$/.test(rawFrames))
    || !Number.isSafeInteger(numberOfFramesInFile) || numberOfFramesInFile < 1) {
    throw new Error('NumberOfFrames (0028,0008) 必须为正整数');
  }
  const spacingBetweenSlices = dataSet.floatString('x00180088');
  const sliceThickness = dataSet.floatString('x00180050');
  const modalityLUT = parseModalityLUT(dataSet);
  const encoding = pixelEncoding(dataSet);

  const plane: ImagePlane = {
    sopClassUid: dataSet.string('x00080016'),
    imageType: dataSet.string('x00080008')?.split('\\').map(value => value.trim().toUpperCase()),
    hasMissingPixelSpacing: !psFloats,
    imageId: candidate.id,
    sopInstanceUid,
    instanceNumber: dataSet.intString('x00200013'),
    imagePositionPatient: ipp,
    imageOrientationPatient: iop,
    pixelSpacing,
    sliceThickness: sliceThickness,
    spacingBetweenSlices: spacingBetweenSlices,
    rows: dataSet.uint16('x00280010') ?? 512,
    columns: dataSet.uint16('x00280011') ?? 512,
    rescaleSlope: dataSet.floatString('x00281053') ?? 1.0,
    rescaleIntercept: dataSet.floatString('x00281052') ?? 0.0,
    modalityLUT,
    bodyPartExamined: dataSet.string('x00180015'),
    windowCenter: dataSet.floatString('x00281050'),
    windowWidth: dataSet.floatString('x00281051'),
    bitsAllocated: encoding.bitsAllocated,
    bitsStored: encoding.bitsStored,
    pixelRepresentation: encoding.pixelRepresentation,
    photometricInterpretation: dataSet.string('x00280004') ?? 'MONOCHROME2',
    frameOfReferenceUID: dataSet.string('x00200052'),
    specificCharacterSet: charset,
    transferSyntaxUid: dataSet.string('x00020010'),
    hasMissingGeometry,
  };

  const frameGeometry = numberOfFramesInFile > 1
    ? resolveMultiframePlanes(dataSet, plane, numberOfFramesInFile) : undefined;

  return {
    plane,
    studyUid,
    patientId,
    patientName,
    studyDate: dataSet.string('x00080020'),
    studyDescription: dataSet.string('x00081030') ?? '',
    seriesUid,
    seriesNumber: dataSet.intString('x00200011'),
    seriesDescription: dataSet.string('x0008103e') ?? '',
    modality,
    numberOfFramesInFile,
    frames: frameGeometry?.planes,
    frameGeometryUnavailable: frameGeometry?.unavailable ?? false,
    frameOrientationVaried: frameGeometry?.orientationVaried ?? false,
  };
}
