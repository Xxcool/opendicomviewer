# Phase 1 多帧与坐标增量独立审查

日期：2026-11-03。审查者：独立代理；未修改实现或提交。范围为本轮多帧导入与源帧坐标换算；会话状态由同轮另一份独立报告覆盖。

## 结论

当前范围没有已确认的阻塞发现。此结论不代表测量 UI、全部 Enhanced SOP、真实多帧数据或桌面绘制已完成验收。

## 已核对链路

- `frame-geometry.ts` 从 Per-frame / Shared Functional Groups 中的 Plane Position、Plane Orientation、Pixel Measures 宏读取逐帧属性。未知位置不以层厚或 1mm 编造 Z；方向变化和重复位置统一标作二维。
- `parse.ts` 明确拒绝无效 NumberOfFrames；`scanner.ts` 为每帧建立 imageId 与同一源 candidate 映射，保留告警。`image-kind.ts` 的二维标记被排序和体积计划共同消费，避免方向异常帧在二维浏览前被剔除。
- `source-local.ts` 非封装像素按 frameIndex 和帧长度截取；封装多帧依赖 Basic Offset Table 定位，无可靠偏移表时显式失败。展开后的各帧 VOI、Rescale 与几何传递到 PixelFrame / SeriesMeta。
- `image-coordinates.ts` 使用 DICOM 行列间距顺序；像素→患者坐标采用实际 IOP，逆变换通过 Gram 2×2 求解接纳合法小数舍入，且拒绝离开当前切面的点及占位几何。

## 独立执行

命令：`pnpm exec vitest run packages/adapters/source-local/tests/integration.test.ts packages/adapters/source-local/tests/unit.test.ts packages/core/tests/measurement-coordinates.test.ts`

结果：3 个文件，52 项通过。线程池故障熔断测试产生预期 stderr，不是本轮失败。

核对了标准嵌套位置序列、未知空间、重复位置、方向变化、逐帧实际像素、无效帧数，以及四位小数 IOP 逆变换回归。测试直接调用实现和真实字节 fixture。

## 验收边界

Shared Functional Groups 中所有宏的组合、逐帧 Modality LUT、更多压缩/彩色、多文件和时间维混合等尚未形成完整真实样本矩阵，不应扩大支持声明。原始 DICOM 只读、不改写；本轮代码与定向测试不能替代目标设备与真实数据验收。
