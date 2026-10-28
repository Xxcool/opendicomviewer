import { describe, expect, it } from 'vitest';
import {
  DRAGGABLE_SLIDER_MAX_FRAMES,
  clampLayer,
  hasSliceNavigation,
  isDraggableSlider,
  nextLayerIndex,
  parseLayerInput,
} from '../src/components/slice-navigation';

describe('切片导航纯逻辑（ui-spec §3.3）', () => {
  describe('hasSliceNavigation / isDraggableSlider', () => {
    it('单帧序列不显示翻页控件', () => {
      expect(hasSliceNavigation(1)).toBe(false);
      expect(hasSliceNavigation(0)).toBe(false);
      expect(isDraggableSlider(1)).toBe(false);
    });

    it('多帧序列显示导航，且小序列才能拖进度条', () => {
      expect(hasSliceNavigation(2)).toBe(true);
      expect(isDraggableSlider(200)).toBe(true);
      // 关键边界：201 帧起进度条降级为只读——1 像素拖动跨多层，精确不到具体层
      expect(isDraggableSlider(DRAGGABLE_SLIDER_MAX_FRAMES + 1)).toBe(false);
      expect(isDraggableSlider(1024)).toBe(false);
    });
  });

  describe('clampLayer', () => {
    it('越界钳到 [0, total-1]', () => {
      expect(clampLayer(-5, 36)).toBe(0);
      expect(clampLayer(9999, 36)).toBe(35);
      expect(clampLayer(12, 36)).toBe(12);
    });

    it('非法输入退到 0，绝不返回负索引', () => {
      expect(clampLayer(Number.NaN, 36)).toBe(0);
      expect(clampLayer(10, 0)).toBe(0);
      expect(clampLayer(10, Number.NaN)).toBe(0);
    });
  });

  describe('parseLayerInput', () => {
    it('1-based 输入转 0-based 索引', () => {
      expect(parseLayerInput('1', 36)).toBe(0);
      expect(parseLayerInput('36', 36)).toBe(35);
    });

    it('数字越界钳到 [1, N]，不算非法', () => {
      expect(parseLayerInput('9999', 36)).toBe(35);
      expect(parseLayerInput('0', 36)).toBe(0);
    });

    it('非纯数字视为非法，返回 null 由调用方恢复原值', () => {
      expect(parseLayerInput('', 36)).toBeNull();
      expect(parseLayerInput('  ', 36)).toBeNull();
      expect(parseLayerInput('abc', 36)).toBeNull();
      expect(parseLayerInput('3.5', 36)).toBeNull();
      expect(parseLayerInput('-2', 36)).toBeNull();
    });

    it('前后空格不影响解析', () => {
      expect(parseLayerInput(' 12 ', 36)).toBe(11);
    });
  });

  describe('nextLayerIndex', () => {
    it('步长 1 与步长 10 都在边界处收敛', () => {
      expect(nextLayerIndex(5, 1, 36)).toBe(6);
      expect(nextLayerIndex(5, 10, 36)).toBe(15);
      // Shift+滚轮 到位：末尾不会越过最后一帧
      expect(nextLayerIndex(30, 10, 36)).toBe(35);
      expect(nextLayerIndex(3, -10, 36)).toBe(0);
      expect(nextLayerIndex(0, -1, 36)).toBe(0);
    });
  });
});
