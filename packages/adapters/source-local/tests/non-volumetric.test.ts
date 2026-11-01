import { describe, expect, it } from 'vitest';
import { planVolumeDownsample, type ImportCandidate } from '@opendicomviewer/core';
import { LocalDataSource } from '../src/source-local';
import { parseDicomMetadata } from '../src/parse';
import { buildDicomBuffer } from '../testing/dicom-fixture';

const SC_UID = '1.2.840.10008.5.1.4.1.1.7';
function candidate(id: string, bytes: Uint8Array): ImportCandidate {
  return { id, name: id, size: bytes.byteLength, async read(start = 0, end = bytes.length) {
    return bytes.slice(start, end).buffer;
  } };
}
function secondary() {
  return buildDicomBuffer({ sopClassUid: SC_UID, sopInstanceUid: '1.2.3.2',
    omitImagePositionPatient: true, omitImageOrientationPatient: true, omitPixelSpacing: true,
    rows: 2, columns: 2, bitsAllocated: 8, bitsStored: 8, pixelData: new Uint8Array([0, 64, 128, 255]),
    windowCenter: 128, windowWidth: 256,
  });
}

describe('定位像与二次采集图像的完整二维导入', () => {
  it('SC 类别、缺失几何与缺失间距跨解析边界保留，不把占位网格当真实几何', () => {
    const { plane } = parseDicomMetadata(secondary(), { id: 'sc' });
    expect(plane).toMatchObject({ sopClassUid: SC_UID, hasMissingGeometry: true, hasMissingPixelSpacing: true });
    expect(plane.imageType).toBeUndefined();
  });

  it('原始定位像 + 无几何 SC：两张像素均可读取，保留各自文件窗，禁止 MPR', async () => {
    const originalPixels = new Uint16Array([0, 1024, 2048, 4095]);
    const raw = buildDicomBuffer({ sopInstanceUid: '1.2.3.1', rows: 2, columns: 2,
      imageOrientationPatient: [0, 1, 0, 0, 0, -1], pixelSpacing: [0.68, 0.68],
      bitsAllocated: 16, bitsStored: 12, pixelData: new Uint8Array(originalPixels.buffer),
      windowCenter: -932, windowWidth: 138,
      extraElements: [{ tag: [0x0008, 0x0008], vr: 'CS', value: 'ORIGINAL\\PRIMARY\\LOCALIZER' }],
    });
    const source = new LocalDataSource();
    const studies = await source.probe({ files: [candidate('original', raw), candidate('secondary', secondary())] });
    const study = studies[0]!;
    const series = await source.listSeries(study.studyInstanceUid);
    const handle = await source.openSeries({ studyInstanceUid: study.studyInstanceUid, seriesInstanceUid: series[0]!.seriesInstanceUid });
    expect(handle.meta.planes.map(plane => plane.imageId)).toEqual(['original', 'secondary']);
    expect(handle.meta.numberOfFrames).toBe(2);
    expect(handle.meta.excludedPlanes).toEqual([]);
    expect(handle.warnings.some(warning => warning.severity === 'error' || warning.code === 'MISSING_GEOMETRY')).toBe(false);
    expect(handle.warnings).toContainEqual(expect.objectContaining({ code: 'NON_VOLUMETRIC_SERIES', severity: 'info' }));
    expect((await handle.pixel(0)).pixelData).toEqual(originalPixels);
    expect((await handle.pixel(1)).pixelData).toEqual(new Uint8Array([0, 64, 128, 255]));
    expect((await handle.pixel(0)).defaultVOI).toEqual({ windowCenter: -932, windowWidth: 138 });
    expect((await handle.pixel(1)).defaultVOI).toEqual({ windowCenter: 128, windowWidth: 256 });
    expect(planVolumeDownsample(handle.meta)).toMatchObject({ ok: false, code: 'NON_VOLUMETRIC_SERIES' });
    handle.dispose();
  });
});
