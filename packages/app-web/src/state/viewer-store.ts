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
import { isMprLayout, SPLIT_PANES, type LayoutMode } from '../layout/viewport-layouts';

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
export type ViewTool = 'browse' | 'window' | 'pan' | 'zoom';
export type InspectorTab = 'image' | 'warnings';

export interface ViewerState {
  readonly splitSeries: Readonly<Record<string, SeriesHandle>>;
  assignSplitSeries: (viewportId: string, handle: SeriesHandle) => void;
  readonly activeTool: ViewTool;
  readonly activeViewportId: string;
  readonly seriesPanelOpen: boolean;
  readonly inspectorOpen: boolean;
  readonly inspectorTab: InspectorTab;
  readonly focusMode: boolean;
  setActiveTool: (tool: ViewTool) => void;
  setActiveViewportId: (id: string) => void;
  toggleSeriesPanel: () => void;
  toggleInspector: () => void;
  setInspectorTab: (tab: InspectorTab) => void;
  toggleFocusMode: () => void;
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

/** 句柄可被多个格子共用；只释放最后一个引用，避免把其他视口的数据清掉。 */
function releaseUnused(previous: readonly SeriesHandle[], keep: readonly SeriesHandle[]) {
  const retained = new Set(keep);
  for (const handle of new Set(previous)) if (!retained.has(handle)) handle.dispose();
}
function selected(handle: SeriesHandle | null) {
  return { activeSeriesHandle: handle, activeSeriesUid: handle?.meta.seriesInstanceUid ?? null,
    activeStudyUid: handle?.meta.studyInstanceUid ?? null, warnings: handle ? [...handle.warnings] : [] };
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  splitSeries: {},
  assignSplitSeries: (viewportId, incoming) => {
    const state = get();
    if (!SPLIT_PANES.some(p => p.viewportId === viewportId)) throw new Error('未知独立视口');
    const existing = Object.values(state.splitSeries).find(h => h.meta.seriesInstanceUid === incoming.meta.seriesInstanceUid);
    const handle = existing ?? incoming;
    const splitSeries = { ...state.splitSeries, [viewportId]: handle };
    set({ splitSeries, ...(state.activeViewportId === viewportId ? { ...selected(handle), mprVolume: null, mprStatus: IDLE_MPR_STATUS } : {}) });
    releaseUnused([...Object.values(state.splitSeries), incoming], [...Object.values(splitSeries), ...(get().activeSeriesHandle ? [get().activeSeriesHandle!] : [])]);
  },
  activeTool: 'browse',
  activeViewportId: 'default-viewport',
  seriesPanelOpen: true,
  inspectorOpen: false,
  inspectorTab: 'image',
  focusMode: false,
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveViewportId: (activeViewportId) => set((state) => {
    const handle = state.splitSeries[activeViewportId] ?? null;
    const changed = state.activeSeriesUid !== handle?.meta.seriesInstanceUid;
    return { activeViewportId,
      ...(state.layoutMode === 'split-2x2' ? { ...selected(handle), ...(changed ? { mprVolume: null, mprStatus: IDLE_MPR_STATUS } : {}) } : {}),
      activeTool: state.layoutMode !== 'split-2x2' && activeViewportId !== 'default-viewport' && state.activeTool === 'window' ? 'pan' : state.activeTool };
  }),
  toggleSeriesPanel: () => set((state) => ({ seriesPanelOpen: !state.seriesPanelOpen, focusMode: false })),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen, focusMode: false })),
  setInspectorTab: (inspectorTab) => set({ inspectorTab, inspectorOpen: true, focusMode: false }),
  // 专注模式只改变呈现，保留两个面板的原始开关，退出时完整恢复。
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
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
    const state = get();
    releaseUnused(Object.values(state.splitSeries), state.activeSeriesHandle ? [state.activeSeriesHandle] : []);
    set({ splitSeries: {}, layoutMode: '1x1', activeViewportId: 'default-viewport', mprVolume: null, mprStatus: IDLE_MPR_STATUS,
      studies,
      // 若之前没有激活的研究，自动选中第一个
      activeStudyUid: studies[0]?.studyInstanceUid ?? null,
    });
  },

  setActiveSeries: (handle) => {
    const state = get();
    if (state.layoutMode === 'split-2x2') { state.assignSplitSeries(state.activeViewportId, handle); return; }
    const seriesChanged = state.activeSeriesHandle?.meta.seriesInstanceUid !== handle.meta.seriesInstanceUid;
    set({ ...selected(handle), activeViewportId: 'default-viewport',
      layoutMode: isMprLayout(state.layoutMode) && !planVolumeDownsample(handle.meta).ok ? '1x1' : state.layoutMode,
      ...(seriesChanged ? { mprVolume: null, mprStatus: IDLE_MPR_STATUS } : {}) });
    releaseUnused(state.activeSeriesHandle ? [state.activeSeriesHandle] : [], [handle, ...Object.values(state.splitSeries)]);
  },

  setImportStatus: (status) => set({ importStatus: status }),
  setWarnings: (warnings) => set({ warnings }),
  setRendererCapabilities: (caps) => set({ rendererCapabilities: caps }),
  setLayoutMode: (layoutMode) => {
    const state = get();
    if (layoutMode === 'split-2x2' && state.layoutMode === layoutMode) return;
    const handle = state.activeSeriesHandle ?? state.splitSeries['default-viewport'] ?? Object.values(state.splitSeries)[0] ?? null;
    if (isMprLayout(layoutMode) && (!handle || !planVolumeDownsample(handle.meta).ok)) return;
    let splitSeries = state.splitSeries;
    if (layoutMode === 'split-2x2' && handle) splitSeries = { ...splitSeries, 'default-viewport': handle };
    set({ layoutMode, splitSeries, activeViewportId: 'default-viewport', ...selected(handle),
      ...(state.activeSeriesUid !== handle?.meta.seriesInstanceUid ? { mprVolume: null, mprStatus: IDLE_MPR_STATUS } : {}) });
    releaseUnused(Object.values(state.splitSeries), [...Object.values(splitSeries), ...(handle ? [handle] : [])]);
  },
  setMprVolume: (mprVolume) => set({ mprVolume }),
  setMprStatus: (mprStatus) => set({ mprStatus }),

  setTheme: (theme) => {
    // DOM 与 localStorage 一起写（applyTheme），store 只做镜像，保证两处永远一致
    applyTheme(theme);
    set({ theme });
  },

  reset: () => {
    const state = get();
    releaseUnused([...Object.values(state.splitSeries), ...(state.activeSeriesHandle ? [state.activeSeriesHandle] : [])], []);
    set({ splitSeries: {},
      studies: [],
      activeTool: 'browse',
      activeViewportId: 'default-viewport',
      focusMode: false,
      seriesPanelOpen: true,
      inspectorOpen: false,
      inspectorTab: 'image',
      activeStudyUid: null,
      activeSeriesUid: null,
      activeSeriesHandle: null,
      importStatus: { loading: false },
      warnings: [],
      layoutMode: '1x1',
      mprVolume: null,
      mprStatus: IDLE_MPR_STATUS,
    });
  },
}));
