/**
 * 本地 DICOM 文件递归扫描与元数据提取器
 *
 * 严格遵循规范：
 * §7.5 导入健壮性：逐文件隔离异常，损坏文件不中断整批导入。
 * P1-2: 读元数据采用 untilTag 与头部切片，不把大像素读入内存。
 * P1-5: 空间几何缺失显式标记 hasMissingGeometry，严禁静默伪装成正常切片。
 * 严格支持 AbortSignal 可中断扫描，不留孤儿任务。
 * 序列内部调用 sortByPosition 执行几何物理排序与缺层告警。
 */

import {
  type ImagePlane,
  type Modality,
  type ModalityLUT,
  type SeriesMeta,
  type StudyMeta,
  sortByPosition,
} from '@opendicomviewer/core';
import type { ImportCandidate } from '@opendicomviewer/core';
import dicomParser, { type ParseOptions } from 'dicom-parser';
import { decodeDicomText } from './charset';
import { hasDicomPrefix } from './magic';
import { extractZipEntries, isZipBuffer, zipEntryToCandidate } from './zip';

export interface FileParseFailure {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}

export interface InternalSeriesData {
  readonly studyInstanceUid: string;
  readonly seriesInstanceUid: string;
  readonly seriesNumber?: number;
  readonly seriesDescription: string;
  readonly modality: Modality;
  readonly planes: ImagePlane[];
  readonly candidateByImageId: Map<string, ImportCandidate>;
}

export interface ScanResult {
  readonly studies: StudyMeta[];
  readonly seriesList: InternalSeriesData[];
  readonly failedFiles: FileParseFailure[];
}

function parseFloats(raw: string | undefined, expectedCount: number): number[] | undefined {
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
  candidate: ImportCandidate,
  options: ParseOptions = { untilTag: 'x7fe00010' },
): {
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
} {
  const dataSet = dicomParser.parseDicom(bytes, options);

  const sopInstanceUid = dataSet.string('x00080018');
  if (!sopInstanceUid) {
    throw new Error('缺少 SOPInstanceUID (0008,0018)');
  }

  const studyUid = dataSet.string('x0020000d') || 'UNKNOWN_STUDY';
  const seriesUid = dataSet.string('x0020000e') || 'UNKNOWN_SERIES';
  const modality = (dataSet.string('x00080060') || 'OT') as Modality;
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

  const psFloats = parseFloats(dataSet.string('x00280030'), 2) ?? [1.0, 1.0];
  const pixelSpacing: [number, number] = [
    psFloats[0] ?? 1.0,
    psFloats[1] ?? 1.0,
  ];

  // N1: 解析 ModalityLUTSequence (0028,3002)
  let modalityLUT: ModalityLUT | undefined;
  const lutSeq = dataSet.elements.x00283002;
  if (lutSeq && lutSeq.items && lutSeq.items[0]) {
    const itemDs = lutSeq.items[0].dataSet;
    const desc = parseFloats(itemDs.string('x00283002'), 3);
    const lutDataElem = itemDs.elements.x00283006;
    if (desc && desc.length >= 3 && lutDataElem) {
      const rawLutBytes = itemDs.byteArray.slice(
        lutDataElem.dataOffset,
        lutDataElem.dataOffset + lutDataElem.length,
      );
      const lutData = new Uint16Array(
        rawLutBytes.buffer,
        rawLutBytes.byteOffset,
        rawLutBytes.byteLength / 2,
      );
      modalityLUT = {
        firstMappedPixelValue: desc[1] ?? 0,
        bitsStored: desc[2] ?? 16,
        lutData,
      };
    }
  }

  const plane: ImagePlane = {
    imageId: candidate.id,
    sopInstanceUid,
    instanceNumber: dataSet.intString('x00200013'),
    imagePositionPatient: ipp,
    imageOrientationPatient: iop,
    pixelSpacing,
    sliceThickness: dataSet.floatString('x00180050'),
    spacingBetweenSlices: dataSet.floatString('x00180088'),
    rows: dataSet.uint16('x00280010') ?? 512,
    columns: dataSet.uint16('x00280011') ?? 512,
    rescaleSlope: dataSet.floatString('x00281053') ?? 1.0,
    rescaleIntercept: dataSet.floatString('x00281052') ?? 0.0,
    modalityLUT,
    windowCenter: dataSet.floatString('x00281050'),
    windowWidth: dataSet.floatString('x00281051'),
    bitsAllocated: dataSet.uint16('x00280100') ?? 16,
    bitsStored: dataSet.uint16('x00280101') ?? 16,
    pixelRepresentation: dataSet.uint16('x00280103') ?? 0,
    photometricInterpretation: dataSet.string('x00280004') ?? 'MONOCHROME2',
    frameOfReferenceUID: dataSet.string('x00200052'),
    specificCharacterSet: charset,
    transferSyntaxUid: dataSet.string('x00020010'),
    hasMissingGeometry,
  };

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
  };
}

