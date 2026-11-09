# Tauri 2 桌面验证壳

复用 `app-web` UI、core、数据源与渲染器。Rust 只做原生选择/拖入、文件索引和会话级读取授权，不解析 DICOM、不通过 IPC 传像素。

本机验证目标：macOS 15.1.1 / Apple Silicon / WKWebView。Windows 安装包由原生 Windows runner 构建，构建成功不代表 Windows 界面验收通过；Linux 尚未验证。预发布未配置 Windows 发布者证书或 macOS Developer ID/公证。

## 运行

先按 [Tauri 官方前置条件](https://v2.tauri.app/start/prerequisites/) 安装 Rust 与对应平台开发工具；macOS 桌面可用 Xcode Command Line Tools。此次本机使用 Rust 1.99.1、Node 20.20.2、pnpm 12.5.1。

仓库根目录：

```bash
# rustup 安装时若未修改 PATH，在当前终端执行一次
. "$HOME/.cargo/env"
pnpm install --frozen-lockfile
pnpm desktop:dev
```

开发使用固定 `127.0.0.1:5174`；端口冲突会报错，不自动切换。页面与 Worker 共用 Web 构建配置，额外显式扫描共享 UI 类名并复制 `app-web/public`。

## 打包

```bash
. "$HOME/.cargo/env"
pnpm desktop:build
```

macOS 输出：`src-tauri/target/release/bundle/macos/OpenDicomViewer.app`。应用内嵌 UI、解码代码、Worker、封面、清单与示例，不需要 Vite 服务。Debug 打包可用 `pnpm --filter @opendicomviewer/app-tauri exec tauri build --debug --bundles app`。

当前包附带全套教学样本，体积不能按空壳估计。样本及封面的许可独立于应用代码，分发时保留来源材料。

在相应平台构建安装包（均在仓库根目录）：

```bash
# Windows x64 / MSVC、WebView2 开发环境
pnpm --filter @opendicomviewer/app-tauri exec tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked

# macOS Apple Silicon / Xcode Command Line Tools
pnpm --filter @opendicomviewer/app-tauri exec tauri build --ci --target aarch64-apple-darwin --bundles app,dmg -- --locked
```

目标产物分别位于 `src-tauri/target/<target>/release/bundle/nsis/` 和 `bundle/dmg/`、`bundle/macos/`。Windows x64 与 macOS arm64 分开提供，不将一种架构的包标为通用版。

### 可复现预发布包

[Desktop release packages](../../.github/workflows/desktop-release.yml) 仅由 `workflow_dispatch` 手动启动：填写完整 `source_commit` 与 `version_tag`（例如 `v0.1.0-alpha.1`）。两个目标都构建同一提交；tag 的基础版本必须与 Tauri、桌面 package、Cargo.toml/Cargo.lock 一致。预发布 tag 可带 `alpha`，本轮安装器内部版本仍为 `0.1.0`，不会冒充稳定版。

流水线执行冻结依赖安装、类型/Lint/测试、Rust locked 测试和目标平台打包；生成 Windows `-setup.exe`、macOS `.dmg` 与保留应用资源的 `.app.zip`，附各平台 `SHA256SUMS-*.txt` 和含源提交的 `build-*.json`。完整成功后，从 Actions Artifacts 下载核验，再由维护者使用 `gh release` 发布；该流水线只有仓库读取权限，不会自行创建或移动 tag，也不会直接公开未核对产物。

发布资产入口：[GitHub Releases](https://github.com/Xxcool/opendicomviewer/releases)。以每个预发布实际提供的资产和已知问题为准。构建/哈希核验、安装运行及 GUI 验收分开记录；Windows GUI、签名/公证及升级流程不能由 runner 构建成功推定完成。不提供绕过系统安全提示的步骤。

## 文件通路

1. 顶栏/欢迎页选择器，或系统拖入 → Rust 取得用户明确选择的路径。
2. 递归读取文件元数据，保留相对目录（支持 DICOMDIR/无扩展文件的后续解析），不跟随符号链接；空选择表示取消，空目录明确报错。
3. 初始 asset scope 为空，仅逐文件授权本次选择；授权不持久化，进程退出即失效。
4. IPC 只返回文件名、大小、路径与候选 ID。WebView 使用 `convertFileSrc` 和 512 KiB Range 请求读取像素，逐块验证 HTTP 206、Content-Range 和长度。
5. 原有 ImportCandidate → LocalDataSource → PixelCodec → CS3D 链路继续处理；所有宿主 API 留在 app 层。

限制：当前进程内的多次选取会保留此前授权到退出；尚未实现按“清空视图”撤销原生授权。未做路径持久缓存、自动扫描光盘、系统文件关联、更新或脱敏导出。

顶部 GitHub 按钮使用 Tauri 官方 opener 打开系统浏览器，权限范围仅为固定项目仓库 URL；不会在阅片 WebView 内导航或拼接影像信息。官方 GitHub Mark 来自 Primer Octicons，MIT 许可随前端 public/brand 分发。

## 检查

```bash
pnpm typecheck
pnpm lint
pnpm test
cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml
cargo fmt --check --manifest-path packages/app-tauri/src-tauri/Cargo.toml
```

桌面 `build` 会额外检查产物实际含共享布局样式、MR/CT 封面与样本清单，防止“编译通过但桌面资源不完整”。

macOS 的进程级离线烟测可用以下命令；不会关闭全机 Wi-Fi，也不是完整网络审计：

```bash
/usr/bin/sandbox-exec -f packages/app-tauri/testing/offline.sb \
  packages/app-tauri/src-tauri/target/release/bundle/macos/OpenDicomViewer.app/Contents/MacOS/opendicomviewer-desktop
```

此配置仅用于测试，命令是否在本轮实测通过以交付报告为准。正式跨平台的外网零请求验证仍需请求拦截与目标设备回归。
