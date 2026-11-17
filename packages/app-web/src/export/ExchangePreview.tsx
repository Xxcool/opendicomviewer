import { useEffect, useRef } from 'react';
import { mapHUToUint8, rawToHU, type PixelFrame, type VOIRange } from '@opendicomviewer/core';
import type { ExchangeDocument } from './exchange';

export interface ExchangePreviewData { result: ExchangeDocument; frame: PixelFrame; window: VOIRange }
export function ExchangePreview({ result, frame, window }: ExchangePreviewData) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const width = frame.width, height = frame.height;
    const pixels = context.createImageData(width, height);
    // GSPS 自带最终呈现极性，不能再叠加原始影像的 MONOCHROME1 反相。
    const photometric = result.kind === 'SR' ? frame.photometricInterpretation
      : result.presentationLutShape === 'INVERSE' ? 'MONOCHROME1' : 'MONOCHROME2';
    for (let index = 0; index < width * height; index++) {
      const value = rawToHU(frame.pixelData[index]!, frame.rescaleSlope, frame.rescaleIntercept, frame.modalityLUT);
      const gray = mapHUToUint8(value, window, photometric);
      const offset = index * 4;
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = gray;
      pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    context.save();
    context.translate(0.5, 0.5);
    context.strokeStyle = context.fillStyle = '#5de4ed';
    context.lineWidth = Math.max(1, width / 400);
    context.font = Math.max(10, width / 40) + 'px sans-serif';
    const groups = result.kind === 'GSPS' ? result.annotations : result.measurements.map(item => ({
      graphics: [{ type: 'POLYLINE', points: item.points }], texts: [],
    }));
    for (const group of groups) {
      for (const graphic of group.graphics) {
        const [a, b, c, d] = graphic.points;
        if (!a || !b) continue;
        context.beginPath();
        if (graphic.type === 'ELLIPSE' && c && d) {
          context.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2,
            Math.hypot(c[0] - d[0], c[1] - d[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), 0, 2 * Math.PI);
        } else {
          context.moveTo(a[0], a[1]);
          for (const point of graphic.points.slice(1)) context.lineTo(point[0], point[1]);
        }
        context.stroke();
      }
      for (const text of group.texts) context.fillText(text.value, text.anchor[0], text.anchor[1]);
    }
    context.restore();
  }, [result, frame, window]);
  return <section aria-label="DICOM 结果核对">
    <p>已匹配源帧 · {result.kind === 'GSPS' ? 'GSPS 图形与文字' : 'SR 测距'}</p>
    <canvas ref={canvas} width={frame.width} height={frame.height} aria-label="结果在源像素上的位置"
      style={{ display: 'block', maxWidth: '100%', maxHeight: '42vh', margin: '8px auto', objectFit: 'contain' }} />
    <p className="text-txt-muted">核对图按原图方向显示，使用{result.kind === 'GSPS' ? '文件窗值和呈现极性' : '当前窗值'}。</p>
    {result.kind === 'SR' ? <ol>{result.measurements.map((item, index) => <li key={index}>{item.type} · {item.lengthMm.toFixed(2)} mm{item.note && ' · ' + item.note}</li>)}</ol>
      : <p>{result.annotations.length} 项标注 · 文件窗宽 {result.voi.windowWidth} · 窗位 {result.voi.windowCenter} · 旋转 {result.rotation}°{result.horizontalFlip && ' · 水平翻转'}</p>}
  </section>;
}
