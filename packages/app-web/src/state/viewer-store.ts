/**
 * OpenDicomViewer 视图与会话状态管理（Zustand）
 *
 * 遵循架构规范 §6.4：
 * 1. 仅管理低频的 UI 态（研究/序列列表、当前激活序列）与导入任务态；
 * 2. 渲染态（切片位置、相机、调窗、GPU 纹理）完全由 CS3D 与渲染器自行持有；
 * 3. 严格遵循 R4：高频渲染循环（滚轮翻页、鼠标右键调窗）严禁调用 setState。
 */

import { create } from 'zustand';
import { planVolumeDownsample } from '@opendicomviewer/core';
import type {
  DataWarning,
  RendererCapabilities,
  SeriesHandle,
  StudyMeta,
  VolumeHandle,
} from '@opendicomviewer/core';
import { applyTheme, currentTheme, type Theme } from '../theme';
import type { LayoutMode } from '../layout/viewport-layouts';

export interface ImportStatus {
  readonly loading: boolean;
  readonly message?: string;
  readonly error?: string;
}

export interface MprBuildStatus {
  readonly phase: 'idle' | 'building' | 'ready' | 'error';
  readonly message?: string;
  readonly processedSlices?: number;
  readonly totalSlices?: number;
}

/** 体积构建的初始态：空闲且无错误 */
export const IDLE_MPR_STATUS: MprBuildStatus = { phase: 'idle' };

export interface ViewerState {
  readonly studies: readonly StudyMeta[];
  readonly activeStudyUid: string | null;
  readonly activeSeriesUid: string | null;
  readonly activeSeriesHandle: SeriesHandle | null;
  readonly importStatus: ImportStatus;
  readonly warnings: readonly DataWarning[];
  /** 渲染器运行时能力（挂载成功后写入），供右栏「能力与降级」展示 */
  readonly rendererCapabilities: RendererCapabilities | null;

  /** 主题的单一真源：顶栏按钮与设置面板都要改它，不能各存一份 state */
  readonly theme: Theme;

  /** 当前视口布局（UI 态；切换走 renderer.setLayout） */
  readonly layoutMode: LayoutMode;
  /** 当前序列的降采样体积（仅 MPR 用；切序列即失效） */
  readonly mprVolume: VolumeHandle | null;
  readonly mprStatus: MprBuildStatus;

  setStudies: (studies: readonly StudyMeta[]) => void;
  setActiveSeries: (handle: SeriesHandle) => void;
  setImportStatus: (status: ImportStatus) => void;
  setWarnings: (warnings: readonly DataWarning[]) => void;
  setRendererCapabilities: (caps: RendererCapabilities) => void;
  setTheme: (theme: Theme) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setMprVolume: (volume: VolumeHandle | null) => void;
  setMprStatus: (status: MprBuildStatus) => void;
  reset: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  studies: [],
  activeStudyUid: null,
  activeSeriesUid: null,
  activeSeriesHandle: null,
  importStatus: { loading: false },
  warnings: [],
  rendererCapabilities: null,
  theme: currentTheme(),
  layoutMode: '1x1',
  mprVolume: null,
  mprStatus: IDLE_MPR_STATUS,
  setStudies: (studies) => {
    set({
      studies,
      // 若之前没有激活的研究，自动选中第一个
      activeStudyUid: studies[0]?.studyInstanceUid ?? null,
    });
  },

  setActiveSeries: (handle) => {
    const currentHandle = get().activeSeriesHandle;
    const seriesChanged =
      currentHandle !== null &&
      currentHandle.meta.seriesInstanceUid !== handle.meta.seriesInstanceUid;
    if (seriesChanged) {
      currentHandle.dispose();
    }
    // 几何不支持 MPR 时直接回到 Stack，避免隐藏布局入口后仍困在旧 MPR 布局。
    const currentLayout = get().layoutMode;
    const layoutMode = currentLayout !== '1x1' && !planVolumeDownsample(handle.meta).ok
      ? '1x1' : currentLayout;
    set({
      layoutMode,
      activeSeriesHandle: handle,
      activeSeriesUid: handle.meta.seriesInstanceUid,
      activeStudyUid: handle.meta.studyInstanceUid,
      warnings: [...handle.warnings],
      // 体积按序列构建，换序列后旧体积必须作废，否则 MPR 会显示上一序列
      ...(seriesChanged
        ? { mprVolume: null, mprStatus: IDLE_MPR_STATUS }
        : {}),
    });
  },

  setImportStatus: (status) => set({ importStatus: status }),
  setWarnings: (warnings) => set({ warnings }),
  setRendererCapabilities: (caps) => set({ rendererCapabilities: caps }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setMprVolume: (mprVolume) => set({ mprVolume }),
  setMprStatus: (mprStatus) => set({ mprStatus }),

  setTheme: (theme) => {
    // DOM 与 localStorage 一起写（applyTheme），store 只做镜像，保证两处永远一致
    applyTheme(theme);
    set({ theme });
  },

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
      rendererCapabilities: null,
      layoutMode: '1x1',
      mprVolume: null,
      mprStatus: IDLE_MPR_STATUS,
    });
  },
}));
