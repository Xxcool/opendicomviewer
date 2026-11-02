# OpenDicomViewer

**在本机打开 DICOM，浏览原始影像与多平面重建。**

基于 React、TypeScript、Cornerstone3D 与 Tauri 2 的本地优先医学影像查看器，提供 Web 界面与桌面客户端。影像读取与解析在本机进行，无需上传到影像服务器。

**开发预览 / WIP** · [当前进度](docs/PROJECT_STATUS.md) · [浏览模式路线](docs/VIEWING_MODES_PLAN.md) · [桌面说明](packages/app-tauri/README.md) · [GitHub](https://github.com/Xxcool/opendicomviewer)

> 仅供研究、教学与非诊断参考使用。尚未经过临床验证，不用于疾病诊断、治疗决策或患者监护。

## 界面预览

### Web · 原始切片与 MPR

![Web 深色界面：原始切片、横断面、冠状面与矢状面](docs/reviews/assets/browser-2026-10-30/mpr-2x2.jpg)

2026-10-30 浏览器实测截图，展示 ICBM152 平均头部教学模板。左上为原始切片，其余三格为降采样 MPR；四格布局不等同于 3D 体绘制。

### 桌面客户端 · 本地影像入口

![macOS Tauri 客户端：本地文件入口与教学示例](docs/reviews/assets/tauri-2026-11-01/github-header.png)

2026-11-01 macOS 实测截图。桌面端复用 Web 工作区，提供原生文件/文件夹选择和本地文件读取。当前为验证版本，多视口/MPR 仍存在重绘与布局切换问题，见[阶段记录](docs/reviews/DELIVERY-2026-11-01-desktop-progress.md)。

<details>
<summary>查看 Web 浅色欢迎页</summary>

![Web 浅色欢迎页：打开文件夹、教学示例与拖入区](docs/reviews/assets/browser-2026-10-30/welcome-light.jpg)

2026-10-30 实测截图。界面仍在迭代，示例封面与实际数据的对应关系见页面内说明；封面不是兼容性或完整性证明。

</details>

以上为已有运行记录，使用仓库教学样本，不含本地真实性验证所用的患者数据；不代表本次重新完成全部界面验收。

## 当前能做什么

| 能力 | 当前范围 |
| --- | --- |
| 本地导入 | 文件、文件夹、DICOMDIR、ZIP 的解析通路已实现；提供取消与部分失败提示，真实 ZIP 拖入完整流程仍待验收 |
| 2D 浏览 | 序列列表、缩略图、翻层、调窗、平移、缩放、适应窗口与复位 |
| 独立分屏 | 2×2 各格浏览独立序列；与空间联动的 MPR 模式分开 |
| MPR | 有效空间几何的序列支持降采样三向重建、2×2 / 1+3 布局及基础翻层定位联动；定位像、普通 SC、单层或不适合建体的数据会说明原因 |
| 显示预设 | 通用及部位相关调窗预设、自动预设；实际适用范围由数据与可用元信息决定 |
| 数据提醒 | 缺层、几何、解码等问题在界面中显示；缺失标定不编造毫米或 HU 信息 |
| 外观 | 深浅主题、影像详情与专注模式 |
| 桌面运行 | Tauri 2 已在 macOS / Apple Silicon 构建并启动，原生选择文件/文件夹可用；Windows/Linux 尚未验收 |

具体支持以实际可解码的数据及几何检查为准，尚不承诺兼容所有厂商、传输语法或光盘结构。

**尚未交付：** 可编辑标注与测量、标注保存恢复、PNG/JPEG 与 DICOM/SR/GSPS 导出、2D Cine、3D 体绘制、真正的 4D 动态体积。详细范围见[导出计划](docs/EXPORT_PLAN.md)与[浏览模式路线](docs/VIEWING_MODES_PLAN.md)。

## 运行 Web

已验证的开发环境：Node.js 20.20.2、pnpm 12.5.1。浏览器需要可用的 WebGL2；建议先使用 Chromium 浏览器验证。

```bash
git clone https://github.com/Xxcool/opendicomviewer.git
cd opendicomviewer
pnpm install --frozen-lockfile
pnpm --filter @opendicomviewer/app-web dev
```

打开终端打印的地址。配置默认端口为 `3000`，占用时可自动切换；需要固定到之前的 `5173` 时执行：

```bash
pnpm --filter @opendicomviewer/app-web dev --host 127.0.0.1 --port 5173 --strictPort
```

进入欢迎页，选择本地影像文件夹/文件，或先打开 MR 教学示例。导入真实数据时，留意失败数量与数据提醒；单层影像可以二维浏览，但不因此具备 MPR 能力。

构建与预览：

```bash
pnpm --filter @opendicomviewer/app-web build
pnpm --filter @opendicomviewer/app-web preview
```

静态部署需复制完整的 `packages/app-web/dist/`。构建会将根目录 `sample-dicom/` 中的示例与清单一起写入产物，无需额外的示例服务。部署环境还需满足浏览器相关安全上下文与资源加载要求；部署不等于已经支持离线安装。

## 运行桌面客户端

先安装 Rust 与对应平台工具链，参见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools；此次本机使用 Rust 1.99.1。

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
```

桌面开发服务固定使用 `127.0.0.1:5174`。如终端未识别 Cargo，先按 Rust 安装提示加载其环境。

```bash
# 构建 macOS 应用
pnpm desktop:build
```

本机 macOS 输出位置：`packages/app-tauri/src-tauri/target/release/bundle/macos/OpenDicomViewer.app`。打包应用包含前端、Worker、解码资源与教学样本，运行不依赖 Vite 服务。

目前没有经签名、公证的正式安装包。桌面重绘问题、跨平台验证和文件授权生命周期仍在完善，详见[客户端说明](packages/app-tauri/README.md)。

## 开发与验证

```bash
pnpm test
pnpm typecheck
pnpm lint

# 桌面 Rust 检查
cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml
cargo fmt --check --manifest-path packages/app-tauri/src-tauri/Cargo.toml
```

测试与构建通过不代表界面、性能、跨平台和真实数据验收全部完成。各轮结果和限制记录在 [docs/reviews/](docs/reviews/)。

```text
packages/
  core/              领域模型、端口、几何排序与体积处理
  adapters/
    source-local/    DICOM / DICOMDIR / ZIP 与本地输入
    codec-wasm/      像素解码
    renderer-cs3d/   Cornerstone3D 渲染适配器
  app-web/           React 界面与组合根
  app-tauri/         Tauri 2 外壳、原生选择与受限文件读取
sample-dicom/        教学样本及来源材料
docs/                架构、计划、评审与验收证据
```

数据流：本地输入 → 候选文件 → 解析/序列组织 → 按需像素解码 → 渲染；MPR 另经几何校验与降采样体积路径。原始切片走全分辨率浏览，显示用体积不能替代原始数据上的数值测量。

- [架构设计](docs/ARCHITECTURE.md)与[编码约束](GEMINI.md)
- [项目进度与开源准备](docs/PROJECT_STATUS.md)
- [标注、测量与导出路线](docs/EXPORT_PLAN.md)
- [2D / MPR / 3D / Cine / 4D 路线](docs/VIEWING_MODES_PLAN.md)

## 隐私与已知限制

- 本地输入在本机处理，未接入影像上传服务、第三方字体或分析上报。示例通过当前应用来源加载；主动点击 GitHub 链接会访问外部网站。完整跨平台禁网流程尚未验收，不能将本地处理宣传为完整网络审计通过。
- 桌面多格、主题及布局切换组合下已发现画面变暗、文字缺笔及切面呈现异常；当前优先修复，暂不声明桌面稳定可用。
- 隐藏患者信息覆盖层不等于脱敏，像素中可能已烧录身份信息。真实患者文件、截图和完整本地路径不应提交到仓库或公开反馈中。

## 教学样本与许可

MR 头部示例由 McGill ICBM152 2009c 平均 T1 模板派生，默认包含 193 层连续轴位序列和一张中线矢状参考图。它是平均教学模板，不是个人原始检查；单独的参考图不支持 MPR。来源、许可、派生方法与哈希见[样本说明](sample-dicom/brain-head-mr/README.md)。原有 36 帧 MR 网格不连续，不作为 MPR 示例。

重现头部样本：

```bash
python3 packages/app-web/testing/generate-head-sample.py /path/to/mni_icbm152_nlin_asym_09c_nifti.zip
node packages/app-web/testing/generate-sample-previews.mjs
```

各样本、封面及第三方资源有各自许可边界，再分发材料仍需审查。当前仓库为私有开发仓库，尚未完成正式公开开源发布准备。

## 贡献与致谢

AI 辅助开发：[Codex](https://github.com/codex)，相关提交保留 `Co-authored-by` 署名。GitHub 侧栏的 Contributors 由平台按提交独立统计。

反馈时请附应用版本/提交、操作系统、Web 或桌面端、复现步骤及已去除隐私的错误信息。请先查看[已知问题和计划](docs/PROJECT_STATUS.md)，避免把尚未交付的功能误认为回归。

## 👨‍💻 作者 (Author)

- **Xxcool** · [GitHub (@Xxcool)](https://github.com/Xxcool) · [掘金技术主页](https://juejin.cn/user/4265760845468296/posts)

## 📄 开源许可 (License)

本项目代码采用 [Apache License 2.0](LICENSE) 开源协议。教学样本、示例封面及第三方资源遵循各自许可，详见相应目录中的来源与许可说明。
