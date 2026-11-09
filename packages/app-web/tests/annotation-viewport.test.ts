import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindAnnotationKeys, isAnnotationViewportActive } from '../src/annotations/annotation-viewport';
import { useViewerStore } from '../src/state/viewer-store';
import { MeasurementSession } from '../../core/measurement/session';
import type { MeasurementRecord } from '@opendicomviewer/core';

class TestKey extends Event {
  constructor() { super('keydown'); }
}
afterEach(() => { useViewerStore.getState().reset(); vi.unstubAllGlobals(); });

describe('annotation ownership across viewports', () => {
  it('applies undo once with four mounted listeners, and follows active pane changes', () => {
    vi.stubGlobal('KeyboardEvent', TestKey);
    const host = new EventTarget();
    const session = new MeasurementSession(error => { throw error; });
    const record: MeasurementRecord = { id: 'one', sessionId: 'session', seriesInstanceUid: 'series', sopInstanceUid: 'instance', frameIndex: 0,
      coordinateSpace: 'image-pixel', type: 'text', points: [[1, 2, 0]], stats: {}, text: 'note', createdAt: 1 };
    session.add(record); session.add({ ...record, id: 'two' });
    const undo = vi.fn(() => session.undo());
    const ids = ['default-viewport', 'split-2', 'split-3', 'split-4'];
    const unbind = ids.map(id => bindAnnotationKeys(host, id, undo));
    useViewerStore.setState({ layoutMode: 'split-2x2', activeViewportId: ids[1]! });
    host.dispatchEvent(new TestKey());
    expect(undo).toHaveBeenCalledTimes(1); expect(session.list().map(item => item.id)).toEqual(['one']);
    useViewerStore.setState({ activeViewportId: ids[2]! });
    host.dispatchEvent(new TestKey());
    expect(undo).toHaveBeenCalledTimes(2); expect(session.list()).toHaveLength(0);
    unbind.forEach(stop => stop()); host.dispatchEvent(new TestKey());
    expect(undo).toHaveBeenCalledTimes(2);
  });
  it('rejects MPR editing, inactive panes and detached single-view listeners', () => {
    useViewerStore.setState({ layoutMode: 'split-2x2', activeViewportId: 'split-2' });
    expect(isAnnotationViewportActive('split-2')).toBe(true);
    expect(isAnnotationViewportActive('default-viewport')).toBe(false);
    for (const layoutMode of ['2x2', '1+3'] as const) {
      useViewerStore.setState({ layoutMode, activeViewportId: 'mpr-axial' });
      expect(isAnnotationViewportActive('mpr-axial')).toBe(false);
    }
    useViewerStore.setState({ layoutMode: '1x1', activeViewportId: 'default-viewport' });
    expect(isAnnotationViewportActive('default-viewport')).toBe(true);
    expect(isAnnotationViewportActive('split-2')).toBe(false);
  });
});
