/**
 * 多视口布局定义（P3 MPR 三视图）
 *
 * 纯数据 + 纯函数，不触 DOM、不触渲染器：布局切换、层数换算、准星世界坐标
 * 都在这里算好，组件只负责把结果写进 DOM / 调 RendererPort。
 *
 * 端口约束：`ViewportLayout.rows × cols` 必须等于 `viewportIds.length`。
 * `1+3` 在视觉上是「左大 + 右侧三格」，但逻辑上仍是 4 个视口，
 * 因此沿用 2×2 的网格声明，真正的格子位置由 `gridArea` 决定。
 */

import type {
  ImagePlane,
  SeriesHandle,
  ViewportLayout,
  ViewportOrientation,
  VolumeHandle,
  WorldPoint,
} from '@opendicomviewer/core';
import { computeNormal } from '@opendicomviewer/core';
import type { CSSProperties } from 'react';

export type LayoutMode = '1x1' | 'split-2x2' | '2x2' | '1+3';

export type PaneKind = 'stack' | 'orthographic';

/** 体积三轴：0 = x(cols/sagittal)，1 = y(rows/coronal)，2 = z(slices/axial) */
export type VolumeAxis = 0 | 1 | 2;

export interface PaneSpec {
  readonly viewportId: string;
  readonly kind: PaneKind;
  readonly orientation?: ViewportOrientation;
  /** 仅 orthographic 有：该视口切的是体积的哪一根轴 */
  readonly axis?: VolumeAxis;
  readonly title: string;
  readonly shortTitle: string;
  /** CSS grid-area：`row-start / col-start / row-end / col-end` */
  readonly gridArea: string;
}

export interface LayoutSpec {
  readonly mode: LayoutMode;
  readonly label: string;
  readonly hint: string;
  readonly panes: readonly PaneSpec[];
  readonly viewportLayout: ViewportLayout;
  readonly gridStyle: CSSProperties;
}

export const STACK_VIEWPORT_ID = 'default-viewport';

const STACK_TITLE = '原始切片 (Stack)';

function pane(
  base: Omit<PaneSpec, 'gridArea'>,
  gridArea: string,
): PaneSpec {
  return { ...base, gridArea };
}

const STACK_BASE = {
  viewportId: STACK_VIEWPORT_ID,
  kind: 'stack' as const,
  title: STACK_TITLE,
  shortTitle: 'Stack',
};

const AXIAL_BASE = {
  viewportId: 'mpr-axial',
  kind: 'orthographic' as const,
  orientation: 'axial' as const,
  axis: 2 as const,
  title: '横断面 (Axial)',
  shortTitle: 'Axial',
};

const CORONAL_BASE = {
  viewportId: 'mpr-coronal',
  kind: 'orthographic' as const,
  orientation: 'coronal' as const,
  axis: 1 as const,
  title: '冠状面 (Coronal)',
  shortTitle: 'Coronal',
};

const SAGITTAL_BASE = {
  viewportId: 'mpr-sagittal',
  kind: 'orthographic' as const,
  orientation: 'sagittal' as const,
  axis: 0 as const,
  title: '矢状面 (Sagittal)',
  shortTitle: 'Sagittal',
};

const SINGLE_STACK = pane(STACK_BASE, '1 / 1 / 2 / 2');

/** 2×2：左上全分辨率原始切片，其余三格为 MPR 三向切面（等分） */
const GRID_2X2: LayoutSpec = {
  mode: '2x2',
  label: 'MPR 2×2',
  hint: '全分辨率原始切片 + MPR 三视图',
  panes: [
    pane(STACK_BASE, '1 / 1 / 2 / 2'),
    pane(AXIAL_BASE, '1 / 2 / 2 / 3'),
    pane(CORONAL_BASE, '2 / 1 / 3 / 2'),
    pane(SAGITTAL_BASE, '2 / 2 / 3 / 3'),
  ],
  viewportLayout: {
    rows: 2,
    cols: 2,
    viewportIds: [
      STACK_VIEWPORT_ID,
      AXIAL_BASE.viewportId,
      CORONAL_BASE.viewportId,
      SAGITTAL_BASE.viewportId,
    ],
    cells: [
      { viewportId: STACK_VIEWPORT_ID, kind: 'stack' },
      {
        viewportId: AXIAL_BASE.viewportId,
        kind: 'orthographic',
        orientation: 'axial',
      },
      {
        viewportId: CORONAL_BASE.viewportId,
        kind: 'orthographic',
        orientation: 'coronal',
      },
      {
        viewportId: SAGITTAL_BASE.viewportId,
        kind: 'orthographic',
        orientation: 'sagittal',
      },
    ],
  },
  gridStyle: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    gap: '2px',
  },
};

