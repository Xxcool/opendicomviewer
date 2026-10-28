/**
 * Spike A：Cornerstone3D 最小渲染验证
 *
 * 只回答三个问题，不追求功能完整：
 *   Q1 真实 CS3D API 与 ARCHITECTURE 附录 A 的 RendererPort 签名是否吻合？
 *   Q2 它到底有没有把像素画到屏幕上？（纯结构化采样，不做像素级回归）
 *   Q3 调窗与翻页的同步渲染耗时是多少？（3 张切片只能得到数量级，不能当性能结论）
 *
 * 结果写进 #report，供 `chrome --headless --dump-dom` 抓取；
 * 同时挂到 window.__SPIKE__ 供截图脚本判读。
 */

import { init as csInit, RenderingEngine, Enums } from '@cornerstonejs/core';
import dicomImageLoader, { init as dicomLoaderInit } from '@cornerstonejs/dicom-image-loader';

const IMAGE_IDS = [
  'wadouri:./series/slice-001.dcm',
  'wadouri:./series/slice-002.dcm',
  'wadouri:./series/slice-003.dcm',
];

const report = {
  stage: 'start',
  errors: [],
  env: {},
  api: {},
  pixels: null,
  voi: null,
  timings: {},
};

function fail(stage, err) {
  report.stage = stage;
  report.errors.push(`${stage}: ${err instanceof Error ? err.message : String(err)}`);
  flush();
}

function step(name) {
  report.stage = name;
  flush();
}

function flush() {
  const text = JSON.stringify(report, null, 2);
  document.getElementById('report').textContent = text;
  window.__SPIKE__ = report;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

function statsOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
  };
}

/**
 * 结构化采样：把 WebGL canvas 画进 2D canvas 再读像素。
 * 只断言"非全黑 + 有灰度层次"，不做逐像素基准比对（见 ARCHITECTURE §12.3）。
 */
function sampleCanvas(canvas) {
  const probe = document.createElement('canvas');
  probe.width = 128;
  probe.height = 128;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { error: '无法创建 2D 上下文' };

  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);

  let nonBlack = 0;
  let min = 255;
  let max = 0;
  let sum = 0;
  const seen = new Set();
  const total = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (luma > 8) nonBlack++;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
    sum += luma;
    seen.add(luma);
  }

  return {
    sampledPixels: total,
    nonBlackRatio: Number((nonBlack / total).toFixed(4)),
    min,
    max,
    mean: Number((sum / total).toFixed(2)),
    distinctLevels: seen.size,
  };
}

