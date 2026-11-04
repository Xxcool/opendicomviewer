import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnnotationIcon, type AnnotationIconName } from './AnnotationIcon';
import { useAnnotations, type AnnotationTool } from './AnnotationContext';

type Choice = { icon: AnnotationIconName; label: string; hint: string; tool?: AnnotationTool };
const choices: Record<'measurement' | 'annotation', readonly Choice[]> = {
  measurement: [
    { icon: 'length', label: '线段测距', hint: '拖动绘制 · 毫米', tool: 'length' },
    { icon: 'rectangle', label: '矩形 ROI', hint: '开发中' },
    { icon: 'ellipse', label: '椭圆 ROI', hint: '开发中' },
    { icon: 'angle', label: '角度', hint: '开发中' },
    { icon: 'curve', label: '曲线测量', hint: '开发中' },
  ],
  annotation: [
    { icon: 'select', label: '选择与编辑', hint: '移动图形或控制点', tool: 'select' },
    { icon: 'arrow', label: '箭头', hint: '拖动绘制 · 可加备注', tool: 'arrow' },
    { icon: 'text', label: '文字', hint: '点击影像后编辑文字', tool: 'text' },
    { icon: 'freehand', label: '手绘轮廓', hint: '开发中' },
  ],
};
export function AnnotationToolMenu({ group, enabled }: { group: 'measurement' | 'annotation'; enabled: boolean }) {
  const state = useAnnotations();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = choices[group];
  const active = items.find(item => item.tool === state.tool);
  const label = group === 'measurement' ? '测量' : '标注';
  const close = (focus: boolean) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 360)), left: Math.max(8, Math.min(rect.left, window.innerWidth - 272)) });
    };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  return <>
    <button ref={trigger} type="button" className="workspace-control annotation-menu-trigger" disabled={!enabled}
      aria-label={`${label}工具`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-pressed={Boolean(active)}
      title={enabled ? `${label}工具${active ? ` · ${active.label}` : ''}` : '目前仅支持单视口原始影像'}
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <AnnotationIcon name={group === 'measurement' ? 'length' : 'arrow'} /><span>{label}</span><AnnotationIcon name="chevron" />
    </button>
    {open && createPortal(<div ref={popup} id={id} className="annotation-tool-menu" role="menu" aria-label={`${label}工具`} style={{ position: 'fixed', ...position, zIndex: 100 }}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.findIndex(button => button === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <div className="annotation-menu-heading">{label}工具</div>
      {items.map(item => <button key={item.icon} type="button" role="menuitemradio" aria-checked={state.tool === item.tool} disabled={!item.tool}
        className="annotation-menu-item" onClick={() => { if (item.tool) { state.setTool(item.tool); state.setPanelOpen(true); close(true); } }}>
        <AnnotationIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.hint}</small></span>
        {state.tool === item.tool && <span aria-hidden="true">✓</span>}
      </button>)}
      <p className="annotation-menu-footnote">仅在原始影像上操作 · Esc 取消绘制</p>
    </div>, document.body)}
  </>;
}
