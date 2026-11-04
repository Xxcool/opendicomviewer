# 工具菜单、按钮样式与尺寸更新复核

日期：2026-11-04。独立只读审查新增 AnnotationToolMenu/AnnotationIcon、面板/确认框样式、菜单快捷键上下文与 AnnotationLayer 尺寸更新。未改实现或旧报告；本报告不替代主线 GUI 验收。

## 发现与验证

| 编号 | 级别 | 可复现证据 | 处置边界 |
| --- | --- | --- | --- |
| UI-07 | P2 | `pnpm exec vitest run packages/app-web/tests/viewport-gestures.test.ts packages/app-web/tests/annotation-geometry.test.ts`：1 失败、7 通过。viewport-gestures.test.ts:57 仍断言不含 `.annotation-tool-menu` 的旧选择器，新实现已加入菜单上下文。 | 属本轮改动未同步既有测试，需修正期望并明确菜单阻挡的测试边界后再报告测试通过。不能降低实现的菜单隔离来迎合旧断言。 |
| UI-08 | P2 | AnnotationToolMenu 的 place 使用 `Math.min(rect.bottom + 8, window.innerHeight - 360)`，未设 top 下界。Web 可视高度 300 时 top=-60；首个可用测距项可能移出屏幕，尽管 popup 有 max-height/overflow。Tauri minHeight=600，因此桌面窗口不受此高度条件影响。 | 建议 top 保持正边距，并令菜单实际高度/可用空间控制滚动。属于 Web 短视窗布局边界，需修正后用实际视窗验收。 |

## 已核对

- 菜单通过 document.body Portal，避开工具栏 overflow-x:auto 的裁剪；打开后聚焦首个可用项，方向键/Home/End跳过 disabled 项，Esc 关闭并返回触发按钮，选项激活后关闭菜单。点击外部和焦点移出会关闭；enabled 变 false 也关闭。
- 菜单存在时 blocksViewerShortcutContext 阻挡后方阅片/标注快捷键，Esc 的菜单捕获监听优先处理关闭；待开发项明确“开发中”并 disabled，没有可执行假入口。
- 菜单 role=menu，选项 role=menuitemradio/aria-checked，触发按钮有 aria-haspopup/expanded/controls 和可访问名称；SVG 用 currentColor 且 aria-hidden，不产生重复读屏名称。
- 面板与确认框新增 annotation-action 的按钮边界、主操作、危险操作、禁用与焦点样式；保存成功/取消用 status、错误用 alert。新样式引用的 panel/hover/active/line/line-strong/txt/txt-muted/accent/accent-hover/danger 均在 index.css 中有定义，并有浅色同名覆盖，未发现不存在的主题 token。
- AnnotationLayer 的 ResizeObserver 改为 rAF 中重新投影，重复通知取消旧帧；卸载时 disconnect 与 cancelAnimationFrame。与渲染适配器同步 resizeNow 相配，避免在同轮尺寸更新前立即读旧相机；这一调度核对不能证明最终截图中叠加一定正确，仍需 resize/侧栏切换/复位 GUI 检查。

## 独立命令

- 上述两文件测试：7 通过、1 失败，失败为 UI-07。
- `pnpm --filter @opendicomviewer/app-web typecheck`：通过。

未执行 GUI、最终 Web 构建或 Tauri 新包；未声称菜单短视窗、原生退出确认样式和实际叠加投影已经视觉验收通过。
