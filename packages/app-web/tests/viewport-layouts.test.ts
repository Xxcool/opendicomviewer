import type { ImagePlane, SeriesHandle, VolumeHandle } from '@opendicomviewer/core';
import { describe, expect, it } from 'vitest';
import {
  LAYOUTS,
  LAYOUT_MODES,
  STACK_VIEWPORT_ID,
  axisDirections,
  isMprLayout,
  moveAlongAxis,
  moveToStackSlice,
  orthographicPanes,
  paneSliceCount,
  planeCenter,
  volumeCenter,
  type PaneSpec,
} from '../src/layout/viewport-layouts';

/** 轴向体积：10×20×30，层距 [1,2,3] mm，方向为单位阵 */
function makeVolume(overrides: Partial<VolumeHandle> = {}): VolumeHandle {
  return {
    volumeId: 'odv:volume:1.2.3',
    seriesInstanceUid: '1.2.3',
    displayOnly: true,
    dimensions: [10, 20, 30],
    spacing: [1, 2, 3],
    origin: [0, 0, 0],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    scalarData: new Uint8Array(10 * 20 * 30),
    ...overrides,
  };
}

function makePlane(index: number, overrides: Partial<ImagePlane> = {}): ImagePlane {
  return {
    imageId: `img-${index}`,
    sopInstanceUid: `sop-${index}`,
    imagePositionPatient: [0, 0, index * 2.5],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    pixelSpacing: [0.5, 0.25],
    rows: 4,
    columns: 6,
    ...overrides,
  };
}

function makeStackHandle(frameCount: number): SeriesHandle {
  return {
    meta: {
      seriesInstanceUid: '1.2.3',
      studyInstanceUid: '1.2',
      seriesDescription: 'test',
      modality: 'CT',
      numberOfFrames: frameCount,
      planes: Array.from({ length: frameCount }, (_, i) => makePlane(i)),
      spacing: [0.5, 0.25, 2.5],
      warnings: [],
    },
    warnings: [],
    pixel: async () => {
      throw new Error('本用例不读取像素');
    },
    dispose: () => {},
  };
}

const panesOf = (mode: (typeof LAYOUT_MODES)[number]): readonly PaneSpec[] =>
  LAYOUTS[mode].panes;

describe('多视口布局定义（P3 MPR 三视图）', () => {
  it('每个模式的视口数量都等于 rows × cols，且 id 不重复', () => {
    for (const mode of LAYOUT_MODES) {
      const { rows, cols, viewportIds } = LAYOUTS[mode].viewportLayout;
      expect(viewportIds).toHaveLength(rows * cols);
      expect(new Set(viewportIds).size).toBe(viewportIds.length);
      // 每格都有 cell 声明，ORTHOGRAPHIC 必须带方向，否则端口会直接拒绝
      expect(LAYOUTS[mode].viewportLayout.cells).toHaveLength(viewportIds.length);
    }
  });

  it('只有 1×1 是单视口，其余都含三向 MPR', () => {
    expect(isMprLayout('1x1')).toBe(false);
    expect(isMprLayout('2x2')).toBe(true);
    expect(isMprLayout('1+3')).toBe(true);

    expect(LAYOUTS['1x1'].viewportLayout.viewportIds).toEqual([STACK_VIEWPORT_ID]);

    for (const mode of ['2x2', '1+3'] as const) {
      const ortho = orthographicPanes(LAYOUTS[mode]);
      expect(ortho.map((p) => p.orientation)).toEqual([
        'axial',
        'coronal',
        'sagittal',
      ]);
      // 体积轴：0=x(Sagittal)、1=y(Coronal)、2=z(Axial)
      expect(ortho.map((p) => p.axis)).toEqual([2, 1, 0]);
      expect(LAYOUTS[mode].viewportLayout.viewportIds).toContain(STACK_VIEWPORT_ID);
    }
  });

  it('1+3 的轴位跨三行，2×2 为等分网格', () => {
    const stack2x2 = panesOf('2x2').find((p) => p.kind === 'stack');
    expect(stack2x2?.gridArea).toBe('1 / 1 / 2 / 2');

    const stack1p3 = panesOf('1+3').find((p) => p.kind === 'stack');
    expect(stack1p3?.gridArea).toBe('1 / 1 / 4 / 2');
    // 右侧三格纵向排列，且都落在第 2 列
    const right = panesOf('1+3')
      .filter((p) => p.kind === 'orthographic')
      .map((p) => p.gridArea);
    expect(right).toEqual(['1 / 2 / 2 / 3', '2 / 2 / 3 / 3', '3 / 2 / 4 / 3']);
  });

  it('gridStyle 与逻辑行列一致（1+3 视觉三行但逻辑仍 4 视口）', () => {
    expect(LAYOUTS['2x2'].gridStyle.gridTemplateRows).toBe('repeat(2, minmax(0, 1fr))');
    expect(LAYOUTS['1+3'].gridStyle.gridTemplateRows).toBe('repeat(3, minmax(0, 1fr))');
    expect(LAYOUTS['1+3'].viewportLayout.viewportIds).toHaveLength(4);
  });
});

