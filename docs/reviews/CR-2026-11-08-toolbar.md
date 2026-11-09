# 工具栏收纳独立审查

日期：2026-11-08。范围：ToolbarMenu、WorkspaceToolbar、AnnotationToolMenu/Controls、WorkspaceIcon 与对应 CSS。未改实现，未代替主线实际窄屏/桌面 GUI。

## 结构与状态

- 常用鼠标工具与适应窗口继续直接可达；测量/标注合成一个入口，入口内保留分组与标注列表；四种布局合为当前布局菜单，放大缩小收进更多；详情/专注保留可访问名称和紧凑图标。
- 沿用既有 viewer/annotation 状态，不新增另一份业务真源。选择鼠标工具仍清除标注活动工具；选择标注工具、备注、保存恢复、删除和撤销仍调用既有 AnnotationContext/Session，不在菜单内重新实现几何或保存。
- MPR 菜单项仍受有效降采样计划与 renderer supportsVolume 限制，1×1/独立分屏始终按既有通路提供。绘制仅 1×1 原始影像启用；其他布局仍能通过菜单打开已有标注列表，禁用说明可见，未假装 MPR 已支持测量。

## 菜单与键盘

- Portal 写到 body，避免横向滚动工具栏裁切；trigger 与 popup 使用 useId 关联，aria-haspopup/expanded/controls 与 role=menu 一致。条目有 menuitem 或 menuitemradio/checked，图标 aria-hidden，按钮名称与当前布局可访问。
- 打开后聚焦首个可用按钮，上下键按 DOM 顺序循环且跳过 disabled，Home/End定位首末项；选项完成与 Escape 关闭后焦点回 trigger。Tab 移出走 blur 关闭，不强制把焦点拉回，符合普通弹出菜单而非模态陷阱。
- 外部 pointerdown 关闭；事件 listener 在关闭或卸载时清理，Escape 在 capture 阶段拦截，不同时穿透取消影像草稿。disabled 状态会关闭当前菜单。
- 布局读取真实 trigger rect 和 popup 高度，窗口 resize/捕获 scroll 时重定位，宽度和左右/顶部留白被约束；菜单 max-height 和 overflow 允许窄屏纵向访问。真实屏幕滚动、上下边界仍需要 GUI 核对。
- popup 沿用 `.annotation-tool-menu` 上下文，既有 blocksViewerShortcut 检查能识别全部新菜单，B/W/P/Z/F 等阅片快捷键不会在菜单开启时作用到背景画布；数字窗预设/标注撤销仍消费同一隔离机制。

## 独立验证

`pnpm exec vitest run packages/app-web/tests/viewport-gestures.test.ts packages/app-web/tests/viewport-layouts.test.ts packages/app-web/tests/annotation-geometry.test.ts`：3文件22项通过。`pnpm --filter @opendicomviewer/app-web typecheck`、`git diff --check`通过。

以上测试覆盖既有手势/布局/几何契约，**没有**验证新菜单真实键盘焦点、Portal视觉位置或窄屏截图；没有为这次可逆布局改动新增只复述DOM实现的测试。静态未发现已确认阻塞，主线仍须对最终构建操作菜单、切布局/主题和导出，并保持已有测量归属、退出保护及原生下载验收。
