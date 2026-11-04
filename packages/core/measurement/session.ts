import type { MeasurementRecord } from '../domain/types';
import type { MeasurementPort, MeasurementTool } from '../ports';

type Snapshot = readonly MeasurementRecord[];
type Listener = (records: Snapshot) => void;

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left);
  const b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) =>
    b.some(([otherKey, otherValue]) => key === otherKey && sameValue(value, otherValue)));
}

function copyRecord(record: MeasurementRecord): MeasurementRecord {
  if (![record.id, record.seriesInstanceUid, record.sopInstanceUid, record.sessionId].every(value => value.trim().length > 0)) {
    throw new Error('标注缺少稳定 ID 或源影像引用');
  }
  if (!Number.isInteger(record.frameIndex) || record.frameIndex < 0 || record.coordinateSpace !== 'image-pixel') {
    throw new Error('标注源帧或坐标空间无效');
  }
  if (!Number.isFinite(record.createdAt) || record.points.length === 0
    || record.points.some(point => point.length !== 3 || point[2] !== 0 || !point.every(Number.isFinite))
    || Object.values(record.stats).some(value => value !== undefined && !Number.isFinite(value))) {
    throw new Error('标注坐标、时间或测量值无效');
  }
  // 复制整个领域记录，新增的帧引用等字段也不能共享调用方的可变对象。
  return freezeDeep(structuredClone(record));
}

/** 会话内真源；不持久化影像或标注。工具选择不属于可撤销的内容修改。 */
export class MeasurementSession implements MeasurementPort {
  private tool: MeasurementTool = 'none';
  private history: Snapshot[] = [Object.freeze([])];
  private cursor = 0;
  private saved: Snapshot = this.history[0]!;
  private listeners = new Set<{ notify: Listener }>();
  private notifying = false;

  /** 回调负责向宿主报告订阅失败；此时内容已提交，不能伪称写入失败。 */
  constructor(private readonly onListenerError: (error: unknown) => void) {}

  get activeTool(): MeasurementTool { return this.tool; }
  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.history.length - 1; }
  get isDirty(): boolean { return !sameValue(this.current, this.saved); }
  private get current(): Snapshot { return this.history[this.cursor]!; }

  setActiveTool(tool: MeasurementTool): void {
    this.assertWritable();
    if (tool === this.tool) return;
    this.tool = tool;
    this.publish();
  }

  list(seriesInstanceUid?: string): Snapshot {
    return seriesInstanceUid === undefined ? this.current
      : Object.freeze(this.current.filter(record => record.seriesInstanceUid === seriesInstanceUid));
  }

  add(record: MeasurementRecord): void {
    this.assertWritable();
    if (this.current.some(existing => existing.id === record.id)) throw new Error('标注 ID 已存在');
    this.commit([...this.current, copyRecord(record)]);
  }

  update(record: MeasurementRecord): void {
    this.assertWritable();
    if (!this.current.some(existing => existing.id === record.id)) throw new Error('标注不存在');
    const copied = copyRecord(record);
    this.commit(this.current.map(existing => existing.id === copied.id ? copied : existing));
  }

  remove(id: string): void {
    this.assertWritable();
    this.commit(this.current.filter(record => record.id !== id));
  }

  clear(seriesInstanceUid?: string): void {
    this.assertWritable();
    this.commit(seriesInstanceUid === undefined ? []
      : this.current.filter(record => record.seriesInstanceUid !== seriesInstanceUid));
  }

  /** 校验整个导入快照后一次替换；撤销仍可回到恢复前的内容。 */
  restoreSaved(records: readonly MeasurementRecord[]): void {
    this.assertWritable();
    const copied = records.map(copyRecord);
    if (new Set(copied.map(record => record.id)).size !== copied.length) throw new Error('标注 ID 重复');
    if (!sameValue(copied, this.current)) {
      const next = Object.freeze(copied);
      this.history = [...this.history.slice(0, this.cursor + 1), next];
      this.cursor += 1;
    } else if (!this.isDirty) return;
    this.saved = this.current;
    this.publish();
  }

  undo(): boolean {
    this.assertWritable();
    if (!this.canUndo) return false;
    this.cursor -= 1;
    this.publish();
    return true;
  }

  redo(): boolean {
    this.assertWritable();
    if (!this.canRedo) return false;
    this.cursor += 1;
    this.publish();
    return true;
  }

  markSaved(): void {
    this.assertWritable();
    if (!this.isDirty) return;
    this.saved = this.current;
    this.publish();
  }

  /** 不立即回放；订阅方先 list()。每次订阅都有独立的取消句柄。 */
  subscribe(listener: Listener): () => void {
    const subscription = { notify: listener };
    this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }

  private assertWritable(): void {
    // 禁止监听器重入修改，确保同一轮所有订阅方看到同一个版本。
    if (this.notifying) throw new Error('标注通知期间不能修改会话');
  }

  private commit(records: Snapshot): void {
    if (sameValue(records, this.current)) return;
    const next = Object.freeze(records);
    this.history = [...this.history.slice(0, this.cursor + 1), next];
    this.cursor += 1;
    this.publish();
  }

  private publish(): void {
    const failures: unknown[] = [];
    this.notifying = true;
    try {
      for (const subscription of [...this.listeners]) {
        if (!this.listeners.has(subscription)) continue;
        try { subscription.notify(this.current); }
        catch (error) { failures.push(error); }
      }
      // 通知全部订阅方后再报告错误，某个视图失败不阻止其他视图同步。
      for (const error of failures) this.onListenerError(error);
    } finally { this.notifying = false; }
  }
}
