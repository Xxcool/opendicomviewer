import { expect, it, vi } from 'vitest';
import { Cs3dViewportAdapter } from '../src/bridge/cs3d-adapter';

it('适配以当前切面为准并保留 10% 边缘，不把 MPR 跳回中心层', () => {
  const resetCamera = vi.fn();
  const setZoom = vi.fn();
  // @ts-expect-error 只注入适配涉及的 CS3D 相机端口。
  const adapter = new Cs3dViewportAdapter({ resetCamera, setZoom });
  adapter.resetCamera();
  expect(resetCamera).toHaveBeenCalledWith({ resetToCenter: false });
  expect(setZoom).toHaveBeenCalledWith(0.9);
  expect(resetCamera.mock.invocationCallOrder[0]).toBeLessThan(setZoom.mock.invocationCallOrder[0]!);
});
