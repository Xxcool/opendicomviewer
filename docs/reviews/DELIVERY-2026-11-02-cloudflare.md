# Cloudflare Pages 首次部署记录

日期：2026-11-02。实施方记录，线上功能完整验收尚未通过。

## 部署结果

- 地址：https://opendicomviewer.pages.dev/
- Cloudflare Pages 项目：`opendicomviewer`，Git 来源 `Xxcool/opendicomviewer`，生产分支 `main`。
- 首次部署提交：`e546e7ff001ddd9870e233328804265eba89d852`。来源为已提交代码，原有七处未提交代码改动与 `.trae` 报告未上传。
- 通过用户明确授权的浏览器控制台完成创建，Cloudflare 页面显示“成功！您的项目已部署到以下区域：全球”。插件 API 此前持续返回 Pages scope 不足；浏览器部署成功不代表插件 OAuth 问题已修复。
- 自定义命令：`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @opendicomviewer/app-web build`；输出 `packages/app-web/dist`。
- 环境变量：`NODE_VERSION=20.20.2`、`PNPM_VERSION=12.5.1`、`SKIP_DEPENDENCY_INSTALL=1`。未启用分析上报或新增业务后端。

## 已取得的证据

- 已提交源码的隔离副本：278 项测试、typecheck、lint、Web build 通过。产物 248 个文件，清单列出的 231 个样本文件均存在，最大文件约 1.57 MiB。
- 浏览器实际打开线上欢迎页，标题为 OpenDicomViewer，本地打开、MR/CT 示例入口及封面可见。
- 浏览器直接打开 `/samples/manifest.json`，显示 `brain-head-mr` 194 文件、`brain-mr` 36 文件、`ct-body` 1 文件。头部 194 文件由 193 张轴位与 1 张矢状参考图组成。
- Cloudflare 成功页面截图保存在本机临时目录，包含账号界面信息，未作为公开仓库资产提交。

## 验收未完成与后续工作

- 本轮线上 MR 示例点击后持续停留“正在加载示例数据集 brain-head-mr...”，未取得完成导入、渲染与 MPR 操作证据；捕获到的浏览器 error/warn 日志为空，不能据此认定没有问题。
- 后续浏览器导航与截图控制出现超时，CT 与完整交互验收未完成；独立 Python HTTP 探针返回 403，而浏览器能打开欢迎页和清单，不能将这些现象直接判为应用代码或 Cloudflare 全站故障。
- 待在稳定的浏览器连接下继续验收：MR/CT、导入取消和失败提示、本地教学文件/ZIP、多视口、主题、刷新及网络请求。真实患者数据只用于本机验证，不作为站点资源上传。
- 当前状态为“部署完成、部分可达性验证通过”，不是“全功能验收通过”或正式桌面发行版。
- 构建日志提示 Node 20 已停止维护，平台安装的新 Corepack 也有 Node 引擎告警；本次构建成功，后续应单独安排工具链升级验证。
