/**
 * Spike B：降采样体素缓冲 → ImageVolume → 三向 MPR
 *
 * 只回答四个问题：
 *   Q1 不经 DICOM imageIds，能否从裸 Uint8Array 建出可渲染的体积？
 *   Q2 三个 ORTHOGRAPHIC 视口能否各自出正确方向的图？（截图四象限采样判定）
 *   Q3 端口要新增的 getSliceIndex / jumpToWorld / setOrientation 是否真实存在？
 *   Q4 192³ Uint8（≈7 MB）的构建与首次出图耗时、堆占用是多少？
 *
 * 结论会回填 docs/ARCHITECTURE.md §14.2，本 spike 不属于交付物。
 */

import {
  init as csInit,
  RenderingEngine,
  Enums,
  volumeLoader,
  cache,
} from '@cornerstonejs/core';

import { DIMS, SPACING, ORIGIN, DIRECTION, metadata, buildScalarData } from './phantom.js';

const VOLUME_ID = 'odv:spike-b';

const report = {
  stage: 'start',
  errors: [],
  env: {},
  api: {},
  volume: null,
  viewports: {},
  timings: {},
  memory: null,
};

function flush() {
  const text = JSON.stringify(report, null, 2);
  document.getElementById('report').textContent = text;
  window.__SPIKE__ = report;
}

function fail(stage, err) {
  report.stage = stage;
  report.errors.push(`${stage}: ${err instanceof Error ? err.message : String(err)}`);
  flush();
}

function step(name) {
  report.stage = name;
  flush();
}

