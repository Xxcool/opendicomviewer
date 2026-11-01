import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeriesHandle, ImagePlane, VolumeHandle } from '@opendicomviewer/core';
import { useViewerStore } from '../src/state/viewer-store';
const makeHandle = (uid: string, count = 1): SeriesHandle => ({
  meta: { studyInstanceUid: `study-${uid}`, seriesInstanceUid: uid, modality: 'CT', seriesDescription: uid,
    numberOfFrames: count, spacing: [1,1,1], warnings: [],
    planes: Array.from({ length: count }, (_, z): ImagePlane => ({ imageId: `${uid}-${z}`, sopInstanceUid: `${uid}.${z}`,
      imagePositionPatient: [0,0,z], imageOrientationPatient: [1,0,0,0,1,0], pixelSpacing: [1,1], rows: 2, columns: 2 })),
  }, warnings: [], pixel: vi.fn(), dispose: vi.fn(),
});
beforeEach(() => useViewerStore.getState().reset());
describe('独立分屏句柄归属', () => {
  it('单层可分屏、空格可激活，详情不残留其他格；不能伪装进入 MPR', () => {
    const store = useViewerStore.getState(); const ct = makeHandle('ct');
    store.setActiveSeries(ct); store.setLayoutMode('split-2x2');
    expect(useViewerStore.getState().splitSeries['default-viewport']).toBe(ct);
    store.setActiveViewportId('split-2');
    expect(useViewerStore.getState().activeSeriesHandle).toBeNull();
    expect(useViewerStore.getState().activeSeriesUid).toBeNull();
    expect(useViewerStore.getState().warnings).toEqual([]);
    store.setLayoutMode('2x2');
    expect(useViewerStore.getState().layoutMode).toBe('split-2x2');
  });
  it('给第二格选择 CT 不替换第一格 MR，切格后详情跟随', () => {
    const store = useViewerStore.getState(); const mr = makeHandle('mr',3); const ct = makeHandle('ct');
    store.setActiveSeries(mr); store.setLayoutMode('split-2x2');
    store.setActiveViewportId('split-2'); store.setActiveSeries(ct);
    expect(useViewerStore.getState().splitSeries).toEqual({ 'default-viewport': mr, 'split-2': ct });
    expect(mr.dispose).not.toHaveBeenCalled();
    expect(useViewerStore.getState().activeSeriesHandle).toBe(ct);
    store.setActiveViewportId('default-viewport');
    expect(useViewerStore.getState().activeStudyUid).toBe('study-mr');
  });
  it('异步分配固定到原目标格，不污染后来选中的格', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a'); const b = makeHandle('b');
    store.setActiveSeries(a); store.setLayoutMode('split-2x2');
    store.setActiveViewportId('split-3');
    store.assignSplitSeries('split-2',b);
    expect(useViewerStore.getState().splitSeries['split-2']).toBe(b);
    expect(useViewerStore.getState().activeViewportId).toBe('split-3');
    expect(useViewerStore.getState().activeSeriesHandle).toBeNull();
  });
  it('共用句柄只在最后一个引用退出时释放，重复打开的同 UID 句柄不泄漏', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a'); const duplicate = makeHandle('a'); const b = makeHandle('b');
    store.setActiveSeries(a); store.setLayoutMode('split-2x2');
    store.setActiveViewportId('split-2'); store.setActiveSeries(duplicate);
    expect(useViewerStore.getState().splitSeries['split-2']).toBe(a);
    expect(duplicate.dispose).toHaveBeenCalledTimes(1);
    store.setActiveSeries(b);
    expect(a.dispose).not.toHaveBeenCalled();
    store.assignSplitSeries('default-viewport',b);
    expect(a.dispose).toHaveBeenCalledTimes(1);
    store.reset(); expect(b.dispose).toHaveBeenCalledTimes(1);
  });
  it('退出分屏展示选中影像，单视口替换不释放其他格保留的句柄', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a'); const b = makeHandle('b'); const c = makeHandle('c');
    store.setActiveSeries(a); store.setLayoutMode('split-2x2'); store.setActiveViewportId('split-2'); store.setActiveSeries(b);
    store.setLayoutMode('1x1'); expect(useViewerStore.getState().activeSeriesHandle).toBe(b);
    store.setActiveSeries(c); expect(b.dispose).not.toHaveBeenCalled();
    store.reset(); expect(a.dispose).toHaveBeenCalledTimes(1); expect(b.dispose).toHaveBeenCalledTimes(1); expect(c.dispose).toHaveBeenCalledTimes(1);
  });
  it('重新导入清理旧格并回单视口，保留活动句柄直至新序列就绪', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a'); const b = makeHandle('b'); const c = makeHandle('c');
    store.setActiveSeries(a); store.setLayoutMode('split-2x2'); store.setActiveViewportId('split-2'); store.setActiveSeries(b);
    store.setStudies([]);
    expect(useViewerStore.getState().splitSeries).toEqual({});
    expect(useViewerStore.getState().layoutMode).toBe('1x1');
    expect(a.dispose).toHaveBeenCalledTimes(1); expect(b.dispose).not.toHaveBeenCalled();
    store.setActiveSeries(c); expect(b.dispose).toHaveBeenCalledTimes(1);
  });
  it('普通格可独立调窗，MPR 正交格仍禁止套用原始窗', () => {
    const store = useViewerStore.getState(); store.setActiveSeries(makeHandle('a',3)); store.setLayoutMode('split-2x2');
    store.setActiveTool('window'); store.setActiveViewportId('split-2');
    expect(useViewerStore.getState().activeTool).toBe('window');
    store.setLayoutMode('2x2'); store.setActiveTool('window'); store.setActiveViewportId('mpr-coronal');
    expect(useViewerStore.getState().activeTool).toBe('pan');
  });
});


