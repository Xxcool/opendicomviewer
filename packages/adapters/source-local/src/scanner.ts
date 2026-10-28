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
  type SeriesMeta,
  type StudyMeta,
  sortByPosition,
} from '@opendicomviewer/core';
import type { ImportCandidate } from '@opendicomviewer/core';
import { hasDicomPrefix } from './magic';
import { parseDicomMetadata } from './parse';
import {
  extractZipEntriesFromCandidate,
  isZipBuffer,
  zipEntryToCandidate,
} from './zip';
import { getParserPool } from './worker/parser-pool';

export interface FileParseFailure {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}

// 解析实现已迁至 ./parse：①解开 worker → scanner → pool → worker 的循环依赖；
// ②worker 包只带 dicom-parser，不再把 zip 解包与扫描主流程重复打进去。
// 此处保留原导出路径，调用方无需改动。
export {
  parseDicomMetadata,
  parseFloats,
  type ParsedDicomMeta,
} from './parse';

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
  /**
   * 成功解析并纳入序列的文件数。
   * 与 failedFiles 一起构成"成功 n · 失败 m"的唯二数据源：
   * 不能用候选文件数去减，因为 ZIP 会展开、非 DICOM 文件会被静默跳过。
   */
  readonly parsedFileCount: number;
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
  let parsedFileCount = 0;

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

      // 如果是 ZIP 压缩包，按需从中央目录分段拉取条目（深度限制 3，P1-9）
      if (isZipBuffer(headerBuffer)) {
        if (depth >= 3) {
          failedFiles.push({
            id: candidate.id,
            name: candidate.name,
            reason: 'ZIP 嵌套层数超过上限（最大 3 层），已跳过',
          });
          continue;
        }

        // P1-9: 基于中央目录仅读取条目索引与按需分段读取，严禁整包 2GB 读入内存
        const zipEntries = await extractZipEntriesFromCandidate(candidate, signal);
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
      let metadataBuf: ArrayBuffer;
      if (candidate.size > 0 && candidate.size <= 131072) {
        metadataBuf = await candidate.read(0, candidate.size, signal);
      } else {
        metadataBuf = await candidate.read(0, 131072, signal);
      }

      // P1-1: 采用 Worker 线程池并发解析元数据（Transferable 零拷贝，主线程零阻塞）
      let parsed: ReturnType<typeof parseDicomMetadata>;
      try {
        parsed = await getParserPool().parse(metadataBuf, candidate);
      } catch {
        // 若超长私有标签导致 128KB 截断，回退读取完整文件并送入 Worker 解析
        const fallbackBuf = await candidate.read(undefined, undefined, signal);
        parsed = await getParserPool().parse(fallbackBuf, candidate);
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
      parsedFileCount++;
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
    parsedFileCount,
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
    // N4 修复说明：代表整条序列展开后的总切片/帧数，与单文件内 (0028,0008) 物理标签语义解耦
    numberOfFrames: sortRes.sortedPlanes.length,
    planes: sortRes.sortedPlanes,
    excludedPlanes: sortRes.excludedPlanes,
    spacing: [rowSpacing, colSpacing, sliceSpacing],
    warnings: allWarnings,
  };
}
