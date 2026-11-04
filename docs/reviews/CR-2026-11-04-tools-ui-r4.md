# macOS Quit 菜单退出保护复核

日期：2026-11-04。只读独立复核；不修改旧报告。主线报告 r3 后的真实 Cmd+Q 验收仍直接退出，因此此前 RunEvent 静态链不能算实际退出保护验收通过。本报告仅审查随后追加的菜单修复。

## 本地依赖事实

- 安装的 `tauri-2.12.5/src/menu/menu.rs`，`Menu::default` 在 macOS 的第一项为应用 Submenu，末项为 `PredefinedMenuItem::quit`。当前 `application.remove_at(count - 1)` 与已安装实现一致；未凭其他版本 API 推测菜单布局。
- 安装的 `muda-*/src/platform_impl/macos/mod.rs` 将 `PredefinedMenuItemType::Quit` 绑定为 `terminate:`。因此直接保留预定义 Quit，不能仅凭应用 RunEvent 代码就认定 Cmd+Q 可等待异步保存确认。
- `tauri-2.12.5/src/menu/submenu.rs` 提供 remove_at，MenuItem::with_id 与 Submenu::append 均属于当前依赖 API。主线另行运行 Rust 构建，不与其争用构建目录。

## 修复状态链

`packages/app-tauri/src-tauri/src/main.rs` 从默认菜单开始，仅 macOS 分支移除应用菜单末项，追加普通 `confirmed-quit` 菜单项并绑定 CmdOrCtrl+Q。普通菜单事件在 on_menu_event 中发送 `desktop-exit-requested`，前端已有监听等待会话确认，确认允许后才 invoke finish_confirmed_exit。

该路径不再调用预定义 Quit 的 terminate:，且没有重建或丢弃默认 Edit、View、Window 等其他菜单。Rust 其他 RunEvent 退出拦截保留，用于应用退出请求；窗口关闭仍走现有异步 onCloseRequested。

## 结论与验收边界

当前菜单修复未发现新的确认阻塞项。它是对实际失败路径的针对修复，不是此前静态结论已经证明可用。须使用重新构建的完整 app 实测：有修改时 Cmd+Q / 点击 Quit 均显示确认，取消后窗口与标注保留；原生保存取消不退出；保存成功或明确丢弃后退出；干净会话可退出。按快捷键与点菜单都应验收，不能只看构建通过。

本复核没有 GUI 操作，未验证系统关机、强制结束进程或 macOS Dock Quit；不承诺可拦截操作系统强制终止。当前结论限于应用菜单、Cmd+Q 与已有窗口关闭链路。
