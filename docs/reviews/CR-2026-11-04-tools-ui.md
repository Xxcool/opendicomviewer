# 标注、测量、Cine 与保存/关闭保护独立审查

日期：2026-11-04。范围：当前未提交 annotations、Viewport/WorkspaceToolbar/App、CineControls/controller/Split，以及 Tauri 标注保存/关闭桥。审查方只读实现，未进行 GUI 操作；主线另做真实桌面验收。本报告不以测试通过证明画面出图或交互已验收。

## 发现与处置

| 编号 | 发现、复现路径 | 当前处置 |
| --- | --- | --- |
| UI-01 | `AnnotationLayer` 原 key 分支在模态阻挡前处理 Ctrl/⌘+Z 和 Esc。打开未保存确认后快捷键仍改后台标注。 | 实现方已采纳；当前先调用 `blocksViewerShortcutContext` 检查首页、输入框与模态，再处理标注快捷键，静态复核关闭。 |
| UI-02 | `Viewport.resetViewToDefault` 原来只重置相机、刷新比例尺，没有通知 AnnotationLayer；缩放/平移后按 R 或复位，标注停留在旧屏幕位置。 | 实现方已采纳；当前 resetView 后调用 `notifyCameraChanged`，静态路径闭环。实际图形复位位置由主线 GUI 核对。 |
| UI-03 | 工具按钮会退出标注工具，原 B/W/P/Z 快捷键只更新基础鼠标工具；测距时按 W，左键仍画测距。 | 实现方已采纳；快捷键分支也调用 `annotations.setTool('none')`，静态复核关闭。 |
| UI-04 | 全局 selected 在手动翻帧/切序列后仍保留；原 Delete 分支无源帧核对，能删除当前不可见的旧帧标注。复现：N 帧画线→N+1帧→Delete。 | 已报告主线，须在 Delete 前核对当前帧归属，或正确清理选择；列表跨帧定位后的选中状态也须保留合理行为。 |

## 已核对链路

- 记录按 sessionId、seriesInstanceUid、sopInstanceUid、frameIndex 过滤，坐标空间明确为原始像素；MPR/独立分屏当前无可用测量入口，未把降采样体积作为测量真源。
- 草稿指针移动只改命令式 SVG，释放后提交领域记录；Esc、指针取消、切帧和卸载清理草稿。可信标定缺失时不输出伪毫米。
- 保存使用冻结内容快照；只有宿主返回 saved 且快照仍为当前版本才 markSaved。浏览器 download-started 保留 dirty，要求用户明确确认文件已经保存。保存取消或失败不继续替换。
- Tauri save 命令仅接收小型标注文本，目标经原生保存对话框选择；临时文件写完并 sync 后 rename，写入错误返回可见失败。当前 3 项 Rust 旧测试不覆盖此新增写入链路，建议补写入成功、替换与失败保留测试。
- Cine 等待异步 navigate 完成再排下一帧，失败 reject 会停止并提示；切会话/布局/首页/模态/页面隐藏/外部交互会暂停。fps 明确是用户播放速度，不能解释为采集时间或 4D。

## 独立验证

执行：`pnpm exec vitest run packages/app-web/tests/annotation-geometry.test.ts packages/app-web/tests/slice-navigation.test.ts packages/core/tests/measurement-session.test.ts`。

结果：3 文件、32 项测试通过。包含源帧身份、坐标、Cine 时钟/异步边界及标注状态；这些测试没有实例化完整 React 指针/键盘交互，因此 UI-01–04 不能仅凭这组测试关闭。

## 未覆盖

- 真实 GUI 的取点、拖动、缩放/平移/复位后叠加位置、备注、删除、撤销、未保存确认和实际文件内容读回，由主线验收。
- `Window.onCloseRequested` 覆盖窗口关闭请求；macOS Cmd+Q/菜单 Quit 可能走应用退出路径，须脏标注实测，不得只测窗口 × 就宣称全部退出均保护。
- 新确认模态未见完整焦点陷阱，需留意 Tab 是否能移至背景操作；现上下文快捷键已阻挡模态，但 ARIA 属性本身不构成键盘焦点隔离。
- JSON 保存未包含本轮可用恢复入口，不能宣称保存恢复闭环；ROI/角度、DICOM/SR/GSPS 导出、桌面 MPR 已知绘制问题不在本报告交付结论中。

## 复核追加

UI-04 已由主线采纳。当前 Delete/Backspace 分支先取得当前 plane 和 selected 记录，必须通过 `belongsToFrame(selected, sessionId, seriesInstanceUid, plane)` 才执行删除；没有清掉列表跨帧定位的选择。静态复核已关闭确认的跨帧误删路径。当前本次静态审查范围无未关闭的确认阻塞项；上述 GUI、退出路径和保存读回边界仍须按各自证据验收。
