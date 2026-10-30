import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import type { VOIRange } from '@opendicomviewer/core';
import { useViewerStore } from '../state/viewer-store';
import { ResetIcon, WarningIcon, SpinnerIcon } from './Icons';
import {
  countBySeverity,
  severityLabel,
  sortBySeverity,
  warningBoxClass,
  warningBannerClass,
} from './warning-presentation';
import {
  clampLayer,
  hasSliceNavigation,
  isDraggableSlider,
  nextLayerIndex,
  parseLayerInput,
} from './slice-navigation';
import { describeSliceOrientation, sliceProjection } from './slice-geometry';
import { getWindowPresets, pickAdaptiveVOI } from './window-presets';
import { ScaleBar } from './ScaleBar';
import { measureMmPerPx } from './scale-bar';
import { bindViewportGestures, blocksViewerShortcut } from './viewport-gestures';
import { WelcomeScreen } from './WelcomeScreen';

interface ViewportProps {
  readonly renderer: CornerstoneRenderer | null;
  readonly viewportId?: string;
  readonly onLoadSample?: (datasetId?: string) => void;
  readonly onOpenFolder?: () => void;
  readonly onOpenFiles?: () => void;
}

/** 翻页键步长：与 Shift+滚轮 对齐（§3.3 / §8 键位表） */
const PAGE_STEP = 10;

