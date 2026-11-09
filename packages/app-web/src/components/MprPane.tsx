/**
 * MPR 单格视口（P3）
 *
 * 一格 = 一个 CS3D 视口 + 一层纯文字角标。渲染面由 App 组合根挂载，
 * 这里只画叠加层、收交互事件：
 * - 滚轮翻层：高频路径，只写 DOM ref 并调 RendererPort（R4，禁止 setState）；
 * - 右键 / Shift+左键调窗：仅在 Stack 格启用（MPR 用固定显示区间）；
 * - 准星：父组件算好画布坐标后通过 handle 命令式写入。
 */

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { VOIRange } from '@opendicomviewer/core';
import { SpinnerIcon, WarningIcon } from './Icons';
import { ScaleBar } from './ScaleBar';
import { bindViewportGestures } from './viewport-gestures';
import { useViewerStore } from '../state/viewer-store';
import type { PaneSpec } from '../layout/viewport-layouts';

export interface CrosshairPoint {
  readonly x: number;
  readonly y: number;
}

export interface MprPaneHandle {
  setSlice(index: number, total: number): void;
  setVoi(text: string, preset?: string | null): void;
  setCrosshair(point: CrosshairPoint | null): void;
}

export interface MprPaneProps {
  readonly renderOverlay?: (hostRef: RefObject<HTMLDivElement | null>) => ReactNode;
  readonly spec: PaneSpec;
  readonly active: boolean;
  readonly selectable?: boolean;
  readonly totalSlices: number;
  readonly modality: string;
  readonly seriesDescription?: string;
  /** 显式状态：构建中/失败/未就绪，禁止用黑色画面代替说明（R7） */
  readonly notice?: string;
  readonly noticeKind?: 'info' | 'error' | 'empty';
  readonly windowingEnabled: boolean;
  readonly onActivate: () => void;
  readonly onStep: (delta: number) => void;
  readonly onPan: (x: number, y: number) => void;
  readonly onZoom: (factor: number) => void;
  readonly onError: (error: unknown) => void;
  readonly onVoiPreview: (voi: VOIRange) => void;
  /** 拖拽开始时读当前窗；读失败由调用方给兜底值，不在渲染循环里重试 */
  readonly readVoi: () => VOIRange;
  /** 比例尺换算：拿不到物理信息返回 null（显示「无物理标尺」） */
  readonly measureScale: (
    viewportId: string,
    width: number,
    height: number,
  ) => number | null;
  readonly register: (viewportId: string, handle: MprPaneHandle | null) => void;
}

const PAGE_STEP = 10;