async function main() {
  report.env = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    dpr: window.devicePixelRatio,
  };

  step('init-core');
  await csInit();

  step('build-scalar-data');
  const tBuild = performance.now();
  const scalarData = buildScalarData();
  report.timings.buildScalarDataMs = Number((performance.now() - tBuild).toFixed(2));

  // Q1：四条候选通路里，先试最直接的 createLocalVolume（裸缓冲 + 元数据）
  step('create-local-volume');
  const tVol = performance.now();
  const volume = volumeLoader.createLocalVolume(VOLUME_ID, {
    metadata,
    dimensions: DIMS,
    spacing: SPACING,
    origin: ORIGIN,
    direction: DIRECTION,
    scalarData,
  });
  report.timings.createVolumeMs = Number((performance.now() - tVol).toFixed(2));
  report.volume = {
    volumeId: volume.volumeId,
    dimensions: volume.dimensions,
    spacing: volume.spacing,
    origin: volume.origin,
    voxels: volume.numVoxels,
    sizeInBytes: volume.sizeInBytes,
    derivedImageIds: volume.imageIds.length,
    inCache: cache.getVolume(VOLUME_ID) === volume,
    dataType: volume.dataType,
  };

  step('create-engine');
  const engine = new RenderingEngine('spike-b');

  const cells = [
    { id: 'vp-ax', el: 'vp-ax', type: Enums.ViewportType.ORTHOGRAPHIC, orientation: Enums.OrientationAxis.AXIAL },
    { id: 'vp-cor', el: 'vp-cor', type: Enums.ViewportType.ORTHOGRAPHIC, orientation: Enums.OrientationAxis.CORONAL },
    { id: 'vp-sag', el: 'vp-sag', type: Enums.ViewportType.ORTHOGRAPHIC, orientation: Enums.OrientationAxis.SAGITTAL },
    // 第四格故意用 STACK + setVolumes：验证"体绘制视口必须是 ORTHOGRAPHIC"这个前提
    { id: 'vp-stack', el: 'vp-stack', type: Enums.ViewportType.STACK, orientation: null },
  ];

  // 对照实验 A：把轴向放到最后启用，判断"始终是第一格不出图"还是"轴向着色有问题"
  const params = new URLSearchParams(location.search);
  if (params.has('axLast')) {
    const ax = cells.shift();
    cells.splice(2, 0, ax);
    report.cellOrder = cells.map((c) => c.id);
  }

  for (const cell of cells) {
    engine.enableElement({
      viewportId: cell.id,
      element: document.getElementById(cell.el),
      type: cell.type,
      defaultOptions: { background: [0, 0, 0] },
    });
  }

  // 对照实验 C 的结论：enableElement 之后必须先空渲染一次，否则**首个**视口的
  // 相机不会初始化——后续 setVolumes + setOrientation 会把体积渲染成纯黑。
  // 这里改为默认执行；?noWarmup=1 可复现原始故障。
  if (!params.has('noWarmup')) {
    for (const cell of cells) engine.getViewport(cell.id).render();
    await new Promise((resolve) => setTimeout(resolve, 50));
    report.warmup = true;
  }

  const sample = engine.getViewport('vp-ax');
  report.api = {
    setVolumes: typeof sample.setVolumes,
    setOrientation: typeof sample.setOrientation,
    jumpToWorld: typeof sample.jumpToWorld,
    getSliceIndex: typeof sample.getSliceIndex,
    getNumberOfSlices: typeof sample.getNumberOfSlices,
    worldToCanvas: typeof sample.worldToCanvas,
    canvasToWorld: typeof sample.canvasToWorld,
    resetCamera: typeof sample.resetCamera,
    viewportType: sample.type,
  };

  // 逐格挂体积 + 定方向 + 调窗 + 出图
  step('set-volumes');
  for (const cell of cells) {
    const vp = engine.getViewport(cell.id);
    const entry = { type: cell.type, orientation: cell.orientation };

    if (cell.type === Enums.ViewportType.STACK) {
      try {
        await vp.setVolumes([{ volumeId: VOLUME_ID }]);
        entry.setVolumes = 'unexpected-ok';
      } catch (err) {
        entry.setVolumes = `threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      report.viewports[cell.id] = entry;
      continue;
    }

    const t0 = performance.now();
    await vp.setVolumes([{ volumeId: VOLUME_ID }]);
    entry.setVolumesMs = Number((performance.now() - t0).toFixed(2));

    vp.setOrientation(cell.orientation, true);

    // 对照实验 B：轴向相机由 CS3D 放在 z=-43（体积外、贴得很近）。
    // 手动摆到 +z 一侧，验证"是否只是相机位置/裁剪导致的空白"
    if (cell.id === 'vp-ax' && params.has('camFix')) {
      vp.setCamera({
        position: [96, 96, 600],
        focalPoint: [96, 96, 192],
        viewUp: [0, -1, 0],
        parallelScale: 96,
      });
      entry.cameraFixed = true;
    }

    vp.setProperties({ voiRange: { lower: 0, upper: 255 } });
    // 手动摆过相机时不能再 resetCamera，否则又被 CS3D 的默认轴向相机覆盖
    if (!entry.cameraFixed) vp.resetCamera();
    const t1 = performance.now();
    vp.render();
    entry.firstRenderMs = Number((performance.now() - t1).toFixed(2));

    entry.sliceIndexAtStart = vp.getSliceIndex();
    entry.numberOfSlices = vp.getNumberOfSlices();
    entry.canvasSize = [vp.canvas?.width, vp.canvas?.height];
    // 轴向格渲染不出来时，靠相机读数区分"相机在体外/朝向反了"与"数据没上传"
    if (typeof vp.getCamera === 'function') {
      const cam = vp.getCamera();
      entry.camera = {
        position: cam.position?.map((v) => Number(v.toFixed(1))),
        focalPoint: cam.focalPoint?.map((v) => Number(v.toFixed(1))),
        viewUp: cam.viewUp?.map((v) => Number(v.toFixed(1))),
        parallelScale: cam.parallelScale !== undefined ? Number(cam.parallelScale.toFixed(1)) : null,
      };
    }
    report.viewports[cell.id] = entry;
  }

  // 延迟再渲染一次：CS3D 的 render() 只做提交，首帧是否真正呈现要看下一轮
  step('re-render');
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (const cell of cells) {
    if (cell.type === Enums.ViewportType.ORTHOGRAPHIC) {
      engine.getViewport(cell.id).render();
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Q3-b：jumpToWorld 能不能驱动"切到含该世界点的层"（端口 focusAt 的实现基础）
  // 用 ?skipJump=1 可跳过，用来区分"轴向格本来就黑"与"被 jump 挪出体积"
  if (!new URLSearchParams(location.search).has('skipJump')) {
    step('jump-to-world');
    const axVp = engine.getViewport('vp-ax');
    const before = axVp.getSliceIndex();
    // 目标点故意取在偏离中心的位置（默认 z=320 → 若按 z/spacing 线性应为第 160 层）
    const targetZ = Number(new URLSearchParams(location.search).get('z') ?? 320);
    const target = [96, 96, targetZ];
    const jumped = axVp.jumpToWorld(target);
    axVp.render();
    const after = axVp.getSliceIndex();
    report.jumpToWorld = {
      returned: jumped,
      target,
      expectedSlice: 160,
      sliceBefore: before,
      sliceAfter: after,
      changed: before !== after,
    };
  }

  // Q4：体积纹理显存占用无法直接读，改记堆占用（仅作数量级参考）
  if (performance.memory) {
    report.memory = {
      usedJSHeapMB: Number((performance.memory.usedJSHeapSize / 1048576).toFixed(1)),
      totalJSHeapMB: Number((performance.memory.totalJSHeapSize / 1048576).toFixed(1)),
    };
  }

  step('done');
}

main().catch((err) => fail('main', err));
