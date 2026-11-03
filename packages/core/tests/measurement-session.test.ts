import { describe, expect, it, vi } from 'vitest';
import type { MeasurementRecord } from '../domain/types';
import { MeasurementSession } from '../measurement/session';

function record(id = 'a', seriesInstanceUid = 'series'): MeasurementRecord {
  return { id, seriesInstanceUid, sopInstanceUid: `sop-${id}`, type: 'length',
    points: [[0, 0, 0], [3, 4, 0]], stats: { lengthMm: 5 }, createdAt: 1, text: '备注' };
}

function setup() {
  const onError = vi.fn();
  return { session: new MeasurementSession(onError), onError };
}

describe('会话内标注真源', () => {
  it('增改删按 ID 定位，过滤和按序列清空不影响其他序列', () => {
    const { session } = setup();
    session.add(record()); session.add(record('b', 'other'));
    session.update({ ...record(), text: '已修改' });
    expect(session.list('series')).toEqual([{ ...record(), text: '已修改' }]);
    session.clear('series');
    expect(session.list()).toEqual([record('b', 'other')]);
    session.undo();
    expect(session.list()).toHaveLength(2);
    session.remove('b');
    expect(session.list()).toEqual([{ ...record(), text: '已修改' }]);
    session.clear();
    expect(session.list()).toEqual([]);
    session.undo();
    expect(session.list()).toEqual([{ ...record(), text: '已修改' }]);
  });

  it('输入、返回列表、控制点与统计均无法外部改写历史', () => {
    const { session } = setup();
    const input = record();
    session.add(input);
    input.points[0]![0] = 99;
    expect(session.list()[0]!.points[0]![0]).toBe(0);
    const output = session.list()[0]!;
    expect(Object.isFrozen(session.list())).toBe(true);
    expect(Object.isFrozen(session.list('series'))).toBe(true);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.points)).toBe(true);
    expect(Object.isFrozen(output.stats)).toBe(true);
    expect(() => { output.points[0]![0] = 123; }).toThrow();
    session.remove('a'); session.undo();
    expect(session.list()[0]!.points[0]![0]).toBe(0);
  });

  it('撤销重做与保存点比较实际内容，新修改清除重做分支', () => {
    const { session } = setup();
    expect(session.isDirty).toBe(false);
    expect(session.undo()).toBe(false);
    expect(session.redo()).toBe(false);
    session.add(record()); session.markSaved();
    session.update({ ...record(), text: '新文字' });
    expect(session.isDirty).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.isDirty).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.isDirty).toBe(true);
    session.undo(); session.add(record('b'));
    expect(session.canRedo).toBe(false);
    expect(session.redo()).toBe(false);
    session.remove('b');
    expect(session.isDirty).toBe(false);
  });

  it('no-op 不新增历史、不广播、不破坏重做分支', () => {
    const { session } = setup();
    const notified = vi.fn(); session.subscribe(notified);
    session.add(record()); session.add(record('b')); session.undo();
    notified.mockClear();
    session.update({ ...record(), stats: { lengthMm: 5 } });
    session.remove('missing'); session.clear('missing');
    expect(notified).not.toHaveBeenCalled();
    expect(session.canRedo).toBe(true);
    session.undo();
    expect(session.list()).toEqual([]);
    expect(session.canUndo).toBe(false);
  });

  it('重复 ID、未知更新与非法数据在提交前失败，不更改历史或保存点', () => {
    const { session } = setup();
    session.add(record()); session.add(record('b')); session.undo(); session.markSaved();
    const before = session.list(); const notified = vi.fn(); session.subscribe(notified);
    expect(() => session.add(record())).toThrow('已存在');
    expect(() => session.update(record('missing'))).toThrow('不存在');
    expect(() => session.add({ ...record('c'), id: ' ' })).toThrow();
    expect(() => session.add({ ...record('c'), points: [[NaN, 0, 0]] })).toThrow();
    expect(() => session.update({ ...record(), stats: { lengthMm: Infinity } })).toThrow();
    expect(() => session.update({ ...record(), points: [] })).toThrow();
    expect(() => session.update({ ...record(), createdAt: NaN })).toThrow();
    expect(session.list()).toBe(before);
    expect(session.isDirty).toBe(false);
    expect(session.canRedo).toBe(true);
    expect(notified).not.toHaveBeenCalled();
  });

  it('工具选择只广播不改内容历史和 dirty；相同工具为 no-op', () => {
    const { session } = setup(); const notified = vi.fn(); session.subscribe(notified);
    expect(session.activeTool).toBe('none');
    session.setActiveTool('length'); session.setActiveTool('length');
    expect(session.activeTool).toBe('length');
    expect(session.isDirty).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(notified).toHaveBeenCalledTimes(1);
    session.add(record()); session.undo();
    expect(session.activeTool).toBe('length');
  });

  it('订阅独立取消，广播期间新增监听器留到下一轮', () => {
    const { session } = setup(); const shared = vi.fn(); const later = vi.fn();
    const stopOne = session.subscribe(shared); session.subscribe(shared);
    stopOne(); stopOne();
    const stopRegistration = session.subscribe(() => { session.subscribe(later); });
    session.add(record());
    expect(shared).toHaveBeenCalledTimes(1); expect(later).not.toHaveBeenCalled();
    stopRegistration(); session.remove('a');
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('监听器异常明确上报且其他订阅方仍收到已经提交的版本', () => {
    const { session, onError } = setup(); const error = new Error('视图故障');
    session.subscribe(() => { throw error; });
    const other = vi.fn(); session.subscribe(other);
    session.add(record());
    expect(onError).toHaveBeenCalledWith(error);
    expect(other).toHaveBeenCalledWith([record()]);
    expect(session.list()).toEqual([record()]);
    expect(session.isDirty).toBe(true);
  });

  it('保存点变化会通知界面刷新未保存状态，重复保存不通知', () => {
    const { session } = setup();
    session.add(record());
    const dirty: boolean[] = [];
    session.subscribe(() => dirty.push(session.isDirty));
    session.markSaved(); session.markSaved(); session.remove('a'); session.undo();
    expect(dirty).toEqual([false, true, false]);
  });

  it('拒绝通知重入，所有视图接收一致版本，通知结束后仍可编辑', () => {
    const { session, onError } = setup();
    const stop = session.subscribe(() => session.add(record('nested')));
    const other = vi.fn(); session.subscribe(other);
    session.add(record());
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error('标注通知期间不能修改会话'));
    expect(other).toHaveBeenCalledTimes(1);
    expect(session.list()).toEqual([record()]);
    stop(); session.add(record('next'));
    expect(session.list()).toHaveLength(2);
  });
});
