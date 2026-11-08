import { isPath, pathSegments } from './annotation-path';
import { isAngle, angleSegments } from './annotation-angle';
import { annotationLabel, isRoi } from './annotation-roi';
import type { ImagePlane, MeasurementRecord } from '@opendicomviewer/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { canvasPoint } from './annotation-geometry';
const NS = 'http://www.w3.org/2000/svg';
function line(group: SVGGElement, x1: number, y1: number, x2: number, y2: number) {
  const element = document.createElementNS(NS, 'line');
  for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) element.setAttribute(key, String(value));
  group.append(element);
}
export function paintAnnotation(svg: SVGSVGElement, record: MeasurementRecord, renderer: CornerstoneRenderer, viewportId: string, plane: ImagePlane, selected: boolean) {
  const a = record.points[0] && canvasPoint(renderer, viewportId, plane, record.points[0]);
  const b = record.points[1] && canvasPoint(renderer, viewportId, plane, record.points[1]);
  if (!a) return;
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('stroke', selected ? '#ffce56' : '#5de4ed'); group.setAttribute('stroke-width', '2');
  if (b) {
    if (isRoi(record)) {
      // 在源像素平面画形状，再投影每个边界点，避免显示旋转时轴对齐框失真。
      const first = record.points[0]!, last = record.points[1]!;
      const coordinates: string[] = [];
      const steps = record.type === 'ellipseRoi' ? 64 : 4;
      for (let i = 0; i < steps; i++) {
        const angle = i / steps * Math.PI * 2;
        const x = record.type === 'ellipseRoi' ? (first[0] + last[0]) / 2 + Math.cos(angle) * (last[0] - first[0]) / 2 : [first[0], last[0], last[0], first[0]][i]!;
        const y = record.type === 'ellipseRoi' ? (first[1] + last[1]) / 2 + Math.sin(angle) * (last[1] - first[1]) / 2 : [first[1], first[1], last[1], last[1]][i]!;
        const point = canvasPoint(renderer, viewportId, plane, [x, y, 0]);
        if (point) coordinates.push(`${point.x},${point.y}`);
      }
      const shape = document.createElementNS(NS, 'polygon'); shape.setAttribute('points', coordinates.join(' ')); shape.setAttribute('fill', 'none'); group.append(shape);
    } else if (isAngle(record) || isPath(record)) {
      for (const [first, last] of (isPath(record) ? pathSegments(record) : angleSegments(record))) {
        const start = record.points[first] && canvasPoint(renderer, viewportId, plane, record.points[first]);
        const end = record.points[last] && canvasPoint(renderer, viewportId, plane, record.points[last]);
        if (start && end) line(group, start.x, start.y, end.x, end.y);
      }
    } else line(group, a.x, a.y, b.x, b.y);
    if (record.type === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      for (const offset of [-0.5, 0.5]) line(group, a.x, a.y, a.x + 12 * Math.cos(angle + offset), a.y + 12 * Math.sin(angle + offset));
    }
  }
  if (selected) for (const point of record.points.map(point => canvasPoint(renderer, viewportId, plane, point)).filter(value => !!value)) {
    const circle = document.createElementNS(NS, 'circle'); circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '4'); circle.setAttribute('fill', '#151a22'); group.append(circle);
  }
  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', String((b?.x ?? a.x) + 8)); label.setAttribute('y', String((b?.y ?? a.y) - 8));
  label.setAttribute('fill', selected ? '#ffce56' : '#5de4ed'); label.setAttribute('stroke', 'none');
  label.setAttribute('font-size', '12'); label.setAttribute('style', 'paint-order:stroke;stroke:#000;stroke-width:3px');
  label.textContent = [record.type === 'length' || isRoi(record) || isAngle(record) || isPath(record) ? annotationLabel(record) : '', record.text].filter(Boolean).join(' · ');
  group.append(label); svg.append(group);
}
