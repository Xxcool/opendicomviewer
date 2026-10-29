/**
 * MPR 工作区（P3）
 *
 * 负责把「布局 → 视口 → 体积 → 准星」串起来：
 * 1. App 先完成 setLayout，本组件等 `layoutReady` 后再往各视口塞数据；
 * 2. 体积只在进入 MPR 后构建，失败/内存不足一律走 mprStatus 显式呈现（R7）；
 * 3. 滚轮/层号是高频路径：异步串行化，命令式写 DOM，绝不 setState（R4）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  CornerstoneRenderer,
} from '@opendicomviewer/renderer-cs3d';
import type { VOIRange, VolumeHandle, WorldPoint } from '@opendicomviewer/core';
import { buildVolumeFromSeries } from '../bridge/volume-builder';
import { measureMmPerPx } from './scale-bar';
import {
  LAYOUTS,
  STACK_VIEWPORT_ID,
  moveAlongAxis,
  moveToStackSlice,
  orthographicPanes,
  paneSliceCount,
  planeCenter,
  volumeCenter,
  type LayoutMode,
  type PaneSpec,
} from '../layout/viewport-layouts';
import { useViewerStore } from '../state/viewer-store';
import { MprPane, type MprPaneHandle } from './MprPane';
import { ResetIcon, SpinnerIcon, WarningIcon } from './Icons';
import {
  countBySeverity,
  sortBySeverity,
  warningBannerClass,
} from './warning-presentation';
import {
  clampLayer,
  isDraggableSlider,
  nextLayerIndex,
  parseLayerInput,
} from './slice-navigation';
import { WINDOW_PRESETS as PRESETS } from './window-presets';

interface MprWorkspaceProps {
  readonly renderer: CornerstoneRenderer | null;
  readonly mode: LayoutMode;
  /** App 的 setLayout 已成功应用当前模式 */
  readonly layoutReady: boolean;
  readonly onLoadSample?: (datasetId?: string) => void;
}

const PAGE_STEP = 10;

function formatVoi(voi: VOIRange): string {
  return `WW ${Math.round(voi.windowWidth)} · WL ${Math.round(voi.windowCenter)}`;
}

