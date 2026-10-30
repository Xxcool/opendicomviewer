import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindViewportGestures } from '../src/components/viewport-gestures';
import type { ViewTool } from '../src/state/viewer-store';

class Host extends EventTarget {
  captured = false;
  setPointerCapture() { this.captured = true; }
  hasPointerCapture() { return this.captured; }
  releasePointerCapture() { this.captured = false; }
  pointer(type: string, x = 0, y = 0, button = 0) {
    this.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, button, shiftKey: false, pointerId: 1 }));
  }
}
function bind(tool: ViewTool = 'zoom', windowing = true) {
  vi.stubGlobal('window', new EventTarget());
  const host = new Host();
  const options = { enabled: () => true, windowingEnabled: () => windowing, tool: () => tool,
    readVOI: () => ({ windowWidth: 100, windowCenter: 40 }), window: vi.fn(), pan: vi.fn(), zoom: vi.fn(), step: vi.fn(), error: vi.fn() };
  const unbind = bindViewportGestures(host, options);
  return { host, options, unbind };
}
afterEach(() => vi.unstubAllGlobals());
describe('原始切片与 MPR 共用手势', () => {
  it('右键优先调窗、中键优先平移，不受当前工具影响', () => {
    const { host, options, unbind } = bind();
    host.pointer('pointerdown', 10, 20, 2); host.pointer('pointermove', 15, 25, 2); host.pointer('pointerup');
    expect(options.window).toHaveBeenCalledWith({ windowWidth: 110, windowCenter: 50 });
    expect(options.zoom).not.toHaveBeenCalled();
    host.pointer('pointerdown', 10, 20, 1); host.pointer('pointermove', 15, 25, 1);
    expect(options.pan).toHaveBeenCalledWith(5, 5);
    unbind();
  });
  it('固定灰度 MPR 不调窗，取消捕获后停止相机操作', () => {
    const { host, options, unbind } = bind('pan', false);
    host.pointer('pointerdown', 0, 0, 2); host.pointer('pointermove', 20, 20, 2);
    expect(options.window).not.toHaveBeenCalled();
    host.pointer('pointerdown'); host.pointer('pointermove', 5, 8); host.pointer('pointercancel'); host.pointer('pointermove', 30, 40);
    expect(options.pan).toHaveBeenCalledTimes(1);
    expect(host.captured).toBe(false);
    unbind();
  });
  it('左键翻页累积小位移，卸载后不再响应', () => {
    const { host, options, unbind } = bind('browse');
    host.pointer('pointerdown'); host.pointer('pointermove', 0, 4); host.pointer('pointermove', 0, 16);
    expect(options.step).toHaveBeenCalledWith(2);
    unbind(); host.pointer('pointermove', 0, 32);
    expect(options.step).toHaveBeenCalledTimes(1);
  });
});
