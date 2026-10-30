# ICBM152 平均头部矢状面教学示例

这是从 McGill ICBM152 2009c T1 平均模板提取的中线矢状面，包含完整头部轮廓；不是某位患者的原始检查。数据以派生 MR DICOM 存储，单层 229×193、1 mm 像素间距，保留源 int16 像素和灰度缩放。

- 来源与许可：见 LICENSE.txt。
- 源 NIfTI 和 DICOM 的 SHA256、物理位置与方位：见 provenance.json。
- 重现：下载 provenance.json 中的公开源 ZIP，运行 `python3 packages/app-web/testing/generate-head-sample.py <ZIP或解出的T1.nii>`，再运行 `node packages/app-web/testing/generate-sample-previews.mjs`。
- 单层示例用于调窗、缩放、平移；不用于 MPR、测量结论或诊断。原有 36 帧 MR 序列仍保留于顶部的全部示例中。
