# OpenDicomViewer 项目进度与开源状态

更新：2026-11-03。本页维护当前能力与验收边界；历史过程见 reviews，后续执行顺序见 [实施计划](IMPLEMENTATION_PLAN.md)。

## 当前处于什么阶段

**当前是开发预览 / Alpha：Phase 1 MVP 尚未闭环，部分 Phase 2 交互和 Phase 3 桌面能力已提前落地。不能称“Phase 2 已完成”。**

这里的 `Phase 0–5` 是[架构路线](ARCHITECTURE.md#十四演进路线图)的产品阶段；问题中的 `P0/P1/P2` 若表示缺陷优先级，则与阶段无关。阶段按验收门槛判定，不以界面数量、提交数量或未经定义的百分比判断。

| 原阶段 | 当前状态 | 已有能力 | 尚缺的主要门槛 |
| --- | --- | --- | --- |
| Phase 0 技术验证 | 部分通过 | 最小 Stack 渲染、裸缓冲 MPR、版本与资源生命周期验证 | S1 千帧内存/导入、S2 真 GPU 帧时间、S3 部署矩阵、S4 十张真实脱敏光盘解析率 |
| Phase 1 MVP | 进行中 | 本地导入、原始切片浏览、调窗/平移/缩放、数据提醒、在线 Web 预览 | 基础测距/ROI/HU、导入完整性回归、Demo Gate |
| Phase 2 交互成熟 | 部分提前实现 | 独立 2×2、MPR 2×2 / 1+3、基础翻层定位、部分热键 | 桌面多轮切换绘制、完整相机/VOI/准星交互、Cine、命令面板与完整验收 |
| Phase 3 双端闭环 | 验证壳已运行 | macOS Tauri 打包、原生选择/拖入、受限 Range 读取 | 桌面显示稳定性、Windows/Linux、签名/公证、关联/更新、脱敏及既往对比 |
| Phase 4 高阶 | 未交付 | 可复用降采样体积基础 | 基础 3D 体绘制；高质量 VR、融合和预标注后置 |
| Phase 5 生态 | 未开始 | Ports & Adapters 边界 | 默认关闭的 DICOMweb、插件网关 |

4D 是[模式路线](VIEWING_MODES_PLAN.md)中的独立后续增量，需要时间维模型和真实时相数据；不因已有 MPR 或能逐层翻页而算完成。

2026-11-03 本轮新增：原始帧直线长度与三点角的纯计算模块、11 项数值/边界测试；尚未接入测量 UI。完整工作树 292 项测试通过（包含原有未提交内容）；独立计算评审与交付记录见 [本轮记录](reviews/DELIVERY-2026-11-03-measurement-foundation.md)。桌面背景滤镜实验及原样对照本次均通过十次布局/五次主题切换，因未建立因果而撤回，绘制缺陷仍未关闭。

## 已实现与已验收范围

| 能力 | 实现 / 证据 | 验收边界 |
| --- | --- | --- |
| 本地文件、目录、DICOMDIR、ZIP 导入 | [导入编排](../packages/app-web/src/import-flow.ts)、[本地适配器](../packages/adapters/source-local/src/source-local.ts) | 取消、部分失败与几何提醒有实现；不承诺全部厂商、语法和目录结构 |
| 2D 原始影像浏览 | [Viewport](../packages/app-web/src/components/Viewport.tsx)、[渲染适配器](../packages/adapters/renderer-cs3d/src/cornerstone-renderer.ts) | 全分辨率 Stack；显示用降采样体积不能作测量真源 |
| 调窗预设 | [预设实现记录](reviews/CR-2026-10-30-window-presets.md)、[core 预设](../packages/core/pipeline/window-presets.ts) | 自动预设、部位分组已落地；不等于所有模态预设已覆盖 |
| 独立多视口与 MPR | [分屏记录](reviews/DELIVERY-2026-10-30-independent-split.md)、[浏览器记录](reviews/CR-2026-10-30-browser-acceptance.md) | 独立分屏与空间联动分开；MPR 要求有效体积几何。桌面多轮回归仍失败 |
| macOS 桌面壳 | [客户端说明](../packages/app-tauri/README.md)、[桌面阶段记录](reviews/DELIVERY-2026-11-01-desktop-progress.md) | Apple Silicon / WKWebView 构建与启动；非三平台正式发行版 |
| 真实 ZIP 原生拖入 | [2026-11-02 验证记录](reviews/DELIVERY-2026-11-02-viewer-followup.md) | 已实测一个 25 帧包和一个 2 帧定位像/SC 包；不替代 Web 拖放、逐帧像素比对或第三份 ZIP 验收 |
| 欢迎页、主题与顶栏 | [WelcomeScreen](../packages/app-web/src/components/WelcomeScreen.tsx)、[顶部记录](reviews/DELIVERY-2026-11-02-viewer-followup.md) | `eb60d2a` 统一页头/工具栏边距；`56d192e` 使用指定脑部封面并删除折叠说明，桌面已查看 |
| 仓库与 Web 交付 | [GitHub](https://github.com/Xxcool/opendicomviewer)、[在线预览](https://opendicomviewer.pages.dev/)、[部署记录](reviews/DELIVERY-2026-11-02-cloudflare.md) | 公开仓库、Apache-2.0 LICENSE、main CI 与 Pages 自动部署已接入；不等于正式桌面 Release |

## 当前阻塞与在制工作

| 工作 | 当前事实 | 关闭条件 |
| --- | --- | --- |
| 桌面 MPR 变暗 / 裁字 | 原生窗口确有故障。先前合成层、画布与渲染模式候选重复回归失败；最新去除模糊与恢复模糊的对照均通过 10 次布局 / 5 次主题切换，尚不能确立因果，实验已撤回 | 独立复现定位后最小修复；多轮布局、主题、尺寸和序列切换均完整显示，不能靠手工缩放恢复 |
| 既有导入改动收敛 | 7 个代码/测试文件仍为本地改动，未混入欢迎页和顶栏提交 | 按产生→解析→分组→显示链路独立审查，补必要测试后单独提交；不能将工作树表现推定为远端行为 |
| Web 最终界面验收 | 此前有浏览器证据；最近本地访问被自动审批的已保存权限设置阻止 | 访问真正恢复后完成窄屏、ZIP 拖放和最新版本回归；不绕过限制、不填“通过” |
| 独立评审 | 现有实施方记录不等同于独立评审 | 每个功能增量由另一评审方核对错误路径、生命周期与证据，结果追加在 reviews |

上述 7 个文件为 source-local 的 `parse.ts`、`scanner.ts`、`source-local.ts`、两份测试，以及 `warning-presentation.ts`、`core/domain/types.ts`。`.trae/` 为既有未跟踪资料。保留内容和归属，相关审查前不自动暂存。

## 未交付功能

- **标注与测量 UI**：直线、箭头、文字、ROI、角度/Cobb 角、自由轮廓、选择/编辑/删除、撤销重做、显式保存恢复尚未交付。纯几何计算已实现物理测距与角度，并新增数值测试；领域计算与现有 `MeasurementRecord`、`MeasurementPort` 不等于可用工具，细则见[标注计划](ANNOTATION_PLAN.md)。
- **导出**：PNG、原始 DICOM、DICOM SR、GSPS；JPEG 可选、JSON 用于版本化保存恢复。原始复制与含标注的结果对象分开；细则见[导出计划](EXPORT_PLAN.md)。
- **浏览扩展**：2D Cine、自由准星及完整相机/VOI 同步、基础 3D、真正的 4D；细则见[模式路线](VIEWING_MODES_PLAN.md)。
- **兼容与规模**：更多压缩语法、彩色/更多多帧场景、千帧与低内存/长期会话验收。当前压缩解码器支持 RLE 与 JPEG Lossless，不能由架构目标清单推定其他语法已经支持，见 [PixelCodec](../packages/adapters/codec-wasm/src/codec.ts)。
- **桌面与隐私闭环**：跨平台分发、签名/更新/文件关联、授权撤销、用户可控缓存、PS3.15 白名单脱敏、UID 映射与烧录信息复核。
- **后续生态**：既往对比工作流、PET-CT 融合、本地预标注、DICOMweb、插件；不挤占基础正确性和工具闭环。

## 是否达到初步开源标准

**作为明确标注 WIP 的公开项目，仓库与在线体验已具备基本入口；作为稳定 MVP 或正式桌面版本，尚未达到原计划验收门槛。**

| 项目 | 当前事实 | 仍需完成 |
| --- | --- | --- |
| 代码许可与文档 | 根 LICENSE、双端运行与部署说明已存在 | 补贡献/安全说明、变更记录、适用的第三方说明；不把规划中的文件当作已有 |
| 样本与封面 | ICBM152 来源/许可有记录；参考封面有 provenance | 完整核对原有 MR/CT 与参考封面的再分发依据；代码许可不覆盖第三方资产 |
| 自动检查 | CI 执行类型检查、Lint、Vitest；Pages 构建另执行检查与 Web 构建 | 浏览器零外域请求和像素链路、桌面/目标设备、SBOM 与依赖审计尚未形成完整门禁 |
| 可用性 | 可演示本地浏览和部分 MPR | 修复桌面显示，补基础测量、真实输入与性能证据 |
| 发布 | main 自动部署 Web，尚无已验收正式安装包 | 目标平台构建、签名、校验清单、下载复验；标签和正式 Release 另获授权 |

原 Demo Gate 要求三份不同来源真实脱敏光盘加一个公开数据集全流程通过，并有首屏 < 2 s、调窗 p95 < 16.7 ms 和零报错证据；目前没有整组通过记录。线上能打开示例不能替代这组门槛。原路线图的周数属于规划假设，不作为当前交付承诺。

## 验证记录的读法

最新本地验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`（312 项 / 29 文件）、Web 构建和 Tauri Debug 构建通过；独立合成绘制诊断入口构建通过。三种变异（错误坐标逆变换、撤销分支错误、绕过多帧二维限制）均被测试捕获。真实 Enhanced 多帧临床数据、测量 UI 和诊断入口桌面视觉验收未由这些测试证明。远端检查以本次提交实际结果为准。

每项交付继续记录：提交、改动文件、数据范围、实际命令、界面证据、未覆盖项和独立评审状态。最新执行队列与完成门槛集中在 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。

## 本轮推进：多帧与标注基础

- 标准 PlanePosition/PlaneOrientation/PixelMeasures 功能组逐帧读取；未知、重复位置或方向变化的多帧保留二维浏览，不推算层位置后开放 MPR。标准嵌套字节流、逐帧像素和非体积判定有集成回归。仅覆盖现有灰度与解码范围，不代表完整 Enhanced SOP 支持声明。
- `MeasurementSession` 提供内存记录、不可变快照、撤销/重做和未保存状态；像素/患者坐标双向转换覆盖不等距、斜切和舍入 IOP。均为工具基础，测量 UI 尚未交付。
- CS3D 合成绘制诊断入口已补充；桌面 MPR 缺陷仍未关闭。
