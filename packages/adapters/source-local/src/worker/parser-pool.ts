/**
 * DICOM 解析 Worker 线程池调度器（P1-1）
 *
 * 遵循规范：
 * - ARCHITECTURE §6.3：DICOM 解析不占主线程；
 * - GEMINI.md §10.1：调度逻辑必须可被单测覆盖。
 *
 * 两种运行模式，各自命名清楚：
 * 1. **Worker 模式**：存在 `Worker` 运行时的浏览器环境，解析在独立线程执行；
 * 2. **同步回退模式**：Node / 无 Worker 运行时（自动化测试正是走这条），
 *    直接调用 `parseDicomMetadata`，行为与解析结果完全一致。
 *
 * 注意：Node 没有全局 `Worker`，所以**任何跑在 vitest 里的用例都只可能覆盖同步回退模式**。
 * 「解析是否真的在 Worker 里执行」只能由浏览器层断言（ARCHITECTURE §12.2 第 3 条）。
 * Worker 分支的可测性因此靠注入 `createWorker` 实现，见下方 `ParserPoolOptions`。
 */

import type { ImportCandidate } from '@opendicomviewer/core';
import { parseDicomMetadata } from '../parse';
import type {
  ParsedWorkerResult,
  WorkerParseRequest,
  WorkerParseResponse,
} from './types';

/**
 * ParserPool 需要的最小 Worker 能力。
 *
 * 用方法式声明（`onMessage(cb)`）而非属性式（`onmessage = cb`），
 * 这样把它接到真实 `Worker` 上时不需要任何 `as` 断言（GEMINI §10 禁止 as）。
 */
export interface WorkerLike {
  postMessage(message: WorkerParseRequest): void;
  onMessage(handler: (response: WorkerParseResponse) => void): void;
  onError(handler: (message: string) => void): void;
  terminate(): void;
}

