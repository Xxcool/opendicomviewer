export interface CineFrames { readonly index: number; readonly total: number }
interface CineOptions {
  read(): CineFrames;
  allowed?(): boolean;
  show(index: number): Promise<void>;
  onPlayingChange(playing: boolean): void;
  onError(error: unknown): void;
}

/** 按完成帧串行推进，不为慢解码积压定时器；fps 是用户播放速度，不是采集帧率。 */
export class CineController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private running = false;
  private busy = false;
  private destroyed = false;
  private fps = 10;
  private loop = false;
  private replay = false;

  constructor(private readonly options: CineOptions) {}
  get playing(): boolean { return this.running; }

  setFps(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error('播放速度必须为 1–60 fps');
    this.fps = value;
  }
  setLoop(value: boolean): void { this.loop = value; }

  play(): void {
    if (this.destroyed || this.running || this.busy || this.options.allowed?.() === false) return;
    const { index, total } = this.read();
    if (total < 2) return;
    this.replay = index === total - 1;
    this.running = true;
    const token = ++this.generation;
    this.options.onPlayingChange(true);
    this.schedule(token, 0);
  }

  pause(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) return;
    this.running = false;
    this.options.onPlayingChange(false);
  }

  destroy(): void { this.pause(); this.destroyed = true; }

  private read(): CineFrames {
    const frame = this.options.read();
    if (!Number.isInteger(frame.total) || frame.total < 0 || !Number.isInteger(frame.index)
      || frame.index < 0 || (frame.total > 0 && frame.index >= frame.total)) {
      throw new Error('当前影像帧索引不可用于播放');
    }
    return frame;
  }

  private schedule(token: number, delay: number): void {
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(token); }, delay);
  }

  private async tick(token: number): Promise<void> {
    if (!this.running || token !== this.generation) return;
    if (this.options.allowed?.() === false) { this.pause(); return; }
    const started = Date.now();
    this.busy = true;
    try {
      const { index, total } = this.read();
      if (total < 2 || (index === total - 1 && !this.loop && !this.replay)) { this.pause(); return; }
      const next = this.replay || index === total - 1 ? 0 : index + 1;
      this.replay = false;
      await this.options.show(next);
      if (!this.running || token !== this.generation) return;
      if (next === total - 1 && !this.loop) { this.pause(); return; }
      this.schedule(token, Math.max(0, 1000 / this.fps - (Date.now() - started)));
    } catch (error) {
      if (token === this.generation) { this.pause(); this.options.onError(error); }
    } finally { this.busy = false; }
  }
}
