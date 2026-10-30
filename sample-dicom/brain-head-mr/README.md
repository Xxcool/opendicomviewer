# ICBM152 完整平均头部教学示例

从 McGill ICBM152 2009c T1 平均模板派生两条序列；不是某位患者的原始检查。保留源 int16 像素、灰度缩放与物理几何，不补层、不插值。

- 默认：193 层连续轴位 DICOM，矩阵 193×229，层距及像素间距均为 1 mm。可选择 2×2 或 1+3 布局，使用现有 MPR 十字准星和翻层联动。MPR 仍走仅显示的 8-bit Volume 通路。
- 参考：`head-sagittal.dcm` 是同一体积 x=0 的中线矢状面（229×193），与欢迎页预览一致；单独选择这条参考序列时，正确禁用 MPR。
- 来源与许可：见 LICENSE.txt。源 NIfTI、全部输出文件的 SHA256 和几何参数：见 provenance.json。
- 重现：下载 provenance.json 中的公开源 ZIP，运行 `python3 packages/app-web/testing/generate-head-sample.py <ZIP或解出的T1.nii>`，再运行 `node packages/app-web/testing/generate-sample-previews.mjs`。
- 原有 36 帧 MR 仍保留于顶部的全部示例中，但实测网格不连续，供原始切片浏览，不作为 MPR 演示。
