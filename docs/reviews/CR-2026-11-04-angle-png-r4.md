# PNG真实挂载节点标记复核

日期：2026-11-04。独立只读复核主线GUI发现的selector缺口修正。未改实现，未操作应用GUI；只核对源码、执行针对测试并查看主线保存的截图文件。

## 标记闭环

PNG捕获入口查询 `[data-odv-viewport="default-viewport"]`。实际渲染器 `resolveViewportContainers` 在1×1时直接返回组合根container，不创建多格子节点；之前仅多格子节点携带该data属性，因此正常1×1也无法找到捕获host。

主线现为App持久节点 `id="odv-viewport-el"` 补 `data-odv-viewport="default-viewport"`；同一id传给renderer.mount，所以PNG selector、CS3D真实挂载host及其2D canvas现在指向同一节点。导出入口仍仅在layoutMode=1x1且renderer ready时启用，不把多格父节点当作完整布局导出。

此修改不替换DOM节点，不改变数据源，不再依赖多格布局创建的子节点，原selector缺口按实际组合根/适配器代码闭合。PNG-01错误边界与PNG-02资产URL修复仍保持。

## 验证

```bash
pnpm exec vitest run packages/app-web/tests/png-capture.test.ts packages/adapters/renderer-cs3d/tests/renderer.test.ts packages/app-web/tests/annotation-angle.test.ts
```

3文件72项通过；包括捕获真实事件等待/失败/断开边界、渲染器既有生命周期与角度数值恢复。Node捕获测试的mock host原本总能被selector找到，因此没抓住App真实挂载节点缺属性；这次GUI发现说明mock测试不能替代组合根和原生预览验收。

独立查看主线文件 `docs/reviews/assets/tools-2026-11-04/png-preview.png`：预览中可见完整非黑脑部教学影像、参考用途页脚；身份checkbox未选，桌面下载按钮禁用且解释只预览。该截图支持主线所报“真实像素预览已跑通”，但不是本审查亲自操作GUI，也不证明Web下载实际落盘或含标注图片的逐项对齐。

主线另报告三点角90°、Cobb30.96°的GUI操作，本复核未操作或数值读回，不将其冒充独立验收。全量测试与最终双端构建以主线最后实际命令为准。

当前最后修正范围无未关闭的确认阻塞项。原报告中的Web下载、原生PNG保存尚未实现、复杂状态并发与跨平台边界继续有效。
