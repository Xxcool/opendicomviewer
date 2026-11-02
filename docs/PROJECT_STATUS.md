# OpenDicomViewer 项目进度与初步开源评估

## 最新快照：2026-11-02

本节优先于下方保留的历史盘点。仓库现已公开，默认分支 `main`；Web 已部署到 [Cloudflare Pages](https://opendicomviewer.pages.dev/)。本轮开始时远端 CI 与 Pages 检查均成功，历史“私有空仓库、未上传、未部署”不再适用。

- **已交付**：页头和工具栏统一 12px 左右外边距；实际桌面窗口核对。
- **本轮实测**：真实 ZIP 原生拖入，25 帧断层保留 25/25，另一个定位像/SC 包保留 2/2，第二张原有规划线可见。未宣称全部格式、全部输入和 Web 拖放均已验收。
- **仍在进行**：桌面 MPR 多轮布局/主题切换后的绘制截断；本轮候选均因重复回归失败而撤回，未伪称修复。
- **待实现**：[标注与测量交互](ANNOTATION_PLAN.md)、[PNG/DICOM/SR/GSPS 导出](EXPORT_PLAN.md)、Cine、3D、4D。测量和多视口导出继续以显示/坐标正确性为前提。
- **验收受阻**：用户重新允许后，浏览器自动审批仍拒绝本地 Web 页面的访问；窄屏和 Web 拖放未通过验收。独立评审待补。

本轮依据：[交付与验证记录](reviews/DELIVERY-2026-11-02-viewer-followup.md)。原有 7 个未提交代码/测试文件及 `.trae/` 保留，不混入本次增量。

---

盘点日期：2026-11-01（初稿 2026-10-30，已复核本地状态并重跑检查）。范围为当前本地工作树、架构路线图、设计约定、测试和本地提交记录。旧评审记录表示当时的状态；以下以最新实现与验证证据为准。没有用一个未经定义的“完成百分比”代替可交付范围。

**当前判断：Phase 1 MVP 尚未收尾，部分 Phase 2 能力已提前落地。** 本地打开影像、原始切片浏览、调窗和教学 MPR 已形成可运行链路；测量、真实数据覆盖、性能验证与开源发布基础尚未闭环。

作为开发中的 WIP/alpha 源码项目，补齐许可证、资产来源、真实状态说明和基本发布材料后可以先公开。按原路线图“可用 MVP / Demo Gate”的标准，目前仍未达标。高阶体绘制、AI、桌面端和 DICOMweb 不是早期开源的前置条件。

**状态口径**

- **完成**：有实现和对应验证证据；支持范围按下面的限制理解。
- **进行中**：已编码、已有部分结果或仍在本地未提交，验收/评审尚未闭环。
- **未开始**：未找到对应交付实现；文档接口、计划或空实现不算功能完成。
- **待优化/待验证**：基础能力已存在，但覆盖、性能、交互或公开发布材料仍不足。

**阶段总览：原定路线与实际进度**

| 原阶段 | 当前状态 | 已有成果 | 尚缺 | 证据 |
| --- | --- | --- | --- | --- |
| Phase 0 技术验证 | 部分完成 | Spike A 最小渲染、Spike B 三向体积；CS3D 版本及缓存约束已落地 | S1 千帧内存/导入、S2 真 GPU/iPad 帧时间、S3 SAB/部署矩阵、S4 十张光盘解析率 | E1、E2 |
| Phase 1 MVP | 进行中 | 本地导入、排序、Stack 浏览、调窗/平移/缩放、失败提示、静态构建 | 测距/ROI/HU、真实光盘验收、上线 Demo、发布材料 | E1、E3、E4 |
| Phase 2 交互成熟 | 部分提前实现 | MPR 2×2 / 1+3、准星随翻层联动、部分热键、面板/专注模式 | 独立分屏最终验收、完整空间/VOI 联动、电影播放、命令面板、桌面验证壳 | E5、E6、E7 |
| Phase 3 双端闭环 | 进行中 | macOS Tauri 验证壳、原生选择器、asset Range、Debug/Release 构建；见 E16 | 桌面多视口绘制正确性、跨平台、系统关联、光盘索引、PS3.15 脱敏、既往对比工作流 | E1、E8、E16 |
| Phase 4 高阶 | 未开始 | 已有可复用降采样体积基础 | 基础 VR、高质量 VR、PET-CT 融合、本地 ONNX 预标注 | E1、E7 |
| Phase 5 生态 | 未开始 | Ports & Adapters 扩展边界 | DICOMweb 客户端、插件网关；网络功能须默认关闭 | E1、E8 |

Phase 0 没有完整验收就进入业务开发，与原计划“先验证”的顺序不一致。下一阶段应补关键验证和公开发布基础，控制新增功能，避免把可演示误当作已满足规模、性能和真实数据要求。原路线图的周数是规划假设，不是本次核实的交付期限。

**已经完成的具体能力**

| 能力 | 当前可用范围与限制 | 证据 |
| --- | --- | --- |
| 分层架构 | core 纯 TS，数据源/解码/渲染适配器与 React 壳隔离；ESLint 有边界检查 | E3、E8 |
| 本地导入主链 | 文件/文件夹/拖入/ZIP、DICOMDIR、取消及部分失败提示有实现；不能据此宣称各种光盘均兼容 | E4 |
| 排序与几何 | 按空间位置排序、方向/层距/缺层检查；不以 InstanceNumber 充当空间排序真源 | E8 |
| 原始灰度显示 | 原始 Stack；物理灰度/窗映射、方位与比例尺；已有 phantom 和适配器测试 | E8、E9 |
| 基础浏览 | 翻层、层号跳转、缩放、平移、适应窗口、复位及部分热键 | E5、E9 |
| 自动窗与 CT 部位预设 | BodyPartExamined 标签贯通；胸/头/腹/四肢/脊柱组，未知使用通用组；自动优先文件窗、否则估算 | E10 |
| 非 CT 预设边界 | MR/CR/DX 提供自动窗，不套 CT 部位参数；MR 序列专用预设尚未扩展 | E10 |
| MPR 基础 | 有效连续体积的三向降采样显示；缺层、非均匀几何或单层会明确拒绝 | E5、E8 |
| MPR 布局与定位 | 原始 Stack + 三向图；2×2 / 1+3 互切保留同序列准星定位；准星跟随翻层 | E5 |
| 各视图适配与缩略图 | 三向适配、窗口改变后的覆盖层刷新、缩略图完整边界已有实现及先前浏览器验收 | E5、E9 |
| 工作台 UI | 左上品牌/名称、统一操作图标、欢迎页、深浅主题直接切换、序列/详情、设置、专注阅片 | E5、E7 |
| 教学 MR 样本 | ICBM152 平均模板派生 193 层轴位 + 单层矢状面；来源、许可及哈希随附；不是个人原始检查 | E11 |
| 解码基础 | 未压缩灰度及 RLE、JPEG Lossless 路径；压缩库按需加载；其他传输语法和彩色不能泛称支持 | E12 |
| 自动检查基础 | 工作树 23 文件 / 267 测试；排除原有改动的隔离副本 23 / 264；两套类型、lint、构建通过 | E3、E6 |
| CI 定义 | 已有 GitHub Actions 的类型检查、lint、测试工作流；没有本仓库远端 CI 成功记录可引用 | E3、E13 |

**正在进行与待闭环**

| 事项 | 已到哪一步 | 剩余动作 | 证据 |
| --- | --- | --- | --- |
| 普通四格独立分屏 | 代码完成，单层可用；共用句柄/索引/VOI/相机隔离有测试；双 MR 及真实 file chooser 导入四序列已实测 | 四种序列同屏、独立调窗/翻层/相机、浅色/窄屏、键盘、MPR 回归及独立评审 | E6 |
| 原有导入修复 | parse/scanner/source-local、相关测试、告警和类型共 7 个文件原有改动仍未提交；工作树测试通过 | 明确评审与归属后单独收敛提交，不混入本轮功能 | E4、E14 |
| UI/架构文档对齐 | 有设计基线和多轮交付/评审记录 | 清理旧“固定轴向”“MPR 后续接入”“测量面板”等过时描述；设置页版本描述按发布阶段统一 | E1、E7 |
| 浏览器验收 | 先前欢迎页、主题、设置、MPR、CT 自动窗等有截图记录；新分屏完成部分实测 | 最终版本完整回归和可重复证据；现仍受浏览器已保存权限策略阻挡 | E5、E6 |
| 脚本/单测到真实环境 | 基本检查及临时隔离构建通过 | 全新环境依赖安装、完整静态产物预览、真实 Worker 路径和目标设备验证 | E3、E4、E6 |

**尚未开始或没有交付实现的计划**

| 计划 | 状态 / 说明 | 所属范围与证据 |
| --- | --- | --- |
| 直线测距、角度、矩形/椭圆 ROI、均值/标准差/HU | 未开始交付；只有 MeasurementRecord/MeasurementPort 和空实现，不能当成可用工具 | Phase 1 测距/统计；其余工具按范围分增量，E1、E8 |
| 标注保存、恢复、导出 | 未开始；StoragePort 只有契约，IndexedDB/OPFS 与加密策略未定 | E1 附录 D、E8 |
| 用户可控的 OPFS 影像缓存、占用展示与清理 | 未交付；默认关闭、显式开启与退出清理仍是设计约定 | E1 §8.2、E8 |
| 电影播放与帧率控制 | 未开始；2D Cine 与完整 4D 分开交付 | Phase 2，E1、[模式路线](VIEWING_MODES_PLAN.md) |
| 3D 体绘制、4D 动态体积 | 均未实现；3D 已在原架构规划，4D 补时间维建模、真实时相与能力判定，不能以多帧播放代替 | [模式范围与验收路线](VIEWING_MODES_PLAN.md) |
| 完整热键体系、命令面板、快捷键编辑 | 仅部分基础热键完成，其余未交付 | Phase 2，E1、E7 |
| 平板完整触控手势 | 双指捏合/平移、长按轮盘、MPR 旋转等没有完整交付验收；不能由桌面鼠标操作推定 | E1 §10.2、E5 |
| 任意点击/拖动十字准星、三向相机/VOI 完整同步 | 基础翻层定位已有；自由定位和完整同步未交付 | Phase 2，E1、E5 |
| JPEG Baseline、JPEG-LS、JPEG2000、Deflated 及彩色/更多多帧覆盖 | 当前不在已实现解码范围；需按 SOP/传输语法明确分批 | E12、E1 附录 C |
| 千帧、大尺寸、低内存与真实光盘测试集 | 未完成原计划验收，不能承诺“秒开所有影像” | Phase 0 S1/S4、Demo Gate，E1 |
| 真 GPU 帧时间、首屏、主线程阻塞、内存回收/长期会话 | 未完成性能基线 | Phase 0 S1/S2、E1 §11 |
| SAB/COOP/COEP、托管兼容与回退矩阵 | 未完成可验证部署矩阵 | Phase 0 S3，E1 |
| 在线静态 Demo 与明确版本发布 | 未开始对外发布；本地构建不等于已上线 | Phase 1，E13 |
| 自动化真实浏览器回归、零外网审计、包体积门禁 | 未接入；手动浏览器记录与单元测试不替代这些检查 | E1 §12、E3、E5 |
| 严格 CSP 部署、零回传审计入口、日志导出与烧录信息人工复核 | 属于隐私与安全计划，尚无完整实现与验收闭环；当前保守身份提示不等于已匿名 | E1 §8/§10.4、E7 |
| Tauri 空壳、打包、签名、更新与安装分发 | macOS 壳与本地 Range 已实现，Debug/Release 已启动；多视口绘制验收未过，签名/更新/文件关联未交付 | Phase 2 验证壳 / Phase 3 交付，E1、E16 |
| 光盘快速索引、既往检查匹配及对比阅片工作流 | 未开始；独立并排显示只是基础能力 | Phase 3，E1、E6 |
| PS3.15 白名单脱敏、UID 一致映射、隐私审计、脱敏导出 | 未开始；当前一律保守提示“含身份信息” | Phase 3，E7 |
| PNG/测量数据导出及水印/用途声明 | 未找到用户可用导出链路；已补 [导出格式与交互计划](EXPORT_PLAN.md)，主范围为 PNG、DICOM、DICOM SR、DICOM GSPS；JPEG 可选、JSON 用于内部保存恢复，CSV/PDF 后置 | E1 §2/§9、E7、E8 |
| 基础体绘制、高质量体绘制 | 未开始；高质量方案需要单独评估，不按普通按钮增量估计 | Phase 4，E1 |
| PET-CT 融合、配准范围、本地 ONNX 预标注 | 未开始；配准策略尚未决定 | Phase 4 / 附录 D Q5，E1 |
| DICOMweb WADO-RS/QIDO-RS、插件网关 | 未开始 | Phase 5，E1 |
| NIfTI/NRRD 直接导入、单文件离线版、PWA | 待决项，未承诺进入当前版本；生成样本时用 NIfTI 不代表应用能导入它 | E1 附录 D、E11 |
| ADR 独立建档、DICOM 支持声明、CHANGELOG、SBOM/依赖扫描 | 文档提出要求，尚未形成完整交付材料 | E1 §13/§16/附录 B/C、E13 |

**值得优化的已有能力（不应先扩张成全功能医学工作站）**

| 优先级 | 优化点 | 理由与证据 |
| --- | --- | --- |
| 高 | 导入边界与失败可解释性 | 核心使用场景；真实光盘、多帧/字符集、损坏/缺失文件、ZIP 限制、取消与二次导入需要系统验收，E1、E4 |
| 高 | 布局切换的一致浏览会话 | MPR 两种布局已有定位保持；1×1 与其他布局间仍可能回首层；新分屏最终回归待补，E5、E6 |
| 高 | 明确支持矩阵与未支持原因 | 不把“浏览器打开一套 MR”解释为所有模态/压缩格式都支持，E7、E12 |
| 高 | 资产与文案可信度 | CT 封面是用户参考截图裁片，与实际单层 CT 不同；再分发许可材料不足。README 的外网/性能宣传未全部经审计，E7、E11、E15 |
| 中 | 首屏包体积与懒加载 | 本轮构建主 JS 约 1.64 MB、gzip 约 466 kB，仍有大 chunk 警告；不能直接宣称满足首屏预算，E6 |
| 中 | 窄屏、键盘、焦点、错误反馈 | 已有横向滚动工具栏/专注模式基础，尚非完整移动适配和无障碍验收，E5、E6 |
| 中 | 设置与预设可发现性 | 部位自动组已实现；手动部位覆盖、MR T1/T2/FLAIR/STIR 预设及更多自定义尚未扩展，E10 |
| 中 | 文档与发布证据 | 使用状态总表和可复验命令维护事实，避免旧评审中“尚未实现”长期误导，E1、E5、E7 |
| 中 | 原计划内部冲突 | 附录 C 骨架把 WADO/QIDO 写在 V1，而路线图将 DICOMweb 放到 Phase 5；发布支持声明应以当前无网络适配器的事实为准，E1、E8 |

**初步开源门槛**

| 项目 | 当前 | 初次公开前建议达到 |
| --- | --- | --- |
| 主项目授权 | package/README 写 Apache-2.0，但根目录没有 LICENSE | 添加正式 LICENSE，明确版权主体；第三方数据独立说明，E13 |
| 样本/封面来源 | 新头部样本有许可和 provenance；旧 MR/CT 与用户截图封面的再分发依据不完整 | 补可核实来源与许可，或移除/替换有疑问资产；用户上传参考图不等于公开再分发许可，E11、E15 |
| README 真实性 | 定位、启动命令、用途声明已有；CI badge 指向未配置的仓库 | 显示 WIP/alpha、支持/不支持清单、已知限制、实际截图和真实仓库/CI 链接，E13 |
| 可复现验证 | 本机与排除原有改动的隔离副本通过；均复用本机依赖 | 新克隆安装验证、真实远端 CI、应用 build 检查；不把“复用 node_modules 的隔离副本”写成全新安装验证，E3、E6 |
| 基本协作材料 | 有架构、规则与评审；缺 CONTRIBUTING、SECURITY、行为准则、Issue/PR 模板等 | 先给最小贡献与私下漏洞报告流程，逐步补齐项目自己承诺的治理材料，E1 §16、E13 |
| 版本与变更 | 本地提交可追溯，无 CHANGELOG/发布版本 | 一个可复现的 alpha 标签/说明、变更日志和已知问题，E13 |
| 仓库状态 | 本地 main，无 remote；原有 7 处改动仍待收敛 | 分类评审、只提交确认的内容，创建仓库后走 PR；本轮不创建/推送，E14 |
| 用户可用性 | 基础科研教学浏览可运行；未通过原 Demo Gate | WIP 可明确限制后先公开；如称可用 MVP，则补测量、真实数据、性能和 Demo 验收，E1、E5、E6 |

原计划 Demo Gate 是：三张不同来源真实脱敏光盘 + 一个公开数据集全部打开、调窗 p95 <16.7 ms、首屏 <2 s 且全程零报错。当前没有满足整组条件的可引用证据，因此不标为通过。评估不要求先完成 VR、AI 或桌面端。

**建议接下来的增量顺序**

1. **收尾与可信公开**：完成独立分屏验收/独立评审，收敛原有导入改动；补 LICENSE、资产许可、支持清单、README/CHANGELOG/贡献与安全说明；准备 WIP/alpha 开源包。创建远端、推送、发布需单独明确授权。
2. **基础 MVP 闭环**：补真实数据与目标设备验证；做直线测距和 ROI/HU 的领域模型、物理断言与 UI；完成静态 Demo Gate。先确认哪些数据格式明确支持，再扩大压缩语法。
3. **再做交互成熟**：统一跨布局定位、自由准星、电影播放、命令面板和热点优化；根据实际用户再决定 Tauri/脱敏/既往对比。Phase 4/5 保持后续规划。

**证据索引**

- E1：[架构路线图与公开门槛](ARCHITECTURE.md#十四演进路线图)，另见 §11、§13、§16、附录 B/C/D。
- E2：[Spike A](../spikes/cs3d-min/README.md)、[Spike B](../spikes/cs3d-volume/README.md)。证明 API/像素链路，不证明目标设备性能。
- E3：[项目脚本](../package.json)、[CI 定义](../.github/workflows/ci.yml)；实际执行 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm --filter @opendicomviewer/app-web build`（本轮 outDir 在临时目录）。
- E4：[导入流程](../packages/app-web/src/import-flow.ts)、[本地适配器](../packages/adapters/source-local/src/source-local.ts)、[扫描](../packages/adapters/source-local/src/scanner.ts)、[文件候选/拖入](../packages/app-web/src/bridge/candidate.ts)、[ZIP](../packages/adapters/source-local/src/zip.ts)。
- E5：[实际浏览器验收与截图](reviews/CR-2026-10-30-browser-acceptance.md)。
- E6：[本轮独立分屏交付与验证边界](reviews/DELIVERY-2026-10-30-independent-split.md)、[SplitWorkspace](../packages/app-web/src/components/SplitWorkspace.tsx)、[分屏状态回归](../packages/app-web/tests/independent-store.test.ts)。
- E7：[设计约定](design/ui-spec.md)、[设置](../packages/app-web/src/components/SettingsDialog.tsx)、[工具栏](../packages/app-web/src/components/WorkspaceToolbar.tsx)。
- E8：[core 契约与空实现](../packages/core/ports/index.ts)、[领域模型](../packages/core/domain/types.ts)、[排序](../packages/core/pipeline/sort.ts)、[降采样](../packages/core/volume/downsample.ts)。检索 `packages/` 未找到测量/存储/桌面/脱敏的实际适配器。
- E9：[渲染适配器](../packages/adapters/renderer-cs3d/src/cornerstone-renderer.ts)、[首帧适配记录](reviews/CR-2026-10-30-first-frame-fit.md)、[三向与缩略图适配](reviews/CR-2026-10-30-all-viewports-fit.md)。
- E10：[预设实现记录](reviews/CR-2026-10-30-window-presets.md)、[数值真源](../packages/core/pipeline/window-presets.ts)；后续浏览器验证见 E5。
- E11：[头部样本说明](../sample-dicom/brain-head-mr/README.md)、[许可](../sample-dicom/brain-head-mr/LICENSE.txt)、[provenance](../sample-dicom/brain-head-mr/provenance.json)。
- E12：[PixelCodec](../packages/adapters/codec-wasm/src/codec.ts)、[parse](../packages/adapters/source-local/src/parse.ts)；以实际 canDecode/拒绝路径为准，不以架构中的目标格式表为准。
- E13：`git remote -v` 无输出；`git log -5 --oneline` 有连续本地提交；`rg --files --hidden` 与根目录清单未发现根 LICENSE、NOTICE、THIRD_PARTY_NOTICES、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、CHANGELOG；`docs/adr/` 为空。[README](../README.md) 仍引用不存在的根 LICENSE 和预设 GitHub badge。
- E14：`git status --short`：原有 parse/scanner/source-local、两个测试、warning-presentation、core/types 改动保留；本轮只提交独立分屏与文档相关文件。原始内容哈希核对 8/8 一致，含 `.trae` 报告；共享文件扣除前轮已经单独提交的 BodyPart 字段后比对。
- E15：[封面 provenance](../packages/app-web/public/sample-covers/provenance.json)、[实际样本预览 provenance](../packages/app-web/public/sample-previews/provenance.json)。前者明确写“用户参考图”“入口封面示意”，未附可公开再分发许可。

本表不把以下非目标算成遗漏：PACS/C-STORE 服务、诊断报告、多用户云同步、胶片排版、WSI 和 V1 移动端 MPR/VR。来源：E1 §2.3。

2026-11-01 后续更新（覆盖 E8/E13/E14 中的旧快照）：新增桌面壳，但测量/存储/脱敏仍未交付；真实定位像/SC 的二维完整浏览修复已完成，桌面 MPR 绘制问题仍在进行。工作树 281 项测试通过；排除原有未提交内容的此前隔离增量为 278 项通过。用户已授权相关下载目录影像用于本地验证，真实数据不提交仓库。

- E16：[桌面与真实影像阶段记录](reviews/DELIVERY-2026-11-01-desktop-progress.md)、[桌面包说明](../packages/app-tauri/README.md)。后续按显示正确性、顶部对齐、ZIP 真拖入、标注/测量、[导出计划](EXPORT_PLAN.md) 推进。
- E17：用户授权创建的 [Xxcool/opendicomviewer](https://github.com/Xxcool/opendicomviewer) 为私有空仓库，已登记 origin；未上传代码、未发布。顶部官方 GitHub 图标已接入；Web 使用新标签链接，Tauri 经官方 opener 仅允许打开固定仓库 URL，已实际点击并在 Chrome 确认目标页面。GitHub 登录有效，需沙箱外访问钥匙串；读取邮箱验证状态缺少 user scope，未扩大权限。

本轮实现已形成独立本地提交：`9283cd3 feat(workspace): 新增四格独立序列分屏`。该提交包含交付与验证边界记录，浏览器最终验收和独立评审仍待补。本进度表另作文档提交；未创建远端、未推送、未发布版本。
