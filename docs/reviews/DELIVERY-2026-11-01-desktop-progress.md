# 桌面验证壳与真实影像兼容性：阶段记录

日期：2026-11-01。此为实施方记录，独立评审待补；不是最终发布验收。

## 已实现、已核验

- 新增 `packages/app-tauri`，复用 Web UI 与既有数据源、解码和渲染端口。原生文件/文件夹选择器返回候选元数据；像素通过 asset 协议分段读取，不经 IPC 传递。初始文件权限范围为空，逐文件授权所选内容；原生目录索引不跟随符号链接。
- Range 每块 512 KiB，检查 206、Content-Range 和实际字节数。证据：`packages/app-tauri/src/candidate.ts`、对应六项测试；Rust 目录/单文件/符号链接三项测试。
- Debug 与 Release `.app` 构建成功，本机 macOS 15.1.1 / Apple Silicon 实际启动，原生文件与文件夹导入可用。Release 约 29.02 MiB；启动时 `lsof -nP -iTCP:5173 -iTCP:5174 -sTCP:LISTEN` 无监听。
- 修正桌面构建未扫描共享 Tailwind 源码及未复制共享 public 资源的问题。证据：`packages/app-web/src/index.css`、`packages/app-tauri/vite.config.ts`、`testing/check-bundle.mjs`。
- 本地两份定位像输入均各含一个原始 CT 定位像与一个 SC 二次采集文件。旧链路每份只显示 1/2：SC 缺少几何标签，解析产生的占位朝向被用于比较，误报 ORIENTATION_MISMATCH 并排除。DICOM SC 的 Image Plane 模块可选，不能据此判为损坏。
- 增加 SOP 类、ImageType、缺失像素间距标识。定位像/SC 保留所有帧按导入顺序二维浏览，明确拒绝 MPR；正常断层继续按 IPP 排序与几何检查。取消此类序列假的层间距和毫米标尺，翻页按各图文件窗显示并适配。两份输入实测 2/2；恢复的 SC 保留源图扫描规划线。后来新增的一份 25 帧断层序列实测 25/25，无几何告警。
- 真实数据不作为仓库 fixture 或截图资产。回归使用合成数据：`non-volumetric.test.ts`、`image-presentation.test.ts`、core 排序/体积测试。

标准证据：[CT LOCALIZER 定义](https://dicom.nema.org/medical/Dicom/current/output/chtml/part03/sect_C.8.2.html)、[SC IOD 可选 Image Plane](https://dicom.nema.org/medical/dicom/2026c/output/chtml/part03/sect_A.8.html)。

## 检查结果

- 工作树：`pnpm test`，26 文件、281 项通过；`pnpm typecheck`、`pnpm lint` 通过。
- HEAD 加本次增量、排除原有未提交内容的隔离副本：278 项通过，typecheck/lint 通过。三项数量差异来自原有未提交测试。
- Web build、Tauri Debug/Release build 通过；Rust test 3/3，rustfmt check 通过。
- 变异自检：禁用非体积序列保留分支触发两项失败；Range 右端点增加一字节触发三项失败。恢复原代码后 281 项重新通过。
- 原有七个脏文件及 `.trae` 报告保持；本次在其中 parse/types/warning-presentation 另有局部新增，提交时须仅暂存本次部分。

## 未完成与禁止扩大结论的边界

- **桌面绘制验收仍未通过。** 多格/MPR、主题和翻页组合下出现文字缺笔、部分画面变暗。DOM 数值存在但呈现错误，调整窗口可暂时恢复。原生 backgroundThrottling disabled 与强制全格 render 均不足，已撤除；覆盖层隔离/translateZ 候选也出现错误呈现，已撤除。同版本官方 Tiled 模式亦复现，已恢复默认模式。另发现 1+3 切回 2×2 后冠状/矢状画面呈现为轴位，须检查 setLayout/resetCamera 的朝向恢复链路，不能只归因于 WebKit。下一步应针对现有 CS3D 4.22.13 的 ContextPool/画布复制与 WKWebView 合成建立独立最小复现，不能宣称桌面稳定。
- `sandbox-exec` 的出网探针明确被拒；受限 Release 进程虽启动，但原生验收工具无法定位其窗口，故**禁网 UI 全流程未验收完成**。标准启动 Release 已实测。未改变全机网络设置，未完成 WebKit 子进程全链路网络审计。
- Windows/Linux、签名公证、文件关联、更新、真实 ZIP 拖入、系统拖入事件尚未完成实际验收。原生文件授权在进程内累积，退出释放，尚无清空视图撤销机制。
- 测量与可编辑标注未交付。当前患者性别/年龄、体位、设备型号、采集时间、kVp 等部分原始标签尚未接入展示；描述字段为空须继续显示“未提供”。
- 现有 GitHub 认证校验失败，未换匿名接口绕过。按全局 AGENTS 要求，提交前 Verified 邮箱核验仍待完成；当前没有新增本地提交、没有推送或发布。

## 后续执行顺序（用户 2026-11-01 最新要求）

1. 完成桌面呈现故障定位、最终产物回归、验证记录及本地提交；不得以构建通过代替显示正确。
2. 对齐顶栏和工具栏两侧基线，缩小截图所示左右留白；保持原有主题单按钮切换。
3. 更新标注/测量开发与交互设计：箭头、文字、直线、矩形、椭圆、角度/Cobb 角、自由轮廓分增量；考虑选中、拖动控制点、编辑文字、Esc 取消、删除选中、清空范围确认、撤销/重做、显隐、跨帧归属与保存/恢复/导出。毫米与 HU 工具须先校验间距、图像类型和灰度换算；定位像/未校准 SC 不给出伪物理数值。计划不等同于功能已实现。
4. 用户已授权下载目录相关影像用于本地真实性验证。实际从欢迎页拖入 ZIP，核对候选数、检查/序列/帧数、失败清单、取消、解码与首帧呈现。需分别验收 Web 拖放与 Tauri 原生拖放，不用选择器测试替代拖入。

## GitHub 入口后续核验

沙箱外 `gh auth status -h github.com` 证实 Xxcool 的 keyring 登录有效，前述“认证失效”的判断应修正为沙箱未能读取钥匙串。无需重新登录。用户授权创建 `https://github.com/Xxcool/opendicomviewer`，`gh repo view --json url,isPrivate,isEmpty` 确认为私有空仓库；已添加 origin，未 push。

顶部右侧增加官方 Primer Octicons GitHub Mark 与无障碍外链名称。Web 普通新标签链接；桌面通过官方 opener 插件打开系统浏览器，capability 仅准许此固定 URL。实际点击后在 Chrome 用户标签中确认该仓库页面，原阅片窗口仍保持 `tauri://localhost`。类型检查、lint、281 项测试及 Debug 打包通过。图标许可在 `packages/app-web/public/brand/github-mark.LICENSE.txt`；界面证据 `assets/tauri-2026-11-01/github-header.png`。

读取邮箱验证状态的接口缺少 user scope；未自动扩大账号授权。提交前等待用户确认当前 Git 邮箱已在 GitHub 验证。

用户已确认当前 Git 邮箱在 GitHub 完成验证，并要求提交注明 AI、Codex。按当前邮箱做本地提交，不扩大账号权限。失败呈现证据另存为 `mpr-hud-presentation-failure.png` 和 `mpr-layout-presentation-failure.png`，不得将其当作通过截图。

最终署名按用户更正采用提交末尾 `Co-authored-by: Codex <codex@openai.com>`，标题不增加 AI 标签；主作者沿用用户 Git 配置。
