# 导入进度与 ROI 修复后独立复核

日期：2026-11-04。审查基线为提交 `8727e7a`，主线本轮正在开发的角度和图片导出不计入本报告。审查方未改实现、未操作 GUI，只新增本报告。

## 已关闭的原发现

| 路径 | 复核与结论 |
| --- | --- |
| Spinner 动画被样式覆盖 | `components/Icons.tsx` 解构 className，合并 `animate-spin`；其余 props 不再包含 className，因而不会覆盖。`import-progress.test.ts` 实际 React 静态渲染测试验证输出，并非仅匹配源码字符串。关闭原覆盖路径；未声称已测真实GPU动画帧率。 |
| DICOMDIR 取消后晚到覆盖 | `source-local.ts:149–154` 在 header/full read 两处 await 后均 `signal.throwIfAborted()`，AbortError重抛而非回退扫描。`import-progress.test.ts` 的真实适配器测试延迟旧DICOMDIR完整读取、取消、导入新样本、放行旧读取，断言旧probe拒绝且新listSeries未被覆盖。已独立重跑通过，关闭原晚到提交路径。 |
| 椭圆可见bbox角点无法命中 | 基线 `AnnotationLayer.tsx:71–72` 先检查a/b屏幕控制点8px命中，再检查椭圆内部；随后:88–89用同一8px阈值派发对应first/last编辑。角点即使位于椭圆外也可进入控制点编辑。静态路径闭合。主线交付记录中的实际拖动统计变化作为主线GUI证据，未冒充本审查独立操作。 |
| 灰度统计误称“非 HU” | Panel文案现为“模态变换后灰度统计（单位未确认）”，与 `roiStats` 的LUT/Rescale结果契约相符；不把CT或MR一概强行称为HU。关闭原肯定非HU/原始存储值的文案偏差。 |

## 进度、取消与恢复链

- `sample-loader.ts` 使用所选数据集的实际文件总数，文件读取完成才累加completed；所有fetch共用AbortSignal，并在报告完成前检查取消。
- `scanner.ts` 的finally按真实已处理项与剩余队列计算completed/total，跳过与失败项也计入；ZIP展开可能增加总数，UI明确写“含展开项”。这是动态已知候选的阶段进度，不是全流程时间百分比。ZIP目录读取与最终几何分组不提供total，App不显示伪百分比。
- `import-flow.ts` 启动任务会取消旧controller；回调及await后检查controller身份和signal；卸载取消；打开序列后的迟到handle释放而非setActiveSeries。空示例候选明确进入错误分支。部分失败后确认载入也使用相同任务保护。
- 基线 `annotation-restore.ts` 的 `restoreWithPixels` 重开源句柄，按SOP/frame定位原始pixel，调用roiStats重算并逐项校验统计（数值容差/字段数量），finally释放句柄。不会把文件内ROI统计不经校验直接写入会话。
- `AnnotationContext.restoreAnnotations` 在读取和重算后、确认后均验证studies引用及alive；全部通过后一次性restoreSaved，不逐条写入破坏原子性。
- 基线ROI异步commit校验disposed、completionToken、当前plane及session快照；取消、帧变更、卸载会使完成token失效。高频移动仍是命令式SVG。

## 实际命令与结果

执行：

```bash
pnpm exec vitest run packages/app-web/tests/import-progress.test.ts packages/app-web/tests/annotation-roi.test.ts packages/app-web/tests/annotation-restore.test.ts packages/core/tests/measurement-session.test.ts packages/core/tests/measurement-roi.test.ts packages/app-web/tests/roi-source-values.test.ts
```

结果：6文件、46项测试通过。执行时共享工作树已出现其他Agent的新角度文件/几何扩展，审查源码使用 `git show 8727e7a:<path>` 对照，未把新角度代码纳入独立结论；本组既有测试文件和导入进度实现没有未提交改动。测试不挂完整React，不能由此关闭所有GUI竞态。

## 待验证假设与未覆盖

一个新假设，不计为已确认阻塞：基线ROI的pixel reject分支只检查disposed/token，未像成功commit那样检查当前plane/新导入状态。若ROI统计在途时开始新导入、旧Layer尚未卸载，晚到reject可能经report调用setImportStatus({loading:false,...})覆盖新导入进度。依据 `AnnotationLayer.tsx:139–142` 及report实现可定位具体路径，但本次未有完整React/GUI失败用例，须先补可复现测试再决定处理，不能只按静态猜测扩大修改。

未独立复测：短流程逐帧旋转、Web窄屏、真实ZIP进度变化的视觉理解、原生ROI保存恢复全流程、复杂跨帧/跨导入并发、压缩数值链和桌面MPR重绘。原已报告修复项在上述证据层关闭，未覆盖范围保持明确，不等同于Phase 1/2最终验收。