export function Viewport({
  renderer,
  viewportId = 'default-viewport',
  onLoadSample,
  onOpenFolder,
  onOpenFiles,
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sliceTextRef = useRef<HTMLSpanElement>(null);
  const voiTextRef = useRef<HTMLSpanElement>(null);
  /** 画布左下「当前窗」与右下「物理位置」：随翻页/调窗高频变化，同样只写 DOM (R4) */
  const voiCornerRef = useRef<HTMLDivElement>(null);
  const posCornerRef = useRef<HTMLDivElement>(null);
  /** 当前预设名（顶栏 chip 和左下角角标共用；null 表示手动调窗后的自定义态） */
  const presetNameRef = useRef<string | null>(null);

  // 层号导航相关 DOM 一律走 ref：翻页是高频操作，不能每帧 setState (R4)
  const layerInputRef = useRef<HTMLInputElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const prevLayerRef = useRef<HTMLButtonElement>(null);
  const nextLayerRef = useRef<HTMLButtonElement>(null);

  const currentSliceIndexRef = useRef<number>(0);
  const navigationRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * 当前序列装载完成时的默认窗（DICOM 标签窗或 CS3D 按像素统计推算）。
   * 「复位」要能把预设/手调过的窗拉回这个值——RendererPort 的 resetView 按契约只复位相机，
   * 所以默认窗必须在 app 侧随装载快照下来。
   */
  const defaultVoiRef = useRef<VOIRange | null>(null);

  const { activeSeriesHandle, activeStudyUid, studies, warnings, setImportStatus, activeTool } =
    useViewerStore();
  const autoPresetRequest = useRef(0);
  const PRESETS = getWindowPresets(activeSeriesHandle?.meta);

  /**
   * 告警改为「状态条角标 + 点开浮层」，不再在画布上盖一条横幅。
   *
   * 原因：横幅必然压在影像上，而影像顶部正是诊断信息最密集的区域
   * （患者信息角标、病灶、方位标记）。角标常驻可保证 R7 的「不静默」
   * ——数量一直可见，详情由用户主动展开。
   */
  const [warnOpen, setWarnOpen] = useState(false);
  /** 装载完成/复位后自增：比例尺依赖相机与画布，必须在这两个时点重新测量 */
  const [scaleEpoch, setScaleEpoch] = useState(0);
  const warnMenuRef = useRef<HTMLDivElement>(null);
  const sortedWarnings = sortBySeverity(warnings);
  const warnCounts = countBySeverity(warnings);
  const topSeverity = sortedWarnings[0]?.severity;

  // 点击外部或 Esc 关闭告警浮层（只处理用户触发的开关，不参与翻页/调窗高频循环）
  useEffect(() => {
    if (!warnOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!warnMenuRef.current?.contains(e.target as Node)) setWarnOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWarnOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [warnOpen]);

  // 四角标注的患者信息（参考 DICOM Vision / Voxenra：角标里直接读患者与序列）
  const currentStudy = studies.find((s) => s.studyInstanceUid === activeStudyUid);
  const patientLabel = currentStudy?.patientName?.trim() || '未知患者';
  const patientIdLabel = currentStudy?.patientId?.trim() || '无编号';

  const firstPlane = activeSeriesHandle?.meta.planes[0];
  const orientation = describeSliceOrientation(firstPlane?.imageOrientationPatient, firstPlane?.hasMissingGeometry);
  const totalFrames = activeSeriesHandle?.meta.planes.length ?? 0;
  const showNav = hasSliceNavigation(totalFrames);
  const sliderDraggable = isDraggableSlider(totalFrames);
  /** 比例尺：用画布中心两点反算 mm/px；序列未装载时返回 null → 显示「无物理标尺」 */
  const measureScale = useCallback(
    (width: number, height: number) =>
      measureMmPerPx(renderer, viewportId, width, height),
    [renderer, viewportId],
  );
  /**
   * 层厚取首帧：它是重建参数，同一序列各帧共用。
   * 翻页不触发 React 重渲染，放进每帧同步反而要多写一次 DOM。
   */
  const sliceThickness = activeSeriesHandle?.meta.planes[0]?.sliceThickness;

  /**
   * 同步调窗显示：顶部状态条与画布左下角共用同一口径，
   * 避免两处各写一套格式后出现"同一次调窗两个数值"。
   */
  const syncVoiUi = (voi: VOIRange, presetName?: string) => {
    presetNameRef.current = presetName ?? null;
    const text = `WW ${Math.round(voi.windowWidth)} · WL ${Math.round(voi.windowCenter)}`;
    if (voiTextRef.current) voiTextRef.current.textContent = text;
    if (voiCornerRef.current) {
      voiCornerRef.current.textContent = presetName
        ? `[${presetName}] · ${text}`
        : text;
    }
  };

  /**
   * 右下角物理位置：IPP 沿切面法向的投影值。
   *
   * 用法向投影而不是直接读 z：斜切序列的 IPP 三个分量都在变，
   * 只有沿法向的距离才等距，才是"第几层"的真实物理位置。
   * 几何缺失时不编造数字，直接显示告警文案（P1-5 / R7）。
   */
  const updatePositionCorner = (index: number) => {
    const el = posCornerRef.current;
    const plane = activeSeriesHandle?.meta.planes[index];
    if (!el) return;
    if (!plane) {
      el.textContent = '--';
      return;
    }
    if (plane.hasMissingGeometry) {
      el.textContent = '⚠ 几何缺失';
      return;
    }

    const projection = sliceProjection(
      plane.imagePositionPatient,
      plane.imageOrientationPatient,
    );

    const spacing = activeSeriesHandle?.meta.spacing?.[2];
    el.textContent =
      `位置 ${projection.toFixed(1)} mm` +
      (spacing === undefined ? '' : ` · ${spacing.toFixed(2)} mm/层`);
  };

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
    updatePositionCorner(index);
  };

  // 1. 装载序列与切换序列（错误可见性遵循 P1-1）
  useEffect(() => {
    if (!renderer || !activeSeriesHandle) return;

    let cancelled = false;

    async function loadSeries() {
      try {
        currentSliceIndexRef.current = 0;
        defaultVoiRef.current = null;
        await renderer!.setStack(viewportId, activeSeriesHandle!, 0);
        if (cancelled) return;

        const count = activeSeriesHandle!.meta.planes.length;
        if (sliceTextRef.current) {
          sliceTextRef.current.textContent = `层数 1 / ${count}`;
        }
        syncSliceUi(0, count);
        // 相机此时才完成适配，比例尺必须在这次装载结束后再量一次
        setScaleEpoch((v) => v + 1);

        try {
          const currentVoi = renderer!.getVOI(viewportId);
          // 只接受有效值：首帧尚未提交时读回 NaN，不能当作"默认窗"记下
          if (
            Number.isFinite(currentVoi.windowWidth) &&
            Number.isFinite(currentVoi.windowCenter)
          ) {
            defaultVoiRef.current = currentVoi;
          }
          syncVoiUi(currentVoi);
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

  // 共用交互绑定：工具选择是低频 UI 态；拖动过程中只更新渲染器和 DOM。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !renderer) return;
    const wheel = (event: WheelEvent) => {
      if (!activeSeriesHandle) return;
      event.preventDefault();
      const delta = Math.sign(event.deltaY) * (event.shiftKey ? PAGE_STEP : 1);
      jumpToSlice(nextLayerIndex(currentSliceIndexRef.current, delta, activeSeriesHandle.meta.planes.length), activeSeriesHandle.meta.planes.length);
    };
    const unbind = bindViewportGestures(el, {
      enabled: () => activeSeriesHandle !== null,
      windowingEnabled: () => true,
      tool: () => useViewerStore.getState().activeTool,
      readVOI: () => renderer.getVOI(viewportId),
      window: (voi) => { renderer.setVOI(viewportId, voi); syncVoiUi(voi, '自定义'); },
      pan: (x, y) => renderer.panBy(viewportId, { x, y }),
      zoom: (factor) => renderer.zoomBy(viewportId, factor),
      step: (delta) => jumpToSlice(currentSliceIndexRef.current + delta, totalFrames),
      error: (error) => setImportStatus({ loading: false, error: `图像操作失败：${error instanceof Error ? error.message : String(error)}` }),
    });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { unbind(); el.removeEventListener('wheel', wheel); };
  }, [renderer, viewportId, activeSeriesHandle, setImportStatus]);

  // 3. 键盘快捷键（1 自动 / 2-4 部位预设，R 复位，方向键/翻页键切片）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeSeriesHandle || !renderer || blocksViewerShortcut(e)) return;

      const num = Number(e.key);
      if (num === 1) { void applyAutomatic(); return; }
      if (num >= 2 && num <= PRESETS.length + 1) {
        const preset = PRESETS[num - 2]!;
        applyPreset(preset.voi, preset.name);
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        resetViewToDefault();
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

  const applyAutomatic = async () => {
    if (!renderer || !activeSeriesHandle) return;
    const handle = activeSeriesHandle;
    const request = ++autoPresetRequest.current;
    try {
      const frame = await handle.pixel(renderer.currentSliceIndex(viewportId));
      if (request !== autoPresetRequest.current || useViewerStore.getState().activeSeriesHandle !== handle) return;
      const result = pickAdaptiveVOI(frame);
      applyPreset(result.voi, result.estimated ? '自动（估算）' : '自动');
    } catch (error) {
      if (request === autoPresetRequest.current && useViewerStore.getState().activeSeriesHandle === handle) setImportStatus({ loading: false, error: `自动窗失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const applyPreset = (voi: VOIRange, presetName?: string) => {
    autoPresetRequest.current++;
    if (!renderer) return;
    // setVOI 内部已包含 render 提交，去除外层冗余 render (N3)
    renderer.setVOI(viewportId, voi);
    syncVoiUi(voi, presetName);
  };

  /**
   * 复位：相机/缩放 + 窗宽窗位都回到本序列装载时的默认值。
   *
   * 只调 resetView 是不够的——端口契约里它明确"不改 VOI"，
   * 预设或右键手调过的窗会原样留在画面上，用户会以为按钮坏了（实测反馈）。
   */
  const resetViewToDefault = () => {
    if (!renderer) return;
    renderer.resetView(viewportId);
    // 复位会改缩放，比例尺要跟着重算
    setScaleEpoch((v) => v + 1);
    const defaultVoi = defaultVoiRef.current;
    if (!defaultVoi) return;
    // 不带预设名：复位后就是"未选预设"的状态，角标只显示 WW/WL
    renderer.setVOI(viewportId, defaultVoi);
    syncVoiUi(defaultVoi);
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
      sliceTextRef.current.textContent = `层数 ${target + 1} / ${total}`;
    }
    syncSliceUi(target, total);
    const series = activeSeriesHandle;
    navigationRef.current = navigationRef.current.catch(() => undefined).then(async () => {
      if (useViewerStore.getState().activeSeriesHandle !== series) return;
      await renderer.setStackIndex(viewportId, target);
    }).catch((error: unknown) => setImportStatus({ loading: false,
      error: `切片切换失败：${error instanceof Error ? error.message : String(error)}` }));
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
    <div className="flex-1 flex flex-col relative overflow-hidden select-none min-w-0 min-h-0 z-10">
      {/* ══ 视口顶部状态条（prototype .vp-bar, 36px, 不透明实色底 + relative 让 z-10 生效） ══ */}
      <div
        className="px-4 bg-panel border-b border-line flex items-center justify-between text-[12px] text-txt-dim relative z-10 shrink-0"
        hidden={!activeSeriesHandle}
        style={{ height: 'var(--vp-bar-h)' }}
      >
        {/* 左组：视口标题 + 预设 chip + 层数 */}
        <div className="flex items-center gap-4 min-w-0">
          <span className="font-medium text-txt truncate">
            {activeSeriesHandle
              ? `${activeSeriesHandle.meta.modality} · ${orientation.label}`
              : '就绪'}
          </span>

          {/* 当前预设 chip（蓝色边框，未选预设时隐藏） */}
          {activeSeriesHandle && presetNameRef.current && (
            <span className="text-[11px] text-accent border border-accent/45 rounded-sm px-1.5 py-px shrink-0">
              {presetNameRef.current}
            </span>
          )}

          {activeSeriesHandle && (
            <span ref={sliceTextRef} className="font-mono text-txt-dim shrink-0">
              层数 --
            </span>
          )}
        </div>

        {/* 右组：数据提醒角标 + WW/WL + 复位 */}
        <div className="flex items-center gap-4 shrink-0">
          {/* 数据提醒角标：常驻显示条数（R7 不静默），点击展开详情浮层，
              不占用画布任何面积 */}
          {warnings.length > 0 && topSeverity && (
            <div ref={warnMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setWarnOpen((v) => !v)}
                aria-expanded={warnOpen}
                aria-haspopup="dialog"
                title="查看数据提醒详情"
                className={`inline-flex items-center gap-1 h-6 px-1.5 rounded-sm border text-[11px] transition cursor-pointer ${warningBannerClass(topSeverity)}`}
              >
                <WarningIcon className="w-3.5 h-3.5" />
                <span className="font-mono">{warnings.length}</span>
              </button>

              {warnOpen && (
                <div
                  role="dialog"
                  aria-label="数据提醒详情"
                  className="absolute right-0 top-full mt-1.5 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-elevated shadow-2xl overflow-hidden"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-line">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-txt">
                      <WarningIcon className="w-3.5 h-3.5 text-txt-dim" />
                      <span>数据提醒</span>
                      <span className="text-txt-muted font-normal">
                        ({warnings.length})
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-txt-muted">
                      {warnCounts.error > 0 && `${warnCounts.error} 错误 `}
                      {warnCounts.warning > 0 && `${warnCounts.warning} 告警 `}
                      {warnCounts.info > 0 && `${warnCounts.info} 提示`}
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-2 flex flex-col gap-1.5">
                    {sortedWarnings.map((w, idx) => (
                      <div
                        key={`${w.code}-${idx}`}
                        className={`px-2 py-1.5 rounded border text-[11px] leading-relaxed ${warningBoxClass(w.severity)}`}
                      >
                        <span className="font-semibold mr-1.5">
                          {severityLabel(w.severity)}
                        </span>
                        <span>{w.message}</span>
                      </div>
                    ))}
                  </div>

                  <div className="px-3 py-1.5 border-t border-line text-[10px] text-txt-muted">
                    完整清单同步显示在右栏「数据提醒」
                  </div>
                </div>
              )}
            </div>
          )}

          <span ref={voiTextRef} className="font-mono text-txt-dim">
            WW -- · WL --
          </span>
          <button
            type="button"
            onClick={resetViewToDefault}
            title="复位视图与窗宽窗位 (快捷键 R)"
            className="inline-flex items-center gap-1 px-2 h-6 rounded-sm text-[12px] text-txt-dim hover:text-txt hover:bg-hover transition cursor-pointer"
          >
            <ResetIcon className="w-3.5 h-3.5" />
            <span>复位</span>
          </button>
        </div>
      </div>

      {/* ══ 画布区（flex-1 + 绝对定位叠加层） ══
          CS3D 挂载容器由 App 持有并位于本层之下；这里只做事件宿主与叠加层 */}
      <div
        ref={containerRef}
        data-tool={activeTool}
        className="flex-1 relative overflow-hidden min-h-0 touch-none cursor-crosshair"
      >

        {/* 数据告警不再覆盖画布：已移到 vp-bar 的角标 + 浮层（见上）。
            画布上只保留纯文字角标，保证影像不被任何不透明块遮挡 */}

        {/* 四角信息 + 方位标记（ui-spec §3.2）
            pointer-events-none：只是读数，不能挡住画布的滚轮翻页与右键调窗 */}
        {activeSeriesHandle && (
          <div className="absolute inset-0 pointer-events-none select-none z-10 text-[11px] text-overlay">
            {/* 左上：患者姓名 / 编号 / 序列描述（参考 DICOM Vision 角标布局）
                用 text-shadow 保证在亮区也读得清，不加底色块避免遮挡影像 */}
            <div className="absolute top-3 left-3 max-w-[46%] flex flex-col gap-0.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              <span className="text-[13px] font-semibold truncate">
                {patientLabel}
              </span>
              <span className="font-mono text-[10px] opacity-80 truncate">
                {patientIdLabel}
              </span>
              <span className="text-[10px] opacity-75 truncate">
                {activeSeriesHandle.meta.modality}
                {activeSeriesHandle.meta.seriesDescription
                  ? ` · ${activeSeriesHandle.meta.seriesDescription}`
                  : ''}
              </span>
            </div>

            {/* 右上：隐私状态（保守默认含身份信息） */}
            <div className="absolute top-3 right-3 max-w-[40%] text-right [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              <span className="inline-flex items-center gap-1 text-warn font-medium">
                <WarningIcon className="w-3 h-3" />
                <span>含身份信息</span>
              </span>
            </div>

            {/* 左下：当前窗（预设名 + WW/WL），由 syncVoiUi 命令式更新 */}
            <div
              ref={voiCornerRef}
              className="absolute bottom-3 left-3 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
            >
              <span className="font-mono">WW -- · WL --</span>
            </div>

            {/* 左下偏上：比例尺，按画布反算 mm/px（ui-spec §3.2） */}
            <div className="absolute bottom-9 left-3">
              <ScaleBar
                hostRef={containerRef}
                measure={measureScale}
                refreshKey={`${activeSeriesHandle.meta.seriesInstanceUid}:${scaleEpoch}`}
              />
            </div>

            {/* 右下：IPP 沿法向的投影值 + 层厚，由 updatePositionCorner 命令式更新
                （ref 节点会被 textContent 覆写，所以静态的层厚放在它外层） */}
            <div className="absolute bottom-3 right-3 text-right flex flex-col gap-0.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              <div ref={posCornerRef} className="font-mono">
                位置 -- mm
              </div>
              {sliceThickness !== undefined && (
                <div className="font-mono text-[10px] opacity-75">
                  层厚 {sliceThickness.toFixed(1)} mm
                </div>
              )}
            </div>

            {/* 方位来自有效 IOP；矢状面、冠状面和反向采集不能沿用固定轴位标记。 */}
            <span className="absolute top-1.5 left-1/2 -translate-x-1/2 font-semibold text-overlay/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              {orientation.top}
            </span>
            <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-semibold text-overlay/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              {orientation.bottom}
            </span>
            <span className="absolute left-2 top-1/2 -translate-y-1/2 font-semibold text-overlay/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              {orientation.left}
            </span>
            <span className="absolute right-2 top-1/2 -translate-y-1/2 font-semibold text-overlay/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              {orientation.right}
            </span>
          </div>
        )}

        {/* 视口状态与空状态覆盖层：绝对定位居中，不干扰 CS3D 内部 DOM 布局 */}
        {!renderer ? (
          <div className="absolute inset-0 flex items-center justify-center text-overlay/70 text-xs pointer-events-none select-none z-20">
            <SpinnerIcon className="w-4 h-4 text-accent mr-2" />
            <span>正在挂载渲染视口...</span>
          </div>
        ) : !activeSeriesHandle ? (
          <WelcomeScreen onOpenFolder={onOpenFolder} onOpenFiles={onOpenFiles} onLoadSample={onLoadSample} />
        ) : null}
      </div>

      {/* ══ 视口底部控制栏（极简专业：克制、无多余边框、轨道感弱） ══ */}
      {activeSeriesHandle && (
        <div
          className="workspace-slice-footer px-4 bg-panel border-t border-line flex items-center justify-between text-[12px] shrink-0"
          style={{ height: 'var(--vp-foot-h)' }}
        >
          {/* 左：层号导航 —— Figma/Xcode 风：按钮无边框、靠 hover 淡入背景，
              进度条 2px 极细轨道（更克制，不像"控件"而像"状态指示"） */}
          {showNav ? (
            <div className="flex items-center gap-3 shrink-0">
              {/* 上一层 / 下一层：24×24，默认透明，hover 时淡入 bg-hover，active 时 accent ring */}
              <button
                ref={prevLayerRef}
                type="button"
                onClick={() =>
                  jumpToSlice(currentSliceIndexRef.current - 1, totalFrames)
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
                  jumpToSlice(currentSliceIndexRef.current + 1, totalFrames)
                }
                title="下一层（滚轮下；Shift+滚轮 = 10 层）"
                aria-label="下一层"
                className="w-6 h-6 flex items-center justify-center rounded-md border border-transparent hover:bg-hover text-txt-muted hover:text-txt disabled:opacity-40 disabled:cursor-not-allowed active:ring-1 active:ring-accent/40 transition cursor-pointer text-[11px]"
              >
                ▶
              </button>

              {/* 层号输入框：更窄 48px，focus 态用 outline + ring 而不是 border 变化 */}
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
                className="w-12 h-6 text-right px-1.5 rounded-md bg-hover text-txt focus:outline-none focus:ring-2 focus:ring-accent/60 tabular-nums text-[12px] border border-transparent transition"
              />
              <span className="text-txt-muted text-[11px] font-mono select-none">/ {totalFrames}</span>

              {/* 进度条：细轨道 + 圆点手柄（自定义 .odv-slice-range），
                  而不是浏览器默认 24px 粗滑块，保持专业工具的克制感
                  ≤200 帧时可拖动；超过则只读显示填充比例 */}
              {sliderDraggable ? (
                <input
                  ref={sliderRef}
                  type="range"
                  min="0"
                  max={totalFrames - 1}
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
                  aria-valuemax={totalFrames}
                  title="当前位置（只读；≤200 帧时变为可拖动滑块）"
                >
                  <div
                    ref={progressFillRef}
                    className="h-full bg-accent rounded-full"
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* 自动与当前 CT 部位预设共用核心数值；非 CT 不显示 CT 窗值。 */}
          <div className="viewport-presets flex items-center gap-1 min-w-0 overflow-x-auto">
            <span className="text-[11px] text-txt-muted mr-1 shrink-0 select-none" title="自动窗及当前 CT 部位预设">
              预设
            </span>
            <div className="flex gap-1 shrink-0">
              <button type="button" className="workspace-control" onClick={() => void applyAutomatic()} title="自动窗（快捷键 1）：优先文件窗，缺失时按当前帧像素估算">自动</button>
              {PRESETS.map((preset, idx) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset.voi, preset.name)}
                  className="px-2 h-6 text-[11px] rounded-md border border-transparent bg-transparent hover:bg-hover text-txt-dim hover:text-txt transition cursor-pointer whitespace-nowrap"
                  title={`${preset.name} (快捷键 ${idx + 2}): WW ${preset.voi.windowWidth}, WL ${preset.voi.windowCenter}`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