/** 1+3：左侧轴位占满三行，右侧三格 MPR 纵向排列 */
const GRID_1_PLUS_3: LayoutSpec = {
  mode: '1+3',
  label: 'MPR 1+3',
  hint: '左侧大图原始切片 + 右侧 MPR 三视图',
  panes: [
    pane(STACK_BASE, '1 / 1 / 4 / 2'),
    pane(AXIAL_BASE, '1 / 2 / 2 / 3'),
    pane(CORONAL_BASE, '2 / 2 / 3 / 3'),
    pane(SAGITTAL_BASE, '3 / 2 / 4 / 3'),
  ],
  viewportLayout: {
    // 逻辑上仍是 4 个视口；视觉布局由 gridStyle 决定
    rows: 2,
    cols: 2,
    viewportIds: GRID_2X2.viewportLayout.viewportIds,
    cells: GRID_2X2.viewportLayout.cells,
  },
  gridStyle: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
    gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
    gap: '2px',
  },
};

const SINGLE: LayoutSpec = {
  mode: '1x1',
  label: '1×1',
  hint: '单视口原始切片浏览',
  panes: [SINGLE_STACK],
  viewportLayout: {
    rows: 1,
    cols: 1,
    viewportIds: [STACK_VIEWPORT_ID],
    cells: [{ viewportId: STACK_VIEWPORT_ID, kind: 'stack' }],
  },
  gridStyle: {},
};

export const SPLIT_PANES: readonly PaneSpec[] = [STACK_VIEWPORT_ID, 'split-2', 'split-3', 'split-4'].map((viewportId, i) => ({
  viewportId, kind: 'stack', title: `视口 ${i + 1}`, shortTitle: `视口 ${i + 1}`,
  gridArea: `${Math.floor(i / 2) + 1} / ${i % 2 + 1} / ${Math.floor(i / 2) + 2} / ${i % 2 + 2}`,
}));
const INDEPENDENT_SPLIT: LayoutSpec = {
  mode: 'split-2x2', label: '独立分屏 2×2', hint: '四个原始视口独立浏览，单层影像也可使用',
  panes: SPLIT_PANES,
  viewportLayout: { rows: 2, cols: 2, viewportIds: SPLIT_PANES.map(p => p.viewportId), cells: SPLIT_PANES.map(p => ({ viewportId: p.viewportId, kind: 'stack' })) },
  gridStyle: GRID_2X2.gridStyle,
};

export const LAYOUTS: Record<LayoutMode, LayoutSpec> = {
  '1x1': SINGLE,
  'split-2x2': INDEPENDENT_SPLIT,
  '2x2': GRID_2X2,
  '1+3': GRID_1_PLUS_3,
};

export const LAYOUT_MODES: readonly LayoutMode[] = ['1x1', 'split-2x2', '2x2', '1+3'];

export function isMprLayout(mode: LayoutMode): boolean {
  return mode === '2x2' || mode === '1+3';
}

/** 该布局里的 MPR 切面视口（不含全分辨率 Stack） */
export function orthographicPanes(layout: LayoutSpec): readonly PaneSpec[] {
  return layout.panes.filter(
    (p) => p.kind === 'orthographic' && p.orientation !== undefined,
  );
}

/**
 * 视口可翻的层数。
 *
 * Stack 用真实帧数；MPR 用体积该轴的体素数（已含降采样因子）。
 * 尚未装载时返回 0，UI 应显示"待构建"而不是编造一个层数。
 */
