# ROI 原始数值入口修复独立复审

日期：2026-11-04。范围：source-local 的 parse/source-local/pixel-values/modality-lut、新增 roi-source-values 字节流回归及 ROI core。只读共享实现；变异仅在 `/tmp` 隔离打包，未修改工作区业务源码。恢复模块不在本报告范围。

## 原发现的处置

| 编号 | 核对结果 | 结论 |
| --- | --- | --- |
| ROI-01 | pixelEncoding 检查 8/16-bit 容器、有效位数、HighBit 范围及 PixelRepresentation；unpackNativePixels 先移位/屏蔽未用位，再以有效符号位减 2^BitsStored。source-local 在原始帧切片及既有大端 swap 后调用它，不再直接把 16-bit 容器当最终样本。真实字节回归验证任意高位 signed12、signed/unsigned16、unsigned12、signed8、旧 HighBit 对齐与多帧。 | 原先 signed12 -1024 变 3072 的未压缩入口路径关闭。 |
| ROI-02 | parseModalityLUT 从标准 `(0028,3000)` 取单项序列，用 uint16/int16 读取三值二进制 Descriptor：首尾为 US，仅第二值按 PixelRepresentation 有符号。解析出的 LUT 随 plane 进入 PixelFrame，新 ROI 再经既有变换函数消费。标准 LUT 字节流读回 mean=22.5、min=10、max=30；SS 起点 -1、8-bit 紧排与 16-bit 填充均有回归。 | 原先标准序列丢失、ROI mean=1.25 的路径关闭。 |

## 边界与错误路径核对

- HighBit 允许有效位整体左移的旧文件，位域必须完全处于容器内；不以容器最高位替代实际符号位。16-bit 全有效位的掩码为 65535，JS 位运算仍能正确取得全部 16 位，再按符号阈值处理。
- LUT 序列为空/多项、Descriptor 不为 6 字节、数据缺失、位深非 8/16、数据长度不匹配或值超出位深均明确抛错；不会把已存在但畸形的 LUT 当成不存在并静默套用缺省 Rescale。
- Descriptor 首值 0 按 65536 条处理，数据长度随 count 校验；只解析到一个有效项后创建 LUT。8-bit 紧排的奇数字节填充不纳入条目；16-bit 填充条目仍核验值范围。
- 新 source-local helper 没有引入第二个解析器、外部请求或 core 宿主依赖。原始帧先解包再应用 Modality LUT/Rescale；没有把显示 VOI 或反色写进数值统计。
- 压缩分支仍先走 codec 并直接返回其 PixelFrame，没有调用新 unpackNativePixels；这是防止擅自重复移位/解包的合理边界，但本轮证据不能证明所有压缩解码器均已规范化样本。测试均为未压缩 Explicit VR Little Endian；大端原始帧、packed8 大端 LUT、更多实际厂商 LUT 编码变体尚未独立验收。

## 独立测试

命令：

```sh
pnpm exec vitest run packages/app-web/tests/roi-source-values.test.ts packages/core/tests/measurement-roi.test.ts
```

结果：2 文件、18 项通过，其中实际 DICOM 字节→source→frame→ROI 9 项，ROI core 9 项。

## 隔离变异

使用仓库现有 esbuild，将同一 `roi-source-values.test.ts` 与其实际依赖打包到 `/tmp/odv-roi-review-mutation-2Iaxyb`；仅 onLoad 内替换隔离副本字符串，外置 vitest。配置/依赖均复用现有版本，没有安装依赖、改写共享实现或删除测试。

| 隔离副本 | 故意破坏点 | 实际结果 |
| --- | --- | --- |
| baseline.test.mjs | 无修改，同样的打包与 Vitest 配置 | 9 项通过，排除打包环境自身制造失败。 |
| sign.test.mjs | 把有效位的有符号扩展表达式替换为原 unsigned value | 4 项失败、5 通过；signed12 回到 `[3072×4]`，signed8 和旧 HighBit 也失败，SS LUT 对应统计错误被捕获。 |
| lut.test.mjs | 把 `dataSet.elements.x00283000` 退回错误的 x00283002 | 3 项失败、6 通过；标准 LUT、SS LUT 与畸形 LUT 应拒绝的路径均变红。 |

执行：

```sh
pnpm exec vitest run --root /tmp/odv-roi-review-mutation-2Iaxyb --config /tmp/odv-roi-review-mutation-2Iaxyb/vitest.config.mjs
pnpm exec vitest run baseline.test.mjs --root /tmp/odv-roi-review-mutation-2Iaxyb --config /tmp/odv-roi-review-mutation-2Iaxyb/vitest.config.mjs
```

两种破坏共 7 项预期失败；baseline 独立运行 9 项通过。临时目录不属于交付物，后续可能由系统清理；仓库正式字节流测试才是持续回归依据。

## 最终边界

本复核范围未发现新的确认阻塞项，ROI-01/02 在已测未压缩数值链关闭。没有验收 ROI GUI、真实患者数据、压缩数值链、全量构建/测试、性能或 JSON 恢复；这些结果由相应主线交付证据分别报告。
