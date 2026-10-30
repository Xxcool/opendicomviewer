# 首帧适应窗口与 Stack 灰度修正

日期：2026-10-30。

## 现象与定位

用户截图显示头部被裁切、灰度近似黑白二值。截图仍显示单层 Mid-sagittal 序列，却标为 Axial / Z；这与当前 `Viewport.tsx` 的动态切面和「位置」标记不一致，提示页面可能仍运行旧代码或旧会话，但没有真实浏览器证据可以直接确认缓存状态。

代码层面确认两项问题：

1. `CornerstoneRenderer.setStack()` 等待首帧后只更新归属，没有显式重新适配。CS3D 4.22.13 的 `StackViewport._updateActorToDisplayImageId()` 会恢复旧 `viewPresentation`，切换序列时可能沿用上次缩放；异步装载期间视口尺寸也可能变化。
2. 自定义 loader 返回原始 int16，但窗宽窗位是换算后的物理强度。已安装 CS3D 的 GPU Stack 直接以 `image.voxelManager.getScalarData()` 创建 VTK 图像，不代替自定义 loader 应用 `slope/intercept`。例如模板原始值 -5455 应为约 41.32324；直接套 WW100/WL50 会被截黑，较大正值则截白。

本机 API 事实依据：`packages/app-web/node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/StackViewport.js` 的 `_updateActorToDisplayImageId`、CPU 的非整数预缩放处理，以及 `RenderingEngine/Viewport.js` 的 `resetCamera`。沿用锁定版本，未升级或猜测 API。

## 修改

- 首帧装载成功且通过并发版本检查后，先同步画布尺寸，再复位相机并重绘；手动「适应窗口」同样先同步尺寸。正常 `setStackIndex` 不复位，保留翻层时的用户缩放和平移。
- 显示 loader 复用 core 的 `rawToHU()`，对非恒等 Rescale 或 Modality LUT 建立 Float32 显示副本，以换算后强度计算 min/max，与物理窗保持一致。标记 `preScale`，避免 CPU 再应用一次线性换算；原始 PixelFrame 未修改。恒等变换仍复用原缓冲。
- 原有 DICOM、MPR、十字准星、几何校验和数值计算真源不变；没有更改依赖或构建配置。

## 验证与边界

- 相机回归：模拟首帧完成时残留 3 倍缩放和平移，验证 resize 先于相机适配，最终 zoom=1、pan=0；随后翻层仍保留用户的 2 倍缩放和平移。
- 实际 `cs3d.imageLoader.loadImage()` 走注册的 loader，验证模板物理像素、Float32 缓冲、默认窗、预缩放标记及原始数组不变。
- CT 水/空气样本输出 `[-1024,0,5,3071]`；Modality LUT 优先于 slope；恒等变换不复制缓冲。
- 变异：独立快照分别取消首帧复位、跳过物理值换算，两个新增回归均失败；恢复后通过。
- 当前工作区 `pnpm test`：19 文件、239 项通过；隔离原有未提交改动的快照：19 文件、236 项通过。两边 `pnpm typecheck`、`pnpm lint`、应用构建均通过。
- `git diff --check` 通过。原有七处未提交改动和接手报告的哈希未变。

限制：没有完成真实浏览器画布、GPU/CPU 视觉对照及缩放拖动验收；此前保存的浏览器权限限制仍在，不能把单元测试视为视觉验收。非恒等变换会增加一个 Float32 显示缓冲，原始帧仍保留。

本地服务仍为 `http://127.0.0.1:5173/?sample=brain-head-mr`。更新后需要刷新并重新载入，避免使用旧的加载器和单层会话。日志与变异结果：`/private/tmp/odv-fit-20261030/`。
