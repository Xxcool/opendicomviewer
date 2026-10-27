/**
 * DICOMDIR (Media Storage Directory) 索引解析器
 *
 * 严格遵循 ARCHITECTURE.md §7.5：
 * 优先解析 DICOMDIR，依据其建立 Study -> Series -> Image 索引树，
 * 避免无索引时光盘或大目录的全盘重复全扫描。
 * 针对 DICOMDIR 的 Directory Record Sequence 手动处理层级记录与引用文件映射。
 */

import type { ImportCandidate, Modality, StudyMeta } from '@opendicomviewer/core';
import dicomParser from 'dicom-parser';
import { decodeDicomText } from './charset';

export interface DicomdirImageRef {
  readonly referencedFileId: string;
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
 * 将形如 "IMAGES\CT0001" 或 ["IMAGES", "CT0001"] 规范化为 "images/ct0001"
 */
export function normalizeReferencedPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim()
    .toLowerCase();
}

/**
 * 解析 DICOMDIR 字节流并构建目录索引
 */
export function parseDicomdir(bytes: Uint8Array): DicomdirStudy[] {
  const dataSet = dicomParser.parseDicom(bytes);
  const recordSeq = dataSet.elements.x00041220;
  if (!recordSeq || !recordSeq.items) {
    return [];
  }

  const studies: DicomdirStudy[] = [];
  let currentPatientId = 'ANONYMOUS';
  let currentPatientName = 'ANONYMOUS';
  let currentStudy: DicomdirStudy | null = null;
  let currentSeries: DicomdirSeries | null = null;

  for (const item of recordSeq.items) {
    const ds = item.dataSet;
    const recordType = (ds.string('x00041430') ?? '').trim().toUpperCase();

    switch (recordType) {
      case 'PATIENT': {
        currentPatientId = ds.string('x00100020') ?? 'ANONYMOUS';
        const pnElement = ds.elements.x00100010;
        if (pnElement) {
          const pnBytes = ds.byteArray.slice(
            pnElement.dataOffset,
            pnElement.dataOffset + pnElement.length,
          );
          currentPatientName = decodeDicomText(
            pnBytes,
            ds.string('x00080005'),
          );
        } else {
          currentPatientName = ds.string('x00100010') ?? currentPatientId;
        }
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

        let refFile = ds.string('x00041500') ?? '';
        // 兼容多值分隔 (0004,1500 可能是多值或者带 \\)
        refFile = normalizeReferencedPath(refFile);
        if (!refFile) break;

        currentSeries.images.push({
          referencedFileId: refFile,
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
 * 根据 DICOMDIR 记录的文件路径与输入的 ImportCandidate 进行匹配关联
 */
export function matchCandidateByRefId(
  candidates: readonly ImportCandidate[],
  refId: string,
): ImportCandidate | undefined {
  const target = normalizeReferencedPath(refId);
  for (const c of candidates) {
    const candPath = normalizeReferencedPath(c.name);
    if (candPath === target || candPath.endsWith('/' + target)) {
      return c;
    }
  }
  return undefined;
}
