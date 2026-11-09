# 原生 PNG 保存独立审查

日期：2026-11-08。范围：`app-tauri` 的 PNG 下载桥、Rust 下载回调、主窗创建与退出保护，以及共享导出控件的宿主接线。审查方未改生产实现、未提交、未操作 GUI；实际 WKDownload 保存与发布产物验收由主线另记。

## 首轮发现

| 编号 | 可复核证据 | 处置 |
| --- | --- | --- |
| PNG-01 | `valid_request` 首版仅允许 `blob:tauri://localhost/`；锁定 Tauri 2.12.5 `src/webview/mod.rs` 的 `use_https_scheme` 文档说明 Windows 默认使用 `http://<scheme>.localhost`。因此 Windows 安装包的正常 Blob URL 会被拒绝，macOS 测试不能覆盖。 | 已反馈实现方与主线；要求准确本地 Windows origin 白名单及域名前缀伪装拒绝测试，不能接受任意外域 Blob。 |
| PNG-02 | 首版 `cancel_png_download` 将任务直接 take 并立即 `remove_dir_all`，清理错误被忽略。Windows 下载句柄尚未关闭时可能删除失败，迟到 Finished 已无任务可再次清理，会留下临时影像。 | 已反馈：保留取消任务的清理信息，迟到事件不能发布，清理失败不可静默丢失。实现方正补回归。 |
| PNG-03 | 首版 `publish` 使用只读 `File::open` 后 `sync_all`；Windows 同步文件句柄的写权限需要核对。 | 已让实现方用读写方式打开本次私有临时文件，并在 Windows runner 的 Rust 测试中覆盖 publish；本机 macOS 通过不等于 Windows 已通过。 |
| PNG-04 | 处理 PNG-02 时拟将取消后的 started tombstone 仍视为活动保存并永久阻止退出；若下载不返回 Finished，正好会触发超时后仍不能退出/重试的状态。 | 已反馈必须有界恢复：取消清理信息与活动保存锁分离。异常终止残留可明确列为边界，不能永久锁住应用。 |

## 首轮已核对的链路

- PNG 二进制通过本应用 Blob 下载交给原生 WebView；IPC 只有请求 ID、URL、大小及结果，不把像素、base64 或数组塞入文本保存命令。
- JS 先注册完成 listener 再发下载；按一次性 ID 隔离事件，重复保存拒绝，保存框取消不发下载。真正完成事件才报告 saved；超时、失败与 Web download-started 区分。
- Rust 保存位置来自原生选择器；同目录私有 staging，完成后检查文件类型/大小和 PNG 签名，sync 后 hard_link 无覆盖发布。已有同名目标不被覆盖，取消/失败不清除标注 dirty。
- `create:false` 与 `WebviewWindowBuilder::from_config` 共用原 `main` 配置；未更换窗口 label、渲染器或依赖。保留菜单、拖入事件及标注退出确认。实际启动/拖入/退出仍需最终包 GUI。
- 快照沿用真实 IMAGE_RENDERED 后的持久 2D canvas 路径；捕获入口同步清除旧 snapshot/blob/preview，选项默认不额外叠加姓名编号，源像素烧录风险仍说明。

## 独立首轮验证

`pnpm exec vitest run packages/app-tauri/tests/png-saver.test.ts packages/app-web/tests/png-capture.test.ts packages/app-web/tests/original-dicom.test.ts`：3 文件 16 项通过；`git diff --check` 通过。

本轮测试是 Node/静态核对，尚不能关闭 Windows/macOS 实际 Blob 下载完成、安装后保存、清理和退出行为。上述发现处理完成后须追加复核，不能把首轮测试通过视作最终认可。

## 最终代码复核追加

