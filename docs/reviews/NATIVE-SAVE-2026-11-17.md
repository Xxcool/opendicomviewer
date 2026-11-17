# macOS 原生保存验收 · 2026-11-17

在 macOS 15.1.1（Apple Silicon）上启动本地生产构建的 OpenDicomViewer.app，使用单层 CT 教学样本验证桌面宿主的系统保存面板。对应源码版本为 `9e71c45`。

| 操作 | 观察结果 |
| --- | --- |
| 从首页载入 CT，在「标注与测量」选择「线段测距」并拖动 | 影像和标注列表均显示 78.57 mm |
| 在「导出 → 标注 DICOM」选择「导出当前帧 GSPS」，取消系统保存 | 返回原导出面板并显示「已取消保存。」；两项导出操作再次可用 |
| 再次导出 GSPS，在系统面板保存建议文件名 | 应用显示「GSPS 已保存。」；实际文件 `presentation-state.dcm` 为 1810 字节 |
| 导出当前帧测距 SR，在系统面板修改建议名称并保存 | 默认名称主干为 `distance-report`，改名后保存的文件仍有 `.dcm` 扩展名；应用显示「SR 已保存。」；文件为 1692 字节 |

## 独立核对

用 pydicom 3.0.2 读取两份实际输出和 [原始 CT](../../sample-dicom/ct-body/ct-slice-001.dcm)。两份结果与源图的 Study Instance UID 一致，各处 Referenced SOP Instance UID 均指向该 CT 实例。GSPS 的 SOP Class 为 Grayscale Softcopy Presentation State Storage，窗宽 400、窗位 40；SR 的 SOP Class 为 Enhanced SR Storage，NUM 项为 78.5720343572241 mm。两者记录相同的浮点坐标。按原图像素间距 0.675781 mm 从端点重算得到 78.5720389088745 mm，差值小于 0.00001 mm。

复验时可以任意选取一条线，记下界面四舍五入后的读数，在两个结果文件中核对几何坐标、长度和原图引用。每次新生成的结果实例 UID 会变化。本项覆盖上述系统保存、取消与读回流程，Windows 原生面板及第三方工作站的显示需单独验证。

## 独立查看器显示

在 macOS 上以独立临时配置启动 Weasis 4.8.0，一次导入同一目录中的公开 CT、桌面产生的 GSPS 和 SR。原图视图显示水平线段，窗宽/窗位为 400/40。在左侧双击 Structured Report，报告显示 Distance = 78.5720343572241 millimeter 并给出图像引用。这次只验证上述三份文件与该版 Weasis。[归档传输和 DCMTK 对照](INTEROP-2026-11-17.md)
