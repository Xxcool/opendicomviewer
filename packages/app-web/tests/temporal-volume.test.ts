import { describe, expect, it } from 'vitest';
import { LocalDataSource } from '@opendicomviewer/source-local';
import { planVolumeDownsample } from '@opendicomviewer/core';
import { buildDicomBuffer, type DicomFixtureElement } from '../../adapters/source-local/testing/dicom-fixture';
import { SeriesFrameRegistry } from '../../adapters/renderer-cs3d/src/frame-registry';
import { buildVolumeFromSeries } from '../src/bridge/volume-builder';
import { useViewerStore } from '../src/state/viewer-store';

function temporalSlice(phase: number, z: number, options: { shift?: number; echo?: number; missingPosition?: boolean } = {}) {
  const extra: DicomFixtureElement[] = [
    { tag: [0x20, 0x52], vr: 'UI', value: '2.25.19' },
    { tag: [0x20, 0x105], vr: 'IS', value: '2' },
    { tag: [0x18, 0x86], vr: 'IS', value: String(options.echo ?? 1) },
  ];
  if (!options.missingPosition) extra.push({ tag: [0x20, 0x100], vr: 'IS', value: String(phase) });
  const bytes = buildDicomBuffer({ sopClassUid: '1.2.840.10008.5.1.4.1.1.4', modality: 'MR',
    sopInstanceUid: `2.25.${phase}.${z + 1}`, imagePositionPatient: [options.shift ?? 0, 0, z],
    rows: 4, columns: 4, bitsAllocated: 8, bitsStored: 8, pixelRepresentation: 0, windowCenter: 128, windowWidth: 256,
    pixelData: new Uint8Array(16).fill(phase * 80 + z), extraElements: extra });
  return { id: `slice-${phase}-${z}`, name: 'slice.dcm', size: bytes.byteLength,
    read: async (start?: number, end?: number) => Uint8Array.from(bytes.subarray(start, end)).buffer };
}
async function open(files: ReturnType<typeof temporalSlice>[]) {
  const source = new LocalDataSource();
  await source.probe({ files });
  return source.openSeries((await source.listSeries())[0]!);
}
const files = () => [temporalSlice(2, 2), temporalSlice(1, 1), temporalSlice(2, 0),
  temporalSlice(1, 2), temporalSlice(2, 1), temporalSlice(1, 0)];

describe('Classic MR 显式时间维体积', () => {
  it('空间排序、时间顺序、源实例引用、像素和缓存均与各相一致，退出回到完整原图', async () => {
    const handle = await open(files());
    expect(handle.meta.planes).toHaveLength(6);
    expect(handle.temporal?.positions).toEqual([1, 2]);
    expect(planVolumeDownsample(handle.meta).ok).toBe(false);
    const store = useViewerStore.getState();
    store.setActiveSeries(handle);
    store.setLayoutMode('2x2');
    const one = useViewerStore.getState().activeSeriesHandle!;
    const two = one.temporal!.select(2);
    expect(one.meta.temporalPosition).toBe(1);
    const registry = new SeriesFrameRegistry();
    const idsOne = registry.register(one);
    const idsTwo = registry.register(two);
    expect(idsOne[0]).not.toBe(idsTwo[0]);
    expect((await registry.resolveFrame(idsOne[0]!)).pixelData[0]).toBe(80);
    expect((await registry.resolveFrame(idsTwo[0]!)).pixelData[0]).toBe(160);
    for (const phase of [one, two]) {
      const position = phase.meta.temporalPosition!;
      expect(phase.meta.planes.map(p => p.imagePositionPatient[2])).toEqual([0, 1, 2]);
      expect(phase.originalCandidates?.(0)[0]?.id).toBe(`slice-${position}-0`);
      expect(phase.originalCandidates?.()).toHaveLength(6);
      const outcome = await buildVolumeFromSeries(phase, { createWorker: null });
      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') throw new Error('应构建时相体积');
      expect(outcome.volume.volumeId).toContain(`/time/${position}`);
      expect(outcome.volume.scalarData[0]).toBe(position * 80);
      store.setMprVolume(outcome.volume);
      if (position === 1) {
        store.setActiveSeries(two);
        expect(useViewerStore.getState().mprVolume).toBeNull();
      }
    }
    store.setLayoutMode('volume-3d');
    expect(useViewerStore.getState().activeSeriesHandle).toBe(two);
    store.setLayoutMode('1x1');
    expect(useViewerStore.getState().activeSeriesHandle?.meta.planes).toHaveLength(6);
    store.reset();
  });

  it.each([
    ['某相缺少层', () => files().slice(1)],
    ['相间空间偏移', () => [...files().slice(1), temporalSlice(2, 2, { shift: 1 })]],
    ['回波变化', () => [...files().slice(1), temporalSlice(2, 2, { echo: 2 })]],
    ['部分缺时间标签', () => [...files().slice(1), temporalSlice(2, 2, { missingPosition: true })]],
    ['编号不连续', () => files().map(f => f.id.includes('slice-2') ? temporalSlice(3, Number(f.id.at(-1))) : f)],
    ['相内重复位置', () => [...files(), temporalSlice(1, 0)]],
  ] as const)('%s 不启用时相或混合重建，保留完整帧集合', async (_label, make) => {
    const candidates = make();
    const handle = await open(candidates);
    expect(handle.temporal).toBeUndefined();
    expect(planVolumeDownsample(handle.meta).ok).toBe(false);
    expect(handle.meta.planes).toHaveLength(candidates.length);
    expect(handle.warnings.at(-1)?.message).toContain('时相');
    handle.dispose();
  });
});
