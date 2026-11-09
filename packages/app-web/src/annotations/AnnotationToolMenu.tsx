import { ToolbarMenu } from '../components/ToolbarMenu';
import { AnnotationIcon, type AnnotationIconName } from './AnnotationIcon';
import { useAnnotations, type AnnotationTool } from './AnnotationContext';

type Choice = { icon: AnnotationIconName; label: string; hint: string; tool?: AnnotationTool };
const choices: Record<'measurement' | 'annotation', readonly Choice[]> = {
  measurement: [
    { icon: 'length', label: '线段测距', hint: '拖动绘制 · 毫米', tool: 'length' },
    { icon: 'rectangle', label: '矩形 ROI', hint: '拖动绘制 · 原始灰度统计', tool: 'rectangleRoi' },
    { icon: 'ellipse', label: '椭圆 ROI', hint: '拖动绘制 · 原始灰度统计', tool: 'ellipseRoi' },
    { icon: 'angle', label: '三点角', hint: '依次点击起点、顶点、终点', tool: 'angle' },
    { icon: 'angle', label: 'Cobb 角', hint: '依次点击两条直线的四个端点', tool: 'cobbAngle' },
    { icon: 'curve', label: '折线测距', hint: '逐点点击 · Enter 完成 · 原图折线长度', tool: 'polyline' },
  ],
  annotation: [
    { icon: 'select', label: '选择与编辑', hint: '移动图形或控制点', tool: 'select' },
    { icon: 'arrow', label: '箭头', hint: '拖动绘制 · 可加备注', tool: 'arrow' },
    { icon: 'text', label: '文字', hint: '点击影像后编辑文字', tool: 'text' },
    { icon: 'freehand', label: '手绘轮廓', hint: '按住拖动 · 松开自动闭合 · 无灰度统计', tool: 'freehand' },
  ],
};
export function AnnotationToolMenu({ enabled }: { enabled: boolean }) {
  const state = useAnnotations();
  return <ToolbarMenu label="标注与测量" icon={<AnnotationIcon name="length" />} active={state.tool !== 'none'} width={520}>
    {close => <>
      <button className="annotation-menu-item annotation-library" role="menuitem" onClick={() => { state.setPanelOpen(true); close(); }}>
        <AnnotationIcon name="list" /><span><strong>标注列表{state.records.length ? ` · ${state.records.length}` : ''}</strong><small>备注、保存恢复、撤销与删除</small></span>
      </button>
      {!enabled && <p className="annotation-menu-footnote">绘制工具支持单视口和独立分屏的原始影像；降采样 MPR 仅用于显示与定位。</p>}
      <div className="annotation-tool-columns">{(['measurement', 'annotation'] as const).map(group => <div key={group} role="group" aria-label={group === 'measurement' ? '测量' : '标注与编辑'}>
        <div className="annotation-menu-heading">{group === 'measurement' ? '测量' : '标注与编辑'}</div>
        {choices[group].map(item => <button key={item.label} type="button" role="menuitemradio" aria-checked={state.tool === item.tool} disabled={!enabled || !item.tool}
          className="annotation-menu-item" onClick={() => { if (item.tool) { state.setTool(item.tool); state.setPanelOpen(true); close(); } }}>
          <AnnotationIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.hint}</small></span>
          {state.tool === item.tool && <span aria-hidden="true">✓</span>}
        </button>)}
      </div>)}</div>
      <p className="annotation-menu-footnote">原始影像工具 · Esc 取消当前绘制</p>
    </>}
  </ToolbarMenu>;
}
