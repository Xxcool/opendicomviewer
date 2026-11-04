# 三点角、Cobb 与 PNG 增量独立审查

日期：2026-11-04。范围为当前未提交的角度工具、对应JSON恢复与PNG预览/下载实现。未改实现、未操作GUI；主线新增ImportProgressDialog与index.css不在本报告范围。原进度/ROI基线复审见独立r2报告。

## 确认发现

**PNG-01 / P2：捕获开始时的视口层号读取在 try 外。**

`PngExportControl.capture` 在setOpen与“正在捕获”之后，先调用 `renderer.currentSliceIndex('default-viewport')`，再进入try。实际renderer实现会在未挂载、找不到视口、尚未装载序列或无效索引时throw（`cornerstone-renderer.ts:547`起）；该异常转成capture拒绝的Promise，而按钮使用 `void capture()` 没有catch。因此视口在入口ready与调用间发生生命周期变化时，不能进入现有message错误分支，会产生unhandled rejection并留下捕获文字。修复应把所有可能throw的renderer读取移进try，不需要新增降级机制。已给主线逐行路径；本次没有完整React故障注入GUI，错误传播来自实际throw接口及现有async边界。

## 角度核对

- 三点角以第二点为顶点，依次使用0–1、1–2两条线；Cobb使用0–1、2–3两条无向线，定义输出0–90°。各向异性先转物理向量，非有限/零长度/缺标定不会生成有效值，端点反向不改Cobb结果。
- `AnnotationLayer` 的逐点fixed数组与预览分开；提交时按3或4点计算。Esc、帧变更、工具Effect卸载清pending，逐点提示写SVG而非高频React状态。
- 选中时检查所有控制点和对应线段，编辑模式为控制点索引；移动保持所有点，释放提交一次历史记录。退化编辑失败取消草稿而保留原正式记录。
- SVG三点角画两射线，Cobb画两独立线，不把点1–2错误连成第三条线。所有控制点均绘制。label使用°，不是mm。
- `annotation-restore` 按工具检查3/4点、匹配源SOP/帧/像素边界，以原图标定重算angleStats，拒绝数值篡改。记录仍由MeasurementSession保存，不在MPR上测量。

上述是静态和数值证据；多次点击、控点拖动、切帧取消、备注输入与恢复后的GUI需主线实际验收。未发现新的已确认角度数值阻塞。

## PNG机制与边界核对

- 捕获源是data-odv-viewport对应的持久2D canvas，先订阅该host的IMAGE_RENDERED，再请求renderer.render，事件后复制，不是读取已清空drawingbuffer的WebGL离屏画布。
- 本地锁定CS3D4.22.13 `TiledRenderingEngine.js` 约:225–230明确从offScreenCanvas drawImage到onScreenContext，约:35–40在绘制后向对应element发IMAGE_RENDERED，因此该机制有实际依赖源码证据。
- render抛错、1500ms无事件、canvas断开/零尺寸/无2D均明确失败，清理listener与timer；控制层比对handle和当前slice，关闭/卸载使generation失效，避免旧结果回写。
- 组合使用同一冻结canvas/SVG快照；默认关闭患者姓名/编号叠加。预览提示烧录信息仍可能存在，未宣称脱敏。默认标注可包含用户自己写入的内容，下载前已有预览与可选取消叠加。
- 桌面识别来自App组合根是否有host filePicker；桌面只预览，下载明确禁用并解释Web可用，未将WebKit不可靠下载伪报原生保存，也没有PNG大二进制走Tauri IPC。
- Web按钮只报告“已发起下载”，不标注已写盘或markSaved；这不改变原始DICOM或标注dirty。
- 合法窗宽窗位、局部区域或片边可能产生全黑像素，不能只用“方差为0”普适拒绝。当前测试只验证事件/尺寸/2D复制边界，不证明真实教学样本PNG有非黑内容。实际预览/PNG读回、VOI/方向/叠加对齐、下载结果和窗口切换仍须主线GUI验证。

## 独立验证

```bash
pnpm exec vitest run packages/app-web/tests/annotation-angle.test.ts packages/app-web/tests/annotation-restore.test.ts packages/app-web/tests/annotation-roi.test.ts packages/app-web/tests/png-capture.test.ts packages/core/tests/measurement-geometry.test.ts
pnpm --filter @opendicomviewer/app-web typecheck
```

针对测试5文件28项通过；包含三点角各向异性、Cobb端点反向/平行/正交/退化、源图重算恢复以及PNG事件/超时/断开错误路径。未把主线此前的全量结果冒充独立重跑，未添加快照假证据。修复后的PNG-01需另行复核关闭。
