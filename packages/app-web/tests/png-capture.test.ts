import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePngSnapshot } from '../src/export/png-capture';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { CANCEL_ANNOTATION_DRAFT } from '../src/annotations/annotation-events';

// 仅验证捕获事件/尺寸与2D边界；真实PNG像素和浏览器下载另行界面验收。
function harness() {
  const copied = vi.fn();
  class Canvas {
    width = 400; height = 300; isConnected = true;
    getContext() { return { drawImage: copied }; }
  }
  class Host extends EventTarget {
    canvas = new Canvas();
    querySelector() { return this.canvas; }
    getBoundingClientRect() { return { width: 200 }; }
  }
  class Svg {}
  const host = new Host();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('HTMLCanvasElement', Canvas); vi.stubGlobal('HTMLElement', Host); vi.stubGlobal('SVGSVGElement', Svg);
  vi.stubGlobal('document', { querySelector: (selector: string) => selector.startsWith('[data-odv-viewport') ? host : null,
    createElement: () => new Canvas() });
  return { host, copied };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function renderer(render: () => void): Pick<CornerstoneRenderer, 'render'> { return { render }; }
describe('PNG持久2D画布捕获', () => {
  it('先同步取消未提交草稿，再触发实际画布渲染', async () => {
    const { host } = harness(); const cancelled = vi.fn();
    window.addEventListener(CANCEL_ANNOTATION_DRAFT, cancelled);
    await capturePngSnapshot(renderer(() => {
      expect(cancelled).toHaveBeenCalledOnce();
      host.dispatchEvent(new Event('CORNERSTONE_IMAGE_RENDERED'));
    }), []);
  });
  it('必须等实际IMAGE_RENDERED事件，复制屏幕2D而非离屏WebGL', async () => {
    const { host, copied } = harness();
    const result = capturePngSnapshot(renderer(() => {}), ['教学样本']);
    expect(copied).not.toHaveBeenCalled();
    host.dispatchEvent(new Event('CORNERSTONE_IMAGE_RENDERED'));
    const snapshot = await result;
    expect(copied).toHaveBeenCalledWith(host.canvas, 0, 0);
    expect(snapshot.pixelRatio).toBe(2);
    expect(snapshot.image.width).toBe(400);
    expect(snapshot.identity).toEqual(['教学样本']);
  });
  it('绘制失败或超时不能导出假成功图片', async () => {
    const { copied } = harness();
    await expect(capturePngSnapshot(renderer(() => { throw new Error('render failed'); }), [])).rejects.toThrow('render failed');
    vi.useFakeTimers();
    const capture = capturePngSnapshot(renderer(() => {}), []);
    const rejected = expect(capture).rejects.toThrow('等待影像绘制超时');
    await vi.advanceTimersByTimeAsync(1500); await rejected;
    expect(copied).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('绘制期间被卸载的画布不能继续捕获', async () => {
    const { host, copied } = harness();
    await expect(capturePngSnapshot(renderer(() => { host.canvas.isConnected = false; host.dispatchEvent(new Event('CORNERSTONE_IMAGE_RENDERED')); }), [])).rejects.toThrow('当前影像不支持可靠截图');
    expect(copied).not.toHaveBeenCalled();
  });
});
