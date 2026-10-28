/**
 * 序列帧登记表
 *
 * 职责：把 `SeriesHandle` 映射成 CS3D 认识的 imageId 列表，并在 CS3D 的
 * 自定义 imageLoader 回调里按 imageId 反查回 `handle.pixel(index)`。
 *
 * 这一层刻意做成纯逻辑（无 DOM、无 CS3D），因此可以在 Node 里直接单测——
 * 「imageId 生成与反查是否自洽」是渲染层最容易写错又最难在浏览器里定位的一环。
 */

import type { PixelFrame, SeriesHandle } from '@opendicomviewer/core';
import { parseImageId, toImageId } from './image-id';

export interface FrameRef {
  readonly handle: SeriesHandle;
  readonly frameIndex: number;
}

export class SeriesFrameRegistry {
  private readonly frames = new Map<string, FrameRef>();
  private readonly imageIdsBySeries = new Map<string, string[]>();

  /**
   * 登记一条序列，返回按 `meta.planes` 顺序排列的 imageId 数组。
   *
   * 注意：这里用 `meta.planes.length` 而不是 `meta.numberOfFrames`。
   * 前者是"已排序、可渲染"的切片集合长度，后者是序列声明的总帧数；
   * 二者在存在 `excludedPlanes` 时并不相等，拿错的会得到越界索引。
   */
  register(handle: SeriesHandle): readonly string[] {
    const seriesUid = handle.meta.seriesInstanceUid;
    if (!seriesUid) {
      throw new Error('无法登记序列：meta.seriesInstanceUid 为空');
    }

    const count = handle.meta.planes.length;
    const imageIds: string[] = [];
    for (let index = 0; index < count; index++) {
      const imageId = toImageId(seriesUid, index);
      imageIds.push(imageId);
      this.frames.set(imageId, { handle, frameIndex: index });
    }

    this.imageIdsBySeries.set(seriesUid, imageIds);
    return imageIds;
  }

  /** CS3D imageLoader 回调：imageId → 已解码帧 */
  async resolveFrame(imageId: string): Promise<PixelFrame> {
    const ref = this.frames.get(imageId);
    if (!ref) {
      // 不做"返回空白帧"的兜底：那会让一整条序列看起来正常但全是黑的
      throw new Error(`未登记的 imageId：${imageId}`);
    }
    return ref.handle.pixel(ref.frameIndex);
  }

  /** 仅做登记信息查询，不触发解码 */
  lookup(imageId: string): FrameRef | null {
    const ref = this.frames.get(imageId);
    if (ref) return ref;

    // 兼容"未登记但格式合法"的情况：用于断言 id 约定自洽，不做数据兜底
    return null;
  }

  imageIdsOf(seriesInstanceUid: string): readonly string[] {
    return this.imageIdsBySeries.get(seriesInstanceUid) ?? [];
  }

  release(seriesInstanceUid: string): void {
    const imageIds = this.imageIdsBySeries.get(seriesInstanceUid);
    if (!imageIds) return;
    for (const id of imageIds) {
      this.frames.delete(id);
    }
    this.imageIdsBySeries.delete(seriesInstanceUid);
  }

  clear(): void {
    this.frames.clear();
    this.imageIdsBySeries.clear();
  }

  get size(): number {
    return this.frames.size;
  }

  /** 供自定义 loader 判断"这个 imageId 是否归本渲染器管" */
  owns(imageId: string): boolean {
    return this.frames.has(imageId) || parseImageId(imageId) !== null;
  }
}
