/**
 * DICOMDIR (Media Storage Directory) 索引解析器
 *
 * 严格遵循 ARCHITECTURE.md §7.5：
 * 优先解析 DICOMDIR，依据其建立 Study -> Series -> Image 索引树，避免全盘重复扫描。
 * P1-7 修复：优先按 (0004,1200) / (0004,1400) / (0004,1410) 真实 offset 链遍历层级树，
 * 并以物理顺序遍历作为兜底。
 * P1-8 修复：建立 O(1) 路径快速查表索引。
 * N5 修复：保留原始 referencedFileId 大小写。
 */

import type { ImportCandidate, Modality, StudyMeta } from '@opendicomviewer/core';
import dicomParser, { type DataSet } from 'dicom-parser';
import { decodeDicomText } from './charset';

export interface DicomdirImageRef {
  /** 原始文件路径（保留大小写，N5） */
  readonly referencedFileId: string;
  /** 规范化小写路径（用于 O(1) 跨平台比对） */
  readonly normalizedPath: string;
  readonly sopInstanceUid?: string;
  readonly instanceNumber?: number;
}

export interface DicomdirSeries {
  readonly seriesInstanceUid: string;
  readonly modality: Modality;
  readonly seriesNumber?: number;
  readonly seriesDescription: string;
  readonly images: DicomdirImageRef[];
}

export interface DicomdirStudy {
  readonly studyInstanceUid: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly studyDate?: string;
  readonly studyDescription: string;
  readonly series: DicomdirSeries[];
}

/**
 * 标准化 DICOMDIR 中 Referenced File ID (0004,1500)
 */
export function normalizeReferencedPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim()
    .toLowerCase();
}

/**
 * 从 DICOMDIR 记录数据集提取 Patient 信息
 */
function extractPatientInfo(ds: DataSet): { id: string; name: string } {
  const id = ds.string('x00100020') ?? 'ANONYMOUS';
  const pnElement = ds.elements.x00100010;
  let name: string;
  if (pnElement) {
    const pnBytes = ds.byteArray.slice(
      pnElement.dataOffset,
      pnElement.dataOffset + pnElement.length,
    );
    name = decodeDicomText(pnBytes, ds.string('x00080005'));
  } else {
    name = ds.string('x00100010') ?? id;
  }
  return { id, name };
}

/**
 * 解析 DICOMDIR 字节流（优先按 offset 链遍历树，失败回退顺序遍历，P1-7）
 */
export function parseDicomdir(bytes: Uint8Array): DicomdirStudy[] {
  const dataSet = dicomParser.parseDicom(bytes);
  const recordSeq = dataSet.elements.x00041220;
  if (!recordSeq || !recordSeq.items) {
    return [];
  }

  // 1. 建立 offset -> DataSet 映射表 (P1-7)
  const offsetMap = new Map<number, DataSet>();
  for (const item of recordSeq.items) {
    if (!item.dataSet) continue;
    const offset = item.dataOffset ?? item.dataSet.elements.x00041430?.dataOffset;
    if (offset !== undefined) {
      // 兼容指向 Item Tag (dataOffset - 8) 或数据起始 (dataOffset) 的偏移指针
      offsetMap.set(offset - 8, item.dataSet);
      offsetMap.set(offset, item.dataSet);
    }
  }

  const firstRootOffset = dataSet.uint32('x00041200');

  // 若存在有效 root offset，沿 (0004,1400) 兄弟与 (0004,1410) 子节点链遍历
  if (firstRootOffset && offsetMap.has(firstRootOffset)) {
    const studies: DicomdirStudy[] = [];
    const visited = new Set<number>();

    function traverseRecords(
      startOffset: number,
      parentStudy: DicomdirStudy | null,
      parentSeries: DicomdirSeries | null,
      patientInfo: { id: string; name: string },
    ): void {
      let currOffset: number | undefined = startOffset;

      while (currOffset && currOffset > 0 && offsetMap.has(currOffset)) {
        if (visited.has(currOffset)) {
          break; // 防止坏盘死循环
        }
        visited.add(currOffset);

        const ds = offsetMap.get(currOffset);
        if (!ds) break;

        const recordType = (ds.string('x00041430') ?? '').trim().toUpperCase();
        // 下级实体指针：优先 (0004,1410)，部分机型写 (0004,1420)
        const lowerOffset = ds.uint32('x00041410') || ds.uint32('x00041420');
        const nextOffset = ds.uint32('x00041400');

        let nextPatientInfo = patientInfo;
        let nextStudy = parentStudy;
        let nextSeries = parentSeries;

        switch (recordType) {
          case 'PATIENT': {
            nextPatientInfo = extractPatientInfo(ds);
            break;
          }
          case 'STUDY': {
            const studyUid = ds.string('x0020000d');
            if (studyUid) {
              const study: DicomdirStudy = {
                studyInstanceUid: studyUid,
                patientId: patientInfo.id,
                patientName: patientInfo.name,
                studyDate: ds.string('x00080020'),
                studyDescription: ds.string('x00081030') ?? '',
                series: [],
              };
              studies.push(study);
              nextStudy = study;
              nextSeries = null;
            }
            break;
          }
          case 'SERIES': {
            const seriesUid = ds.string('x0020000e');
            if (seriesUid && parentStudy) {
              const series: DicomdirSeries = {
                seriesInstanceUid: seriesUid,
                modality: ds.string('x00080060') ?? 'OT',
                seriesNumber: ds.intString('x00200011'),
                seriesDescription: ds.string('x0008103e') ?? '',
                images: [],
              };
              parentStudy.series.push(series);
              nextSeries = series;
            }
            break;
          }
          case 'IMAGE': {
            const rawRef = ds.string('x00041500');
            if (rawRef && parentSeries) {
              parentSeries.images.push({
                referencedFileId: rawRef,
                normalizedPath: normalizeReferencedPath(rawRef),
                sopInstanceUid: ds.string('x00041511'),
                instanceNumber: ds.intString('x00200013'),
              });
            }
            break;
          }
        }

        // 递归访问下级实体
        if (lowerOffset && lowerOffset > 0 && offsetMap.has(lowerOffset)) {
          traverseRecords(lowerOffset, nextStudy, nextSeries, nextPatientInfo);
        }

        currOffset = nextOffset;
      }
    }

    traverseRecords(firstRootOffset, null, null, {
      id: 'ANONYMOUS',
      name: 'ANONYMOUS',
    });

    if (studies.length > 0) {
      return studies;
    }
  }

  // 2. 兜底策略：若 offset 缺失或损坏，按物理 sequence items 顺序解析
  return parseDicomdirSequential(recordSeq.items);
}

