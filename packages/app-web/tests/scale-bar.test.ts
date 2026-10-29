import { describe, expect, it } from 'vitest';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { measureMmPerPx, pickScaleBar } from '../src/components/scale-bar';

interface FakeRenderer {
  canvasToWorld: (
    viewportId: string,
    point: { x: number; y: number },
  ) => [number, number, number];
}

/** 假渲染器：画布 x 每 2 px = 1 mm（即 0.5 mm/px） */
function fakeRenderer(mmPerCanvasPx: number): FakeRenderer {
  return {
    canvasToWorld: (_viewportId, point) => [
      point.x * mmPerCanvasPx,
      0,
      0,
    ],
  };
}

const asRenderer = (fake: FakeRenderer): CornerstoneRenderer =>
  fake as unknown as CornerstoneRenderer;

describe('比例尺换算', () => {
  it('用画布中心两点反算 mm/px', () => {
    expect(measureMmPerPx(asRenderer(fakeRenderer(0.5)), 'vp', 400, 300)).toBeCloseTo(
      0.5,
      5,
    );
  });

  it('渲染器缺失、尺寸为 0 或 canvasToWorld 抛错时返回 null，不编造刻度', () => {
    expect(measureMmPerPx(null, 'vp', 400, 300)).toBeNull();
    expect(measureMmPerPx(asRenderer(fakeRenderer(0.5)), 'vp', 0, 300)).toBeNull();

    const throwing = asRenderer({
      canvasToWorld: () => {
        throw new Error('未装载');
      },
    });
    expect(measureMmPerPx(throwing, 'vp', 400, 300)).toBeNull();
  });

  it('在 1-2-5 系列里挑像素长度可读的最长刻度', () => {
    // 0.5 mm/px、可用 160px：50 mm = 100 px
    expect(pickScaleBar(0.5, 160)).toEqual({
      millimeters: 50,
      pixels: 100,
    });
    // 0.7 mm/px、小格 48px：50 mm 超宽，退到 20 mm ≈ 28.6 px
    const small = pickScaleBar(0.7, 48);
    expect(small?.millimeters).toBe(20);
    expect(small?.pixels).toBeCloseTo(20 / 0.7, 5);
  });

  it('连最短刻度都放不下时按可用宽度取小数刻度，长度与标签一致', () => {
    const size = pickScaleBar(0.01, 80);
    expect(size).not.toBeNull();
    expect(size!.millimeters).toBe(0.8);
    expect(size!.pixels).toBeCloseTo(80, 5);
  });

  it('无法换算或可用宽度非法时返回 null', () => {
    expect(pickScaleBar(null, 100)).toBeNull();
    expect(pickScaleBar(0, 100)).toBeNull();
    expect(pickScaleBar(Number.NaN, 100)).toBeNull();
    expect(pickScaleBar(0.5, 0)).toBeNull();
  });
});