- PNG-01 已修：精确限定 `blob:tauri://localhost/` 与 Windows `blob:http://tauri.localhost/` / `blob:https://tauri.localhost/`，调试仅额外接受既有 `127.0.0.1:5174`；新增正常 Windows URL 与 `tauri.localhost.evil.test` 拒绝测试。未扩大 CSP/网络权限。
- PNG-02 已修：状态分为 active 与 abandoned。started 取消转为 cancelled 墓碑，迟到 Finished 只执行 cleanup，不发布目标；Finished 清理失败仍保留墓碑，后续 prepare 重试清理，未静默丢失可清理路径。
- PNG-03 已修：publish 以 `OpenOptions.read(true).write(true)` 打开本次私有临时文件再读签名及 sync。该修改不开放任意源文件写入；Windows 真机仍由 CI/Rust 与实际下载分别验证。
- PNG-04 已修：墓碑不占活动槽位，`is_busy` 只判断 active；取消/超时后不因此永久阻止关闭。墓碑仍无法清理时，最多四项后明确要求检查临时目录并重启，而非无限增长。强杀/崩溃后的临时残留无法承诺自动回收，继续作为限制。

独立执行：`/Users/xiabin/.cargo/bin/cargo test --locked --manifest-path packages/app-tauri/src-tauri/Cargo.toml png_download::tests`，4 项通过、7 项过滤；包含完整字节发布/不覆盖、无效或大小不完整拒绝、取消释放 active、迟到完成不产生目标及清理目录。独立 Node 三文件16项此前通过，修后仍应纳入主线全量检查；`git diff --check` 通过。

当前代码未发现新增确认阻塞项；实际 macOS WKDownload 是否能从当前 Blob URL 产生 Requested/Finished、安装产物中保存与取消/退出、Windows WebView2 界面操作仍待主线完成。无覆盖发布依赖目标文件系统 hard link 支持，不支持时明确报错，不假装保存成功；普通下载成功也不等于标准 DICOM SR/GSPS 支持。

### 全量类型检查修正追加

主线全量 typecheck 在 Tauri PNG 桥测试发现两处 `vi.fn` 的 prepare 返回值被推断为 `Promise<string>`（TS2322），阻止桌面构建。主线将两处精确指定为 `vi.fn<PngSaveHost['prepare']>`，未通过宽断言绕过类型，也未删除测试。独立检查该签名修正；此前 Web package typecheck 和 Node测试绿不应写作全仓库类型验证通过。完整类型复跑结果由后续实际命令补充。

独立修后执行根目录 `pnpm typecheck`，六个包的完整检查退出0；此结果包含 Tauri 测试类型。`git diff --check`再次通过。

### PNG 草稿与提示过滤复核追加

主线真实 GUI 捕获发现，直接 clone live SVG 会包含尚未提交的绘制草稿或编辑预览，因此即使领域记录为空仍可能烧录数值。新增 `CANCEL_ANNOTATION_DRAFT` 事件在 capture 的 renderer.render 之前同步派发；AnnotationLayer 使用既有 cancel 清草稿/pending、释放指针捕获、递增完成 token 并立即从正式会话重绘，卸载配对移除 listener。已开始编辑但未提交的记录在 cancel 后恢复原正式几何，不把一半控制点当作结果；等待中的 ROI token 同时失效。

独立核对 `paintAnnotation` 将正式图形及数值/备注放在 `<g>` 内，而工具提示为根 SVG 的直接 `<text>`。clone 仅额外移除 `:scope > text` 和选择控制点 circle，保留组内正式数值/备注，不会因过滤提示而删除已经完成的测量标签。

独立运行 `pnpm exec vitest run packages/app-web/tests/png-capture.test.ts packages/app-tauri/tests/png-saver.test.ts packages/app-web/tests/original-dicom.test.ts`：3文件17项通过，其中新增顺序测试直接导入 capture，断言取消事件先于 renderer.render；既有 IMAGE_RENDERED 等待/失败/卸载边界不变。该 Node 测试没有实例化真实SVG过滤，也不替代真实像素；过滤的保留范围以上述DOM结构静态证据为准，最终截图由主线记录。

### 原图模块机械拆分复核追加

按文件长度约束将原图生产代码移到 `original_export.rs`、原图断言移到 `original_export_tests.rs`、原 main 测试移到 `main_tests.rs`，main 255行。独立逐段查看：来源授权表、SELECTION及io_error仍由主模块共享；copy/sync/hard_link无覆盖、完整size检查、实例去重/取消/新目录清理、全部原断言保持；仅命令注册路径改为 `original_export::save_original_files`，必要类型/函数改pub(super)。未增加依赖、IPC字段、权限或原图重编码。主线正在构建，审查方不争用Cargo锁；机械提取后Rust编译/全测试以主线随后的实际结果为准。
