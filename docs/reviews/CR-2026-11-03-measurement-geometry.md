# 原始帧测量几何独立评审

日期：2026-11-03。范围：`packages/core/measurement/geometry.ts`、`packages/core/tests/measurement-geometry.test.ts`、`packages/core/index.ts`。评审方为独立 `render_audit` 代理；未修改实现。此报告只评价纯计算增量，不表示标注 UI、物理标定策略或临床准确性已验收。

## 首轮结论

发现 1 项 P2 数值边界问题，已交由实现方处理：

- **MG-01：亚正规间距导致角度静默错误。** 首轮 `measureImageAngle` 直接用 `physicalVector.length` 归一化。输入 `start=[1,1]`、`vertex=[0,0]`、`end=[1,0]`、`trusted=true`、`pixelSpacing=[Number.MIN_VALUE,Number.MIN_VALUE]` 被间距校验接受，但返回 `ok:true, value:0`；等比例正间距应得到 45°。原因是亚正规长度的 `Math.hypot` 舍入，点积限幅掩盖了非单位向量。该参数不是正常医学像素间距，但属于接口当前接受的数值域，不能返回成功的错误角度。
- 复现直接读取实现，经已安装 TypeScript `transpileModule` 转为 ESM 并导入执行，没有复制算法；初版结果为 `subnormal-angle { ok: true, value: 0, unit: 'deg' }`，普通等比例间距结果约 45°。
- 首轮已有 10 项测试全部通过，说明原测试未覆盖此数值边界。

## 已核对的正确行为

| 项目 | 证据及结论 |
| --- | --- |
| DICOM 行列间距 | `physicalVector` 用 x 差乘 column、y 差乘 row；非对称 `[row=2,column=0.5]` 的轴向断言和 3–4–5 phantom 可以识别交换错误。 |
| 各向异性角度 | 向量先转换物理平面；测试使用列间距 √3，将像素坐标的 90° 转为物理 60°，不是只测等距直角。 |
| 无可信标定 | undefined 与 trusted=false 都显式失败，长度、角度均不产生伪物理结果；可信度由调用边界负责，这一纯函数不声称标签存在即可靠。 |
| 非法输入与溢出 | 非有限坐标、非正/非有限间距、差值溢出和零边返回失败；1e200 的正交向量避免原始点积溢出。 |
| 输出和坐标范围 | 同一帧像素中心契约明确；长度 mm、无符号内角 0–180 deg。此模块不接收图像尺寸，图内边界、SOP/帧绑定仍须由后续交互层检查。 |
| core 边界与导出 | 不依赖 DOM、CS3D、网络或持久化；`packages/core/index.ts` 明确导出本模块。没有改动现有 MeasurementRecord。 |

## 测试有效性

实际执行 `pnpm exec vitest run packages/core/tests/measurement-geometry.test.ts`。测试直接导入实现，不是手抄实现。

独立临时副本变异验证保留原工作树：基线退出码 0；交换行列间距退出码 1；跳过 trusted=false 校验退出码 1；恢复旧归一化退出码 1。副本复用仓库测试及依赖，不能称为全新安装验证。日志目录：`/var/folders/nm/s8x3b5ln16n8v32kjbwqgq580000gn/T/odv-geometry-review-uUnyZc/`。

## 复核追加

实现方采纳 MG-01，将角向量先按最大绝对分量缩放，再计算单位向量；新增亚正规等比例间距的 45° 回归。独立重跑结果：**11 项通过**。旧归一化变异被新回归捕获。MG-01 已关闭，当前范围没有未关闭阻塞发现。

未覆盖：UI 选点/缩放/删除、像素与屏幕坐标映射、真实源图标定判定、ROI/HU、标注保存与 SR/GSPS。不得用本报告证明这些能力已交付。
