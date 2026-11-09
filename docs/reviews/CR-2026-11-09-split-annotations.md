# 独立分屏标注与测量独立审查

日期：2026-11-09。范围：原始独立2×2视口的 AnnotationLayer、输入门禁、列表定位和播放接线。审查方只检查实现、运行测试并新增本报告；实际界面验收由主线另记。

## 首轮发现及处置

| 编号 | 可复核证据 | 处置 |
| --- | --- | --- |
| SPLIT-01 | IndependentPane.navigate 首版仅在 `await renderer.setStackIndex` **之前**广播 `ANNOTATION_FRAME_CHANGED`。AnnotationLayer.changedFrame 调 cancel→paint，此时 renderer 仍是旧索引，故重绘旧层标注；切层成功后只 paint HUD，没有通知标注SVG。重现路径：在分屏某格当前层绘制测距→下一层，旧线可能残留到相机/会话下一次更新。 | 已反馈，主线采纳：保留前置广播取消草稿，成功且current后再广播，以新帧索引重绘。修后源码已核对：第二次广播位于 setStackIndex 成功之后，不会把前置取消挪走。实际绘制/跨层界面由主线补证据。 |

## 其它已核对链路

- `isAnnotationViewportActive` 仅允许单视口与独立分屏活动格，不对降采样 MPR 开放测量；四格共享同一领域会话，不复制或变换数值真源。
- 键盘监听通过 `bindAnnotationKeys` 在分发时读取活动格，四个挂载监听只有一个执行；切布局后旧格不能继续消费 Delete/undo/Enter。输入框、首页、模态及菜单上下文隔离仍由原 key handler 保留。
- 每格 AnnotationLayer 使用对应 `viewportId`、`SeriesHandle` 与 renderer 当前层读取函数；`belongsToFrame` 继续按会话/序列/SOP/多帧索引过滤，不仅按屏幕格号过滤。
- MprPane 的 React `onPointerDownCapture` 位于应用委派捕获路径，会先执行活动格切换；标注层原生host capture随后处理绘制并阻断普通browse/pan手势。首击激活并绘制应以实际GUI确认，不能仅凭层级推断算通过。
- 活动格/布局变更同步 cancel 所有草稿并递增completion token；ROI异步读回在commit时再核对活动格、生命周期、当前帧和会话快照，避免把离开的格子统计写回。
- 原始句柄变化使ready不再匹配，旧层卸载清理监听与pending；新图装载ready后才挂新标注层。列表只有一个全局面板，使用当前活动序列查SOP/帧后导航活动格，不给每个格子重复画列表。
- 分屏Cine的enabled增加`annotations.tool === 'none'`，选工具后controller available变化会暂停；绘制事件也被既有全局interaction暂停机制观察。此功能仍是空间Stack播放，不声明4D。

## 独立验证

`pnpm exec vitest run packages/app-web/tests/annotation-viewport.test.ts packages/app-web/tests/annotation-geometry.test.ts packages/app-web/tests/annotation-roi.test.ts packages/app-web/tests/annotation-angle.test.ts packages/app-web/tests/annotation-path.test.ts packages/app-web/tests/annotation-restore.test.ts`：6文件25项通过。

新增门禁测试实际导入 `bindAnnotationKeys`，挂载4个监听并驱动领域MeasurementSession，验证一次撤销只发生一次及活动格切换后继续正确路由；几何/ROI/角度/恢复既有测试保持通过。`git diff --check` 通过。

## 待实机复核

- SPLIT-01切层后的SVG刷新，以及同序列不同层/不同序列/多帧在四格之间的归属。
- 首次点击非活动格即绘制、右键与Shift调窗、指针捕获释放、布局切换期间ROI取消、Cine暂停和列表跳层。
- 备注输入框尚未Enter/blur时点击另一格（不同序列）：面板过滤导致旧编辑器卸载，需验证blur是否先提交。当前只是待验证风险，不能凭推测认定缺陷；若复现应在切换前复用现有FLUSH事件。
- 更新当前支持文案与状态表；旧历史交付记录不重写。分屏原始图测量已接入不等于MPR测量或HUD重绘D1已解决。