export function paneSliceCount(
  pane: PaneSpec,
  handle: SeriesHandle | null,
  volume: VolumeHandle | null,
): number {
  if (pane.kind === 'stack') return handle?.meta.planes.length ?? 0;
  if (!volume || pane.axis === undefined) return 0;
  return volume.dimensions[pane.axis];
}

/** origin 是首个体素中心，末中心在 (N-1) × spacing；准星取两端中心的中点。 */
export function volumeCenter(volume: VolumeHandle): WorldPoint {
  const [x, y, z] = volume.dimensions;
  const [sx, sy, sz] = volume.spacing;
  const [dx, dy, dz] = axisDirections(volume);
  return [
    volume.origin[0] + (dx[0] * (x - 1) * sx + dy[0] * (y - 1) * sy + dz[0] * (z - 1) * sz) / 2,
    volume.origin[1] + (dx[1] * (x - 1) * sx + dy[1] * (y - 1) * sy + dz[1] * (z - 1) * sz) / 2,
    volume.origin[2] + (dx[2] * (x - 1) * sx + dy[2] * (y - 1) * sy + dz[2] * (z - 1) * sz) / 2,
  ];
}

/** 体积三轴方向余弦（direction 按 [x, y, z] 三段排布） */
export function axisDirections(
  volume: VolumeHandle,
): readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] {
  const d = volume.direction;
  return [
    [d[0], d[1], d[2]],
    [d[3], d[4], d[5]],
    [d[6], d[7], d[8]],
  ];
}

/** 沿体积某轴移动 `delta` 层后的世界坐标（准星随翻层联动） */
export function moveAlongAxis(
  volume: VolumeHandle,
  world: WorldPoint,
  axis: VolumeAxis,
  delta: number,
): WorldPoint {
  const dir = axisDirections(volume)[axis];
  const offset = delta * volume.spacing[axis];
  return [
    world[0] + dir[0] * offset,
    world[1] + dir[1] * offset,
    world[2] + dir[2] * offset,
  ];
}

/**
 * Stack 翻到新层后准星的世界坐标。
 *
 * 只沿切片法向移动，保留 x/y 的定位——否则轴位翻页会把冠状/矢状面的
 * 准星横向位置也一起重置。几何缺失时原样返回，不编造坐标（R7）。
 */
export function moveToStackSlice(
  world: WorldPoint,
  planes: readonly ImagePlane[],
  fromIndex: number,
  toIndex: number,
): WorldPoint {
  const from = planes[fromIndex];
  const to = planes[toIndex];
  if (!from || !to || from.hasMissingGeometry || to.hasMissingGeometry) {
    return world;
  }
  const normal = computeNormal(from.imageOrientationPatient);
  const fromProjection = projectionOn(from.imagePositionPatient, normal);
  const toProjection = projectionOn(to.imagePositionPatient, normal);
  const offset = toProjection - fromProjection;
  return [
    world[0] + normal[0] * offset,
    world[1] + normal[1] * offset,
    world[2] + normal[2] * offset,
  ];
}

/**
 * 单帧中心点：IPP 沿行/列方向各走半程。
 * 几何缺失时返回 null——绝不拿 [0,0,0] 编造世界坐标（R7）。
 */
export function planeCenter(plane: ImagePlane): WorldPoint | null {
  if (plane.hasMissingGeometry) return null;
  const [rowX, rowY, rowZ, colX, colY, colZ] = plane.imageOrientationPatient;
  const [rowSpacing, colSpacing] = plane.pixelSpacing;
  const halfCol = ((plane.columns - 1) * colSpacing) / 2;
  const halfRow = ((plane.rows - 1) * rowSpacing) / 2;
  return [
    plane.imagePositionPatient[0] + rowX * halfCol + colX * halfRow,
    plane.imagePositionPatient[1] + rowY * halfCol + colY * halfRow,
    plane.imagePositionPatient[2] + rowZ * halfCol + colZ * halfRow,
  ];
}

function projectionOn(
  point: readonly [number, number, number],
  normal: readonly [number, number, number],
): number {
  return point[0] * normal[0] + point[1] * normal[1] + point[2] * normal[2];
}
