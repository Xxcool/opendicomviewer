import { describe, expect, it } from 'vitest';
import type { ImagePlane, SeriesMeta } from '@opendicomviewer/core';
import { describeSeriesImages } from '../src/components/image-presentation';

function meta(overrides: Partial<ImagePlane> = {}): SeriesMeta {
  return { seriesInstanceUid: 'test', studyInstanceUid: 'test', modality: 'CT', seriesDescription: '',
    numberOfFrames: 3, spacing: [0.68, 0.68, 2], warnings: [],
    planes: [0, 2, 4].map(z => ({ imageId: String(z), sopInstanceUid: String(z), rows: 2, columns: 2,
      imagePositionPatient: [0, 0, z], imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      pixelSpacing: [0.68, 0.68], ...overrides })),
  };
}

describe('物理信息展示边界', () => {
  it('正常断层显示真实毫米间距与方向', () => {
    expect(describeSeriesImages(meta())).toMatchObject({ physicalScale: true, pixelSpacing: '0.68 × 0.68 mm', layerSpacing: '2.00 mm', orientation: { label: '横断面 (Axial)' } });
  });
  it('定位像不显示假的层间距或断面方位，不开放毫米标尺', () => {
    expect(describeSeriesImages(meta({ imageType: ['ORIGINAL', 'PRIMARY', 'LOCALIZER'] }))).toMatchObject({
      physicalScale: false, layerSpacing: '不适用（二维影像）', orientation: { label: '定位像 / 二次采集（二维）', top: '', left: '' },
    });
  });
  it('SC 占位 1×1 间距不能呈现为毫米，单帧断层的占位层距也不呈现', () => {
    const single = meta({ sopClassUid: '1.2.840.10008.5.1.4.1.1.7', hasMissingPixelSpacing: true, pixelSpacing: [1, 1] });
    expect(describeSeriesImages(single)).toMatchObject({ physicalScale: false, pixelSpacing: '部分影像未提供或无效', layerSpacing: '不适用（二维影像）' });
    const slice = meta();
    expect(describeSeriesImages({ ...slice, planes: slice.planes.slice(0, 1), spacing: [0.68, 0.68, 1] }).layerSpacing).toBeUndefined();
  });
});
