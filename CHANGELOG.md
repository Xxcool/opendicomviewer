# 更新日志

按版本记录已交付的功能、修复和重要限制。后续开发范围见[项目状态](docs/PROJECT_STATUS.md)。

## [0.1.0-alpha.1] — 2026-11-09

首个桌面预览版本，提供 Windows x64 与 macOS Apple Silicon 客户端。

### ✨ 新增

- 本地 DICOM 文件、文件夹、DICOMDIR 和 ZIP 导入，支持进度、取消与部分失败提示。
- 二维浏览、调窗、平移、缩放、二维播放和独立 2×2 分屏。
- 有效空间几何影像的降采样 MPR 2×2 / 1+3 与基础定位联动。
- 原始单视口的直线/折线测距、矩形/椭圆 ROI、三点角/Cobb、箭头、文字和手绘轮廓。
- 标注控制点编辑、备注、删除、撤销/重做、JSON 保存恢复及未保存保护。
- PNG 预览与桌面原生保存；完整原始 DICOM 实例/序列导出，不覆盖原图。

### 🛠️ 修复与改进

- 收纳工具栏：合并标注与测量入口，布局和辅助操作改为分类菜单，保留原有快捷键。
- 改进导入加载反馈，显示真实阶段进度和百分比，修正人形扫描图越框。
- 修正有符号像素与 Modality LUT 数值处理，恢复标注时核对原始帧并重算测量值。
- 修正 Windows CRLF 检出导致的发行版本校验失败，补充跨换行格式回归测试。
- 精简 README，增加清晰的截图、下载入口与功能边界说明。

### 📦 下载与验证

- Windows x64：NSIS EXE 安装包。
- macOS Apple Silicon：DMG 与 APP ZIP，最低 macOS 13；暂不提供 Intel Mac 包。
- 附两平台 SHA-256 校验清单、源提交与架构记录。
- 两平台构建测试通过；下载后的 macOS APP 已实际启动并显示内置教学影像。

### ⚠️ 已知限制

- 预览包未配置 Windows 发布者证书、macOS Developer ID 与公证；Windows 实机界面及安装/卸载尚待验收。
- macOS MPR 多轮布局/主题切换仍有重绘问题；标注测量限原始 1×1 Stack。
- ROI 灰度单位尚未确认，手绘只保存轮廓与备注；原生 ZIP 展开项和内置样本暂不支持原始 DICOM 导出。
- DICOM SR/GSPS、脱敏、3D 体绘制和真正的 4D 尚未交付。

[安装包与完整发行说明][0.1.0-alpha.1] · [本版提交记录](https://github.com/Xxcool/opendicomviewer/commits/v0.1.0-alpha.1/) · [验收记录](docs/reviews/DELIVERY-2026-11-09-preview-release.md)

[0.1.0-alpha.1]: https://github.com/Xxcool/opendicomviewer/releases/tag/v0.1.0-alpha.1