/**
 * 扫描并分析候选文件列表，支持 ZIP 自动展开与深度限制 (P1-9)
 */
export async function scanCandidates(
  candidates: readonly ImportCandidate[],
  signal?: AbortSignal,
): Promise<ScanResult> {
  const queue: Array<{ candidate: ImportCandidate; depth: number }> =
    candidates.map((c) => ({ candidate: c, depth: 0 }));
  const failedFiles: FileParseFailure[] = [];

  const studiesMap = new Map<string, {
    studyMeta: StudyMeta;
    seriesMap: Map<string, InternalSeriesData>;
  }>();

  let processedCount = 0;

  while (queue.length > 0) {
    if (signal?.aborted) {
      throw new DOMException('导入已由用户中断', 'AbortError');
    }

    const item = queue.shift();
    if (!item) continue;
    const { candidate, depth } = item;

    // P1-1: 主线程定期让出控制权，防止大序列解析冻结 UI 帧循环
    processedCount++;
    if (processedCount % 50 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    try {
      // 检查前 132 字节魔数判定是否为 DICOM
      const headerBuffer = await candidate.read(0, 132, signal);
      if (signal?.aborted) {
        throw new DOMException('导入已由用户中断', 'AbortError');
      }

      // 如果是 ZIP 压缩包，自动流式解包并将子条目入队（深度限制 3，P1-9）
      if (isZipBuffer(headerBuffer)) {
        if (depth >= 3) {
          failedFiles.push({
            id: candidate.id,
            name: candidate.name,
            reason: 'ZIP 嵌套层数超过上限（最大 3 层），已跳过',
          });
          continue;
        }

        const fullZipBuffer = await candidate.read(undefined, undefined, signal);
        const zipEntries = await extractZipEntries(fullZipBuffer);
        for (const entry of zipEntries) {
          if (!entry.isDirectory) {
            queue.push({
              candidate: zipEntryToCandidate(candidate.id, entry),
              depth: depth + 1,
            });
          }
        }
        continue;
      }

      // 必须通过 DICM 魔数校验（不依赖文件扩展名）
      if (!hasDicomPrefix(headerBuffer)) {
        continue;
      }

      // P1-2: 先按需读取前 128 KB 元数据段，不将几十 MB 的像素数据读入内存
      let metadataBytes: Uint8Array;
      if (candidate.size > 0 && candidate.size <= 131072) {
        const fullBuf = await candidate.read(0, candidate.size, signal);
        metadataBytes = new Uint8Array(fullBuf);
      } else {
        const chunkBuf = await candidate.read(0, 131072, signal);
        metadataBytes = new Uint8Array(chunkBuf);
      }

      let parsed: ReturnType<typeof parseDicomMetadata>;
      try {
        parsed = parseDicomMetadata(metadataBytes, candidate, {
          untilTag: 'x7fe00010',
        });
      } catch {
        // 若超长私有标签导致 128KB 截断，回退读取完整文件
        const fallbackBuf = await candidate.read(undefined, undefined, signal);
        parsed = parseDicomMetadata(new Uint8Array(fallbackBuf), candidate, {
          untilTag: 'x7fe00010',
        });
      }

      // 归类到 Study 树
      let studyRecord = studiesMap.get(parsed.studyUid);
      if (!studyRecord) {
        studyRecord = {
          studyMeta: {
            studyInstanceUid: parsed.studyUid,
            patientId: parsed.patientId,
            patientName: parsed.patientName,
            studyDate: parsed.studyDate,
            studyDescription: parsed.studyDescription,
            modalities: [parsed.modality],
            seriesCount: 0,
          },
          seriesMap: new Map(),
        };
        studiesMap.set(parsed.studyUid, studyRecord);
      }

      // 归类到 Series 树
      let seriesRecord = studyRecord.seriesMap.get(parsed.seriesUid);
      if (!seriesRecord) {
        seriesRecord = {
          studyInstanceUid: parsed.studyUid,
          seriesInstanceUid: parsed.seriesUid,
          seriesNumber: parsed.seriesNumber,
          seriesDescription: parsed.seriesDescription,
          modality: parsed.modality,
          planes: [],
          candidateByImageId: new Map(),
        };
        studyRecord.seriesMap.set(parsed.seriesUid, seriesRecord);
      }

      seriesRecord.planes.push(parsed.plane);
      seriesRecord.candidateByImageId.set(parsed.plane.imageId, candidate);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // 隔离单个文件异常，不中断整批导入（§7.5）
      const message = err instanceof Error ? err.message : String(err);
      failedFiles.push({
        id: candidate.id,
        name: candidate.name,
        reason: message,
      });
    }
  }

  // 组装最终结果
  const studies: StudyMeta[] = [];
  const seriesList: InternalSeriesData[] = [];

  for (const st of studiesMap.values()) {
    const allSeries = Array.from(st.seriesMap.values());
    const modalities = Array.from(new Set(allSeries.map((s) => s.modality)));
    studies.push({
      ...st.studyMeta,
      modalities,
      seriesCount: allSeries.length,
    });
    seriesList.push(...allSeries);
  }

  return {
    studies,
    seriesList,
    failedFiles,
  };
}

/**
 * 将序列中所有切片经过 sortByPosition 处理并构建完整的 SeriesMeta
 */
export function buildSortedSeriesMeta(
  seriesData: InternalSeriesData,
  additionalFailures?: readonly FileParseFailure[],
): SeriesMeta {
  const sortRes = sortByPosition(seriesData.planes);
  const rowSpacing = seriesData.planes[0]?.pixelSpacing[0] ?? 1.0;
  const colSpacing = seriesData.planes[0]?.pixelSpacing[1] ?? 1.0;
  const sliceSpacing = sortRes.expectedSpacing;

  const allWarnings = [...sortRes.warnings];
  if (additionalFailures && additionalFailures.length > 0) {
    allWarnings.push({
      code: 'DECODE_PARTIAL_FAILURE',
      message: `序列中有 ${additionalFailures.length} 个文件解析失败，已安全跳过`,
      severity: 'warning',
      details: { failedCount: additionalFailures.length },
    });
  }

  return {
    seriesInstanceUid: seriesData.seriesInstanceUid,
    studyInstanceUid: seriesData.studyInstanceUid,
    seriesNumber: seriesData.seriesNumber,
    seriesDescription: seriesData.seriesDescription,
    modality: seriesData.modality,
    numberOfFrames: sortRes.sortedPlanes.length,
    planes: sortRes.sortedPlanes,
    excludedPlanes: sortRes.excludedPlanes,
    spacing: [rowSpacing, colSpacing, sliceSpacing],
    warnings: allWarnings,
  };
}
