import type { HostOriginalSaver } from '../../app-web/src/bridge/host-original-saver';
import { isNativeCandidate } from './candidate';
import { originalDicomBlob } from '../../app-web/src/export/original-dicom';

type CopyOriginals = (files: readonly { id: string; size: number }[]) => Promise<'saved' | 'cancelled'>;
type SaveBlob = (blob: Blob, signal?: AbortSignal) => Promise<'saved' | 'cancelled'>;

export function createOriginalSaver(copy: CopyOriginals, save: SaveBlob): HostOriginalSaver {
  return async (files, signal) => {
    if (signal?.aborted) return 'cancelled';
    if (!files.length) throw new Error('没有可导出的原始实例');
    // ZIP 展开项与教学样本没有原生路径，必须读回候选原始字节，不能复制压缩包冒充实例。
    if (files.every(isNativeCandidate)) {
      return copy(files.map(({ id, size }) => ({ id, size })));
    }
    const size = files.reduce((total, file) => total + file.size + 128, 22);
    if (size > 512 * 1024 * 1024) throw new Error('原始影像打包超过 512 MiB 上限，请分批导出');
    const blob = await originalDicomBlob(files, signal);
    if (signal?.aborted) return 'cancelled';
    return save(blob, signal);
  };
}
