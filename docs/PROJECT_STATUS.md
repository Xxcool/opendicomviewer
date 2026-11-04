# OpenDicomViewer 项目进度与开源状态

更新：2026-11-04。本页维护当前能力与验收边界；历史过程见 reviews，后续执行顺序见 [实施计划](IMPLEMENTATION_PLAN.md)。

## 当前处于什么阶段

**当前是开发预览 / Alpha：Phase 1 MVP 尚未闭环，部分 Phase 2 交互和 Phase 3 桌面能力已提前落地。不能称“Phase 2 已完成”。**

这里的 `Phase 0–5` 是[架构路线](ARCHITECTURE.md#十四演进路线图)的产品阶段；问题中的 `P0/P1/P2` 若表示缺陷优先级，则与阶段无关。阶段按验收门槛判定，不以界面数量、提交数量或未经定义的百分比判断。

| 原阶段 | 当前状态 | 已有能力 | 尚缺的主要门槛 |
| --- | --- | --- | --- |
| Phase 0 技术验证 | 部分通过 | 最小 Stack 渲染、裸缓冲 MPR、版本与资源生命周期验证 | S1 千帧内存/导入、S2 真 GPU 帧时间、S3 部署矩阵、S4 十张真实脱敏光盘解析率 |
| Phase 1 MVP | 进行中 | 本地导入、原始切片浏览、调窗/平移/缩放、数据提醒、单视口测距/箭头/文字、在线 Web 预览 | ROI/HU、工具双端完整验收、导入完整性回归、Demo Gate |
| Phase 2 交互成熟 | 部分提前实现 | 独立 2×2、MPR 2×2 / 1+3、基础翻层定位、部分热键、二维播放控制 | 桌面 MPR 多轮切换绘制、完整相机/VOI/准星交互、播放完整验收、命令面板 |
| Phase 3 双端闭环 | 验证壳已运行 | macOS Tauri 打包、原生选择/拖入、受限 Range 读取 | 桌面显示稳定性、Windows/Linux、签名/公证、关联/更新、脱敏及既往对比 |
| Phase 4 高阶 | 未交付 | 可复用降采样体积基础 | 基础 3D 体绘制；高质量 VR、融合和预标注后置 |
| Phase 5 生态 | 未开始 | Ports & Adapters 边界 | 默认关闭的 DICOMweb、插件网关 |

4D 是[模式路线](VIEWING_MODES_PLAN.md)中的独立后续增量，需要时间维模型和真实时相数据；不因已有 MPR 或能逐层翻页而算完成。

2026-11-04 本轮已把领域基础接入可见工具：1×1 原始 Stack 的测距、箭头、文字、列表、编辑删除、撤销/重做与显式 JSON 保存；二维播放接入单视口及独立分屏活动格。桌面退出保护与最新 GUI 验收见[本轮记录](reviews/DELIVERY-2026-11-04-tools-ui.md)。这些新增能力不代表 HU 单位确认、角度或标准导出已经交付。桌面 MPR 重绘问题保留，但不再阻塞可靠 Stack 功能的推进。

## 已实现与已验收范围

| 能力 | 实现 / 证据 | 验收边界 |
| --- | --- | --- |
| 本地文件、目录、DICOMDIR、ZIP 导入 | [导入编排](../packages/app-web/src/import-flow.ts)、[本地适配器](../packages/adapters/source-local/src/source-local.ts) | 取消、部分失败与几何提醒有实现；不承诺全部厂商、语法和目录结构 |
| 2D 原始影像浏览 | [Viewport](../packages/app-web/src/components/Viewport.tsx)、[渲染适配器](../packages/adapters/renderer-cs3d/src/cornerstone-renderer.ts) | 全分辨率 Stack；显示用降采样体积不能作测量真源 |
| 标注与测量 | [工具界面](../packages/app-web/src/annotations/AnnotationControls.tsx)、[绘制层](../packages/app-web/src/annotations/AnnotationLayer.tsx)、[会话](../packages/core/measurement/session.ts) | 当前限 1×1 原始 Stack 的测距、箭头、文字；分屏/MPR 测量及 ROI/HU/角度未实现，GUI 范围见本轮记录 |
| 标注 JSON 保存 | [会话桥](../packages/app-web/src/annotations/AnnotationContext.tsx)、[桌面保存](../packages/app-tauri/src-tauri/src/main.rs) | 原生保存成功才清除相应保存点；Web 下载需用户确认；新增 v1 备份恢复；源序列/SOP/帧与坐标校验通过后原子替换，桌面恢复/定位/再编辑/撤销重做已实测 |
| 二维播放 | [CineControls](../packages/app-web/src/components/CineControls.tsx)、[控制器](../packages/app-web/src/components/cine-controller.ts) | 单视口与独立分屏活动格可播放/暂停、选速度及循环；fps 是用户播放速度，不代表采集时间或 4D |
| 调窗预设 | [预设实现记录](reviews/CR-2026-10-30-window-presets.md)、[core 预设](../packages/core/pipeline/window-presets.ts) | 自动预设、部位分组已落地；不等于所有模态预设已覆盖 |
| 独立多视口与 MPR | [分屏记录](reviews/DELIVERY-2026-10-30-independent-split.md)、[浏览器记录](reviews/CR-2026-10-30-browser-acceptance.md) | 独立分屏与空间联动分开；MPR 要求有效体积几何。桌面多轮回归仍失败 |
| macOS 桌面壳 | [客户端说明](../packages/app-tauri/README.md)、[桌面阶段记录](reviews/DELIVERY-2026-11-01-desktop-progress.md) | Apple Silicon / WKWebView 构建与启动；非三平台正式发行版 |
| 真实 ZIP 原生拖入 | [2026-11-02 验证记录](reviews/DELIVERY-2026-11-02-viewer-followup.md) | 已实测一个 25 帧包和一个 2 帧定位像/SC 包；不替代 Web 拖放、逐帧像素比对或第三份 ZIP 验收 |
| 欢迎页、主题与顶栏 | [WelcomeScreen](../packages/app-web/src/components/WelcomeScreen.tsx)、[顶部记录](reviews/DELIVERY-2026-11-02-viewer-followup.md) | `eb60d2a` 统一页头/工具栏边距；`56d192e` 使用指定脑部封面并删除折叠说明，桌面已查看 |
| 仓库与 Web 交付 | [GitHub](https://github.com/Xxcool/opendicomviewer)、[在线预览](https://opendicomviewer.pages.dev/)、[部署记录](reviews/DELIVERY-2026-11-02-cloudflare.md) | 公开仓库、Apache-2.0 LICENSE、main CI 与 Pages 自动部署已接入；不等于正式桌面 Release |

## 已知问题与在制工作

| 工作 | 当前事实 | 关闭条件 |
| --- | --- | --- |
| 桌面 MPR 变暗 / 裁字 | 原生窗口曾复现；现有合成层、画布与渲染模式实验未建立稳定根因，未保留无效补丁。按用户要求降为独立已知问题，不阻塞 Stack 工具/播放/导出 | 后续定位最小修复并完成多轮布局、主题、尺寸及序列切换；不能靠手工 resize 恢复后宣称关闭 |
| 真实输入与多帧覆盖 | 既有 7 个导入相关文件已在 `c783dd5` 收敛提交；标准多帧合成字节流回归已通过 | 补更多真实 Enhanced/厂商输入与逐帧核对，不把合成测试视作所有临床数据支持声明 |
| Web 最终界面验收 | 此前有浏览器证据；最近本地访问被自动审批的已保存权限设置阻止 | 访问真正恢复后完成窄屏、ZIP 拖放和最新版本回归；不绕过限制、不填“通过” |
| 独立评审 | 现有实施方记录不等同于独立评审 | 每个功能增量由另一评审方核对错误路径、生命周期与证据，结果追加在 reviews |

`.trae/` 为既有未跟踪资料，继续保留，不混入功能提交。独立审查发现与复核报告采用追加新文件的方式保留历史。

## 未交付功能

- **标注与测量扩展**：HU 单位确认、角度/Cobb 角、自由轮廓、独立分屏工具、批量清空、隐藏/显示尚未交付。当前基础工具不覆盖这些目标；纯三点角计算也不等于角度 UI，细则见[标注计划](ANNOTATION_PLAN.md)。
- **导出**：PNG、原始 DICOM、DICOM SR、GSPS；JPEG 可选、JSON 用于版本化保存恢复。原始复制与含标注的结果对象分开；细则见[导出计划](EXPORT_PLAN.md)。
- **浏览扩展**：二维播放完整双端验收、真实时间轴、自由准星及完整相机/VOI 同步、命令面板、基础 3D、真正的 4D；细则见[模式路线](VIEWING_MODES_PLAN.md)。
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
| 可用性 | 可演示本地浏览、基础 Stack 标注与部分 MPR；二维播放已接入 | 补 ROI/HU、工具完整双端验收、真实输入与性能证据；桌面 MPR 已知问题单列跟踪 |
| 发布 | main 自动部署 Web，尚无已验收正式安装包 | 目标平台构建、签名、校验清单、下载复验；标签和正式 Release 另获授权 |

原 Demo Gate 要求三份不同来源真实脱敏光盘加一个公开数据集全流程通过，并有首屏 < 2 s、调窗 p95 < 16.7 ms 和零报错证据；目前没有整组通过记录。线上能打开示例不能替代这组门槛。原路线图的周数属于规划假设，不作为当前交付承诺。

## 验证记录的读法

最新本地验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`（324 项 / 30 文件）、Web 构建和 Tauri Debug 构建通过；Rust `cargo test` 5 项通过。基础坐标、会话及 Cine 控制器的数值/状态测试不能替代完整 GUI；独立审查与界面结果见[本轮记录](reviews/DELIVERY-2026-11-04-tools-ui.md)。真实 Enhanced 多帧、浏览器最新工具交互与桌面 MPR 稳定性仍有未覆盖项，远端检查以本次提交实际结果为准。

每项交付继续记录：提交、改动文件、数据范围、实际命令、界面证据、未覆盖项和独立评审状态。最新执行队列与完成门槛集中在 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。

## 当前基础与工具链路

- 标准 PlanePosition/PlaneOrientation/PixelMeasures 功能组逐帧读取；未知、重复位置或方向变化的多帧保留二维浏览，不推算层位置后开放 MPR。标准嵌套字节流、逐帧像素和非体积判定有集成回归。仅覆盖现有灰度与解码范围，不代表完整 Enhanced SOP 支持声明。
- `MeasurementSession` 提供内存记录、不可变快照、撤销/重做和未保存状态；像素/患者坐标双向转换覆盖不等距、斜切和舍入 IOP。当前已接入原始 Stack 工具；帧身份同时包含会话、序列、SOP 与 frameIndex。
- CS3D 合成绘制诊断入口已补充；桌面 MPR 缺陷仍未关闭。

最新：矩形/椭圆ROI界面与原图统计、控制点编辑及JSON重算恢复已实现；导入真实阶段百分比与Spinner类名修正已交付。完整边界及尚缺独立复审见[本轮记录](reviews/DELIVERY-2026-11-04-progress-roi.md)。
