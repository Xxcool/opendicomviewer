import { describe, it, expect, vi } from 'vitest';
import type { ImagePlane, PixelFrame, SeriesHandle } from '@opendicomviewer/core';
import {
  computeMinMax,
  buildImagePlaneModule,
  registerCs3dBridge,
} from '../src/bridge/cs3d-bridge';
import { fileToImportCandidate } from '../src/bridge/candidate';

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
      bridge.unregister();
    });
  });
});
