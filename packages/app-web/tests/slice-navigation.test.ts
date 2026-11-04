import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CineController } from '../src/components/cine-controller';
import {
  DRAGGABLE_SLIDER_MAX_FRAMES,
  clampLayer,
  hasSliceNavigation,
  isDraggableSlider,
  nextLayerIndex,
  parseLayerInput,
  queueLayerNavigation,
} from '../src/components/slice-navigation';

describe('切片导航纯逻辑（ui-spec §3.3）', () => {
  it('连续五次相对翻页排队后全部执行，从第 49 层到第 54 层', async () => {
    let index = 48;
    let chain = Promise.resolve();
    const enqueue = (task: () => Promise<void>) => { chain = chain.then(task); };
    for (let n = 0; n < 5; n++) queueLayerNavigation({
      enqueue, isCurrent: () => true, readIndex: () => index, request: { delta: 1 }, total: 96,
      apply: async (_current, target) => { await Promise.resolve(); index = target; },
    });
    await chain;
    expect(index + 1).toBe(54);
  });

  it('排队期间切换序列后不再读取或移动旧视口', async () => {
    let queued: (() => Promise<void>) | undefined;
    let applied = false;
    queueLayerNavigation({ enqueue: (task) => { queued = task; }, isCurrent: () => false,
      readIndex: () => { throw new Error('旧视口不应被读取'); }, request: { delta: 1 }, total: 96,
      apply: async () => { applied = true; },
    });
    await queued?.();
    expect(applied).toBe(false);
  });
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


describe('2D Cine 串行播放', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup(index = 0, total = 3) {
    const frame = { index, total };
    const show = vi.fn(async (next: number) => { frame.index = next; });
    const onPlayingChange = vi.fn(); const onError = vi.fn();
    const player = new CineController({ read: () => frame, show, onPlayingChange, onError });
    return { frame, show, onPlayingChange, onError, player };
  }
  it('非循环到末帧停止，再播从首帧开始', async () => {
    const { frame, show, player, onPlayingChange } = setup();
    player.play(); await vi.advanceTimersByTimeAsync(100);
    expect(frame.index).toBe(2); expect(player.playing).toBe(false);
    expect(show.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(onPlayingChange.mock.calls.map(call => call[0])).toEqual([true, false]);
    player.play(); await vi.advanceTimersByTimeAsync(0);
    expect(frame.index).toBe(0); player.destroy();
  });
  it('循环模式回到首帧，暂停后不再推进', async () => {
    const { frame, show, player } = setup(2);
    player.setLoop(true); player.play(); await vi.advanceTimersByTimeAsync(300);
    expect(show.mock.calls.map(call => call[0])).toEqual([0, 1, 2, 0]);
    player.pause(); await vi.advanceTimersByTimeAsync(1000);
    expect(frame.index).toBe(0); expect(player.playing).toBe(false);
  });
  it('慢解码只保留一个在途任务，暂停不会追加旧帧请求', async () => {
    let finish: () => void = () => { throw new Error('尚未开始'); };
    const show = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const player = new CineController({ read: () => ({ index: 0, total: 5 }), show,
      onPlayingChange: vi.fn(), onError: vi.fn() });
    player.play(); await vi.advanceTimersByTimeAsync(2000);
    expect(show).toHaveBeenCalledTimes(1);
    player.pause(); finish(); await vi.advanceTimersByTimeAsync(2000);
    expect(show).toHaveBeenCalledTimes(1);
  });
  it('解码失败停止并上报，不静默跳帧', async () => {
    const error = new Error('解码失败'); const onError = vi.fn();
    const show = vi.fn(async () => { throw error; });
    const player = new CineController({ read: () => ({ index: 0, total: 5 }), show,
      onPlayingChange: vi.fn(), onError });
    player.play(); await vi.advanceTimersByTimeAsync(2000);
    expect(player.playing).toBe(false); expect(show).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
  it('fps 限定播放速度，单帧不启动，销毁后不能重启', async () => {
    const { player, show, frame } = setup(0, 1);
    expect(() => player.setFps(0)).toThrow(); expect(() => player.setFps(61)).toThrow();
    expect(() => player.setFps(2.5)).toThrow();
    player.play(); await vi.advanceTimersByTimeAsync(1000); expect(show).not.toHaveBeenCalled();
    frame.total = 5; player.setFps(5); player.play();
    await vi.advanceTimersByTimeAsync(199); expect(show).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(show).toHaveBeenCalledTimes(2);
    player.destroy(); player.play(); await vi.advanceTimersByTimeAsync(1000);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it('时钟触发前会话/首页许可变更不会读取或修改新视口', async () => {
    let allowed = true;
    const read = vi.fn(() => ({ index: 0, total: 5 })); const show = vi.fn(async () => {});
    const onError = vi.fn();
    const player = new CineController({ read, show, allowed: () => allowed, onPlayingChange: vi.fn(), onError });
    player.play(); read.mockClear(); allowed = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled(); expect(show).not.toHaveBeenCalled();
    expect(player.playing).toBe(false); expect(onError).not.toHaveBeenCalled();
  });

  it('帧索引失效时明确失败，停止后不保留旧时钟', async () => {
    const { frame, player, show, onError } = setup();
    player.play(); frame.index = 99; await vi.advanceTimersByTimeAsync(0);
    expect(player.playing).toBe(false); expect(onError).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });
});
