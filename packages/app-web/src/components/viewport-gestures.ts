import type { VOIRange } from '@opendicomviewer/core';
import type { ViewTool } from '../state/viewer-store';

interface GestureOptions {
  enabled: () => boolean;
  windowingEnabled: () => boolean;
  tool: () => ViewTool;
  activate?: () => void;
  readVOI: () => VOIRange;
  window: (voi: VOIRange) => void;
  pan: (x: number, y: number) => void;
  zoom: (factor: number) => void;
  step: (delta: number) => void;
  error: (error: unknown) => void;
}

export function blocksViewerShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey
    || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null)
    || document.querySelector('[role="dialog"][aria-modal="true"], [data-viewer-home="true"]') !== null;
}

export const CAMERA_CHANGED = 'odv-camera-changed';
export function notifyCameraChanged(): void { window.dispatchEvent(new Event(CAMERA_CHANGED)); }

/** 所有视口共用鼠标优先级；拖动只更新相机/DOM，不写 React 或 Zustand。 */
export function bindViewportGestures(el: EventTarget & Pick<HTMLElement, 'setPointerCapture' | 'hasPointerCapture' | 'releasePointerCapture'>, options: GestureOptions): () => void {
  let mode: ViewTool | null = null;
  let origin = { x: 0, y: 0 };
  let previous = origin;
  let voi: VOIRange | null = null;
  const down = (raw: Event) => {
    const event = raw as PointerEvent;
    if (!options.enabled() || event.button > 2) return;
    options.activate?.();
    mode = event.button === 2 || (event.button === 0 && event.shiftKey)
      ? 'window' : event.button === 1 ? 'pan' : options.tool();
    if (mode === 'window' && !options.windowingEnabled()) { mode = null; return; }
    event.preventDefault();
    origin = previous = { x: event.clientX, y: event.clientY };
    try {
      voi = mode === 'window' ? options.readVOI() : null;
      el.setPointerCapture(event.pointerId);
    } catch (error) { mode = null; options.error(error); }
  };
  const move = (raw: Event) => {
    const event = raw as PointerEvent;
    if (!mode) return;
    event.preventDefault();
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    try {
      if (mode === 'window' && voi) options.window({
        windowWidth: Math.max(1, Math.round(voi.windowWidth + (event.clientX - origin.x) * 2)),
        windowCenter: Math.round(voi.windowCenter + (event.clientY - origin.y) * 2),
      });
      else if (mode === 'pan') options.pan(dx, dy);
      else if (mode === 'zoom') options.zoom(Math.exp(-dy * 0.01));
      else if (mode === 'browse') {
        const delta = Math.trunc(dy / 8);
        if (!delta) return;
        options.step(delta);
      }
      previous = { x: event.clientX, y: event.clientY };
      if (mode === 'pan' || mode === 'zoom') notifyCameraChanged();
    } catch (error) { mode = null; options.error(error); }
  };
  const up = (raw: Event) => {
    const event = raw as PointerEvent;
    mode = null; voi = null;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  };
  const context = (event: Event) => event.preventDefault();
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', context);
  return () => {
    el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    el.removeEventListener('contextmenu', context);
  };
}
