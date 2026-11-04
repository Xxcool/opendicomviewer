# 菜单边界修正与 React 清理复核

日期：2026-11-04。独立只读复核 UI-07/UI-08 与新增 TSX 的 Hook/清理边界，按 react-best-practices 的组件、Hook、事件清理、可访问性和瞬时状态要点检查。只新增本报告，不修改此前失败记录。

## 关闭的发现

- **UI-07**：viewport-gestures.test.ts 的 selector 期望已加入 `.annotation-tool-menu`，与新上下文隔离一致。独立重跑 `pnpm exec vitest run packages/app-web/tests/viewport-gestures.test.ts packages/app-web/tests/annotation-geometry.test.ts`，2 文件、8 项通过。主线报告全量 324 项通过；本复核不把主线全量结果冒充独立重跑。
- **UI-08**：菜单 top 改为 `Math.max(8, Math.min(...))`，不再随短视窗变为负值；CSS 原有 `max-height: calc(100vh - 24px)` 与 overflow:auto 保留，首部可用项留在视窗内并滚动剩余内容。静态关闭负坐标路径；实际 Web 短视窗视觉未由本复核证明。

## React 与生命周期核对

- AnnotationToolMenu 的 Hook 均在组件顶层；打开时的 resize/scroll、外部 pointerdown、Escape 监听都有对应移除。Portal 的当前 popup/trigger 通过 ref 读取，未发现旧 DOM 引用常驻；布局定位只在打开/resize/scroll 时更新，不进入影像指针逐帧渲染循环。
- AnnotationPanel 的 state Hook 在条件 return 之前；AnnotationNoteEditor 独立组件有稳定 record.id key，备注订阅随依赖更新并卸载清理。Esc 取消仍先重置草稿 ref、标记取消再 blur，菜单样式调整没有改变保存状态链。
- AnnotationContext 的 session 订阅、beforeunload 与宿主 closeGuard 仍清理；原生异步订阅在卸载后完成也立即退订。新增 icon/menu 未新增宿主/core 交叉依赖或网络资源。
- AnnotationLayer 的高频草稿仍经命令式 SVG/ref 更新；尺寸更新仅排 rAF 重绘，重复 resize 和卸载均取消待执行帧。没有为重投影引入每帧 React setState。
- CineControls 保持固定 Hook 顺序；MutationObserver、visibility/pointer/wheel/key 监听卸载清理并 pause。controller 读取 latest ref，切会话/布局/能力时 pause，未把旧闭包中的导航对象作为持续播放真源。
- 新按钮有可访问名称，装饰 SVG aria-hidden；菜单 disabled 规划项、箭头键与 Esc 焦点返回仍保留。完整模态辅助技术和复杂跨平台焦点行为不在本次静态通过声明内。

## GUI 证据边界

主线报告新桌面包已看到分组菜单，选线段后绘得 108.08 mm，面板按钮/icon 与 Cmd+Q 确认按钮正常，Esc 取消保留；Cine 实际由第 97 帧推进至 103 帧。这些是主线 GUI 证据，本审查未再次操作原生窗口。

修复复核范围无新确认阻塞项。未覆盖的 Web 短视窗、真实 Zip、原生保存的更多错误路径、跨平台和 MPR 重绘问题仍按主线交付记录保留，不因本次 Hook/样式审查而宣称全部验收完成。