function parseDicomdirSequential(
  items: readonly { readonly dataSet?: DataSet }[],
): DicomdirStudy[] {
  const studies: DicomdirStudy[] = [];
  let currentPatientId = 'ANONYMOUS';
  let currentPatientName = 'ANONYMOUS';
  let currentStudy: DicomdirStudy | null = null;
  let currentSeries: DicomdirSeries | null = null;

  for (const item of items) {
    const ds = item.dataSet;
    if (!ds) continue;
    const recordType = (ds.string('x00041430') ?? '').trim().toUpperCase();

    switch (recordType) {
      case 'PATIENT': {
        const p = extractPatientInfo(ds);
        currentPatientId = p.id;
        currentPatientName = p.name;
        break;
      }

      case 'STUDY': {
        const studyUid = ds.string('x0020000d') ?? '';
        if (!studyUid) break;

        currentStudy = {
          studyInstanceUid: studyUid,
          patientId: currentPatientId,
          patientName: currentPatientName,
          studyDate: ds.string('x00080020'),
          studyDescription: ds.string('x00081030') ?? '',
          series: [],
        };
        studies.push(currentStudy);
        currentSeries = null;
        break;
      }

      case 'SERIES': {
        if (!currentStudy) break;
        const seriesUid = ds.string('x0020000e') ?? '';
        if (!seriesUid) break;

        currentSeries = {
          seriesInstanceUid: seriesUid,
          modality: ds.string('x00080060') ?? 'OT',
          seriesNumber: ds.intString('x00200011'),
          seriesDescription: ds.string('x0008103e') ?? '',
          images: [],
        };
        currentStudy.series.push(currentSeries);
        break;
      }

      case 'IMAGE': {
        if (!currentSeries) break;
        const rawRef = ds.string('x00041500') ?? '';
        if (!rawRef) break;

        currentSeries.images.push({
          referencedFileId: rawRef,
          normalizedPath: normalizeReferencedPath(rawRef),
          sopInstanceUid: ds.string('x00041511'),
          instanceNumber: ds.intString('x00200013'),
        });
        break;
      }
    }
  }

  return studies;
}

/**
 * 将解析出的 DicomdirStudy 列表转化为上层标准的 StudyMeta 摘要
 */
export function dicomdirToStudyMetas(studies: readonly DicomdirStudy[]): StudyMeta[] {
  return studies.map((st) => {
    const modalities = Array.from(new Set(st.series.map((s) => s.modality)));
    return {
      studyInstanceUid: st.studyInstanceUid,
      patientId: st.patientId,
      patientName: st.patientName,
      studyDate: st.studyDate,
      studyDescription: st.studyDescription,
      modalities,
      seriesCount: st.series.length,
    };
  });
}

/**
 * 构建 O(1) 候选文件快速索引 Map (P1-8)
 */
export function createCandidateIndex(
  candidates: readonly ImportCandidate[],
): Map<string, ImportCandidate> {
  const index = new Map<string, ImportCandidate>();
  for (const c of candidates) {
    const norm = normalizeReferencedPath(c.name);
    index.set(norm, c);
    const base = norm.split('/').pop();
    if (base && !index.has(base)) {
      index.set(base, c);
    }
  }
  return index;
}

/**
 * 依据 DICOMDIR 记录快速查表获取 ImportCandidate (O(1) 复杂度，P1-8)
 */
export function matchCandidateO1(
  candidateIndex: Map<string, ImportCandidate>,
  refId: string,
): ImportCandidate | undefined {
  const norm = normalizeReferencedPath(refId);
  const direct = candidateIndex.get(norm);
  if (direct) return direct;

  const base = norm.split('/').pop();
  return base ? candidateIndex.get(base) : undefined;
}
