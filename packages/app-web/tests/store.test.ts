import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SeriesHandle, StudyMeta } from '@opendicomviewer/core';
import { useViewerStore } from '../src/state/viewer-store';

describe('useViewerStore', () => {
  beforeEach(() => {
    useViewerStore.getState().reset();
  });

  it('初始状态为空', () => {
    const state = useViewerStore.getState();
    expect(state.studies).toEqual([]);
    expect(state.activeSeriesHandle).toBeNull();
    expect(state.importStatus.loading).toBe(false);
  });

  it('setStudies 更新列表并自动选中首个 studyInstanceUid', () => {
    const mockStudies: StudyMeta[] = [
      {
        studyInstanceUid: 'study-1',
        patientId: 'P001',
        patientName: 'Test Patient',
        studyDescription: 'Chest CT',
        modalities: ['CT'],
        seriesCount: 2,
      },
    ];

    useViewerStore.getState().setStudies(mockStudies);
    const state = useViewerStore.getState();
    expect(state.studies).toHaveLength(1);
    expect(state.activeStudyUid).toBe('study-1');
  });

  it('setActiveSeries 释放旧序列并装载新序列', () => {
    const dispose1 = vi.fn();
    const handle1 = {
      meta: {
        studyInstanceUid: 'study-1',
        seriesInstanceUid: 'series-1',
        seriesDescription: 'S1',
        modality: 'CT',
        numberOfFrames: 10,
        planes: [],
        spacing: [1, 1, 1],
        warnings: [],
      },
      warnings: [],
      pixel: vi.fn(),
      dispose: dispose1,
    } as unknown as SeriesHandle;

    const dispose2 = vi.fn();
    const handle2 = {
      meta: {
        studyInstanceUid: 'study-1',
        seriesInstanceUid: 'series-2',
        seriesDescription: 'S2',
        modality: 'CT',
        numberOfFrames: 20,
        planes: [],
        spacing: [1, 1, 1],
        warnings: [],
      },
      warnings: [{ code: 'SLICE_GAP', message: '缺层', severity: 'warning' }],
      pixel: vi.fn(),
      dispose: dispose2,
    } as unknown as SeriesHandle;

    useViewerStore.getState().setActiveSeries(handle1);
    expect(useViewerStore.getState().activeSeriesUid).toBe('series-1');
    expect(dispose1).not.toHaveBeenCalled();

    // 切换至新序列，旧 handle 应被 dispose
    useViewerStore.getState().setActiveSeries(handle2);
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().activeSeriesUid).toBe('series-2');
    expect(useViewerStore.getState().warnings).toHaveLength(1);
  });

  it('reset 释放活跃句柄并重置所有状态', () => {
    const dispose = vi.fn();
    const handle = {
      meta: {
        studyInstanceUid: 'study-1',
        seriesInstanceUid: 'series-1',
        seriesDescription: 'S1',
        modality: 'CT',
        numberOfFrames: 10,
        planes: [],
        spacing: [1, 1, 1],
        warnings: [],
      },
      warnings: [],
      pixel: vi.fn(),
      dispose,
    } as unknown as SeriesHandle;

    useViewerStore.getState().setActiveSeries(handle);
    useViewerStore.getState().reset();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().activeSeriesUid).toBeNull();
    expect(useViewerStore.getState().studies).toEqual([]);
  });
});