describe('分屏状态边界', () => {
  it('重复点击已选布局不覆盖第一格、不改变活动格', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a'); const b = makeHandle('b');
    store.setActiveSeries(a); store.setLayoutMode('split-2x2'); store.setActiveViewportId('split-2'); store.setActiveSeries(b);
    const before = useViewerStore.getState(); store.setLayoutMode('split-2x2');
    expect(useViewerStore.getState()).toBe(before);
    expect(useViewerStore.getState().splitSeries['default-viewport']).toBe(a);
  });
  it('选择另一序列格立即作废旧 MPR 体积，禁止把 A 的体积交给 B', () => {
    const store = useViewerStore.getState(); const a = makeHandle('a',3); const b = makeHandle('b',3);
    store.setActiveSeries(a); store.setLayoutMode('split-2x2'); store.assignSplitSeries('split-2',b);
    store.setMprVolume({ seriesInstanceUid:'a' } as VolumeHandle);
    store.setMprStatus({phase:'ready'}); store.setActiveViewportId('split-2');
    expect(useViewerStore.getState().mprVolume).toBeNull(); expect(useViewerStore.getState().mprStatus.phase).toBe('idle');
    store.setLayoutMode('2x2'); expect(useViewerStore.getState().activeSeriesUid).toBe('b');
  });
  it('重新导入作废旧体积，清空保留已挂载渲染器的能力', () => {
    const store = useViewerStore.getState();
    store.setActiveSeries(makeHandle('a',3)); store.setMprVolume({seriesInstanceUid:'a'} as VolumeHandle);
    store.setStudies([]); expect(useViewerStore.getState().mprVolume).toBeNull();
    store.setRendererCapabilities({supportsVolume:true, isSoftwareFallback:false, backend:'webgl2', maxTextureSize:4096});
    const caps = useViewerStore.getState().rendererCapabilities;
    store.reset(); expect(useViewerStore.getState().rendererCapabilities).toBe(caps);
  });
});