async function main() {
  report.env = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    dpr: window.devicePixelRatio,
  };

  const element = document.getElementById('viewport');
  if (!element) throw new Error('缺少 #viewport 容器');

  step('init-core');
  await csInit();

  step('init-dicom-loader');
  await dicomLoaderInit({ maxWebWorkers: 1 });

  step('create-engine');
  const engine = new RenderingEngine('spike-a');
  engine.enableElement({
    viewportId: 'spike-stack',
    element,
    type: Enums.ViewportType.STACK,
    defaultOptions: { background: [0, 0, 0] },
  });

  const viewport = engine.getViewport('spike-stack');

  // Q1：把 RendererPort 需要的能力逐个探一遍，存在性即结论
  report.api = {
    setStack: typeof viewport.setStack === 'function',
    setImageIdIndex: typeof viewport.setImageIdIndex === 'function',
    setProperties: typeof viewport.setProperties === 'function',
    getProperties: typeof viewport.getProperties === 'function',
    render: typeof viewport.render === 'function',
    getImageData: typeof viewport.getImageData === 'function',
    worldToCanvas: typeof viewport.worldToCanvas === 'function',
    canvasToWorld: typeof viewport.canvasToWorld === 'function',
    resetCamera: typeof viewport.resetCamera === 'function',
    canvasProp: 'canvas' in viewport,
  };

  step('set-stack');
  const t0 = performance.now();
  await viewport.setStack(IMAGE_IDS, 1);
  report.timings.setStackMs = Number((performance.now() - t0).toFixed(2));

  step('first-render');
  const t1 = performance.now();
  viewport.render();
  report.timings.firstRenderMs = Number((performance.now() - t1).toFixed(2));

  const props = viewport.getProperties();
  report.voi = { ...props.voiRange };

  step('sample-pixels');
  const canvas = viewport.canvas ?? element.querySelector('canvas');
  if (!canvas) throw new Error('CS3D 未创建 canvas');
  report.pixels = {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    // 页内 drawImage 采样拿到的基本一定是全黑：WebGL drawing buffer 在合成后已被清空
    // （除非开 preserveDrawingBuffer）。像素真值看 scripts/sample-screenshot.mjs 对
    // 无头截图的解码采样。保留这份原始读数，正是为了证明"页内 readback 不可信"。
    inPageReadback: sampleCanvas(canvas),
    note: '页内 readback 不可作为渲染证据，见 README「Q2」',
  };

  // Q3-a：调窗到"新画面呈现"的端到端延迟
  // 实测：viewport.render() 返回后画面并未更新（内部走 requestAnimationFrame），
  // 只计同步耗时会得到 0 ms，必须等帧真正提交。
  step('measure-window-level');
  /**
   * 无头 Chrome 的 --virtual-time-budget 模式下 rAF 不一定被驱动，
   * 直接用 requestAnimationFrame 等待会导致流程卡死（实测卡在本阶段）。
   * 这里用定时器让流程走完，同时单独探测 rAF 是否真的在跑——这个探测结果本身就是结论：
   * 无头虚拟时间下测不出真实帧时间，§11 的帧时间指标必须放到真机/有头环境。
   */
  const waitFrames = async (n) => {
    for (let i = 0; i < n; i++) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  };
  const wlCosts = [];
  const wlSyncCosts = [];
  let center = (props.voiRange.lower + props.voiRange.upper) / 2;
  let width = props.voiRange.upper - props.voiRange.lower;
  for (let i = 0; i < 40; i++) {
    center += 1.5;
    width = Math.max(2, width + 1);
    const s = performance.now();
    viewport.setProperties({
      voiRange: { lower: center - width / 2, upper: center + width / 2 },
    });
    viewport.render();
    wlSyncCosts.push(performance.now() - s);
    await waitFrames(2);
    wlCosts.push(performance.now() - s);
  }
  report.timings.windowLevelSyncMs = statsOf(wlSyncCosts);
  report.timings.windowLevelFrameMs = statsOf(wlCosts);

  // 探测 rAF 是否被驱动：0 帧说明"帧时间"在本环境不可测
  let rafTicks = 0;
  let rafStopped = false;
  const rafLoop = () => {
    if (rafStopped) return;
    rafTicks++;
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);
  await new Promise((resolve) => setTimeout(resolve, 200));
  rafStopped = true;
  report.timings.rafTicksIn200ms = rafTicks;
  report.timings.frameTimingMeasurable = rafTicks > 0;

  // Q3-b：翻页耗时（含解码，3 张切片已在缓存里，只能代表"已解码后"的切换）
  step('measure-slice-flip');
  const flipCosts = [];
  for (let i = 0; i < 30; i++) {
    const s = performance.now();
    await viewport.setImageIdIndex(i % IMAGE_IDS.length);
    flipCosts.push(performance.now() - s);
  }
  report.timings.sliceFlipMs = statsOf(flipCosts);

  // 右键拖动调窗：不引入 @cornerstonejs/tools，纯 setProperties 驱动
  step('bind-window-level');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startVoi = null;

  element.addEventListener('contextmenu', (e) => e.preventDefault());
  element.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startVoi = viewport.getProperties().voiRange;
    element.setPointerCapture(e.pointerId);
  });
  element.addEventListener('pointermove', (e) => {
    if (!dragging || !startVoi) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const baseWidth = startVoi.upper - startVoi.lower;
    const baseCenter = (startVoi.lower + startVoi.upper) / 2;
    const nextWidth = Math.max(1, baseWidth + dx * 2);
    const nextCenter = baseCenter + dy * 2;
    viewport.setProperties({
      voiRange: { lower: nextCenter - nextWidth / 2, upper: nextCenter + nextWidth / 2 },
    });
    viewport.render();
    report.voi = { ...viewport.getProperties().voiRange };
  });
  element.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    element.releasePointerCapture(e.pointerId);
  });

  report.stage = 'done';
  report.dicomLoader = {
    hasWadouri: typeof dicomImageLoader?.wadouri === 'object',
    initIsAsync: dicomLoaderInit.constructor.name === 'AsyncFunction',
  };
  flush();
}

main().catch((err) => fail('main', err));
