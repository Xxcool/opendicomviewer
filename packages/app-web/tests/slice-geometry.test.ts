import { describe, expect, it } from 'vitest';
import { describeSliceOrientation, sliceNormal, sliceProjection } from '../src/components/slice-geometry';

describe('切面名称与 DICOM LPS 方位标记', () => {
  it('头部矢状面使用 S/I/A/P，轴位继续使用 A/P/R/L', () => {
    expect(describeSliceOrientation([0, 1, 0, 0, 0, -1])).toEqual({ label: '矢状面 (Sagittal)', top: 'S', bottom: 'I', left: 'A', right: 'P' });
    expect(describeSliceOrientation([1, 0, 0, 0, 1, 0])).toEqual({ label: '横断面 (Axial)', top: 'A', bottom: 'P', left: 'R', right: 'L' });
  });
  it('反向和冠状面不沿用固定标签', () => {
    expect(describeSliceOrientation([0, -1, 0, 0, 0, -1])).toMatchObject({ label: '矢状面 (Sagittal)', left: 'P', right: 'A' });
    expect(describeSliceOrientation([1, 0, 0, 0, 0, -1])).toEqual({ label: '冠状面 (Coronal)', top: 'S', bottom: 'I', left: 'R', right: 'L' });
  });
  it('斜切、退化或明确缺失的几何不伪造轴位方位', () => {
    expect(describeSliceOrientation([1, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2])).toMatchObject({ label: '斜切面 (Oblique)', top: '', left: '' });
    expect(describeSliceOrientation([0, 0, 0, 0, 0, 0]).label).toBe('切面未知');
    expect(describeSliceOrientation([1, 0, 0, 0, 1, 0], true).label).toBe('切面未知');
  });
});

describe('sliceNormal', () => {
  it('轴位 IOP 的法向为 +Z', () => {
    expect(sliceNormal([1, 0, 0, 0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('冠状 IOP 的法向为 -Y', () => {
    // row=+X, col=+Z → X × Z = -Y
    expect(sliceNormal([1, 0, 0, 0, 0, 1])).toEqual([0, -1, 0]);
  });

  it('非单位 IOP 也归一化为单位法向', () => {
    expect(sliceNormal([2, 0, 0, 0, 2, 0])).toEqual([0, 0, 1]);
  });

  it('退化 IOP 回落到单位 +Z，不产生 NaN', () => {
    expect(sliceNormal([0, 0, 0, 0, 0, 0])).toEqual([0, 0, 1]);
  });
});

describe('sliceProjection', () => {
  it('轴位下等于 IPP 的 z 分量', () => {
    expect(sliceProjection([10, 20, -62.5], [1, 0, 0, 0, 1, 0])).toBeCloseTo(
      -62.5,
    );
  });

  it('斜切时只取沿单位法向的分量', () => {
    // 绕 X 轴 45°：法向 (0, -√½, √½)，IPP (0,0,10) → 10·√½
    const iop = [1, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2];
    expect(sliceProjection([0, 0, 10], iop)).toBeCloseTo(10 * Math.SQRT1_2);
  });
});
