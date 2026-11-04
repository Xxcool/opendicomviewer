# 标注 JSON 恢复独立审查

日期：2026-11-04。审查范围：`annotation-restore.ts`、`AnnotationContext`/`AnnotationControls` 恢复入口、App 数据源注入、`MeasurementSession.restoreSaved` 与对应测试。未修改实现，未进行 GUI 操作。

## 结论

当前静态链路与针对测试中，没有发现新的确认阻塞缺陷。JSON 恢复限定为本项目版本 1、直线测距/箭头/文字，依赖当前已经导入的原始 DICOM；不等同于 SR/GSPS 或独立影像归档。主线仍需完成实际文件选择、替换确认和恢复后的编辑/撤销验收。

## 核对结果

| 核对项 | 代码证据与实际边界 |
| --- | --- |
| 外部输入边界 | `packages/app-web/src/annotations/annotation-restore.ts:24` 先限制 UTF-8 大小、JSON 结构、format/version、字段白名单与数量。单记录核对工具、点数、有限坐标、坐标空间、时间、备注长度和重复 ID；未知工具不被静默丢弃。 |
| 源图身份 | `restoreRecord` 同时匹配 SeriesInstanceUID、SOPInstanceUID 与零基 frameIndex，必须唯一命中。多帧其他帧及重复源匹配失败；检查控制点在原图边界内。 |
| 测量可信性 | 保存的 lengthMm 不直接信任，按匹配原始帧可信 PixelSpacing 重算并比对；缺标定、数值不符或混入未知统计字段均拒绝。箭头/文字不凭空要求毫米标定。 |
| 解析失败不影响旧记录 | `AnnotationContext.tsx:109` 至恢复记录校验完成只读外部数据；真正替换发生在全部验证、未保存确认与第二次会话核对之后。`restoreSaved` 自身也在更改历史前复制校验整批记录。 |
| 未保存保护 | `AnnotationContext.tsx:114` 调用已有 confirmReplacement，沿用保存/丢弃/取消；该函数同步提交活动备注草稿后再看 dirty。取消返回 false，Controls 提示旧标注保留。此段为静态核对，针对单测没有挂载 React 模态。 |
| 过期与并发恢复 | `AnnotationContext.tsx:104` 以 ref 防重复恢复；await 文件/元数据后及 await 确认后都检查 alive 与原 studies 引用。已换影像会话不写入旧 session；finally 释放在途标志。取消确认不改下载保存点。 |
| 保存点与历史 | `packages/core/measurement/session.ts:96` 整批复制、唯一 ID 校验后一次替换与广播，并设置恢复内容为保存点。undo 回到恢复前内容且 dirty，redo 回到恢复内容且 clean；相同内容不增加无意义历史，空恢复可撤销。 |
| 临时句柄隔离 | `loadBackupSources` 对每个唯一源序列打开独立句柄，取得 meta 后在 finally dispose。App 通过组合根为导入和恢复注入同一 LocalDataSource；没有额外数据源或像素解码。集成测试实际缓存帧后读取恢复元数据，释放临时句柄不清掉活动帧缓存。 |

## 独立验证

执行：

```sh
pnpm exec vitest run packages/app-web/tests/annotation-restore.test.ts packages/core/tests/measurement-session.test.ts
pnpm --filter @opendicomviewer/app-web typecheck
git diff --check
```

结果：2 文件、19 项测试通过；Web typecheck 与 diff 检查通过。覆盖真实实现的格式/版本/超限、源帧不匹配、重复引用、错误统计、中文备注、临时句柄缓存隔离、后部记录失败原子性、撤销重做及保存点。

## 尚未由这些验证证明

- 单测没有挂载完整 React，因此文件选择器取消、恢复过程中切会话、保存后继续恢复、未按 Enter 的备注与取消恢复，仍需实际界面验收；静态存在守卫不等于已经实测竞态。
- 本轮只核对上述三种工具。矩形/椭圆/曲线/角度/手绘尚不能通过菜单存在或 JSON 字段宣称可恢复。
- 这是显式 JSON 文件备份恢复，不启用自动患者缓存，不包含原始像素，不证明第三方 DICOM 交换能力。
