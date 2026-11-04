# 保存、退出与备注草稿复审

日期：2026-11-04。独立只读审查；本报告新增，不修改前次结论。范围为 Tauri 应用退出/窗口关闭、JSON 写入和 AnnotationContext 保存/焦点边界；未操作 GUI。

## 发现

| 编号 | 级别 | 证据与复现步骤 | 结论 |
| --- | --- | --- | --- |
| UI-05 | P1 | `AnnotationControls.tsx` 的 `AnnotationNoteEditor` 在 onChange 仅写组件 text，blur/Enter 才提交领域记录；`AnnotationContext.tsx` 的 confirmReplacement 和 beforeunload 仅检查 session.isDirty。先创建并保存一条标注，再在备注框输入新内容，保持焦点，直接 Cmd+Q；原生退出事件不必产生 blur，检查时会把会话视为干净。 | 当前静态状态链存在未提交备注被跳过的路径。须由主线用最终桌面包复现，或提供备注草稿进入退出/保存保护的实现及回归。不能只以已提交记录的 dirty 保护证明文字编辑不会丢失。 |
| UI-06 | P2 | `saveAnnotations` 在宿主保存旧 snapshot 期间有新修改时正确不 markSaved，但仍返回 saved；普通面板据此无条件显示“标注已保存”。模态保存分支另检查 dirty，因此不会据此放行退出。 | 数据保护成立，普通面板成功提示可能误导。建议结果提示明确“已保存导出版本，当前仍有未保存修改”，并保留 dirty。 |

## 已核对

- 安装版本 `@tauri-apps/api@2.12.4/window.js` 的 onCloseRequested 实现 await handler 后才判断 preventDefault/destroy，因此当前异步确认方式符合实际 API。
- Rust RunEvent::ExitRequested 在 main 窗口存在且未获确认时 prevent_exit 并通知前端；只有前端确认后 finish_confirmed_exit 设置 ALLOW_EXIT 并再次请求退出。没有窗口时不拦截正常关闭。此静态链补齐 Cmd+Q 直接退出缺口，但不替代真实 Cmd+Q/菜单 Quit/窗口关闭验收。
- closeGuard 初始化失败可见报错；第二订阅失败会清理第一订阅，StrictMode 异步完成后也有取消清理。重复退出请求在 resolver 已存在时返回 false，不会直接解锁既有确认。
- save_annotation_file 使用用户选择路径，小文本有 10 MiB 限额；先 create_new 临时文件、完整写入/sync、关闭后 rename，失败尝试删除临时文件，未提前截断目标。Rust 新增替换成功与发布失败保留目标两项测试；本审查未重新运行 Rust 构建以避免与主线构建争用。
- 浏览器 download-started 不等于已保存；确认下载仅当导出快照仍为当前快照才 markSaved，保存期间修改不会被误标记。JSON 导入恢复仍未交付。
- 未保存模态加入了 Tab 首尾循环与 Escape 取消；尚未真实验证原生保存对话框返回后焦点和辅助技术行为。它未为整个背景设置 inert，不能把这段键盘循环宣称完整模态可访问性验收。

## 独立验证与边界

执行 `pnpm exec vitest run packages/app-web/tests/annotation-geometry.test.ts packages/core/tests/measurement-session.test.ts packages/app-web/tests/viewport-gestures.test.ts`：3 文件、18 项通过。

这些测试核对源帧身份、数值几何、不可变会话与快捷键上下文，不挂载完整 React 编辑器或 Tauri 事件循环，因而没有覆盖 UI-05，也不证明桌面退出和原生对话框交互已经通过。当前不能给出“退出与备注保存全部闭环”的独立结论。
