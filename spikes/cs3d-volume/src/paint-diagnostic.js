/** 独立绘制诊断入口。只用合成体积，不载入患者数据，也不挂载正式 React 应用。 */
import { init, RenderingEngine, Enums, volumeLoader, cache } from '@cornerstonejs/core';
import { DIMS, SPACING, ORIGIN, DIRECTION, metadata, buildScalarData } from './phantom.js';
import './paint-diagnostic.css';

const volumeId = 'odv:paint-diagnostic';
const root = document.createElement('main');
root.id = 'paint-diagnostic';
root.dataset.theme = 'dark';
root.dataset.layout = '2x2';
root.innerHTML = `<header>
  <h1>CS3D 合成体积绘制诊断 · 无患者数据</h1>
  <button data-action="layout" disabled>切换布局</button>
  <button data-action="theme" disabled>切换主题</button>
  <button data-action="cycle" disabled>循环 10 次布局 / 5 次主题</button>
  <button data-action="inspect" disabled>读取画布尺寸</button>
  <div class="paint-status" role="status" aria-live="polite"></div>
</header><div class="paint-grid"></div><pre aria-label="绘制诊断数据"></pre>`;
document.body.append(root);

const specs = [
  { id: 'paint-stack', title: '原始合成轴位 Stack', type: Enums.ViewportType.STACK },
  { id: 'paint-axial', title: '横断面 Axial', orientation: Enums.OrientationAxis.AXIAL },
  { id: 'paint-coronal', title: '冠状面 Coronal', orientation: Enums.OrientationAxis.CORONAL },
  { id: 'paint-sagittal', title: '矢状面 Sagittal', orientation: Enums.OrientationAxis.SAGITTAL },
];
const status = root.querySelector('.paint-status');
const reportNode = root.querySelector('pre');
const buttons = [...root.querySelectorAll('button')];
const report = {
  phase: '初始化', layoutChanges: 0, themeChanges: 0, completedCycles: 0,
  renderEvents: {}, errors: [], canvas: [],
  userAgent: navigator.userAgent, dpr: window.devicePixelRatio,
  note: '收到 IMAGE_RENDERED 不代表画面正确；须人工核对图像和文字完整性。',
};
let engine;
let observer;
let busy = true;
let disposed = false;
let resizeFrame = 0;

for (const spec of specs) {
  const cell = document.createElement('section');
  cell.className = 'paint-cell';
  const viewport = document.createElement('div');
  viewport.className = 'paint-viewport';
  viewport.id = spec.id;
  const label = document.createElement('div');
  label.className = 'paint-label';
  label.textContent = `${spec.title} · 完整文字 ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789`;
  const scale = document.createElement('div');
  scale.className = 'paint-scale';
  scale.textContent = '完整底边文字 · WW 256 / WL 128 · 合成数据';
  cell.append(viewport, label, scale);
  root.querySelector('.paint-grid').append(cell);
  spec.element = viewport;
  report.renderEvents[spec.id] = 0;
  viewport.addEventListener(Enums.Events.IMAGE_RENDERED, () => { report.renderEvents[spec.id]++; });
}

function paintReport() {
  report.canvas = specs.map(({ id, element }) => {
    const canvas = element.querySelector('canvas');
    const rect = element.getBoundingClientRect();
    return {
      id, css: [rect.width, rect.height], pixels: canvas ? [canvas.width, canvas.height] : null,
      expectedPixels: [Math.round(rect.width * devicePixelRatio), Math.round(rect.height * devicePixelRatio)],
    };
  });
  status.textContent = `${report.phase} · 布局 ${root.dataset.layout} / ${report.layoutChanges} 次 · 主题 ${root.dataset.theme} / ${report.themeChanges} 次 · 完整循环 ${report.completedCycles} · 错误 ${report.errors.length}`;
  reportNode.textContent = JSON.stringify(report, null, 2);
}

function fail(error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  report.phase = '错误（保留现场）';
  paintReport();
}

