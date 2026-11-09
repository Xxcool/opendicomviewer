# 桌面发行流水线独立审查

日期：2026-11-08。范围：`.github/workflows/desktop-release.yml`、`packages/app-tauri/testing/release-artifacts.mjs`。未改实现、未触发构建或发布；主线负责真实 runner、下载复验与 GitHub Release。

## 核对结果

- 仅 workflow_dispatch，输入固定40位小写提交 SHA 及受限版本标签；没有把输入直接插入 shell。SHA/tag 经环境变量传入 Bash 正则及 Node 二次检查。checkout 固定该 SHA，脚本再次对照 HEAD，避免“构建 main 最新但声明旧标签”。
- 标签 base version 与桌面 package.json、tauri.conf.json、Cargo.toml、Cargo.lock 主包一致。预发布标签后缀不会冒充另一个应用内部版本；manifest 同时记录 tag、applicationVersion 与 sourceCommit。
- 仓库权限 contents:read，checkout 不持久化凭据；流水线只上传 reviewable Actions artifact，不自行创建、移动标签或公开 Release。最终发布由主线在产物与检查核实后独立执行。
- Windows2022 x64 使用 x86_64-pc-windows-msvc + NSIS；macOS15 使用 aarch64-apple-darwin + app,dmg。独立通过 `gh api repos/actions/runner-images/contents/README.md` 解码核对当前官方表：`macos-15` 为 arm64；Intel 行使用 `macos-15-large` / `macos-15-intel`。不能凭旧标签记忆判断当前 runner 架构。
- pnpm frozen-lockfile、cargo test/build --locked；在目标 runner 执行 typecheck/lint/测试后打包。独立查看本地锁定 CLI `tauri build --help`，确认 --target、--bundles、--ci 及 `-- [ARGS]` 透传 runner 参数的形状。
- collect 从指定 target/release/bundle 找唯一非空产物；Windows收集一个 -setup.exe，macOS收集DMG并用 ditto 保留.app资源结构生成ZIP。独占创建输出目录，COPYFILE_EXCL 避免静默混入旧包；每包记录SHA256、大小，另含构建manifest及校验清单。
- manifest 如实声明无 Windows publisher certificate / Developer ID / notarization，且构建测试不等于平台 GUI 验收。签名、Windows安装启动与临床适用性不能由流水线绿灯推导。

## 独立执行与剩余边界

实际导入脚本调用 validateRelease(当前完整HEAD, `v0.1.0-alpha.1`) 通过；main 短引用、带shell字符/路径的tag和不匹配base version均拒绝。脚本命令与库函数共用实现，没有手抄另一套校验。`git diff --check` 通过。

尚未由本审查验证：云端工具链下载、Windows WebView2/NSIS、DMG构建、最终资产字节/架构、安装卸载及GitHub下载。runner能否使用指定Rust/Node/pnpm版本以真实作业为准；失败不允许削弱测试或改成“发布成功”。当前未发现静态注入、错误目录收集或版本映射阻塞，须等待主线真实构建与产物复验。

最终微调已复核：collect 在创建输出目录前校验 process.platform/process.arch 与 Windows x64 / macOS arm64 相符，manifest 记录 buildHost。collectPackages/writeManifest 拆分后，路径、无覆盖复制、哈希及版本校验调用关系保持一致。客户端 README 提供目标平台命令及未签名、GUI未验收边界；根 README 由主线按用户要求精简，不在本报告范围。