export function MprPane({
  spec,
  renderOverlay,
  active,
  selectable = false,
  totalSlices,
  modality,
  seriesDescription,
  notice,
  noticeKind = 'info',
  windowingEnabled,
  onActivate,
  onStep,
  onPan, onZoom, onError,
  onVoiPreview,
  readVoi,
  measureScale,
  register,
}: MprPaneProps) {
  const activeTool = useViewerStore((state) => state.activeTool);
  const rootRef = useRef<HTMLDivElement>(null);
  const sliceRef = useRef<HTMLSpanElement>(null);
  const voiRef = useRef<HTMLSpanElement>(null);
  const verticalRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);

  /** 把视口 id 绑进比例尺测量：ScaleBar 只关心宿主尺寸 */
  const measure = useCallback(
    (width: number, height: number) =>
      measureScale(spec.viewportId, width, height),
    [measureScale, spec.viewportId],
  );

  // 回调放 ref：事件监听只随「层数/是否可调窗」重建，避免每次渲染重绑
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onVoiPreviewRef = useRef(onVoiPreview);
  onVoiPreviewRef.current = onVoiPreview;
  const readVoiRef = useRef(readVoi);
  readVoiRef.current = readVoi;

  const cameraRef = useRef({ onPan, onZoom, onError });
  cameraRef.current = { onPan, onZoom, onError };

  // 注册命令式句柄：父组件翻层后只写 DOM，不触发 React 重渲染
  useEffect(() => {
    register(spec.viewportId, {
      setSlice: (index, total) => {
        if (sliceRef.current) {
          sliceRef.current.textContent =
            total > 0 ? `层 ${index + 1} / ${total}` : '层 -- / --';
        }
      },
      setVoi: (text, preset) => {
        if (voiRef.current) {
          voiRef.current.textContent = preset ? `[${preset}] · ${text}` : text;
        }
      },
      setCrosshair: (point) => {
        const vertical = verticalRef.current;
        const horizontal = horizontalRef.current;
        const root = rootRef.current;
        if (!vertical || !horizontal || !root) return;
        if (
          !point ||
          point.x < 0 ||
          point.y < 0 ||
          point.x > root.clientWidth ||
          point.y > root.clientHeight
        ) {
          vertical.style.display = 'none';
          horizontal.style.display = 'none';
          return;
        }
        vertical.style.display = 'block';
        horizontal.style.display = 'block';
        vertical.style.left = `${point.x}px`;
        horizontal.style.top = `${point.y}px`;
      },
    });
    return () => register(spec.viewportId, null);
  }, [register, spec.viewportId]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (totalSlices <= 1) return;
      e.preventDefault();
      const step = e.shiftKey ? PAGE_STEP : 1;
      onStepRef.current(Math.sign(e.deltaY) * step);
    };

    const unbind = bindViewportGestures(el, {
      enabled: () => totalSlices > 0,
      windowingEnabled: () => windowingEnabled,
      tool: () => useViewerStore.getState().activeTool,
      activate: () => onActivateRef.current(),
      readVOI: () => readVoiRef.current(),
      window: (voi) => onVoiPreviewRef.current(voi),
      pan: (x, y) => cameraRef.current.onPan(x, y),
      zoom: (factor) => cameraRef.current.onZoom(factor),
      step: (delta) => onStepRef.current(delta),
      error: (error) => cameraRef.current.onError(error),
    });
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => { unbind(); el.removeEventListener('wheel', handleWheel); };
  }, [totalSlices, windowingEnabled]);

  return (
    <div
      ref={rootRef}
      role={selectable ? 'group' : undefined}
      aria-label={selectable ? spec.shortTitle : undefined}
      tabIndex={selectable ? 0 : undefined}
      onFocus={selectable ? onActivate : undefined}
      onPointerDownCapture={selectable ? onActivate : undefined}
      data-tool={activeTool}
      data-odv-pane={spec.viewportId}
      style={{ gridArea: spec.gridArea }}
      className={`relative min-h-0 min-w-0 overflow-hidden select-none pointer-events-auto ${
        active ? 'ring-1 ring-inset ring-accent/70 z-10' : ''
      } ${windowingEnabled ? 'cursor-crosshair' : 'cursor-default'}`}
    >
      {renderOverlay?.(rootRef)}
      {/* 左上：切面名 + 序列描述 */}
      <div className="absolute top-2 left-2.5 max-w-[70%] flex flex-col gap-0.5 pointer-events-none [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        <span className="text-[12px] font-semibold text-overlay truncate">
          {spec.title}
        </span>
        <span title={seriesDescription} className="text-[10px] text-overlay/70 truncate">
          {modality}
          {seriesDescription ? ` · ${seriesDescription}` : ''}
        </span>
      </div>

      {/* 右上：层号 */}
      <div className="absolute top-2 right-2.5 text-right pointer-events-none [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        <span ref={sliceRef} className="font-mono text-[11px] text-overlay">
          层 -- / --
        </span>
      </div>

      {/* 左下：窗宽窗位（MPR 固定显示区间） */}
      <div className="absolute bottom-2 left-2.5 pointer-events-none [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
        <span ref={voiRef} className="font-mono text-[10px] text-overlay/75">
          WW -- · WL --
        </span>
      </div>

      {/* 左下偏上：比例尺。体积挂载后 totalSlices 从 0 变为 N，触发重测 */}
      <div className="absolute bottom-7 left-2.5">
        <ScaleBar hostRef={rootRef} measure={measure} refreshKey={totalSlices} />
      </div>

      {/* 右下：网格类型提示，避免用户把降采样 MPR 当成测量真源 */}
      {spec.kind === 'orthographic' && (
        <div className="absolute bottom-2 right-2.5 pointer-events-none text-[10px] text-overlay/60 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
          降采样 · 仅显示
        </div>
      )}

      {/* 十字准星：由父组件命令式定位，pointer-events-none 不挡交互 */}
      <div
        ref={verticalRef}
        className="absolute top-0 bottom-0 w-px bg-accent/80 pointer-events-none"
        style={{ display: 'none' }}
      />
      <div
        ref={horizontalRef}
        className="absolute left-0 right-0 h-px bg-accent/80 pointer-events-none"
        style={{ display: 'none' }}
      />

      {/* 构建/失败状态：显式覆盖层，绝不用黑屏代替说明 */}
      {notice && (
        <div className={`absolute inset-0 flex items-center justify-center p-4 pointer-events-none ${selectable ? 'bg-canvas' : ''}`}>
          <div
            className={`max-w-[85%] rounded-md border px-3 py-2 text-center text-[11px] leading-relaxed backdrop-blur-xs ${
              noticeKind === 'error'
                ? 'border-danger/50 bg-danger/15 text-danger'
                : 'border-line bg-canvas/70 text-overlay/80'
            }`}
          >
            {noticeKind === 'info' && (
              <SpinnerIcon className="w-4 h-4 text-accent inline mr-1.5 align-[-2px]" />
            )}
            {noticeKind === 'error' && (
              <WarningIcon className="w-3.5 h-3.5 inline mr-1.5 align-[-2px]" />
            )}
            {notice}
          </div>
        </div>
      )}
    </div>
  );
}
