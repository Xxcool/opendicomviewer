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
    line(group, a.x, a.y, b.x, b.y);
    if (record.type === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      for (const offset of [-0.5, 0.5]) line(group, a.x, a.y, a.x + 12 * Math.cos(angle + offset), a.y + 12 * Math.sin(angle + offset));
    }
  }
  if (selected) for (const point of [a, b].filter(value => !!value)) {
    const circle = document.createElementNS(NS, 'circle'); circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '4'); circle.setAttribute('fill', '#151a22'); group.append(circle);
  }
  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', String((b?.x ?? a.x) + 8)); label.setAttribute('y', String((b?.y ?? a.y) - 8));
  label.setAttribute('fill', selected ? '#ffce56' : '#5de4ed'); label.setAttribute('stroke', 'none');
  label.setAttribute('font-size', '12'); label.setAttribute('style', 'paint-order:stroke;stroke:#000;stroke-width:3px');
  label.textContent = [record.type === 'length' ? `${record.stats.lengthMm?.toFixed(2) ?? '--'} mm` : '', record.text].filter(Boolean).join(' · ');
  group.append(label); svg.append(group);
}
