# PNG错误边界与加载模态复核

日期：2026-11-04。独立只读复核当前PNG-01修复及新增 ImportProgressDialog/index.css；不改实现、不操作GUI。本报告只增不改原审查结论。

## PNG-01关闭

`PngExportControl.capture` 现把state/handle/首次currentSliceIndex/study读取移入try，后续真实捕获和源handle/index二次核对也位于同一错误边界。renderer未挂载、视口不存在、序列未装载或索引无效时，异常现在进入catch并显示可见message；不会从原首次读取路径直接产生未处理的capture拒绝。

保持原generation防旧结果回写、关闭和卸载失效、真实IMAGE_RENDERED等待及2D复制边界。PNG-01按当前静态控制流关闭；本次针对测试覆盖的是capture模块事件/超时/render错误/断开，不实例化整个React按钮，未宣称已经故障注入实测上述窗口切换场景。

## 新加载模态

- App仅在importStatus.loading时挂载ImportProgressDialog，传入同一importStatus与既有cancelImport；没有新增平行进度源。
- 只有completed和total明确且total>0时计算百分比，按真实比值floor并限制0–100；无计数的索引/ZIP/几何阶段使用“处理中”与不确定光带，不假装持续增加百分比。
- role=dialog、aria-modal、aria-labelledby对应实际h2；进度role=progressbar有阶段名称、0/100边界，确定阶段提供aria-valuenow，不确定阶段省略valuenow。阶段role=status具有隐含polite公告，不将装饰扫描图当作医疗结果。
- 装饰图片位于aria-hidden容器、空alt且draggable=false，不产生额外无意义朗读。CSS仅使用本地内置资产与本地样式，没有外域网络请求或患者图像上传。
- 挂载将焦点移至唯一取消按钮，Tab/ShiftTab均留在取消按钮；Esc调用同一onCancel；卸载仅在原焦点仍连接时返回。取消继续使用已审查的controller/晚到保护，不仅隐藏弹窗。
- 真实stage保留在aria-label和文本映射中，界面简化为“扫描与解析”“校验空间信息”等可读名称，不把底层函数名称当进度语义。
- CSS扫描线与不确定条有prefers-reduced-motion分支，停动画并保留“处理中”和阶段语义；静态满宽淡条不提供100%的aria值。图像窄屏尺寸与内容布局存在响应式规则。

数值来自内部可信生产链；本组件未为外部NaN/Infinity创建兜底契约。没有凭假设添加无限兼容层。该加载图是装饰，不证明实际扫描速度、进度精度或医学用途；生成模型/许可说明属于资产来源记录，本审查未重新确认模型。

## 独立验证

```bash
pnpm exec vitest run packages/app-web/tests/png-capture.test.ts packages/app-web/tests/import-progress.test.ts packages/app-web/tests/annotation-angle.test.ts
pnpm --filter @opendicomviewer/app-web typecheck
```

结果：3文件12项通过，Webtypecheck失败（见下述PNG-02）。包含真实Spinner类名输出、真实候选计数、下载信号/晚到取消、DICOMDIR取消索引隔离、角度重算与PNG捕获边界；新加载模态的实际样式/焦点表现并未由这些Node测试实例化证明。

**PNG-02 / 类型检查阻塞**：`ImportProgressDialog.tsx:1` 导入真实存在的 `../assets/import-body.png`，但app-web未配置Vite静态资产类型声明，命令报TS2307。`tsconfig.json` 的types仅node且src无d.ts。需最小补Vite客户端/PNG声明或复用已验证资产URL机制，并重新检查Web及desktop类型；不需要新增依赖。该项在本报告结束时未关闭。

PNG实际非黑图像与叠加对齐、浏览器下载、加载扫描运动、低高度/窄屏取消按钮可见性、辅助技术真实朗读，仍须主线GUI验收。文档不得把本次静态通过写成这些平台/交互全部通过。
