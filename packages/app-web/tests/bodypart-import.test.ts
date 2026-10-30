import { expect, it } from 'vitest';
import { LocalDataSource } from '@opendicomviewer/source-local';
import { PixelCodec } from '@opendicomviewer/codec-wasm';
import { getWindowPresets } from '@opendicomviewer/core';
import { buildDicomBuffer } from '../../adapters/source-local/testing/dicom-fixture';
it('真实 DICOM 部位标签经解析、扫描、打开序列后决定预设组', async () => {
  const bytes = buildDicomBuffer({ modality: 'CT', pixelData: new Uint8Array(8), rows:2, columns:2,
    extraElements: [{tag:[0x18,0x15],vr:'CS',value:'HEAD'}] });
  const source = new LocalDataSource(new PixelCodec());
  await source.probe({files:[{id:'head.dcm',name:'head.dcm',size:bytes.length,read:async(start=0,end=bytes.length)=>Uint8Array.from(bytes.subarray(start,end)).buffer}]});
  const handle = await source.openSeries((await source.listSeries())[0]!);
  try {
    expect(handle.meta.planes[0]?.bodyPartExamined).toBe('HEAD');
    expect(getWindowPresets(handle.meta).map(p=>p.name)).toEqual(['脑窗','骨窗','卒中窗']);
    expect((await handle.pixel(0)).pixelData.length).toBe(4);
  } finally {handle.dispose();}
});
