# 首个双端预览版交付

日期：2026-11-09。

- [Release v0.1.0-alpha.1](https://github.com/Xxcool/opendicomviewer/releases/tag/v0.1.0-alpha.1)
- 源提交：`c562990ae468888080c6e6338103ae446c220e09`；应用内部版本0.1.0。标签已通过GitHub API核对指向该提交。
- [成功的固定源构建](https://github.com/Xxcool/opendicomviewer/actions/runs/42552117047)：validate、Windows x64、macOS arm64全部成功；对应主分支CI与Pages检查通过。

## 产物与范围

| 平台 | 产物 | 当前验证 |
| --- | --- | --- |
| Windows x64 | NSIS `-setup.exe`，21771324字节 | Windows runner完成类型/Lint、应用与Rust测试、原生release打包；下载SHA-256与源/架构清单核对通过。未完成Windows实机GUI及安装/卸载验收 |
| macOS Apple Silicon | DMG，22875614字节；APP ZIP，22817866字节 | arm64 runner同源构建；下载SHA-256、Mach-O arm64及DMG内部完整性通过；下载后APP实际启动，193帧内置MR加载与第97层显示通过 |

另附 `build-windows-x64.json`、`build-macos-arm64.json` 与两套 `SHA256SUMS-*.txt`，共7个公开资产。未配置Windows发布者证书、macOS Developer ID和公证，采用预发布标记，不宣称稳定签名发行版。没有Intel Mac或Linux包。

截图：[下载后的macOS发行包](assets/release-2026-11-09/downloaded-macos.png)。截图为教学模板，未提交真实患者文件或本地导出数据。

## 完成的收尾

README精简至95行，移除部署/发布流程与Cloudflare专章；保留简介、截图、功能/限制、下载、快速开始、样本、作者和许可。工具栏将布局、测量/标注和辅助操作分类收纳，原功能/快捷键仍有入口。原始DICOM和PNG原生保存已交付，前一批详细验证见[收尾准备](DELIVERY-2026-11-08-release-preparation.md)与[原图导出](DELIVERY-2026-11-08-original-export.md)。

应用386项测试、发布回归2项及macOS Rust11项通过；两平台runner重新执行实际检查与打包，不以本机macOS结果替代Windows编译。首次Windows任务在版本校验失败：脚本未兼容CRLF，已保留[独立复核](CR-2026-11-09-release-crlf.md)，修复后完整重建通过；没有削弱版本门禁。

## 保留的边界

预览版发布不代表所有原规划完成。SR/GSPS、HU单位确认、分屏测量、完整Web/Windows GUI、更多真实厂商输入、性能规模与隐私网络审计仍未全部闭环；桌面MPR多轮切换绘制问题继续列为已知问题；3D体绘制和真实4D尚未交付。正式稳定版、签名及跨平台实机验证仍需后续独立验收。

公开资产发布后的再次下载校验结果在最终核验追加中记录，不以上传成功替代下载验证。

## 最终核验追加

GitHub API确认 `draft=false`、`prerelease=true`、标签指向 `c562990ae468888080c6e6338103ae446c220e09`，7个资产均为uploaded。逐一将GitHub服务端提供的SHA-256 digest与已下载的Actions产物实际字节比对，全部一致，包含两个manifest与两份校验清单。

从公开Release资源CDN再次下载时，本运行环境连接被拒，正常重试仍失败，未完成公开下载通路复验；未修改DNS、代理或绕过网络限制。此前Actions实际下载、产物清单/hash比对、DMG内部完整性及下载后macOS APP启动均通过。这些是独立证据，不能将服务端digest相同表述为公开CDN下载成功，也不将本机网络问题认定为所有用户无法下载。
