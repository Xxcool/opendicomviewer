import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import type { VOIRange } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { ResetIcon, WarningIcon, SpinnerIcon } from './Icons';
import {
  primaryWarning,
  severityLabel,
  warningBannerClass,
} from './warning-presentation';
import {
  clampLayer,
  hasSliceNavigation,
  isDraggableSlider,
  nextLayerIndex,
  parseLayerInput,
} from './slice-navigation';

interface ViewportProps {
  readonly renderer: CornerstoneRenderer | null;
  readonly viewportId?: string;
  readonly onLoadSample?: (datasetId?: string) => void;
}

const PRESETS: readonly { readonly name: string; readonly voi: VOIRange }[] = [
  { name: '肺窗', voi: { windowWidth: 1500, windowCenter: -600 } },
  { name: '纵隔', voi: { windowWidth: 350, windowCenter: 40 } },
  { name: '骨窗', voi: { windowWidth: 2000, windowCenter: 350 } },
  { name: '脑窗', voi: { windowWidth: 80, windowCenter: 40 } },
  { name: '软组织', voi: { windowWidth: 400, windowCenter: 40 } },
];

/** 翻页键步长：与 Shift+滚轮 对齐（§3.3 / §8 键位表） */
const PAGE_STEP = 10;

export function Viewport({
  renderer,
  viewportId = 'default-viewport',
  onLoadSample,
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sliceTextRef = useRef<HTMLSpanElement>(null);
  const voiTextRef = useRef<HTMLSpanElement>(null);

  // 层号导航相关 DOM 一律走 ref：翻页是高频操作，不能每帧 setState (R4)
  const layerInputRef = useRef<HTMLInputElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const prevLayerRef = useRef<HTMLButtonElement>(null);
  const nextLayerRef = useRef<HTMLButtonElement>(null);

  const currentSliceIndexRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const startVoiRef = useRef<VOIRange | null>(null);

  const { activeSeriesHandle, warnings, setImportStatus } = useViewerStore();
  const topWarning = primaryWarning(warnings);
  const restWarningCount = Math.max(0, warnings.length - 1);

  const totalFrames = activeSeriesHandle?.meta.planes.length ?? 0;
  const showNav = hasSliceNavigation(totalFrames);
  const sliderDraggable = isDraggableSlider(totalFrames);

  /**
   * 把导航控件的显示同步到指定层号。
   * 只写 DOM、不触发 React 渲染：这些节点在 JSX 里都不受控（无 value / style / disabled），
   * 因此 React 重渲染不会把命令式写入的值冲掉。
   */
  const syncSliceUi = (index: number, total: number) => {
    if (layerInputRef.current) {
      layerInputRef.current.value = String(index + 1);
    }
    if (progressFillRef.current) {
      const pct = total > 1 ? (index / (total - 1)) * 100 : 0;
      progressFillRef.current.style.width = `${pct}%`;
    }
    if (sliderRef.current && sliderRef.current.value !== String(index)) {
      sliderRef.current.value = String(index);
    }
    if (prevLayerRef.current) prevLayerRef.current.disabled = index <= 0;
    if (nextLayerRef.current) nextLayerRef.current.disabled = index >= total - 1;
  };

  // 1. 装载序列与切换序列（错误可见性遵循 P1-1）
  useEffect(() => {
    if (!renderer || !activeSeriesHandle) return;

    let cancelled = false;

    async function loadSeries() {
      try {
        currentSliceIndexRef.current = 0;
        await renderer!.setStack(viewportId, activeSeriesHandle!, 0);
        if (cancelled) return;

        const count = activeSeriesHandle!.meta.planes.length;
        if (sliceTextRef.current) {
          sliceTextRef.current.textContent = `1 / ${count}`;
        }
        syncSliceUi(0, count);

        try {
          const currentVoi = renderer!.getVOI(viewportId);
          if (voiTextRef.current) {
            voiTextRef.current.textContent = `WW: ${Math.round(currentVoi.windowWidth)} WL: ${Math.round(currentVoi.windowCenter)}`;
          }
        } catch {
          // 首帧尚未提交时静默跳过
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setImportStatus({
            loading: false,
            error: `序列切片装载失败: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    void loadSeries();

    return () => {
      cancelled = true;
    };
  }, [renderer, viewportId, activeSeriesHandle, setImportStatus]);

  // 2. 高频交互：滚轮切片翻页与鼠标右键调窗（R4: 渲染循环内绝对禁止 setState）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !renderer) return;

    let rafId: number | null = null;
    let pendingVOI: VOIRange | null = null;

    const handleWheel = (e: WheelEvent) => {
      if (!activeSeriesHandle) return;
      e.preventDefault();

      const total = activeSeriesHandle.meta.planes.length;
      if (total <= 1) return;

      // Shift+滚轮步长 10：大序列下逐层滚到目标层不现实（§3.3）
      const step = e.shiftKey ? PAGE_STEP : 1;
      const nextIndex = nextLayerIndex(
        currentSliceIndexRef.current,
        Math.sign(e.deltaY) * step,
        total,
      );

      if (nextIndex !== currentSliceIndexRef.current) {
        currentSliceIndexRef.current = nextIndex;
        if (sliceTextRef.current) {
          sliceTextRef.current.textContent = `${nextIndex + 1} / ${total}`;
        }
        syncSliceUi(nextIndex, total);
        void renderer.setStackIndex(viewportId, nextIndex);
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!activeSeriesHandle) return;
      // 允许右键 (button 2) 或 Shift+左键调窗
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        draggingRef.current = true;
        startPosRef.current = { x: e.clientX, y: e.clientY };
        try {
          startVoiRef.current = renderer.getVOI(viewportId);
        } catch {
          startVoiRef.current = { windowWidth: 400, windowCenter: 40 };
        }
        el.setPointerCapture(e.pointerId);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!draggingRef.current || !startVoiRef.current) return;
      e.preventDefault();

      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;

      const nextWidth = Math.max(1, Math.round(startVoiRef.current.windowWidth + dx * 2));
      const nextCenter = Math.round(startVoiRef.current.windowCenter + dy * 2);

      pendingVOI = { windowWidth: nextWidth, windowCenter: nextCenter };

      // rAF 节流避免高频触控板过度提交 (N4)
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingVOI) {
            renderer.setVOI(viewportId, pendingVOI);
            // 直接更新 DOM ref，零 React setState 开销 (R4)
            if (voiTextRef.current) {
              voiTextRef.current.textContent = `WW: ${pendingVOI.windowWidth} WL: ${pendingVOI.windowCenter}`;
            }
          }
          rafId = null;
        });
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (draggingRef.current) {
        draggingRef.current = false;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('contextmenu', handleContextMenu);
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('contextmenu', handleContextMenu);
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [renderer, viewportId, activeSeriesHandle]);

  // 3. 键盘快捷键（1-5 预设，R 复位，方向键/翻页键切片）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeSeriesHandle || !renderer) return;

      const num = Number(e.key);
      if (num >= 1 && num <= PRESETS.length) {
        const preset = PRESETS[num - 1]!;
        applyPreset(preset.voi);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        // CornerstoneRenderer.resetView 已自带 render，无需重复提交 (N3)
        renderer.resetView(viewportId);
        return;
      }

      const total = activeSeriesHandle.meta.planes.length;
      if (total <= 1) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        jumpToSlice(currentSliceIndexRef.current - 1, total);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        jumpToSlice(currentSliceIndexRef.current + 1, total);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        jumpToSlice(currentSliceIndexRef.current - PAGE_STEP, total);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        jumpToSlice(currentSliceIndexRef.current + PAGE_STEP, total);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [renderer, viewportId, activeSeriesHandle]);

  const applyPreset = (voi: VOIRange) => {
    if (!renderer) return;
    // setVOI 内部已包含 render 提交，去除外层冗余 render (N3)
    renderer.setVOI(viewportId, voi);
    if (voiTextRef.current) {
      voiTextRef.current.textContent = `WW: ${voi.windowWidth} WL: ${voi.windowCenter}`;
    }
  };

  const jumpToSlice = (index: number, total: number) => {
    if (!renderer) return;
    const target = clampLayer(index, total);
    if (target === currentSliceIndexRef.current) {
      // 即便层号没变也要同步 UI：输入框可能刚被用户改成非法值，需要恢复
      syncSliceUi(target, total);
      return;
    }
    currentSliceIndexRef.current = target;
    if (sliceTextRef.current) {
      sliceTextRef.current.textContent = `${target + 1} / ${total}`;
    }
    syncSliceUi(target, total);
    void renderer.setStackIndex(viewportId, target);
  };

  const handleLayerInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const total = activeSeriesHandle?.meta.planes.length ?? 0;
    const parsed = parseLayerInput(e.currentTarget.value, total);
    if (parsed === null) {
      // 非法输入恢复原值（§3.3）
      syncSliceUi(currentSliceIndexRef.current, total);
      return;
    }
    jumpToSlice(parsed, total);
  };

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!activeSeriesHandle) return;
    const total = activeSeriesHandle.meta.planes.length;
    jumpToSlice(Number(e.target.value), total);
  };

  return (
    <div className="flex-1 flex flex-col bg-canvas relative overflow-hidden select-none">
      {/* 视口顶部状态提示条 */}
      <div className="h-9 px-4 bg-panel/80 border-b border-line flex items-center justify-between text-xs text-txt-dim z-10 backdrop-blur-xs">
        <div className="flex items-center space-x-3">
          <span className="font-medium text-txt">
            {activeSeriesHandle
              ? `${activeSeriesHandle.meta.modality} · 横断面 (Axial)`
              : '就绪'}
          </span>
          {activeSeriesHandle && (
            <span ref={sliceTextRef} className="font-mono text-txt-dim" />
          )}
        </div>

        <div className="flex items-center space-x-4">
          <span ref={voiTextRef} className="font-mono text-txt-dim">
            WW: -- WL: --
          </span>
          <button
            type="button"
            onClick={() => {
              renderer?.resetView(viewportId);
            }}
            title="复位视图 (快捷键 R)"
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-hover text-txt-dim hover:text-txt transition cursor-pointer"
          >
            <ResetIcon className="w-3.5 h-3.5" />
            <span>复位</span>
          </button>
        </div>
      </div>

      {/* 数据告警提示（R7: 禁止静默降级）
          只展示最严重的一条 + 剩余条数：真实数据下逐条拼接会把顶条撑成好几行并溢出 */}
      {topWarning && (
        <div
          className={`${warningBannerClass(topWarning.severity)} border-b px-4 py-1.5 flex items-center space-x-2 text-xs z-10`}
        >
          <WarningIcon className="w-4 h-4 shrink-0" />
          <span className="font-semibold shrink-0">{severityLabel(topWarning.severity)}：</span>
          <span className="truncate">{topWarning.message}</span>
          {restWarningCount > 0 && (
            <span className="shrink-0 opacity-70">· 另有 {restWarningCount} 条见右侧</span>
          )}
        </div>
      )}

      {/* 视口中央内容区 */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-canvas">
        {/* CS3D 渲染挂载容器：DOM 节点持久存在，由 App 组合根完成 mount (P0-1) */}
        <div
          id="odv-viewport-el"
          ref={containerRef}
          className="w-full h-full relative cursor-crosshair touch-none"
        />

        {/* 视口状态与空状态覆盖层：绝对定位居中，不干扰 CS3D 内部 DOM 布局 */}
        {!renderer ? (
          <div className="absolute inset-0 flex items-center justify-center text-overlay/70 text-xs pointer-events-none select-none">
            <SpinnerIcon className="w-4 h-4 text-accent mr-2" />
            <span>正在挂载渲染视口...</span>
          </div>
        ) : !activeSeriesHandle ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-overlay/70 text-sm p-4 pointer-events-auto select-none">
            <p className="font-medium text-overlay text-base">请选择序列或拖入 DICOM 影像</p>
            <p className="text-xs text-overlay/60 mt-1.5 max-w-sm">
              可直接将文件夹或 .dcm 文件拖入窗口，或点击上方「打开文件/文件夹」
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
        ) : null}
      </div>

      {/* 视口底部控制栏：层号导航 + 快捷调窗预设 */}
      {activeSeriesHandle && (
        <div className="h-12 px-4 bg-panel border-t border-line flex items-center justify-between z-10 space-x-4">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            {showNav && (
              <>
                {/* 上一层 / 下一层：单帧序列整组隐藏 (§3.3) */}
                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    ref={prevLayerRef}
                    type="button"
                    onClick={() =>
                      jumpToSlice(currentSliceIndexRef.current - 1, totalFrames)
                    }
                    title="上一层 (↑)"
                    aria-label="上一层"
                    className="w-6 h-6 flex items-center justify-center rounded bg-hover hover:bg-active active:bg-accent text-txt-dim hover:text-txt disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer text-[11px]"
                  >
                    ◀
                  </button>
                  <button
                    ref={nextLayerRef}
                    type="button"
                    onClick={() =>
                      jumpToSlice(currentSliceIndexRef.current + 1, totalFrames)
                    }
                    title="下一层 (↓)"
                    aria-label="下一层"
                    className="w-6 h-6 flex items-center justify-center rounded bg-hover hover:bg-active active:bg-accent text-txt-dim hover:text-txt disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer text-[11px]"
                  >
                    ▶
                  </button>
                </div>

                {/* 层号输入框：回车跳转，越界钳到 [1, N]，非法输入恢复原值 */}
                <div className="flex items-center space-x-1.5 shrink-0 font-mono text-[11px] text-txt-muted">
                  <input
                    ref={layerInputRef}
                    type="text"
                    inputMode="numeric"
                    aria-label="层号"
                    title="输入层号后回车跳转"
                    onKeyDown={handleLayerInputKeyDown}
                    onBlur={() =>
                      syncSliceUi(currentSliceIndexRef.current, totalFrames)
                    }
                    className="w-12 px-1.5 py-0.5 text-center rounded bg-elevated border border-line-strong text-txt focus:outline-none focus:border-accent tabular-nums"
                  />
                  <span>/ {totalFrames}</span>
                </div>

                {/* 进度：默认只读；≤200 帧的小序列升级为可拖动滑块 (§3.3) */}
                {sliderDraggable ? (
                  <input
                    ref={sliderRef}
                    type="range"
                    min="0"
                    max={totalFrames - 1}
                    defaultValue={0}
                    onChange={handleSliderChange}
                    aria-label="切片进度"
                    className="flex-1 min-w-0 accent-accent cursor-pointer h-1.5 bg-line-strong rounded-lg"
                  />
                ) : (
                  <div
                    className="flex-1 min-w-0 h-[3px] bg-line-strong rounded overflow-hidden"
                    role="progressbar"
                    aria-label="切片进度"
                    aria-valuemin={1}
                    aria-valuemax={totalFrames}
                  >
                    <div
                      ref={progressFillRef}
                      className="h-full bg-accent rounded"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 常用调窗预设 */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <span className="text-[11px] text-txt-muted mr-1">预设:</span>
            {PRESETS.map((preset, idx) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset.voi)}
                className="px-2 py-1 text-xs rounded bg-hover hover:bg-active active:bg-accent text-txt-dim hover:text-txt transition cursor-pointer font-medium"
                title={`${preset.name} (快捷键 ${idx + 1}): WW ${preset.voi.windowWidth}, WL ${preset.voi.windowCenter}`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
