/**
 * OpenDicomViewer 视图与会话状态管理（Zustand）
 *
 * 遵循架构规范 §6.4：
 * 1. 仅管理低频的 UI 态（研究/序列列表、当前激活序列）与导入任务态；
 * 2. 渲染态（切片位置、相机、调窗、GPU 纹理）完全由 CS3D 与渲染器自行持有；
 * 3. 严格遵循 R4：高频渲染循环（滚轮翻页、鼠标右键调窗）严禁调用 setState。
 */

import { create } from 'zustand';
import type {
  DataWarning,
  SeriesHandle,
  StudyMeta,
} from '@opendicomviewer/core';

export interface ImportStatus {
  readonly loading: boolean;
  readonly message?: string;
  readonly error?: string;
}

export interface ViewerState {
  readonly studies: readonly StudyMeta[];
  readonly activeStudyUid: string | null;
  readonly activeSeriesUid: string | null;
  readonly activeSeriesHandle: SeriesHandle | null;
  readonly importStatus: ImportStatus;
  readonly warnings: readonly DataWarning[];

  setStudies: (studies: readonly StudyMeta[]) => void;
  setActiveSeries: (handle: SeriesHandle) => void;
  setImportStatus: (status: ImportStatus) => void;
  setWarnings: (warnings: readonly DataWarning[]) => void;
  reset: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  studies: [],
  activeStudyUid: null,
  activeSeriesUid: null,
  activeSeriesHandle: null,
  importStatus: { loading: false },
  warnings: [],

  setStudies: (studies) => {
    set({
      studies,
      // 若之前没有激活的研究，自动选中第一个
      activeStudyUid: studies[0]?.studyInstanceUid ?? null,
    });
  },

  setActiveSeries: (handle) => {
    const currentHandle = get().activeSeriesHandle;
    if (
      currentHandle &&
      currentHandle.meta.seriesInstanceUid !== handle.meta.seriesInstanceUid
    ) {
      currentHandle.dispose();
    }
    set({
      activeSeriesHandle: handle,
      activeSeriesUid: handle.meta.seriesInstanceUid,
      activeStudyUid: handle.meta.studyInstanceUid,
      warnings: [...handle.warnings],
    });
  },

  setImportStatus: (status) => set({ importStatus: status }),
  setWarnings: (warnings) => set({ warnings }),

  reset: () => {
    const currentHandle = get().activeSeriesHandle;
    if (currentHandle) {
      currentHandle.dispose();
    }
    set({
      studies: [],
      activeStudyUid: null,
      activeSeriesUid: null,
      activeSeriesHandle: null,
      importStatus: { loading: false },
      warnings: [],
    });
  },
}));
