# 实际脑部示例替换与矢状面方位校正

日期：2026-10-30。

## 用户可见结果

欢迎页「MR 脑部影像」实际载入 `brain-head-mr/head-sagittal.dcm`，直接显示头部中线矢状面，不再只更换封面后仍打开原轴位数据。封面预览由该 DICOM 自身生成。原有 36 帧 MR 和单层 CT 保留，顶部「示例」载入全部后仍可选择。

样本是 McGill ICBM152 2009c T1 平均头部模板的一张派生教学切片，229×193、1 mm 像素间距；不是某位患者的原始检查，也不宣称是完整体积或可 MPR 检查。来源、许可、文献、源 NIfTI SHA256、DICOM SHA256 及派生参数随数据保存于 `sample-dicom/brain-head-mr/`。

## 数据与正确性证据

- 来源：[McGill/NIST ICBM152 2009](https://nist.mni.mcgill.ca/icbm-152-nonlinear-atlases-2009/)。已核实公开源模板与许可，并保留版权及所需引用。
- 原始 T1 NIfTI 从供应方 ZIP 的完整条目提取并核对 ZIP CRC；源 SHA256 固定为 `67fe8b2e8fed7fa318d293e79a31416f5b31d70f0330312f58125fcd3dde43a1`。大体积原始下载文件没有提交进仓库。
- `generate-head-sample.py` 仅接受已核实哈希、int16、193×229×193、mm 单位及明确的 RAS 仿射；提取 x=0 中线，不插值、不补绘，不把截图包装为 MRI。
- 派生 DICOM 保留源 int16 体素和灰度缩放，IOP 为 `[0,1,0,0,0,-1]`，IPP 为 `[0,-96,114]`，并记录 DERIVED/SECONDARY/OTHER；未知原始扫描参数以空值保留。
- `head-sample.test.ts` 使用真正的 LocalDataSource 与 PixelCodec，核对导入成功、像素锚点、灰度缩放、默认窗、方位、物理位置与单层 MPR 禁用。
- `slice-geometry.ts` 根据有效 IOP 得出切面名与 LPS 方位，矢状面显示 S/I/A/P；缺失或斜切时不伪造轴位标记。视口物理位置改称「位置」，不再把任何法向距离写成 Z。
- 布局中的全分辨率 Stack 改称「原始切片」，避免把非轴位原始序列标成 Axial。参考：[DICOM Image Plane Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.7.6.2.html)。

## 验证

- 当前工作区：19 个测试文件、233 项测试通过。
- 排除原有七个改动文件的独立快照：19 个文件、230 项测试通过；类型检查、lint、静态构建通过。
- 将切面强制改回轴位的变异被新的矢状面回归测试检出；恢复后通过。
- 静态构建测试核对新增样本清单、DICOM 与 PNG 的实际发布文件。
- `git diff --check` 通过。会话日志位于 `/private/tmp/odv-head-sample-20261030/`。

浏览器自动视觉验收仍受此前保存的权限设置限制；不能把以上代码/数据检查视为浏览器已验收。手动入口：`http://127.0.0.1:5173/?sample=brain-head-mr`。

原有七个文件的未提交改动和接手报告保持原样，不混入此次本地提交；不创建远端或推送。没有修改依赖、锁文件、CI 或运行时渲染架构。

## 后续修正

单层默认示例影响了既有 MPR 演示，现已补齐连续体积并保留参考图；上述单层默认行为已被替代。详见 `CR-2026-10-30-mpr-sample-restoration.md`。