export interface ParserPoolOptions {
  /** 并发 Worker 上限，默认取 `navigator.hardwareConcurrency`（≤ 8）或 4 */
  readonly maxConcurrency?: number;
  /** 单次解析超时，超时后终止该 Worker 并报错；默认 30 s，传 0 关闭 */
  readonly timeoutMs?: number;
  /** 队列上限，超过直接拒绝，避免 1000 帧全量排队把内存拉满 */
  readonly maxQueueSize?: number;
  /**
   * Worker 工厂。传 `null` 强制走同步回退模式；不传则自动探测。
   * 测试通过注入 fake 工厂覆盖 Worker 调度分支。
   */
  readonly createWorker?: (() => WorkerLike) | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 64;

interface PendingTask {
  readonly id: string;
  readonly buffer: ArrayBuffer;
  readonly candidate: ImportCandidate;
  readonly resolve: (value: ParsedWorkerResult) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** 运行环境是否提供 Worker（Node 下为 false） */
export function isWorkerRuntimeAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * 把真实 `Worker` 适配成 `WorkerLike`。
 * 全程不做类型断言：`addEventListener('message')` 的 event 是 `MessageEvent<any>`，
 * `('error')` 的是 `ErrorEvent`，两者都能直接取到需要的字段。
 */
function adaptBrowserWorker(worker: Worker): WorkerLike {
  return {
    postMessage: (message) => {
      // 不传 transfer list：转移所有权会 detach 调用方的 ArrayBuffer，
      // 而 metadata 段只有几十 KB，结构化克隆的代价可以忽略。
      worker.postMessage(message);
    },
    onMessage: (handler) => {
      worker.addEventListener('message', (event) => {
        handler(event.data);
      });
    },
    onError: (handler) => {
      worker.addEventListener('error', (event) => {
        handler(event.message || '未知 Worker 错误');
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}

function createDefaultWorker(): WorkerLike {
  return adaptBrowserWorker(
    new Worker(new URL('./parser.worker.ts', import.meta.url), {
      type: 'module',
    }),
  );
}

export class ParserPool {
  private readonly maxConcurrency: number;
  private readonly timeoutMs: number;
  private readonly maxQueueSize: number;
  private readonly createWorker: (() => WorkerLike) | null;

  private readonly idleWorkers: WorkerLike[] = [];
  private readonly busyWorkers = new Map<WorkerLike, PendingTask>();
  private readonly allWorkers = new Set<WorkerLike>();
  private readonly queue: PendingTask[] = [];

  private requestIdCounter = 0;
  private terminated = false;

  /**
   * @param options 传 number 等价于 `{ maxConcurrency: n }`（保留旧调用写法）
   */
  constructor(options: number | ParserPoolOptions = {}) {
    const opts: ParserPoolOptions =
      typeof options === 'number' ? { maxConcurrency: options } : options;

    this.maxConcurrency = opts.maxConcurrency ?? defaultConcurrency();
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxQueueSize = opts.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

    if (opts.createWorker === null) {
      this.createWorker = null;
    } else if (opts.createWorker) {
      this.createWorker = opts.createWorker;
    } else {
      this.createWorker = isWorkerRuntimeAvailable()
        ? createDefaultWorker
        : null;
    }
  }

  /** 当前是否处于 Worker 模式（同步回退模式返回 false） */
  public isWorkerMode(): boolean {
    return this.createWorker !== null;
  }

  public parse(
    buffer: ArrayBuffer,
    candidate: ImportCandidate,
  ): Promise<ParsedWorkerResult> {
    if (this.createWorker === null) {
      // 同步回退模式：仅用于无 Worker 运行时，语义与 Worker 通道一致
      try {
        const parsed = parseDicomMetadata(new Uint8Array(buffer), candidate, {
          untilTag: 'x7fe00010',
        });
        return Promise.resolve(parsed);
      } catch (err: unknown) {
        return Promise.reject(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    if (this.terminated) {
      return Promise.reject(new Error('解析线程池已终止，无法继续投递任务'));
    }

    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new Error(`解析队列已满（上限 ${this.maxQueueSize}），请降低并发后重试`),
      );
    }

    const id = `req-${++this.requestIdCounter}`;
    return new Promise<ParsedWorkerResult>((resolve, reject) => {
      this.queue.push({
        id,
        buffer,
        candidate,
        resolve,
        reject,
        settled: false,
      });
      this.pump();
    });
  }

  /**
   * 终止线程池：**所有在途与排队任务必须被显式 reject**。
   *
   * 早先实现只清空 map 不 settle，调用方的 `await` 会永久挂起（P1-1 缺陷 b）。
   */
  public terminate(): void {
    this.terminated = true;

    const hanging = [...this.busyWorkers.values(), ...this.queue];
    this.busyWorkers.clear();
    this.queue.length = 0;

    for (const worker of this.allWorkers) {
      worker.terminate();
    }
    this.allWorkers.clear();
    this.idleWorkers.length = 0;

    for (const task of hanging) {
      this.settle(task, () => {
        task.reject(new Error('解析线程池已终止'));
      });
    }
  }

  // ── 内部调度 ──────────────────────────────────────────────

  private pump(): void {
    while (this.queue.length > 0) {
      const worker = this.acquireWorker();
      if (!worker) return;

      const task = this.queue.shift();
      if (!task) {
        this.idleWorkers.push(worker);
        return;
      }
      this.dispatch(worker, task);
    }
  }

  private acquireWorker(): WorkerLike | undefined {
    const idle = this.idleWorkers.pop();
    if (idle) return idle;

    if (!this.createWorker) return undefined;
    if (this.allWorkers.size >= this.maxConcurrency) return undefined;

    const worker = this.createWorker();
    this.allWorkers.add(worker);

    // 关键：处理器里用 `busyWorkers.get(worker)` 取"当前持有者"，
    // 而不是闭包里捕获的创建者任务。复用 Worker 后出错时，
    // 错误才能落到真正等待的那个请求上（P1-1 缺陷 a）。
    worker.onMessage((response) => {
      const task = this.busyWorkers.get(worker);
      if (!task) return; // 迟到的响应（超时后已被 reject），丢弃

      this.busyWorkers.delete(worker);

      if (response.id !== task.id) {
        this.settle(task, () => {
          task.reject(
            new Error(
              `解析线程返回了错误的请求 id（期望 ${task.id}，实际 ${response.id}）`,
            ),
          );
        });
        this.retireWorker(worker);
        this.pump();
        return;
      }

      if (response.success) {
        const result = response.result;
        this.settle(task, () => {
          task.resolve(result);
        });
      } else {
        const message = response.error;
        this.settle(task, () => {
          task.reject(new Error(message));
        });
      }

      this.idleWorkers.push(worker);
      this.pump();
    });

    worker.onError((message) => {
      const task = this.busyWorkers.get(worker);
      if (task) {
        this.busyWorkers.delete(worker);
        this.settle(task, () => {
          task.reject(new Error(`解析线程异常: ${message}`));
        });
      }
      // 出错的 Worker 状态不可信，直接弃用，让下次 dispatch 重新创建
      this.retireWorker(worker);
      this.pump();
    });

    return worker;
  }

  private dispatch(worker: WorkerLike, task: PendingTask): void {
    this.busyWorkers.set(worker, task);

    if (this.timeoutMs > 0) {
      task.timer = setTimeout(() => {
        if (task.settled) return;
        this.busyWorkers.delete(worker);
        this.settle(task, () => {
          task.reject(
            new Error(
              `DICOM 解析超时（超过 ${this.timeoutMs} ms），已终止该解析线程`,
            ),
          );
        });
        this.retireWorker(worker);
        this.pump();
      }, this.timeoutMs);
    }

    try {
      worker.postMessage({
        id: task.id,
        buffer: task.buffer,
        candidateInfo: {
          id: task.candidate.id,
          name: task.candidate.name,
          size: task.candidate.size,
        },
      });
    } catch (err: unknown) {
      this.busyWorkers.delete(worker);
      const error = err instanceof Error ? err : new Error(String(err));
      this.settle(task, () => {
        task.reject(error);
      });
      this.retireWorker(worker);
      this.pump();
    }
  }

  private settle(task: PendingTask, action: () => void): void {
    if (task.settled) return;
    task.settled = true;
    if (task.timer !== undefined) {
      clearTimeout(task.timer);
      task.timer = undefined;
    }
    action();
  }

  private retireWorker(worker: WorkerLike): void {
    const idleIndex = this.idleWorkers.indexOf(worker);
    if (idleIndex >= 0) this.idleWorkers.splice(idleIndex, 1);
    this.allWorkers.delete(worker);
    worker.terminate();
  }
}

function defaultConcurrency(): number {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.hardwareConcurrency === 'number' &&
    navigator.hardwareConcurrency > 0
  ) {
    return Math.min(navigator.hardwareConcurrency, 8);
  }
  return 4;
}

let defaultPool: ParserPool | null = null;

export function getParserPool(): ParserPool {
  if (!defaultPool) {
    defaultPool = new ParserPool();
  }
  return defaultPool;
}

/** 仅供测试：释放单例，避免用例间相互污染 */
export function resetParserPoolForTest(): void {
  defaultPool?.terminate();
  defaultPool = null;
}
