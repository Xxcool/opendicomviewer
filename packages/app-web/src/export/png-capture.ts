import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';

export interface PngSnapshot {
  readonly image: HTMLCanvasElement;
  readonly annotationSvg: string | null;
  readonly identity: readonly string[];
  readonly pixelRatio: number;
}
/** 读取CS3D已提交的持久2D视口，而不是已清空drawing buffer的离屏WebGL画布。 */
export async function capturePngSnapshot(renderer: Pick<CornerstoneRenderer, 'render'>, identity: readonly string[]): Promise<PngSnapshot> {
  const host = document.querySelector('[data-odv-viewport="default-viewport"]');
  const canvas = host?.querySelector('canvas');
  if (!(host instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) throw new Error('当前原始影像画布尚未准备好');
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); host.removeEventListener('CORNERSTONE_IMAGE_RENDERED', ready); };
    const ready = () => { cleanup(); resolve(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('等待影像绘制超时，请重试')); }, 1500);
    host.addEventListener('CORNERSTONE_IMAGE_RENDERED', ready, { once: true });
    try { renderer.render('default-viewport'); } catch (error) { cleanup(); reject(error); }
  });
  if (!canvas.isConnected || canvas.width === 0 || canvas.height === 0 || !canvas.getContext('2d')) throw new Error('当前影像不支持可靠截图');
  const image = document.createElement('canvas'); image.width = canvas.width; image.height = canvas.height;
  const context = image.getContext('2d'); if (!context) throw new Error('浏览器不支持图片导出');
  context.drawImage(canvas, 0, 0);
  const overlay = document.querySelector('svg[aria-label="影像标注"]');
  let annotationSvg: string | null = null;
  const ratio = canvas.width / host.getBoundingClientRect().width;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('当前影像尺寸无效');
  if (overlay instanceof SVGSVGElement) {
    const clone = overlay.cloneNode(true);
    if (clone instanceof SVGSVGElement) {
      clone.querySelectorAll('circle').forEach(point => point.remove());
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(canvas.width)); clone.setAttribute('height', String(canvas.height));
      const rect = overlay.getBoundingClientRect();
      clone.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
      annotationSvg = new XMLSerializer().serializeToString(clone);
    }
  }
  return { image, annotationSvg, identity, pixelRatio: ratio };
}
async function loadSvg(text: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url;
    await image.decode(); return image;
  } finally { URL.revokeObjectURL(url); }
}
export async function composePng(snapshot: PngSnapshot, annotations: boolean, identity: boolean): Promise<Blob> {
  const ratio = snapshot.pixelRatio;
  const footer = Math.ceil(28 * ratio);
  const output = document.createElement('canvas'); output.width = snapshot.image.width; output.height = snapshot.image.height + footer;
  const context = output.getContext('2d'); if (!context) throw new Error('无法创建导出图片');
  context.fillStyle = '#000'; context.fillRect(0, 0, output.width, output.height);
  context.drawImage(snapshot.image, 0, 0);
  if (annotations && snapshot.annotationSvg) context.drawImage(await loadSvg(snapshot.annotationSvg), 0, 0);
  context.fillStyle = '#fff'; context.font = `${12 * ratio}px sans-serif`;
  if (identity) snapshot.identity.forEach((line, index) => context.fillText(line, 12 * ratio, (24 + index * 18) * ratio));
  context.fillStyle = '#b7c0ce'; context.font = `${10 * ratio}px sans-serif`;
  context.fillText('OpenDicomViewer · 研究与教学参考 · 测量未经临床验证', 12 * ratio, output.height - 10 * ratio);
  return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG编码失败')), 'image/png'));
}
