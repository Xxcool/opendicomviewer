import { describe, it, expect, vi } from 'vitest';
import type { ImagePlane, PixelFrame, SeriesHandle } from '@opendicomviewer/core';
import {
  computeMinMax,
  buildImagePlaneModule,
  registerCs3dBridge,
} from '../src/bridge/cs3d-bridge';
import { fileToImportCandidate } from '../src/bridge/candidate';
import * as cs3d from '@cornerstonejs/core';

describe('cs3d-bridge & candidate utilities', () => {
  describe('computeMinMax', () => {
    it('正确计算像素数组的极值', () => {
      const data = new Int16Array([-1000, 0, 45, 1200, -20]);
      const [min, max] = computeMinMax(data);
      expect(min).toBe(-1000);
      expect(max).toBe(1200);
    });

    it('空数组返回 [0, 0]', () => {
      const data = new Uint8Array(0);
      const [min, max] = computeMinMax(data);
      expect(min).toBe(0);
      expect(max).toBe(0);
    });
  });

  describe('buildImagePlaneModule', () => {
    it('正确解构 IOP 余弦方向与物理间距', () => {
      const plane: ImagePlane = {
        imageId: 'slice1',
        sopInstanceUid: '1.2.3.4.5',
        imagePositionPatient: [-150, -120, 10],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        pixelSpacing: [0.75, 0.75],
        sliceThickness: 2.5,
        spacingBetweenSlices: 2.5,
        rows: 512,
        columns: 512,
      };

      const module = buildImagePlaneModule(plane, '1.2.3.4');
      expect(module.imagePositionPatient).toEqual([-150, -120, 10]);
      expect(module.rowCosines).toEqual([1, 0, 0]);
      expect(module.columnCosines).toEqual([0, 1, 0]);
      expect(module.pixelSpacing).toEqual([0.75, 0.75]);
      expect(module.rowPixelSpacing).toBe(0.75);
      expect(module.columnPixelSpacing).toBe(0.75);
      expect(module.frameOfReferenceUID).toBe('1.2.3.4');
    });
  });

  describe('fileToImportCandidate', () => {
    it('封装 File 并支持全量和分段 Range 读取', async () => {
      const content = new Uint8Array([0x44, 0x49, 0x43, 0x4d, 0x01, 0x02, 0x03, 0x04]);
      // Node 20+ supports global File / Blob
      const file = new File([content], 'test.dcm', { type: 'application/dicom' });

      const candidate = fileToImportCandidate(file);
      expect(candidate.name).toBe('test.dcm');
      expect(candidate.size).toBe(8);

      // 全量读取
      const fullBuf = await candidate.read();
      expect(new Uint8Array(fullBuf)).toEqual(content);

      // 分段 Range 读取
      const sliceBuf = await candidate.read(0, 4);
      expect(new Uint8Array(sliceBuf)).toEqual(new Uint8Array([0x44, 0x49, 0x43, 0x4d]));
    });

    it('响应 AbortSignal 中止信号', async () => {
      const file = new File(['content'], 'test.dcm');
      const candidate = fileToImportCandidate(file);

      const controller = new AbortController();
      controller.abort();

      await expect(candidate.read(0, 4, controller.signal)).rejects.toThrow('读取已中断');
    });
  });

  describe('registerCs3dBridge', () => {
    it.each([
      { name: 'CT 水与空气', frame: { width: 2, height: 2, pixelData: new Uint16Array([0, 1024, 1029, 4095]), rescaleIntercept: -1024 }, expected: [-1024, 0, 5, 3071], copied: true },
      { name: 'Modality LUT 优先于线性缩放', frame: { width: 2, height: 2, pixelData: new Uint16Array([0, 1, 2, 3]), rescaleSlope: 100,
        modalityLUT: { firstMappedPixelValue: 0, bitsStored: 16, lutData: [10, 20, 40, 80] } }, expected: [10, 20, 40, 80], copied: true },
      { name: '恒等变换保留缓冲', frame: { width: 2, height: 2, pixelData: new Uint16Array([0, 10, 20, 30]) }, expected: [0, 10, 20, 30], copied: false },
    ])('$name 的显示标量正确且不重复换算', async ({ frame, expected, copied }) => {
      const fake = { frameRegistry: {
        lookup: () => ({ handle: { meta: { modality: 'CT', planes: [] } }, frameIndex: 0 }),
        resolveFrame: async () => frame,
      } };
      // @ts-expect-error 仅注入加载器需要的帧登记端口。
      const bridge = registerCs3dBridge(fake);
      try {
        const image = await cs3d.imageLoader.loadImage('odv://bridge-transform-test#0');
        expect(Array.from(image.getPixelData())).toEqual(expected);
        expect(image.getPixelData() === frame.pixelData).toBe(!copied);
        expect([image.slope, image.intercept]).toEqual([1, 0]);
      } finally { bridge.unregister(); }
    });

    it('真正 loader 输出已重标定的显示缓冲，物理窗不再把头部截为黑白，原始帧不变', async () => {
      const raw = new Int16Array([-7733, -5455, 0, 32767]);
      const pixel: PixelFrame = { width: 2, height: 2, pixelData: raw,
        rescaleSlope: 0.001513414551, rescaleIntercept: 49.57891846,
        defaultVOI: { windowWidth: 100, windowCenter: 50 } };
      const fake = { frameRegistry: {
        lookup: () => ({ handle: { meta: { modality: 'MR', planes: [] } }, frameIndex: 0 }),
        resolveFrame: async () => pixel,
      } };
      // @ts-expect-error 仅注入加载器需要的帧登记端口。
      const bridge = registerCs3dBridge(fake);
      try {
        const image = await cs3d.imageLoader.loadImage('odv://bridge-rescale-test#0');
        expect(image.getPixelData()).toBeInstanceOf(Float32Array);
        expect(image.getPixelData()[1]).toBeCloseTo(41.32324, 4);
        expect(image.getPixelData()[2]).toBeCloseTo(49.578918, 4);
        expect(image.preScale?.scaled).toBe(true);
        expect([image.slope, image.intercept]).toEqual([1, 0]);
        expect(image.windowWidth).toBe(100);
        expect(image.windowCenter).toBe(50);
        expect(image.minPixelValue).toBeCloseTo(37.8756737, 4);
        expect(raw).toEqual(new Int16Array([-7733, -5455, 0, 32767]));
      } finally { bridge.unregister(); }
    });

    it('注册元数据提供程序与 imageLoader 回调', async () => {
      const mockPixelFrame: PixelFrame = {
        width: 2,
        height: 2,
        pixelData: new Int16Array([0, 10, 20, 30]),
        rescaleSlope: 1,
        rescaleIntercept: -1024,
      };

      const mockPlane: ImagePlane = {
        imageId: 'frame1',
        sopInstanceUid: '1.2.3.4',
        imagePositionPatient: [0, 0, 0],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        pixelSpacing: [1, 1],
        rows: 2,
        columns: 2,
        windowWidth: 400,
        windowCenter: 40,
      };

      const mockHandle: SeriesHandle = {
        meta: {
          studyInstanceUid: 'study-1',
          seriesInstanceUid: 'series-1',
          seriesDescription: 'Test Series',
          modality: 'CT',
          numberOfFrames: 1,
          planes: [mockPlane],
          spacing: [1, 1, 1],
          warnings: [],
        },
        warnings: [],
        pixel: vi.fn().mockResolvedValue(mockPixelFrame),
        dispose: vi.fn(),
      };

      // 假渲染器 mock
      const mockRenderer = {
        frameRegistry: {
          lookup: vi.fn().mockReturnValue({ handle: mockHandle, frameIndex: 0 }),
          resolveFrame: vi.fn().mockResolvedValue(mockPixelFrame),
        },
      };

      // @ts-expect-error mock renderer
      const bridge = registerCs3dBridge(mockRenderer);
      expect(typeof bridge.unregister).toBe('function');
      try {
        const image = await cs3d.imageLoader.loadImage('odv://bridge-meta-window#0');
        expect([image.windowWidth, image.windowCenter]).toEqual([400, 40]);
      } finally { bridge.unregister(); }
    });
  });
});