describe('paneSliceCount', () => {
  const [stackPane] = panesOf('2x2');
  const ortho = orthographicPanes(LAYOUTS['2x2']);

  it('Stack 用真实帧数，MPR 用体积对应轴体素数', () => {
    const handle = makeStackHandle(5);
    const volume = makeVolume();
    expect(paneSliceCount(stackPane!, handle, volume)).toBe(5);
    expect(paneSliceCount(ortho[0]!, handle, volume)).toBe(30); // axial → z
    expect(paneSliceCount(ortho[1]!, handle, volume)).toBe(20); // coronal → y
    expect(paneSliceCount(ortho[2]!, handle, volume)).toBe(10); // sagittal → x
  });

  it('尚未装载时返回 0，不编造层数', () => {
    expect(paneSliceCount(stackPane!, null, null)).toBe(0);
    expect(paneSliceCount(ortho[0]!, makeStackHandle(5), null)).toBe(0);
  });
});

describe('体积几何换算', () => {
  it('axisDirections 按 [x, y, z] 三段拆分', () => {
    expect(axisDirections(makeVolume())).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('volumeCenter 取各轴半程并乘方向余弦', () => {
    expect(volumeCenter(makeVolume())).toEqual([5, 20, 45]);

    const flipped = makeVolume({
      origin: [1, 2, 3],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, -1],
    });
    expect(volumeCenter(flipped)).toEqual([6, 22, 3 - 45]);
  });

  it('moveAlongAxis 沿对应轴按层距平移，方向余弦为负时反号', () => {
    const volume = makeVolume();
    expect(moveAlongAxis(volume, [5, 20, 45], 1, 2)).toEqual([5, 24, 45]);
    expect(moveAlongAxis(volume, [5, 20, 45], 2, -1)).toEqual([5, 20, 42]);

    const flipped = makeVolume({
      direction: [1, 0, 0, 0, 1, 0, 0, 0, -1],
    });
    expect(moveAlongAxis(flipped, [0, 0, 0], 2, 1)).toEqual([0, 0, -3]);
  });

  it('moveToStackSlice 沿切片法向移动，保留 x/y 定位', () => {
    const planes = Array.from({ length: 5 }, (_, i) => makePlane(i));
    expect(moveToStackSlice([5, 6, 1], planes, 0, 3)).toEqual([5, 6, 8.5]);
    expect(moveToStackSlice([5, 6, 1], planes, 2, 1)).toEqual([5, 6, -1.5]);
  });

  it('几何缺失时 moveToStackSlice 原样返回，不编造坐标', () => {
    const planes = [
      makePlane(0, { hasMissingGeometry: true }),
      makePlane(1),
    ];
    expect(moveToStackSlice([5, 6, 1], planes, 0, 1)).toEqual([5, 6, 1]);
  });

  it('planeCenter 用 IPP + 行列方向各走半程', () => {
    expect(planeCenter(makePlane(0))).toEqual([0.75, 1, 0]);
    expect(
      planeCenter(makePlane(0, { hasMissingGeometry: true })),
    ).toBeNull();
  });
});