export function MprWorkspace({
  renderer,
  mode,
  layoutReady,
  onLoadSample,
}: MprWorkspaceProps) {
  const layout = LAYOUTS[mode];
  const orthoPanes = useMemo(() => orthographicPanes(layout), [layout]);

  const activeSeriesHandle = useViewerStore((s) => s.activeSeriesHandle);
  const layoutMode = useViewerStore((s) => s.layoutMode);
  const mprVolume = useViewerStore((s) => s.mprVolume);
  const mprStatus = useViewerStore((s) => s.mprStatus);
  const rendererCapabilities = useViewerStore((s) => s.rendererCapabilities);
  const warnings = useViewerStore((s) => s.warnings);
  const setMprVolume = useViewerStore((s) => s.setMprVolume);
  const setMprStatus = useViewerStore((s) => s.setMprStatus);
  const setImportStatus = useViewerStore((s) => s.setImportStatus);

  const [activePaneId, setActivePaneId] = useState<string>(STACK_VIEWPORT_ID);
  const [attachedVolume, setAttachedVolume] = useState<VolumeHandle | null>(null);

  // 命令式 DOM 句柄：每个视口一格
  const paneHandles = useRef(new Map<string, MprPaneHandle>());
  /** 准星所在的世界坐标；null = 尚未建立（等体积） */
  const crosshairRef = useRef<WorldPoint | null>(null);
  /** 每个视口当前层号，避免每帧去渲染器读相机 */
  const sliceIndexRef = useRef(new Map<string, number>());
  const loadedSeriesUidRef = useRef<string | null>(null);
  const stackDefaultVoiRef = useRef<VOIRange | null>(null);
  /** 异步导航串行队列：滚轮高频触发时保证「翻层 → 准星 → 其他视口」不乱序 */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /** navigate 完成后刷新底部栏；避免用无依赖 effect 每帧轮询 */
  const navSyncRef = useRef<(() => void) | null>(null);

  // 底部导航 refs
  const layerInputRef = useRef<HTMLInputElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const prevLayerRef = useRef<HTMLButtonElement>(null);
  const nextLayerRef = useRef<HTMLButtonElement>(null);

  const registerPane = useCallback(
    (viewportId: string, handle: MprPaneHandle | null) => {
      if (handle) paneHandles.current.set(viewportId, handle);
      else paneHandles.current.delete(viewportId);
    },
    [],
  );

  /** 各格比例尺共用同一套换算：从画布反查世界坐标，拿不到物理信息返回 null */
  const measureScale = useCallback(
    (viewportId: string, width: number, height: number) =>
      measureMmPerPx(renderer, viewportId, width, height),
    [renderer],
  );

  const readIndex = useCallback(
    (viewportId: string): number | null => {
      if (!renderer) return null;
      try {
        return renderer.currentSliceIndex(viewportId);
      } catch {
        return null;
      }
    },
    [renderer],
  );

  const syncPaneUi = useCallback(
    (pane: PaneSpec) => {
      const total = paneSliceCount(pane, activeSeriesHandle, mprVolume);
      const index = readIndex(pane.viewportId) ?? 0;
      const handle = paneHandles.current.get(pane.viewportId);
      if (!handle) return;
      if (total > 0) {
        sliceIndexRef.current.set(pane.viewportId, index);
        handle.setSlice(index, total);
      } else {
        sliceIndexRef.current.delete(pane.viewportId);
        handle.setSlice(0, 0);
      }
    },
    [activeSeriesHandle, mprVolume, readIndex],
  );

  const syncAllPaneUi = useCallback(() => {
    for (const pane of layout.panes) syncPaneUi(pane);
  }, [layout, syncPaneUi]);

  const syncPaneVoi = useCallback(
    (pane: PaneSpec) => {
      const handle = paneHandles.current.get(pane.viewportId);
      if (!renderer || !handle) return;
      try {
        handle.setVoi(formatVoi(renderer.getVOI(pane.viewportId)));
      } catch {
        // 首帧尚未提交时忽略
      }
    },
    [renderer],
  );

  /** 准星投影到每个视口的画布坐标；越界由 Pane 自己隐藏 */
  const updateCrosshairOverlays = useCallback(() => {
    const world = crosshairRef.current;
    for (const pane of layout.panes) {
      const handle = paneHandles.current.get(pane.viewportId);
      if (!handle) continue;
      if (!world || !renderer) {
        handle.setCrosshair(null);
        continue;
      }
      try {
        const point = renderer.worldToCanvas(pane.viewportId, world);
        handle.setCrosshair({ x: point.x, y: point.y });
      } catch {
        handle.setCrosshair(null);
      }
    }
  }, [layout, renderer]);

  /**
   * 把准星同步到所有视口。
   *
   * 单轴越界是正常情况（例如准星在体积边缘），逐视口吞掉端口抛出的错误；
   * 真正的装载失败由 setVolume / setStack 的 catch 显式上报。
   */
  const focusAllAtCrosshair = useCallback(async () => {
    const world = crosshairRef.current;
    if (!renderer || !world) return;
    for (const pane of layout.panes) {
      try {
        await renderer.focusAt(pane.viewportId, world);
      } catch {
        // 该轴越界：只影响这一格的定位，其他格继续
      }
    }
  }, [layout, renderer]);

  /** 串行执行导航任务；上一个失败不阻塞后续滚轮 */
  const enqueue = useCallback((task: () => Promise<void>) => {
    chainRef.current = chainRef.current
      .then(task)
      .catch((err: unknown) => {
        setImportStatus({
          loading: false,
          error: `MPR 视口联动失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }, [setImportStatus]);

  // 1. 装载 Stack 视口（setLayout 完成后；MPR 之间切换不重复装载）
  useEffect(() => {
    if (!renderer || !activeSeriesHandle || !layoutReady) return;
    const seriesUid = activeSeriesHandle.meta.seriesInstanceUid;
    if (loadedSeriesUidRef.current === seriesUid) {
      syncAllPaneUi();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await renderer.setStack(STACK_VIEWPORT_ID, activeSeriesHandle, 0);
        if (cancelled) return;
        loadedSeriesUidRef.current = seriesUid;
        stackDefaultVoiRef.current = null;
        try {
          const voi = renderer.getVOI(STACK_VIEWPORT_ID);
          if (
            Number.isFinite(voi.windowWidth) &&
            Number.isFinite(voi.windowCenter)
          ) {
            stackDefaultVoiRef.current = voi;
          }
        } catch {
          // 首帧尚未提交
        }
        syncAllPaneUi();
        syncPaneVoi(layout.panes[0]!);

        // 体积可能先于 Stack 装载完成；此时补一次定位，保证轴位与准星对齐
        if (crosshairRef.current) {
          await focusAllAtCrosshair();
          if (cancelled) return;
          syncAllPaneUi();
          updateCrosshairOverlays();
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setImportStatus({
            loading: false,
            error: `MPR 轴位装载失败: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    renderer,
    activeSeriesHandle,
    layoutReady,
    layout,
    syncAllPaneUi,
    syncPaneVoi,
    focusAllAtCrosshair,
    updateCrosshairOverlays,
    setImportStatus,
  ]);

  // 2. 构建降采样体积：失败一律显式落到 mprStatus，由格子覆盖层 + 顶栏同时呈现
  useEffect(() => {
    if (!activeSeriesHandle) return;
    const seriesUid = activeSeriesHandle.meta.seriesInstanceUid;
    if (mprVolume && mprVolume.seriesInstanceUid === seriesUid) return;
    if (rendererCapabilities && !rendererCapabilities.supportsVolume) {
      setMprStatus({
        phase: 'error',
        message: '当前渲染后端不支持体积通路，MPR 不可用',
      });
      return;
    }

    const controller = new AbortController();
    setAttachedVolume(null);
    setMprStatus({
      phase: 'building',
      processedSlices: 0,
      totalSlices: activeSeriesHandle.meta.planes.length,
    });

    void buildVolumeFromSeries(activeSeriesHandle, {
      signal: controller.signal,
      onProgress: (progress) => {
        setMprStatus({
          phase: 'building',
          processedSlices: progress.processedSlices,
          totalSlices: progress.totalSlices,
        });
      },
    })
      .then((outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.status === 'ok') {
          setMprVolume(outcome.volume);
          setMprStatus({ phase: 'ready' });
        } else if (outcome.status === 'rejected') {
          setMprStatus({ phase: 'error', message: outcome.message });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setMprStatus({
          phase: 'error',
          message: `MPR 体积构建失败：${err instanceof Error ? err.message : String(err)}`,
        });
      });

    return () => controller.abort();
  }, [
    activeSeriesHandle,
    mprVolume,
    rendererCapabilities,
    setMprStatus,
    setMprVolume,
  ]);

  // 3. 把体积挂到三个 MPR 视口，并把准星落到体积中心
  useEffect(() => {
    if (!renderer || !activeSeriesHandle || !mprVolume || !layoutReady) return;
    if (mprVolume.seriesInstanceUid !== activeSeriesHandle.meta.seriesInstanceUid) {
      return;
    }
    if (attachedVolume === mprVolume) {
      syncAllPaneUi();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        for (const pane of orthoPanes) {
          await renderer.setVolume(pane.viewportId, mprVolume);
          if (cancelled) return;
        }
        if (cancelled) return;

        if (!crosshairRef.current) {
          crosshairRef.current = volumeCenter(mprVolume);
        }
        await focusAllAtCrosshair();
        if (cancelled) return;

        setAttachedVolume(mprVolume);
        syncAllPaneUi();
        for (const pane of orthoPanes) syncPaneVoi(pane);
        updateCrosshairOverlays();
      } catch (err: unknown) {
        if (!cancelled) {
          setMprStatus({
            phase: 'error',
            message: `MPR 视口装载失败：${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    renderer,
    activeSeriesHandle,
    mprVolume,
    layoutReady,
    orthoPanes,
    attachedVolume,
    syncAllPaneUi,
    syncPaneVoi,
    focusAllAtCrosshair,
    updateCrosshairOverlays,
    setMprStatus,
  ]);

  // 布局在 2×2 ↔ 1+3 间切换时视口不变，但格子尺寸变了：等浏览器完成布局后重投影准星
  useEffect(() => {
    if (!layoutReady) return;
    const id = requestAnimationFrame(() => {
      syncAllPaneUi();
      updateCrosshairOverlays();
    });
    return () => cancelAnimationFrame(id);
  }, [layoutReady, layout, syncAllPaneUi, updateCrosshairOverlays]);

  // 切序列：准星/索引/默认窗全部作废
  useEffect(() => {
    setAttachedVolume(null);
    crosshairRef.current = null;
    sliceIndexRef.current.clear();
  }, [activeSeriesHandle]);

  // 4. 导航：Stack 走 setStackIndex，MPR 走 stepSlice，随后沿对应轴移动准星
  const navigate = useCallback(
    (pane: PaneSpec, target: number) => {
      const total = paneSliceCount(pane, activeSeriesHandle, mprVolume);
      if (total <= 0) return;
      const current = sliceIndexRef.current.get(pane.viewportId) ?? 0;
      const clamped = clampLayer(target, total);
      if (clamped === current) {
        syncPaneUi(pane);
        return;
      }

      enqueue(async () => {
        if (!renderer) return;
        if (pane.kind === 'stack') {
          await renderer.setStackIndex(pane.viewportId, clamped);
          const applied = (readIndex(pane.viewportId) ?? clamped) - current;
          if (applied !== 0 && activeSeriesHandle) {
            const plane = activeSeriesHandle.meta.planes[current];
            const base =
              crosshairRef.current ?? (plane ? planeCenter(plane) : null);
            if (base) {
              crosshairRef.current = moveToStackSlice(
                base,
                activeSeriesHandle.meta.planes,
                current,
                current + applied,
              );
            }
          }
        } else {
          await renderer.stepSlice(pane.viewportId, clamped - current);
          const applied = (readIndex(pane.viewportId) ?? current) - current;
          if (applied !== 0 && crosshairRef.current && mprVolume) {
            crosshairRef.current = moveAlongAxis(
              mprVolume,
              crosshairRef.current,
              pane.axis ?? 2,
              applied,
            );
          }
        }

        await focusAllAtCrosshair();
        syncAllPaneUi();
        updateCrosshairOverlays();
        navSyncRef.current?.();
      });
    },
    [
      activeSeriesHandle,
      mprVolume,
      renderer,
      enqueue,
      readIndex,
      syncAllPaneUi,
      syncPaneUi,
      focusAllAtCrosshair,
      updateCrosshairOverlays,
    ],
  );

  const stepPane = useCallback(
    (pane: PaneSpec, delta: number) => {
      const total = paneSliceCount(pane, activeSeriesHandle, mprVolume);
      if (total <= 1) return;
      const current = sliceIndexRef.current.get(pane.viewportId) ?? 0;
      navigate(pane, nextLayerIndex(current, delta, total));
    },
    [activeSeriesHandle, mprVolume, navigate],
  );

  // 5. 底部导航跟随「当前激活视口」
  const activePane =
    layout.panes.find((p) => p.viewportId === activePaneId) ?? layout.panes[0]!;
  const activeTotal = paneSliceCount(activePane, activeSeriesHandle, mprVolume);

  const paintNavUi = useCallback((index: number, total: number) => {
    if (layerInputRef.current) {
      layerInputRef.current.value = total > 0 ? String(index + 1) : '';
    }
    if (progressFillRef.current) {
      const pct = total > 1 ? (index / (total - 1)) * 100 : 0;
      progressFillRef.current.style.width = `${pct}%`;
    }
    if (sliderRef.current && sliderRef.current.value !== String(index)) {
      sliderRef.current.value = String(index);
    }
    if (prevLayerRef.current) prevLayerRef.current.disabled = index <= 0;
    if (nextLayerRef.current) nextLayerRef.current.disabled = total <= 1 || index >= total - 1;
  }, []);

  const syncNavUi = useCallback(() => {
    const total = paneSliceCount(activePane, activeSeriesHandle, mprVolume);
    const index = sliceIndexRef.current.get(activePane.viewportId) ?? 0;
    paintNavUi(index, total);
  }, [activePane, activeSeriesHandle, mprVolume, paintNavUi]);
  navSyncRef.current = syncNavUi;

  useEffect(() => {
    syncNavUi();
  }, [syncNavUi, activePaneId, mprVolume, layoutReady]);

  const jumpActive = (target: number) => {
    if (!renderer || activeTotal <= 0) {
      syncNavUi();
      return;
    }
    const clamped = clampLayer(target, activeTotal);
    // 底部栏立即反馈；视口/准星由 navigate 在串行队列里完成后再校正
    paintNavUi(clamped, activeTotal);
    navigate(activePane, clamped);
  };

  const handleLayerInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const parsed = parseLayerInput(e.currentTarget.value, activeTotal);
    if (parsed === null) {
      syncNavUi();
      return;
    }
    jumpActive(parsed);
  };

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    jumpActive(Number(e.target.value));
  };

  const applyPreset = (voi: VOIRange, presetName?: string) => {
    if (!renderer || activePane.kind !== 'stack') return;
    renderer.setVOI(activePane.viewportId, voi);
    const handle = paneHandles.current.get(activePane.viewportId);
    handle?.setVoi(formatVoi(voi), presetName ?? null);
  };

  const readActiveVoi = (pane: PaneSpec): VOIRange => {
    if (renderer) {
      try {
        return renderer.getVOI(pane.viewportId);
      } catch {
        // 首帧尚未提交
      }
    }
    return { windowWidth: 400, windowCenter: 40 };
  };

  const resetView = () => {
    if (!renderer) return;
    for (const pane of layout.panes) {
      renderer.resetView(pane.viewportId);
    }
    if (activePane.kind === 'stack' && stackDefaultVoiRef.current) {
      renderer.setVOI(activePane.viewportId, stackDefaultVoiRef.current);
      paneHandles.current
        .get(activePane.viewportId)
        ?.setVoi(formatVoi(stackDefaultVoiRef.current));
    }
    if (crosshairRef.current) {
      enqueue(async () => {
        await focusAllAtCrosshair();
        updateCrosshairOverlays();
      });
    }
  };

  // 6. 键盘：方向键/翻页键作用于当前激活视口；1-5 仅 Stack 生效
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (!renderer || !activeSeriesHandle) return;

      if (activePane.kind === 'stack') {
        const num = Number(e.key);
        if (num >= 1 && num <= PRESETS.length) {
          const preset = PRESETS[num - 1]!;
          applyPreset(preset.voi, preset.name);
          return;
        }
      }

      if (e.key === 'r' || e.key === 'R') {
        resetView();
        return;
      }

      const deltas: Record<string, number> = {
        ArrowUp: -1,
        ArrowDown: 1,
        PageUp: -PAGE_STEP,
        PageDown: PAGE_STEP,
      };
      const delta = deltas[e.key];
      if (delta === undefined) return;
      e.preventDefault();
      stepPane(activePane, delta);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const sortedWarnings = sortBySeverity(warnings);
  const warnCounts = countBySeverity(warnings);
  const topSeverity = sortedWarnings[0]?.severity;
  const sliderDraggable = isDraggableSlider(activeTotal);
  const busy = mprStatus.phase === 'building';
  const failed = mprStatus.phase === 'error';

  /** MPR 格子的显式状态：构建中 / 失败 / 尚未挂载 */
  const paneNotice = (pane: PaneSpec): string | undefined => {
    if (pane.kind === 'stack') return undefined;
    if (failed) return mprStatus.message;
    if (!layoutReady) return '正在切换布局…';
    if (busy) {
      const done = mprStatus.processedSlices ?? 0;
      const total = mprStatus.totalSlices ?? activeSeriesHandle?.meta.planes.length ?? 0;
      return `正在构建 MPR 体积 ${done} / ${total}`;
    }
    if (!mprVolume) return '等待 MPR 体积…';
    if (attachedVolume !== mprVolume) return '正在载入 MPR 视口…';
    return undefined;
  };

  const empty = !activeSeriesHandle;

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden select-none min-w-0 min-h-0 z-10">
      {/* 顶部状态条：标题 + 体积状态 + 数据提醒 + 复位 */}
      <div
        className="px-4 bg-panel border-b border-line flex items-center justify-between text-[12px] text-txt-dim relative z-20 shrink-0 gap-4"
        style={{ height: 'var(--vp-bar-h)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-txt truncate">
            {activeSeriesHandle
              ? `${activeSeriesHandle.meta.modality} · ${LAYOUTS[layoutMode].hint}`
              : '就绪'}
          </span>
          {busy && (
            <span className="inline-flex items-center gap-1 text-[11px] text-accent shrink-0">
              <SpinnerIcon className="w-3.5 h-3.5" />
              <span>
                构建 MPR {mprStatus.processedSlices ?? 0}/{mprStatus.totalSlices ?? 0}
              </span>
            </span>
          )}
          {failed && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-danger shrink-0 max-w-[46%] truncate"
              title={mprStatus.message}
            >
              <WarningIcon className="w-3.5 h-3.5" />
              <span>MPR 不可用</span>
            </span>
          )}
          {!busy && !failed && mprVolume && (
            <span className="text-[11px] text-txt-muted font-mono shrink-0">
              体积 {mprVolume.dimensions.join('×')} · 8-bit
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {warnings.length > 0 && topSeverity && (
            <span
              title={warnings.map((w) => w.message).slice(0, 8).join('\n')}
              className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-sm border text-[11px] ${warningBannerClass(topSeverity)}`}
            >
              <WarningIcon className="w-3.5 h-3.5" />
              <span className="font-mono">{warnings.length}</span>
              <span className="text-[10px]">
                {warnCounts.error > 0 && `${warnCounts.error} 错误 `}
                {warnCounts.warning > 0 && `${warnCounts.warning} 告警 `}
                {warnCounts.info > 0 && `${warnCounts.info} 提示`}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={resetView}
            title="复位所有视口 (快捷键 R)"
            className="inline-flex items-center gap-1 px-2 h-6 rounded-sm text-[12px] text-txt-dim hover:text-txt hover:bg-hover transition cursor-pointer"
          >
            <ResetIcon className="w-3.5 h-3.5" />
            <span>复位</span>
          </button>
        </div>
      </div>

      {/* 画布区：CS3D 容器由 App 持久持有；这里只叠一层同网格的交互/角标层 */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        <div
          style={layout.gridStyle}
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {layout.panes.map((pane) => (
            <MprPane
              key={pane.viewportId}
              spec={pane}
              active={pane.viewportId === activePane.viewportId}
              totalSlices={paneSliceCount(pane, activeSeriesHandle, mprVolume)}
              modality={activeSeriesHandle?.meta.modality ?? '--'}
              seriesDescription={activeSeriesHandle?.meta.seriesDescription}
              notice={paneNotice(pane)}
              noticeKind={failed ? 'error' : 'info'}
              windowingEnabled={pane.kind === 'stack' && !empty}
              onActivate={() => setActivePaneId(pane.viewportId)}
              onStep={(delta) => stepPane(pane, delta)}
              onVoiPreview={(voi) => {
                if (!renderer) return;
                renderer.setVOI(pane.viewportId, voi);
                paneHandles.current
                  .get(pane.viewportId)
                  ?.setVoi(formatVoi(voi), '自定义');
              }}
              readVoi={() => readActiveVoi(pane)}
              measureScale={measureScale}
              register={registerPane}
            />
          ))}
        </div>

        {!renderer && (
          <div className="absolute inset-0 flex items-center justify-center text-overlay/70 text-xs pointer-events-none select-none z-20">
            <SpinnerIcon className="w-4 h-4 text-accent mr-2" />
            <span>正在挂载渲染视口...</span>
          </div>
        )}

        {renderer && empty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-overlay/70 text-sm p-4 pointer-events-auto select-none z-20">
            <p className="font-medium text-overlay text-[18px] mb-2">
              MPR 三视图已就绪 · 请载入序列
            </p>
            <p className="text-[11px] text-overlay/60 max-w-sm">
              体积仅用于显示与定位，不做测量
            </p>
            {onLoadSample && (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => onLoadSample()}
                  className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition cursor-pointer shadow-md"
                >
                  载入示例（脑部 MR 36 帧 + 胸腹 CT）
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部控制栏：层号导航作用于当前激活视口；预设仅 Stack 可用 */}
      {activeSeriesHandle && (
        <div
          className="px-4 bg-panel border-t border-line flex items-center justify-between text-[12px] shrink-0"
          style={{ height: 'var(--vp-foot-h)' }}
        >
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-txt-muted">
              {activePane.title}
            </span>
            <button
              ref={prevLayerRef}
              type="button"
              onClick={() =>
                jumpActive((sliceIndexRef.current.get(activePane.viewportId) ?? 0) - 1)
              }
              title="上一层（滚轮上；Shift+滚轮 = 10 层）"
              aria-label="上一层"
              className="w-6 h-6 flex items-center justify-center rounded-md border border-transparent hover:bg-hover text-txt-muted hover:text-txt disabled:opacity-40 disabled:cursor-not-allowed active:ring-1 active:ring-accent/40 transition cursor-pointer text-[11px]"
            >
              ◀
            </button>
            <button
              ref={nextLayerRef}
              type="button"
              onClick={() =>
                jumpActive((sliceIndexRef.current.get(activePane.viewportId) ?? 0) + 1)
              }
              title="下一层（滚轮下；Shift+滚轮 = 10 层）"
              aria-label="下一层"
              className="w-6 h-6 flex items-center justify-center rounded-md border border-transparent hover:bg-hover text-txt-muted hover:text-txt disabled:opacity-40 disabled:cursor-not-allowed active:ring-1 active:ring-accent/40 transition cursor-pointer text-[11px]"
            >
              ▶
            </button>
            <input
              ref={layerInputRef}
              type="text"
              inputMode="numeric"
              aria-label="层号"
              title="输入层号后回车跳转"
              onKeyDown={handleLayerInputKeyDown}
              onBlur={syncNavUi}
              className="w-12 h-6 text-right px-1.5 rounded-md bg-hover text-txt focus:outline-none focus:ring-2 focus:ring-accent/60 tabular-nums text-[12px] border border-transparent transition"
            />
            <span className="text-txt-muted text-[11px] font-mono select-none">
              / {activeTotal}
            </span>
            {sliderDraggable ? (
              <input
                ref={sliderRef}
                type="range"
                min="0"
                max={Math.max(0, activeTotal - 1)}
                defaultValue={0}
                onChange={handleSliderChange}
                aria-label="切片进度"
                className="odv-slice-range w-20 shrink-0"
              />
            ) : (
              <div
                className="w-20 h-0.5 bg-line-strong rounded-full overflow-hidden shrink-0"
                role="progressbar"
                aria-label="切片进度"
                aria-valuemin={1}
                aria-valuemax={Math.max(1, activeTotal)}
              >
                <div ref={progressFillRef} className="h-full bg-accent rounded-full" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 min-w-0 overflow-hidden">
            {activePane.kind === 'stack' ? (
              <>
                <span className="text-[11px] text-txt-muted mr-1 shrink-0 select-none">
                  预设
                </span>
                <div className="flex gap-1 shrink-0">
                  {PRESETS.map((preset, idx) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset.voi, preset.name)}
                      className="px-2 h-6 text-[11px] rounded-md border border-transparent bg-transparent hover:bg-hover text-txt-dim hover:text-txt transition cursor-pointer whitespace-nowrap"
                      title={`${preset.name} (快捷键 ${idx + 1}): WW ${preset.voi.windowWidth}, WL ${preset.voi.windowCenter}`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-[11px] text-txt-muted select-none">
                MPR 视口使用固定显示区间（仅显示）
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