// 逐次等待真实渲染事件，避免自动循环把数十次 render 合并成同一帧。
function renderAll() {
  return new Promise((resolve, reject) => {
    const pending = new Set(specs.map(spec => spec.id));
    const listeners = [];
    const clean = () => { clearTimeout(timeout); for (const [el, listener] of listeners) el.removeEventListener(Enums.Events.IMAGE_RENDERED, listener); };
    const timeout = setTimeout(() => { clean(); reject(new Error(`渲染事件超时：${[...pending].join(', ')}`)); }, 8000);
    for (const spec of specs) {
      const listener = () => {
        pending.delete(spec.id);
        if (!pending.size) { clean(); requestAnimationFrame(() => requestAnimationFrame(resolve)); }
      };
      spec.element.addEventListener(Enums.Events.IMAGE_RENDERED, listener);
      listeners.push([spec.element, listener]);
    }
    try { engine.render(); } catch (error) { clean(); reject(error); }
  });
}

async function changeLayout() {
  root.dataset.layout = root.dataset.layout === '2x2' ? '1+3' : '2x2';
  report.layoutChanges++;
  // 读布局后通知 SDK 更新实际 backing store；与正式页面使用相同 resize 路径。
  root.querySelector('.paint-grid').getBoundingClientRect();
  engine.resize(true, true);
  for (const spec of specs) engine.getViewport(spec.id).resetCamera();
  await renderAll();
  paintReport();
}

async function changeTheme() {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  report.themeChanges++;
  await renderAll();
  paintReport();
}

async function run(action) {
  if (busy || disposed) return;
  busy = true;
  buttons.forEach(button => { button.disabled = true; });
  try {
    report.phase = '执行中';
    paintReport();
    if (action === 'layout') await changeLayout();
    else if (action === 'theme') await changeTheme();
    else if (action === 'cycle') {
      for (let i = 0; i < 10 && !disposed; i++) {
        await changeLayout();
        if (i % 2 === 1) await changeTheme();
      }
      if (!disposed) report.completedCycles++;
    }
    report.phase = '就绪（请核对视觉）';
  } catch (error) { fail(error); }
  finally {
    busy = false;
    if (!disposed) { buttons.forEach(button => { button.disabled = false; }); paintReport(); }
  }
}

buttons.forEach(button => button.addEventListener('click', () => { void run(button.dataset.action); }));
const onError = event => fail(event.error ?? event.message);
const onRejection = event => fail(event.reason);
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onRejection);

async function start() {
  await init();
  if (disposed) return;
  const volume = volumeLoader.createLocalVolume(volumeId, {
    dimensions: DIMS, spacing: SPACING, origin: ORIGIN, direction: DIRECTION,
    metadata, scalarData: buildScalarData(),
  });
  engine = new RenderingEngine('paint-diagnostic');
  for (const spec of specs) engine.enableElement({
    viewportId: spec.id, element: spec.element,
    type: spec.type ?? Enums.ViewportType.ORTHOGRAPHIC,
    defaultOptions: { background: [0, 0, 0] },
  });
  await renderAll();
  for (const spec of specs) {
    const viewport = engine.getViewport(spec.id);
    if (spec.type === Enums.ViewportType.STACK) await viewport.setStack(volume.imageIds, Math.floor(DIMS[2] / 2));
    else {
      await viewport.setVolumes([{ volumeId }]);
      viewport.setOrientation(spec.orientation, true);
    }
    viewport.setProperties({ voiRange: { lower: 0, upper: 255 } });
    viewport.resetCamera();
  }
  await renderAll();
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return;
      try { engine.resize(true, true); paintReport(); } catch (error) { fail(error); }
    });
  });
  specs.forEach(spec => observer.observe(spec.element));
  busy = false;
  buttons.forEach(button => { button.disabled = false; });
  report.phase = '就绪（请核对视觉）';
  paintReport();
}

window.addEventListener('pagehide', () => {
  disposed = true;
  observer?.disconnect();
  cancelAnimationFrame(resizeFrame);
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  engine?.destroy();
  if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
}, { once: true });
paintReport();
void start().catch(fail);
