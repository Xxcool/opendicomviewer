import { isAngle, angleStats, anglePointCount, angleSegments } from './annotation-angle';
import { isRoi, roiStats } from './annotation-roi';
import { useEffect, useRef, type RefObject } from 'react';
import { measureImageLength, type ImagePlane, type MeasurementRecord, type SeriesHandle } from '@opendicomviewer/core';
import type { CornerstoneRenderer } from '@opendicomviewer/renderer-cs3d';
import { useAnnotations } from './AnnotationContext';
import { belongsToFrame, calibrated, canvasPoint, segmentDistance, sourcePoint, type PixelPoint } from './annotation-geometry';
import { paintAnnotation } from './annotation-svg';
import { blocksViewerShortcut, blocksViewerShortcutContext, CAMERA_CHANGED } from '../components/viewport-gestures';
import { useViewerStore } from '../state/viewer-store';

export const ANNOTATION_FRAME_CHANGED = 'odv-annotation-frame-changed';
interface Props {
  renderer: CornerstoneRenderer; viewportId: string; series: SeriesHandle;
  hostRef: RefObject<HTMLDivElement | null>; readIndex: () => number;
}
interface Draft {
  record: MeasurementRecord; original: MeasurementRecord | null; plane: ImagePlane;
  start: PixelPoint; mode: 'draw' | 'move' | number; pointerId: number;
}
export function AnnotationLayer({ renderer, viewportId, series, hostRef, readIndex }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const state = useAnnotations();
  const selectedRef = useRef(state.selected); selectedRef.current = state.selected;
  const paintRef = useRef<() => void>(() => {});
  useEffect(() => { paintRef.current(); }, [state.selected]);
  useEffect(() => {
    const svg = svgRef.current, host = hostRef.current;
    if (!svg || !host) return;
    let draft: Draft | null = null;
    let pending: { record: MeasurementRecord; plane: ImagePlane; fixed: PixelPoint[] } | null = null;
    let completionToken = 0; let disposed = false;
    const current = () => {
      const index = readIndex();
      try { return renderer.currentSliceIndex(viewportId) === index ? series.meta.planes[index] : undefined; }
      catch { return undefined; } // 初始 Stack 尚未提交，禁止在未就绪画面上取点。
    };
    const report = (message: string) => useViewerStore.getState().setImportStatus({ loading: false, error: message });
    const visible = (plane: ImagePlane) => state.session.list().filter(record => belongsToFrame(record, state.sessionId, series.meta.seriesInstanceUid, plane));
    const paint = () => {
      const plane = current(); svg.replaceChildren();
      if (!plane) return;
      try {
        for (const record of visible(plane)) {
          if (draft?.original?.id !== record.id) paintAnnotation(svg, record, renderer, viewportId, plane, selectedRef.current === record.id);
        }
        if (pending && pending.plane === plane) paintAnnotation(svg, pending.record, renderer, viewportId, plane, true);
        if (state.tool === 'angle' || state.tool === 'cobbAngle') {
          const hint = document.createElementNS(svg.namespaceURI, "text"); hint.setAttribute("x", "16"); hint.setAttribute("y", "80"); hint.setAttribute("fill", "#ffce56"); hint.setAttribute("font-size", "13"); const step = pending ? pending.fixed.length + 1 : 1;
          const count = state.tool === 'angle' ? 3 : 4;
          const role = state.tool === 'angle' ? ['起点', '顶点', '终点'][step - 1] : ['第一条线起点', '第一条线终点', '第二条线起点', '第二条线终点'][step - 1];
          hint.textContent = `点击${role} · ${step}/${count} · Esc 取消`; svg.append(hint);
        }
        if (draft && draft.plane === plane) paintAnnotation(svg, draft.record, renderer, viewportId, plane, true);
      } catch (error) { report(`标注绘制失败：${error instanceof Error ? error.message : String(error)}`); }
    };
    paintRef.current = paint;
    const cancel = () => {
      completionToken++;
      if (draft && host.hasPointerCapture(draft.pointerId)) host.releasePointerCapture(draft.pointerId);
      draft = null; pending = null; paint();
    };
    const pointAt = (event: PointerEvent, plane: ImagePlane) => {
      const rect = host.getBoundingClientRect();
      return sourcePoint(renderer, viewportId, plane, event.clientX - rect.left, event.clientY - rect.top);
    };
    const down = (event: PointerEvent) => {
      if (useViewerStore.getState().importStatus.loading || event.button !== 0 || event.shiftKey || state.tool === 'none'
        || (event.target instanceof Element && event.target.closest('[data-annotation-panel]'))) return;
      const plane = current(); if (!plane) return;
      event.preventDefault(); event.stopImmediatePropagation();
      completionToken++;
      try {
        const point = pointAt(event, plane); if (!point) return;
        if ((state.tool === 'angle' || state.tool === 'cobbAngle')) {
          if (!calibrated(plane)) { report('当前帧缺少可信物理标定，不能测量角度'); return; }
          if (!pending) {
            const type = state.tool === 'cobbAngle' ? 'cobbAngle' : 'angle';
            pending = { plane, fixed: [], record: { id: crypto.randomUUID(), sessionId: state.sessionId, coordinateSpace: 'image-pixel', seriesInstanceUid: series.meta.seriesInstanceUid, sopInstanceUid: plane.sopInstanceUid, frameIndex: plane.frameIndex ?? 0, type, points: [], stats: {}, createdAt: Date.now() } };
          }
          pending.fixed.push(point); pending.record = { ...pending.record, points: [...pending.fixed] };
          if (pending.fixed.length === anglePointCount(pending.record.type)) {
            const completed = pending; pending = null;
            state.session.add({ ...completed.record, stats: angleStats(completed.record, plane) });
            state.select(completed.record.id); state.setPanelOpen(true);
          }
          paint(); return;
        }
        if (state.tool === 'select') {
          const rect = host.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
          const hit = [...visible(plane)].reverse().find(record => {
            const a = record.points[0] && canvasPoint(renderer, viewportId, plane, record.points[0]);
            const b = record.points[1] && canvasPoint(renderer, viewportId, plane, record.points[1]);
            const controls = record.points.map(point => canvasPoint(renderer, viewportId, plane, point));
            if (controls.some(point => point && Math.hypot(x - point.x, y - point.y) < 8)) return true;
            if (isAngle(record)) return angleSegments(record).some(([first, last]) => { const start = controls[first], end = controls[last]; return start && end && segmentDistance(x, y, start, end) < 10; });
            if (a && Math.hypot(x - a.x, y - a.y) < 8) return true;
            if (b && Math.hypot(x - b.x, y - b.y) < 8) return true;
            if (isRoi(record) && b) {
              const p = sourcePoint(renderer, viewportId, plane, x, y);
              const first = record.points[0]!, last = record.points[1]!;
              if (!p) return false;
              const cx = (first[0] + last[0]) / 2, cy = (first[1] + last[1]) / 2;
              const rx = Math.abs(last[0] - first[0]) / 2, ry = Math.abs(last[1] - first[1]) / 2;
              return record.type === 'ellipseRoi' ? ((p[0] - cx) / rx) ** 2 + ((p[1] - cy) / ry) ** 2 <= 1
                : Math.abs(p[0] - cx) <= rx && Math.abs(p[1] - cy) <= ry;
            }
            return a && (b ? segmentDistance(x, y, a, b) < 10 : Math.hypot(x - a.x, y - a.y) < 20);
          });
          state.select(hit?.id ?? null);
          if (!hit) return;
          const index = hit.points.findIndex(point => { const p = canvasPoint(renderer, viewportId, plane, point); return p && Math.hypot(x - p.x, y - p.y) < 8; });
          const mode = index >= 0 ? index : 'move';
          draft = { record: hit, original: hit, plane, start: point, mode, pointerId: event.pointerId };
        } else {
          if (state.tool === 'length' && !calibrated(plane)) { report('当前帧缺少可信物理标定，不能测距；仍可使用箭头或文字备注'); return; }
          const type = state.tool;
          const record: MeasurementRecord = { id: crypto.randomUUID(), sessionId: state.sessionId, coordinateSpace: 'image-pixel',
            seriesInstanceUid: series.meta.seriesInstanceUid, sopInstanceUid: plane.sopInstanceUid, frameIndex: plane.frameIndex ?? 0,
            type, points: type === 'text' ? [point] : [point, point], stats: {}, createdAt: Date.now(), text: type === 'length' || type === 'rectangleRoi' || type === 'ellipseRoi' ? undefined : '备注' };
          draft = { record, original: null, plane, start: point, mode: 'draw', pointerId: event.pointerId };
        }
        host.setPointerCapture(event.pointerId); paint();
      } catch (error) { cancel(); report(`标注取点失败：${error instanceof Error ? error.message : String(error)}`); }
    };
    const move = (event: PointerEvent) => {
      if (pending) {
        if (current() !== pending.plane) { cancel(); return; }
        const point = pointAt(event, pending.plane);
        if (point) { pending.record = { ...pending.record, points: [...pending.fixed, point] }; paint(); }
        return;
      }
      if (!draft) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (current() !== draft.plane) { cancel(); return; }
      try {
        const point = pointAt(event, draft.plane); if (!point) return;
        let points: readonly PixelPoint[];
        if (draft.mode === 'move' && draft.original) {
          const dx = point[0] - draft.start[0], dy = point[1] - draft.start[1];
          points = draft.original.points.map(p => [p[0] + dx, p[1] + dy, 0]);
          if (points.some(p => p[0] < 0 || p[1] < 0 || p[0] > draft!.plane.columns - 1 || p[1] > draft!.plane.rows - 1)) return;
        } else if (draft.record.type === 'text') points = [point];
        else points = draft.record.points.map((old, index) => index === (typeof draft!.mode === 'number' ? draft!.mode : 1) ? point : [...old]);
        const stats = draft.record.type === 'length' ? measureImageLength([points[0]![0], points[0]![1]], [points[1]![0], points[1]![1]], { trusted: calibrated(draft.plane), pixelSpacing: draft.plane.pixelSpacing }) : null;
        draft.record = { ...draft.record, points, stats: isAngle(draft.record) ? angleStats({ ...draft.record, points }, draft.plane) : stats?.ok ? { lengthMm: stats.value } : {} };
        paint();
      } catch (error) { cancel(); report(`标注修改失败：${error instanceof Error ? error.message : String(error)}`); }
    };
    const up = (event: PointerEvent) => {
      if (!draft) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const completed = draft;
      try {
        if (current() !== completed.plane) { cancel(); return; }
        if (completed.record.type !== 'text' && !isAngle(completed.record) && (!completed.record.points[1]
          || Math.hypot(completed.record.points[1][0] - completed.record.points[0]![0], completed.record.points[1][1] - completed.record.points[0]![1]) < 0.5)) { cancel(); return; }
        if (completed.record.type === 'length' && completed.record.stats.lengthMm === undefined) { cancel(); return; }
        draft = null;
        const token = ++completionToken;
        const snapshot = state.session.list();
        const commit = (record: MeasurementRecord) => {
          if (disposed || token !== completionToken || current() !== completed.plane || useViewerStore.getState().importStatus.loading || state.session.list() !== snapshot) return;
          if (completed.original) state.session.update(record); else state.session.add(record);
          state.select(record.id); state.setPanelOpen(true);
        };
        if (isRoi(completed.record)) {
          // 释放后才读原图与统计；异步期间切帧、撤销或新绘制使本次提交失效。
          void series.pixel(readIndex()).then(frame => {
            if (disposed || token !== completionToken || current() !== completed.plane) return;
            commit({ ...completed.record, stats: roiStats(completed.record, frame, completed.plane) });
          }).catch(error => { if (!disposed && token === completionToken && current() === completed.plane && !useViewerStore.getState().importStatus.loading) report(`区域统计失败：${error instanceof Error ? error.message : String(error)}`); });
        } else commit(completed.record);
      } catch (error) { report(`标注保存失败：${error instanceof Error ? error.message : String(error)}`); }
      finally { if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId); paint(); }
    };
    const changedFrame = () => { cancel(); };
    const key = (event: KeyboardEvent) => {
      if (blocksViewerShortcutContext(event)) return;
      if (event.key === 'Escape') { cancel(); state.setTool('none'); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); cancel(); if (event.shiftKey) state.session.redo(); else state.session.undo(); return;
      }
      if (blocksViewerShortcut(event)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current) {
        const plane = current();
        const selected = state.session.list().find(record => record.id === selectedRef.current);
        if (!plane || !selected || !belongsToFrame(selected, state.sessionId, series.meta.seriesInstanceUid, plane)) return;
        event.preventDefault(); state.session.remove(selected.id); state.select(null);
      }
    };
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true);
    host.addEventListener('pointerup', up, true); host.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key); window.addEventListener(ANNOTATION_FRAME_CHANGED, changedFrame);
    window.addEventListener(CAMERA_CHANGED, paint);
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      // 等渲染器完成同轮尺寸与相机更新后，再投影源像素坐标。
      resizeFrame = requestAnimationFrame(paint);
    }); observer.observe(host);
    const unsubscribe = state.session.subscribe(paint); paint();
    return () => {
      disposed = true; cancel(); unsubscribe(); observer.disconnect(); cancelAnimationFrame(resizeFrame);
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true);
      host.removeEventListener('pointerup', up, true); host.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key); window.removeEventListener(ANNOTATION_FRAME_CHANGED, changedFrame);
      window.removeEventListener(CAMERA_CHANGED, paint);
    };
  }, [renderer, viewportId, series, hostRef, readIndex, state.session, state.sessionId, state.tool]);
  return <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none z-20" aria-label="影像标注" />;
}
