/**
 * 角落比例尺（ui-spec §3.2）
 *
 * 只做两件事：量出「每 CSS 像素多少毫米」并画一条 1-2-5 系列标尺。
 * 拿不到物理信息时不画刻度，直接写「无物理标尺」（R7）。
 * 随宿主尺寸变化自动重算（ResizeObserver）；缩放/复位后由 refreshKey 触发。
 */

import { useEffect, useRef, type RefObject } from 'react';
import { pickScaleBar } from './scale-bar';

interface ScaleBarProps {
  /** 测量对象：必须是真实画布宿主，不能用本组件自己的包裹层 */
  readonly hostRef: RefObject<HTMLElement | null>;
  readonly measure: (width: number, height: number) => number | null;
  /** 变化时重新测量（序列装载、体积挂载完成等） */
  readonly refreshKey?: string | number;
  readonly className?: string;
}

/** 刻度至少留出的容器宽度（像素），避免极窄格子里选到过短刻度 */
const MIN_BAR_BOX_PX = 32;
/** 装载是异步的：拿不到物理信息时短暂重试，避免永久停在「无物理标尺」 */
const MAX_RETRIES = 6;
const RETRY_INTERVAL_MS = 300;

export function ScaleBar({
  hostRef,
  measure,
  refreshKey,
  className,
}: ScaleBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | null = null;

    const update = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const size = pickScaleBar(
        measure(width, height),
        Math.max(MIN_BAR_BOX_PX, Math.min(160, width * 0.32)),
      );
      const bar = barRef.current;
      const label = labelRef.current;
      if (!bar || !label) return;

      if (!size) {
        label.textContent = '无物理标尺';
        bar.style.display = 'none';
        // 装载完成时宿主尺寸通常不变，ResizeObserver 不会触发；
        // 短暂重试几次，避免比例尺一直停在「无物理标尺」（拿不到时就停，不无限轮询）
        if (retries < MAX_RETRIES) {
          retries += 1;
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(update, RETRY_INTERVAL_MS);
        }
        return;
      }
      bar.style.display = 'block';
      bar.style.width = `${Math.round(size.pixels)}px`;
      label.textContent =
        size.millimeters >= 1
          ? `${Math.round(size.millimeters)} mm`
          : `${size.millimeters.toFixed(1)} mm`;
    };

    update();
    // 渲染适配器也观察同一批元素，但 ResizeObserver 回调按观察器创建顺序执行：
    // 适配器的 canvas resize（含相机重算）可能排在本回调之后。下一帧再量一次，
    // rAF 晚于本轮所有 RO 回调，保证读到的是 resize 之后的画布/相机。
    const scheduleUpdate = () => {
      update();
      if (typeof requestAnimationFrame !== 'function' || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(host);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (frame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
    };
  }, [hostRef, measure, refreshKey]);

  return (
    <div
      className={`pointer-events-none select-none flex flex-col gap-1 ${
        className ?? ''
      }`}
    >
      <span
        ref={labelRef}
        className="font-mono text-[10px] text-overlay/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
      >
        无物理标尺
      </span>
      {/* 两端带竖刻度：底边 + 左右边形成「⊔」形标尺 */}
      <div
        ref={barRef}
        style={{ display: 'none' }}
        className="h-[5px] border-x border-b border-overlay/85"
      />
    </div>
  );
}
