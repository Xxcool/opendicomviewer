# 桌面 ZIP / 示例原始 DICOM 导出独立审查

日期：2026-11-09。审查范围为当前未提交的 `original-saver.ts`、`download-saver.ts`、`candidate.ts`、Rust `export_download.rs` / `download_format.rs` 和两端宿主接线。审查方未修改实现，未操作 GUI；界面、真实写盘、Windows WebView2 验收由主线另记。

## 结论

本轮代码检查与独立测试未发现已确认的新增阻塞缺陷。可以继续原生界面验收，不能仅凭 Node/Rust 测试关闭全部平台的下载完成行为。

## 链路核对

- `candidate.ts` 在实际创建原生候选时登记 `WeakSet<ImportCandidate>`；`original-saver.ts` 用对象身份选择原生 copy，而不是从 `desktop-` 等字符串猜测权限。ZIP 展开项即便继承原生文件 ID 前缀也不会复制整个压缩包冒充 DICOM。Rust 原始文件授权表及逐 ID/size 校验保持原有约束。
- 非原生候选读取既有 `ImportCandidate.read()`，复用 `originalDicomBlob`。单实例输出完整原始字节，多实例仅封装无压缩 ZIP，文件名使用序号；不编码像素、不覆盖源实例、不把新标注声称为已写入原图。
- 宿主 IPC 只传原始授权 ID/size 或 Blob URL/格式/大小/一次性请求 ID；没有影像数组、base64 或大二进制 IPC。下载保存位置仍由原生选择器确定，Blob URL 来源限定本应用及既有调试源。
- TS 与 Rust 对 PNG 100 MiB、DICOM/ZIP 512 MiB 分别设限；ZIP/示例路径在读取前以候选大小和每条128字节封装预算进行上限检查。PNG 原有 MIME/尺寸校验保留，未知格式显式拒绝。
- 通用下载桥先订阅再准备/下载；请求 ID 隔离完成事件，全局保存互斥；原生取消、失败、超时均撤销一次性授权和 Blob URL。Rust active 与 abandoned 分离，取消后的迟到 Finished 不发布目标，清理失败保留可重试记录；旧 PNG 有效边界未因通用化移除。
- Rust 检查本次私有 staging 中的普通文件、精确大小与 PNG/ZIP 签名，sync 后 hard_link 无覆盖发布。DICOM 使用不透明完整实例复制，不在 Rust 重新解析，也不强制原始数据必须带 Part 10 文件前导；这符合既有解析层边界。
- `main.rs` 同时改管理状态、命令注册、on_download 和退出 busy 检查；JS 的原始导出接入候选 + signal，新 PNG 路径使用同一下载桥，未遗留旧 PNG 事件名或命令接线。

## 独立验证

- `pnpm exec vitest run packages/app-tauri/tests/png-saver.test.ts packages/app-tauri/tests/original-saver.test.ts packages/app-tauri/tests/candidate.test.ts`：3文件15项通过。
- `pnpm exec vitest run packages/app-web/tests/original-dicom.test.ts packages/app-web/tests/png-capture.test.ts`：2文件11项通过。
- `/Users/xiabin/.cargo/bin/cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml`：14项通过。
- `git diff --check`：通过。
- 相关 Rust main 256行、下载模块171行，未新增依赖/权限/渲染后端。

## 验收边界与建议

- 建议主线补通用桥 DICOM/ZIP 的 format/filename 路由回归及非PNG取消：共享状态机已有PNG回归，新格式已有Rust发布/错误格式/尺寸用例，但不能将这些描述为已经覆盖真实WebView下载。
- 原生普通文件 copy 仍不消费中途 signal，进程崩溃事务仍未实现；本次只修 ZIP/教学样本无法原图导出的缺口，不得声称全部复制中断/强杀路径完备。
- ZIP 打包在 WebView 内执行且有512 MiB输出预算，不等于已经验证同规模设备峰值内存。原生路径保留直接copy避免普通大序列全量读入内存。
- 源字节仍可能含身份或像素烧录信息；导出不等于脱敏。SR/GSPS及源影像加测量的标准组合包不属于此次修复。
- macOS 必须实际验证 DCM/ZIP 保存、取消、再导入/字节一致；Windows 尚须 WebView2 实机验证。普通测试通过不代表所有平台均已验收。
