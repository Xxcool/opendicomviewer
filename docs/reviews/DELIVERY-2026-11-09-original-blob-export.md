# 桌面 ZIP 与内置样本原图导出修复

日期：2026-11-09。对应发布说明中的“桌面 ZIP 展开项及内置样本暂不支持原始 DICOM 导出”。本记录描述新源码，不改变已经发布的 alpha.1 安装包。

## 原因与改动

旧桌面保存器只接受 Rust 已授权路径的来源 ID，ZIP 展开项和内置样本没有该路径。现在 `original-saver.ts` 按原生候选对象身份选择直接复制，其他来源读取 `originalCandidates()` 保留的原始字节，再交给 WebView Blob 下载及原生保存对话框。禁止以 ID 前缀判断来源，禁止把压缩包当作原始实例复制。

原 PNG 下载状态机抽为 `download-saver.ts` / `export_download.rs`，增加 DICOM/ZIP 白名单，保留同源一次性授权、大小核对、同步落盘、无覆盖发布、取消和迟到完成保护。IPC 只有 URL/ID/大小/格式，不传影像二进制。原图打包上限512 MiB；原生路径直接复制不因本修复进入内存打包。

## 实际验收

使用 `pnpm desktop:build` 产出的 macOS arm64 应用，全部为已有可分发教学样本，不使用真实患者数据。

- CT 内置样本保存 `original-instance.dcm`，530638字节，与内嵌 `ct-slice-001.dcm` 完全一致。
- MR 内置样本当前序列保存 `original-series.zip`，包含193个完整实例；Python `zipfile` 解包逐个对照 `head-axial-*.dcm`，全部字节一致。ZIP SHA-256：`08c0ce0567ac9e22f1a51b4556239e7d306fe6587e90ada31dd5e8bf703d144a`。
- 原生选择该ZIP重新导入，界面显示1个序列、193帧；再导出当前实例 `zip-roundtrip.dcm`，与最初 `head-axial-000.dcm` 字节一致。
- 取消原生保存选择器，界面明确显示“已取消保存”，不显示成功；随后再次保存正常。
- PNG 通过通用桥另存后界面显示“PNG已保存”，磁盘文件带标准PNG签名。
- 本地证据文件位于 `/private/tmp/odv-known-issues-20261109`，不提交二进制产物。

## 验证与审查

- `pnpm typecheck`、`pnpm lint`、`pnpm test`；Web构建与Tauri Release应用构建。
- `/Users/xiabin/.cargo/bin/cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml`：14项通过。
- 来源身份变异自检：将真实对象身份判定故意改为所有来源均直接复制，`original-saver.test.ts` 变红；恢复后通过。
- 独立审查见 [CR-2026-11-09-desktop-original-blobs.md](CR-2026-11-09-desktop-original-blobs.md)。建议补新格式桥路由与取消测试已采纳。

## 其他已知问题的本轮取证

同一打包应用及193帧教学数据，实际执行十轮 MPR 2×2→1+3→2×2，每轮交替主题，后五轮切换详情栏宽度。最终截图中三向影像与HUD完整，未手工resize恢复。本轮未复现历史重绘问题，也没有针对其根因的代码修复，因此不将D1标为已解决。下一步仍应在异常现场对照持久2D画布、相机和窗口合成结果。

## 边界

Windows实际保存未验收；原生文件复制的中途取消、崩溃事务未完成；512 MiB附近内存峰值未测。此修复不增加SR/GSPS、脱敏、3D或4D，也不修改降采样MPR不能作为测量真源的约束。已发布alpha.1保留原有能力声明，后续版本才能包含本修复。
