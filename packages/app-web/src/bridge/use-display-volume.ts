import { useEffect } from 'react';
import { useViewerStore } from '../state/viewer-store';
import { buildVolumeFromSeries } from './volume-builder';

/** MPR 与 3D 共用当前序列的降采样体积，切走视图后放弃在途结果。 */
export function useDisplayVolume() {
  const activeSeriesHandle = useViewerStore(s => s.activeSeriesHandle);
  const mprVolume = useViewerStore(s => s.mprVolume);
  const rendererCapabilities = useViewerStore(s => s.rendererCapabilities);
  const setMprVolume = useViewerStore(s => s.setMprVolume);
  const setMprStatus = useViewerStore(s => s.setMprStatus);
  useEffect(() => {
    if (!activeSeriesHandle) return;
    const seriesUid = activeSeriesHandle.meta.seriesInstanceUid;
    if (mprVolume && mprVolume.seriesInstanceUid === seriesUid) return;
    if (rendererCapabilities && !rendererCapabilities.supportsVolume) {
      setMprStatus({
        phase: 'error',
        message: '当前渲染后端不支持体积通路，体积视图不可用',
      });
      return;
    }

    const controller = new AbortController();
    setMprStatus({
      phase: 'building',
      processedSlices: 0,
      totalSlices: activeSeriesHandle.meta.planes.length,
    });

    void buildVolumeFromSeries(activeSeriesHandle, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (controller.signal.aborted) return;
        setMprStatus({
          phase: 'building',
          processedSlices: progress.processedSlices,
          totalSlices: progress.totalSlices,
        });
      },
    })
      .then((outcome) => {
        if (controller.signal.aborted) return;
        if (outcome.status === 'ok') {
          setMprVolume(outcome.volume);
          setMprStatus({ phase: 'ready' });
        } else if (outcome.status === 'rejected') {
          setMprStatus({ phase: 'error', message: outcome.message });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setMprStatus({
          phase: 'error',
          message: `显示体积构建失败：${err instanceof Error ? err.message : String(err)}`,
        });
      });

    return () => controller.abort();
  }, [
    activeSeriesHandle,
    mprVolume,
    rendererCapabilities,
    setMprStatus,
    setMprVolume,
  ]);

  return mprVolume;
}
