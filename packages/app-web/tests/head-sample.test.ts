import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PixelCodec } from '@opendicomviewer/codec-wasm';
import { LocalDataSource } from '@opendicomviewer/source-local';
import { planVolumeDownsample, rawToHU } from '@opendicomviewer/core';
import { describeSliceOrientation } from '../src/components/slice-geometry';

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
});
