# 原始帧 ROI 数值核心独立审查

日期：2026-11-04。范围：`packages/core/measurement/roi.ts`、`measurement-roi.test.ts`、core index 导出，以及真实 `LocalDataSource → PixelFrame → ROI` 数值链。恢复模块不在本报告范围。只读实现，没有修改业务代码或既有报告。

## 结论

新 ROI 模块的中心采样、矩形/椭圆选择、连续几何面积、人口标准差与 Modality LUT 优先规则，在其声明的 PixelFrame 契约下未发现确认错误。9 项目标测试通过。

**真实数值入口仍有两项可复现的既有缺陷，不能据这 9 项手工 PixelFrame 测试宣称真实 DICOM ROI/HU 链正确。** 两项根因均在已有 source-local，非本轮 roi.ts 引入；新数值工具会消费错误输入，因此在开放对应格式统计前应修复或明确拒绝。

## 发现

| 编号 | 级别 | 实现与实际输出 | 应有结果 |
| --- | --- | --- | --- |
| ROI-01 | P1 | source-local.ts 原始像素分支仅按 PixelRepresentation 将 16-bit 容器解释为 Int16Array，没有按 BitsStored 取有效位并符号扩展。实际 fixture：2×2，BitsAllocated=16、BitsStored=12、HighBit=11、PixelRepresentation=1，四个容器均 0x0C00；经 probe/listSeries/openSeries/pixel 返回 `[3072,3072,3072,3072]`，ROI `mean=3072`。 | 12-bit 补码 0xC00 为 -1024，应得到四个 -1024 及 mean=-1024。未使用的高位不能假定已经符号扩展。[DICOM PS3.5 §8.1.1](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_8.html)明确 HighBit 是补码符号位，未用位不可作此假定。 |
| ROI-02 | P1 | parse.ts:127–149 把 Modality LUT Sequence 定位到 `x00283002`，但实际序列为 `(0028,3000)`；3002 是其内 Descriptor。标准 SQ fixture：Descriptor US `[3,0,16]`、LUTData OW `[10,20,30]`、原始像素 `[0,1,2,2]`；实际 source 后 plane/frame LUT 均缺失，ROI `mean=1.25`、min=0、max=2。 | 经 LUT 应为 `[10,20,30,30]`，mean=22.5、min=10、max=30。即使修正序列 tag，当前 `itemDs.string('x00283002')` 读取 US/SS 的方式也须一并修正，不能只改一个 tag。[DICOM PS3.3 C.11.1](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.11.html)定义了序列、三值 Descriptor、US/SS 与 8/16-bit LUT 数据。 |

ROI-02 第二次复现使用 SC SOP/OT、无 Rescale 标签，避免把“LUT 与 Rescale 同时存在”的非规范输入作为唯一证据；上述错误结果仍成立。原始像素读取器为缺失 Rescale 提供 1/0 缺省，因 LUT 丢失而把存储值当输出值。

## 可复现构造与执行证据

复现调用实际仓库的 `buildDicomBuffer` / `encodeElement`、`LocalDataSource` 和 `measureImageRegion`，未手写替代解析或统计实现。使用现有 esbuild 打包为 Node 脚本，输出只放 `/tmp`，没有新增依赖或改仓库源码。

执行：

```sh
node /tmp/odv-roi-signed12-repro.cjs
node /tmp/odv-roi-lut-repro.cjs
```

实际输出关键字段：

```json
{"bitsStored":12,"pixelRepresentation":1,"pixels":[3072,3072,3072,3072],"roi":{"ok":true,"stats":{"count":4,"mean":3072,"stdDev":0,"min":3072,"max":3072,"areaUnavailable":"uncalibrated"}}}
{"planeLut":null,"frameLut":null,"pixels":[0,1,2,2],"roi":{"ok":true,"stats":{"count":4,"mean":1.25,"stdDev":0.82915619758885,"min":0,"max":2,"areaUnavailable":"uncalibrated"}}}
```

临时脚本可能被系统清理；长期回归应把以下输入构造加入 source-local 的集成测试，并断言真实 PixelFrame 与 ROI 输出，而非只断言手工填写的 frame：

- ROI-01：fixture 参数 `rows:2, columns:2, bitsAllocated:16, bitsStored:12, pixelRepresentation:1, rescaleSlope:1, rescaleIntercept:0, pixelData:new Uint8Array(new Uint16Array([0xC00,0xC00,0xC00,0xC00]).buffer)`。
- ROI-02：`encodeElement(0x28,0x3002,'US',...)` 写 descriptor，3004 LO 写 LUT Type，3006 OW 写 data；用 `(FFFE,E000)` 明确长度 item 封装，再以 extraElements `{tag:[0x28,0x3000],vr:'SQ',value:itemBytes}` 写入 fixture。四个原始像素为 `[0,1,2,2]`，不提供 Rescale。通过 source 的真实 probe/open/pixel 后调用 `measureImageRegion(frame,{shape:'rectangle',start:[0,0],end:[1,1]})`。

## 新核心的核对点

- 输入只接受完整灰度 typed array，尺寸/像素数不符、彩色、非法变换会明确失败。数值经现有 rawToHU（通用 Modality LUT/Rescale 变换函数）后统计，不经过 VOI、反色或显示降采样。
- 矩形闭边界按像素中心 `ceil(left)..floor(right)` 收集；椭圆按归一化半径平方 ≤1 收集，未把外接矩形角点算入。反向拖动通过 min/max 归一化；部分越界拒绝而非裁剪；退化与无像素明确失败。
- 面积是连续图形宽×高×列/行间距，椭圆再乘 π/4；与采样像素 count 分开。因此 `[0,0]..[1,1]` 的闭矩形可采四中心而几何面积只有一个 spacing 乘积，这与本轮明确的中心坐标/连续图形契约一致，不构成 off-by-one。
- 行/列间距对应 y/x 正确；不可信标定仅返回灰度统计并明确 areaUnavailable；非法物理标定不会生成伪面积。
- Welford 增量均值/M2、总体标准差 `sqrt(M2/count)` 符合人口统计口径；非有限中间数拒绝，未把异常值静默加入结果。
- core index 已导出模块；core 新模块不引入 DOM、宿主 API、DICOM 解析或 CS3D。输出 mean/stdDev 未自动冠以 HU，最终 UI 必须另核实单位，不能凭模态名称推测。

## 验证与未覆盖

`pnpm exec vitest run packages/core/tests/measurement-roi.test.ts`：1 文件、9 项通过。上述两项端到端合成字节流分别产生错误统计，证明测试通过的边界仅到手工 PixelFrame 契约。

本审查没有修改实现、添加仓库测试或进行变异修改；未验收 ROI GUI、异步切帧、真实患者数据、压缩像素、PixelPadding/更多 Modality LUT 编码变体。ROI-01/02 修复应有 source-local 字节流回归，并重新审查后才能关闭。
