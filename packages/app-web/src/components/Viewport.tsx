import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import type { VOIRange } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { ResetIcon, WarningIcon, SpinnerIcon } from './Icons';

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

export function Viewport({
  renderer,
  viewportId = 'default-viewport',
  onLoadSample,
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sliceTextRef = useRef<HTMLSpanElement>(null);
  const voiTextRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  const currentSliceIndexRef = useRef<number>(0);
  const draggingRef = useRef<boolean>(false);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const startVoiRef = useRef<VOIRange | null>(null);

  const { activeSeriesHandle, warnings, setImportStatus } = useViewerStore();
  const [sliceIndex, setSliceIndex] = useState(0);

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
        setSliceIndex(0);
        if (sliceTextRef.current) {
          sliceTextRef.current.textContent = `1 / ${count}`;
        }
        if (sliderRef.current) {
          sliderRef.current.max = String(Math.max(0, count - 1));
          sliderRef.current.value = '0';
        }

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

      const delta = Math.sign(e.deltaY);
      const nextIndex = Math.min(
        Math.max(0, currentSliceIndexRef.current + delta),
        total - 1,
      );

      if (nextIndex !== currentSliceIndexRef.current) {
        currentSliceIndexRef.current = nextIndex;
        setSliceIndex(nextIndex);
        if (sliceTextRef.current) {
          sliceTextRef.current.textContent = `${nextIndex + 1} / ${total}`;
        }
        if (sliderRef.current) {
          sliderRef.current.value = String(nextIndex);
        }
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

  // 3. 键盘快捷键（1-5 预设，R 复位，上下键切片）
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

      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        const nextIndex = Math.max(0, currentSliceIndexRef.current - 1);
        jumpToSlice(nextIndex, total);
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        const nextIndex = Math.min(total - 1, currentSliceIndexRef.current + 1);
        jumpToSlice(nextIndex, total);
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
    if (!renderer || index === currentSliceIndexRef.current) return;
    currentSliceIndexRef.current = index;
    setSliceIndex(index);
    if (sliceTextRef.current) {
      sliceTextRef.current.textContent = `${index + 1} / ${total}`;
    }
    if (sliderRef.current) {
      sliderRef.current.value = String(index);
    }
    void renderer.setStackIndex(viewportId, index);
  };

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!activeSeriesHandle) return;
    const targetIndex = Number(e.target.value);
    const total = activeSeriesHandle.meta.planes.length;
    jumpToSlice(targetIndex, total);
  };

  const totalFrames = activeSeriesHandle?.meta.planes.length ?? 0;

  return (
    <div className="flex-1 flex flex-col bg-[#080B11] relative overflow-hidden select-none">
      {/* 视口顶部状态提示条 */}
      <div className="h-9 px-4 bg-[#0D111A]/80 border-b border-gray-800/80 flex items-center justify-between text-xs text-gray-400 z-10 backdrop-blur-xs">
        <div className="flex items-center space-x-3">
          <span className="font-medium text-gray-200">
            {activeSeriesHandle
              ? `${activeSeriesHandle.meta.modality} · 横断面 (Axial)`
              : '就绪'}
          </span>
          {activeSeriesHandle && (
            <span ref={sliceTextRef} className="font-mono text-gray-300">
              {sliceIndex + 1} / {totalFrames}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-4">
          <span ref={voiTextRef} className="font-mono text-gray-300">
            WW: -- WL: --
          </span>
          <button
            type="button"
            onClick={() => {
              renderer?.resetView(viewportId);
            }}
            title="复位视图 (快捷键 R)"
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-gray-800 text-gray-300 hover:text-white transition cursor-pointer"
          >
            <ResetIcon className="w-3.5 h-3.5" />
            <span>复位</span>
          </button>
        </div>
      </div>

      {/* 数据告警提示（R7: 禁止静默降级） */}
      {warnings.length > 0 && (
        <div className="bg-amber-950/70 border-b border-amber-600/50 px-4 py-1.5 flex items-center space-x-2 text-xs text-amber-200 z-10">
          <WarningIcon className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="truncate">
            <span className="font-semibold">影像数据告警：</span>
            {warnings.map((w) => w.message).join('；')}
          </div>
        </div>
      )}

      {/* 视口中央内容区 */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-black">
        {/* CS3D 渲染挂载容器：DOM 节点持久存在，由 App 组合根完成 mount (P0-1) */}
        <div
          id="odv-viewport-el"
          ref={containerRef}
          className="w-full h-full relative cursor-crosshair touch-none"
        />

        {/* 视口状态与空状态覆盖层：绝对定位居中，不干扰 CS3D 内部 DOM 布局 */}
        {!renderer ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs pointer-events-none select-none">
            <SpinnerIcon className="w-4 h-4 text-blue-500 mr-2" />
            <span>正在挂载渲染视口...</span>
          </div>
        ) : !activeSeriesHandle ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-gray-500 text-sm p-4 pointer-events-auto select-none">
            <p className="font-medium text-gray-300 text-base">请选择序列或拖入 DICOM 影像</p>
            <p className="text-xs text-gray-500 mt-1.5 max-w-sm">
              可直接将文件夹或 .dcm 文件拖入窗口，或点击上方「打开文件/文件夹」
            </p>
            {onLoadSample && (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => onLoadSample()}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-medium transition cursor-pointer shadow-md"
                >
                  载入示例（脑部 MR 36 帧 + 胸腹 CT）
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 视口底部控制栏（滑块与快捷调窗预设） */}
      {activeSeriesHandle && (
        <div className="h-12 px-4 bg-[#0D111A] border-t border-gray-800 flex items-center justify-between z-10 space-x-4">
          {/* 切片滑动条 (N9: 统一受控同步) */}
          <div className="flex items-center space-x-2 flex-1 max-w-sm">
            <span className="text-[11px] text-gray-400 font-mono">1</span>
            <input
              ref={sliderRef}
              type="range"
              min="0"
              max={Math.max(0, totalFrames - 1)}
              value={sliceIndex}
              onChange={handleSliderChange}
              className="w-full accent-blue-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg"
            />
            <span className="text-[11px] text-gray-400 font-mono">
              {totalFrames}
            </span>
          </div>

          {/* 常用调窗预设 */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[11px] text-gray-500 mr-1">预设:</span>
            {PRESETS.map((preset, idx) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset.voi)}
                className="px-2 py-1 text-xs rounded bg-gray-800/80 hover:bg-gray-700 active:bg-blue-600 text-gray-300 hover:text-white transition cursor-pointer font-medium"
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
