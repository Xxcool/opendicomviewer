# 接通 CT 部位预设与自动窗

日期：2026-10-30。

## 结果及数据链路

设置页原「5 个通用预设，按部位分组与自动尚未实现」确为实现缺口。本次接通而非仅删除说明：

- DICOM `(0018,0015)` → `parseDicomMeta.plane.bodyPartExamined` → Worker/扫描保留的 ImagePlane → 打开的 SeriesMeta.planes → core `normalizeBodyPart/getWindowPresets` → Settings、Viewport、MprWorkspace。
- CT 按胸部/头颅/腹部/四肢/脊柱分组；缺失或不识别则采用通用组。每组三个窗值沿用既定 `ui-spec.md` 表，数值唯一真源移入 core。
- 「自动」永远第一。有效 DICOM 窗宽窗位优先（宽度至少 1、值有限）；缺失则对经 Modality LUT 或 slope/intercept 换算的强度，截去两端各 2% 的经验分位估算。分位塌缩时用 min/max，常量窗宽 1；无有效像素明确报错。原始像素不改。
- 自定义 image loader 的首帧默认窗也使用该算法，保留已有 frame → plane 的标签窗回退。自动按钮按当前帧计算，点击后的估算结果标记「自动（估算）」。快捷键 1 为自动，2–4 为当前 CT 组三项；异步返回不会覆盖后续预设或新序列。
- MR/CR/DX 仅自动窗，不套用 CT 参数；MPR 三个 Orthographic 视口仍使用固定 8-bit 区间，只在原始 Stack 上提供预设。

设置页为当前序列的只读预设说明，应用操作在视口完成。手动部位覆盖、MR 按 T1/T2/FLAIR/STIR 优化的预设、更多预设以及旧设计中的全部高亮细节尚未扩展，未将其宣称为已实现。

## 验证

- 新 core 测试覆盖别名、未知/缺失标签、非 CT 排除、标签优先、CT 空气/水物理值、Modality LUT 优先、2%–98% 离群值、常量、空数据、无效标签及不修改原数组。
- `bodypart-import.test.ts` 从合成的真实 DICOM 开始，经 LocalDataSource 扫描、打开、解码，验证 HEAD 标签最终选择脑/骨/卒中组三项，避免只验证手工构造的元数据。
- 真实 CS3D loader 测试保留 frame 缺少默认窗时读取 plane 标签的既有行为。
- 变异：跳过物理重标定或丢弃 BodyPartExamined 标签时，新增测试分别失败；恢复后通过。
- 工作区：22 文件、255 项测试通过；排除原有改动的独立快照：22 文件、252 项测试通过。类型检查、lint、静态构建通过，`git diff --check` 通过。

原有七处未提交内容保留。与原有改动共用的 types.ts / parse.ts 仅提交新增字段及标签读取的两个小补丁，其余原有改动不进入提交。无依赖、锁文件、CI 或架构决策变更。

限制：浏览器视觉与交互尚未验收；无窗值的超大单帧估算耗时未专项评测。算法按用户显式操作/图像加载计算，不在拖拽渲染循环执行。日志及隔离快照记录位于 `/private/tmp/odv-presets-20261030/`。
