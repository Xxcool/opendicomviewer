import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PixelCodec } from '@opendicomviewer/codec-wasm';
import { LocalDataSource } from '@opendicomviewer/source-local';
import { planVolumeDownsample, rawToHU } from '@opendicomviewer/core';
import { describeSliceOrientation } from '../src/components/slice-geometry';
import { buildVolumeFromSeries } from '../src/bridge/volume-builder';
import { LAYOUTS, moveAlongAxis, moveToStackSlice, orthographicPanes, volumeCenter } from '../src/layout/viewport-layouts';
import { useViewerStore } from '../src/state/viewer-store';

describe('实际头部矢状面教学 DICOM', () => {
  it('通过真实导入和解码链路打开，保留像素、灰度和几何，不伪装成轴位或可 MPR 体积', async () => {
    const file = new URL('../../../sample-dicom/brain-head-mr/head-sagittal.dcm', import.meta.url);
    const bytes = await readFile(file);
    const provenance = JSON.parse(await readFile(new URL('../../../sample-dicom/brain-head-mr/provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.outputSha256);
    const source = new LocalDataSource(new PixelCodec());
    const studies = await source.probe({ files: [{
      id: 'brain-head-mr/head-sagittal.dcm', name: 'head-sagittal.dcm', size: bytes.length,
      read: async (start = 0, end = bytes.length) => {
        const chunk = bytes.subarray(start, end);
        const buffer = new ArrayBuffer(chunk.length);
        new Uint8Array(buffer).set(chunk);
        return buffer;
      },
    }] });
    expect(studies).toHaveLength(1);
    expect(source.importOutcome().failures).toEqual([]);
    const series = await source.listSeries();
    expect(series).toHaveLength(1);
    const handle = await source.openSeries(series[0]!);
    try {
      expect(handle.meta.modality).toBe('MR');
      expect(handle.meta.planes).toHaveLength(1);
      expect(handle.meta.planes[0]?.imageOrientationPatient).toEqual([0, 1, 0, 0, 0, -1]);
      expect(handle.meta.planes[0]?.imagePositionPatient).toEqual([0, -96, 114]);
      expect(handle.meta.planes[0]?.hasMissingGeometry).not.toBe(true);
      expect(handle.meta.planes[0]?.pixelSpacing).toEqual([1, 1]);
      expect(describeSliceOrientation(handle.meta.planes[0]?.imageOrientationPatient).label).toBe('矢状面 (Sagittal)');
      const frame = await handle.pixel(0);
      expect([frame.width, frame.height]).toEqual([229, 193]);
      expect(frame.defaultVOI).toEqual({ windowWidth: 100, windowCenter: 50 });
      expect(frame.pixelData[0]).toBe(-31640);
      expect(frame.pixelData[114 + 229 * 96]).toBe(-7733);
      expect(rawToHU(frame.pixelData[85 + 229 * 80]!, frame.rescaleSlope, frame.rescaleIntercept)).toBeCloseTo(41.32324, 3);
      expect(planVolumeDownsample(handle.meta).ok).toBe(false);
    } finally { handle.dispose(); }
  });

  it('默认载入真实的 193 层连续序列，能构建体积并保留 2×2 / 准星翻层坐标链路', async () => {
    const folder = new URL('../../../sample-dicom/brain-head-mr/', import.meta.url);
    const provenance = JSON.parse(await readFile(new URL('provenance.json', folder), 'utf8'));
    const files = await Promise.all((await readdir(folder)).filter((name) => name.endsWith('.dcm')).sort().map(async (name) => {
      const bytes = await readFile(new URL(name, folder));
      if (name.startsWith('head-axial-')) {
        const record = provenance.axialVolume.files.find((item: { file: string }) => item.file === name);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
      }
      return { id: `brain-head-mr/${name}`, name, size: bytes.length,
        read: async (start = 0, end = bytes.length) => Uint8Array.from(bytes.subarray(start, end)).buffer };
    }));
    const source = new LocalDataSource(new PixelCodec());
    await source.probe({ files });
    expect(source.importOutcome().failures).toEqual([]);
    const series = await source.listSeries();
    // 与导入流程一样打开首序列，防止参考单图抢占默认入口。
    expect(series.map((item) => item.numberOfFrames)).toEqual([193, 1]);
    const handle = await source.openSeries(series[0]!);
    useViewerStore.getState().reset();
    try {
      const plan = planVolumeDownsample(handle.meta);
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.message);
      expect(plan.plan.sourceDimensions).toEqual([193, 229, 193]);
      expect(plan.plan.spacing).toEqual([1, 1, 1]);
      expect(plan.plan.origin).toEqual([-96, -96, -78]);
      expect(plan.plan.direction).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const frame = await handle.pixel(112);
      expect(frame.pixelData[96 + 193 * 85]).toBe(-5455); // 与矢状面参考图的同一体素一致。
      const result = await buildVolumeFromSeries(handle, { createWorker: null, maxDim: 128 });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') throw new Error('实际头部体积构建失败');
      const volume = result.volume;
      expect(volume.dimensions).toEqual([96, 114, 96]);
      expect(volume.spacing).toEqual([2, 2, 2]);
      expect(volume.origin).toEqual([-95.5, -95.5, -77.5]);
      expect(volume.scalarData[48 + 96 * (57 + 114 * 48)]).toBe(155); // 源 NIfTI 八体素平均，重标定后 60.1514433。
      expect(volume.displayOnly).toBe(true);
      const center = volumeCenter(volume);
      expect(center).toEqual([-0.5, 17.5, 17.5]);
      expect(moveAlongAxis(volume, center, 2, 1)).toEqual([-0.5, 17.5, 19.5]);
      expect(moveToStackSlice(center, handle.meta.planes, 96, 98)).toEqual([-0.5, 17.5, 19.5]);
      for (const mode of ['2x2', '1+3'] as const) {
        const state = useViewerStore.getState();
        state.setLayoutMode(mode);
        state.setActiveSeries(handle);
        expect(useViewerStore.getState().layoutMode).toBe(mode);
        expect(orthographicPanes(LAYOUTS[mode]).map((pane) => pane.axis)).toEqual([2, 1, 0]);
      }
    } finally { useViewerStore.getState().reset(); }
  });
});
