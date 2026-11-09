import { useViewerStore } from '../state/viewer-store';

/** 多格共享标注会话，但只有当前原始视口拥有键盘与绘制输入。 */
export function isAnnotationViewportActive(viewportId: string): boolean {
  const state = useViewerStore.getState();
  return (state.layoutMode === '1x1' || state.layoutMode === 'split-2x2')
    && state.activeViewportId === viewportId;
}

export function bindAnnotationKeys(target: EventTarget, viewportId: string, handle: (event: KeyboardEvent) => void): () => void {
  const key = (event: Event) => {
    if (isAnnotationViewportActive(viewportId) && event instanceof KeyboardEvent) handle(event);
  };
  target.addEventListener('keydown', key);
  return () => target.removeEventListener('keydown', key);
}
