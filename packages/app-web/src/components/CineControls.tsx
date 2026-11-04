import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '../state/viewer-store';
import { CineController } from './cine-controller';

interface CineControlsProps {
  readonly sessionKey: unknown;
  readonly enabled: boolean;
  readonly total: number;
  readonly readIndex: () => number;
  /** 必须等当前帧提交完成才 resolve；失败应 reject，由播放器停止并提示。 */
  readonly navigate: (index: number) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

function covered(): boolean {
  return document.hidden || document.querySelector('[data-viewer-home="true"], [role="dialog"][aria-modal="true"]') !== null;
}

export function CineControls({ sessionKey, enabled, total, readIndex, navigate, onError }: CineControlsProps) {
  const controls = useRef<HTMLDivElement>(null);
  const loading = useViewerStore(state => state.importStatus.loading);
  const layout = useViewerStore(state => state.layoutMode);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const [loop, setLoop] = useState(false);
  const available = enabled && total > 1 && !loading;
  const scope = useRef({ sessionKey, layout });
  const latest = useRef({ total, readIndex, navigate, onError, available, sessionKey, layout });
  latest.current = { total, readIndex, navigate, onError, available, sessionKey, layout };
  const [controller] = useState(() => new CineController({
    read: () => ({ index: latest.current.readIndex(), total: latest.current.total }),
    show: index => latest.current.navigate(index),
    allowed: () => latest.current.available && latest.current.sessionKey === scope.current.sessionKey
      && latest.current.layout === scope.current.layout && !covered(),
    onPlayingChange: setPlaying,
    onError: error => latest.current.onError(error),
  }));
  useEffect(() => { controller.pause(); }, [controller, sessionKey, layout, available]);
  useEffect(() => {
    const stopIfCovered = () => { if (covered()) controller.pause(); };
    const observer = new MutationObserver(stopIfCovered);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-viewer-home'] });
    const stopForInteraction = (event: Event) => {
      if (!(event.target instanceof Node) || !controls.current?.contains(event.target)) controller.pause();
    };
    document.addEventListener('visibilitychange', stopIfCovered);
    window.addEventListener('pointerdown', stopForInteraction, true);
    window.addEventListener('wheel', stopForInteraction, true);
    window.addEventListener('keydown', stopForInteraction, true);
    return () => {
      observer.disconnect(); document.removeEventListener('visibilitychange', stopIfCovered);
      window.removeEventListener('pointerdown', stopForInteraction, true);
      window.removeEventListener('wheel', stopForInteraction, true);
      window.removeEventListener('keydown', stopForInteraction, true);
      controller.pause();
    };
  }, [controller]);
  if (total < 2) return null;
  return <div ref={controls} className="tool-group shrink-0" role="group" aria-label="二维电影播放">
    <button type="button" className="workspace-control" disabled={!available} aria-label={playing ? '暂停播放' : '播放序列'} aria-pressed={playing}
      title="二维播放；非循环时到末帧暂停，再次播放从首帧开始" onClick={() => {
        if (playing) controller.pause();
        else if (!covered()) { try { scope.current = { sessionKey, layout }; controller.play(); } catch (error) { onError(error); } }
      }}>{playing ? '暂停' : '播放'}</button>
    <label className="inline-flex items-center gap-1 text-xs">速度
      <select aria-label="播放速度 fps" className="bg-panel text-txt border border-line rounded px-1" value={fps}
        onChange={event => { const value = Number(event.target.value); controller.setFps(value); setFps(value); }}>
        {[1, 5, 10, 15, 24, 30, 60].map(value => <option key={value} value={value}>{value} fps</option>)}
      </select>
    </label>
    <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" style={{ width: 'auto' }} checked={loop} aria-label="循环播放"
      onChange={event => { controller.setLoop(event.target.checked); setLoop(event.target.checked); }} />循环</label>
  </div>;
}
