# 工作区 v2 与真实影像欢迎页：实施及验收记录

日期：2026-10-30。范围：完成已获授权的第一阶段工作区改造，并按用户参考图调整欢迎页。保留既有技术栈、本地处理模式及原有未提交改动。

## 已实现与证据

| 内容 | 实现证据 |
| --- | --- |
| 欢迎页居中展示导入主入口、两份影像示例、文件拖放入口及三步说明 | `packages/app-web/src/components/WelcomeScreen.tsx`、`packages/app-web/src/index.css` |
| 示例卡片使用对应数据集的真实影像，点击装载对应 MR 或 CT | `public/sample-previews/brain-mr.png`、`ct-body.png`（均在 app-web 下），`WelcomeScreen.tsx` 的数据集 ID |
| 预览不包含患者信息叠加层，保留真实灰度与原图比例 | `packages/app-web/testing/generate-sample-previews.mjs` 复用核心 `rawToHU` / `mapHUToUint8`；`public/sample-previews/provenance.json` 记录源文件、SHA256、尺寸和窗口 |
| 顶栏集中导入、设置与主题；独立工具条接通翻页、调窗、平移、缩放、适应窗口和布局 | `Header.tsx`、`WorkspaceToolbar.tsx`、`viewport-gestures.ts`、已提交的渲染端口与适配器 |
| 左栏可收起，右栏默认收起，专注模式保留原面板偏好；保持渲染容器节点 | `App.tsx`、`state/viewer-store.ts`、`tests/store.test.ts` |
| 序列列表懒加载真实中间帧预览，限制并发并释放独立句柄 | `SeriesThumbnail.tsx`、`thumbnail.ts`、`SeriesList.tsx`、`tests/thumbnail.test.ts` |
| 详情区分影像与提醒，移除尚未实现的测量占位；CT 预设不再显示于 MR | `MetadataPanel.tsx`、`Viewport.tsx`、`MprWorkspace.tsx` |
| 键盘操作避开输入与模态框，图标按钮有名称，详情页签支持方向键 | `viewport-gestures.ts`、`WorkspaceToolbar.tsx`、`MetadataPanel.tsx` |
| MPR 联动后的原始切片层号读取 CS3D 实际视口，后续翻页不使用旧缓存 | 本地提交 `b151293`，`renderer-cs3d/tests/renderer.test.ts` |
| 连续相对翻页在队列执行时读取层号，切换序列后取消旧导航；同步底栏层号 | `slice-navigation.ts`、`MprWorkspace.tsx`、`tests/slice-navigation.test.ts` |

设计依据先更新于 `docs/design/tokens.md`、`ui-spec.md` 与 `prototype.html`。旧原型保留五态演示，新空态引用同一份真实预览资产。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 当前工作区 `pnpm test` | 18 个测试文件、229 项通过 |
| 独立快照 `pnpm test` | 18 个测试文件、226 项通过；排除了原有 7 个改动文件 |
| 独立快照 `pnpm typecheck` | 通过 |
| 独立快照 `pnpm lint` | 通过；预览生成器使用标准 Node ESM 导入，没有放宽规则 |
| 独立快照 `pnpm --filter @opendicomviewer/app-web build --outDir ...` | 通过；静态产物包含样本清单、DICOM 与两份 PNG |
| 实际静态构建回归测试 | `tests/sample-build.test.ts` 检查样本清单、文件、预览 PNG 签名与尺寸 |
| 导航变异检验 | 将读层号移回入队前，五步翻页测试由期望第 54 层退化到第 50 层并失败；恢复正确实现后通过 |
| `git diff --check` | 通过 |

会话原始日志和隔离产物位于 `/private/tmp/odv-workspace-20261030/`；该目录是临时验收附件，不是产品运行依赖。生成预览可重现：

```bash
node packages/app-web/testing/generate-sample-previews.mjs
```

构建仍有既有的单包超过 500 kB 提示；独立快照主 JS gzip 约 460 kB。本轮没有改 CI、构建配置、依赖清单或锁文件来掩盖提示。

## 浏览器验证边界

2026-10-29 的早期迭代曾观察到 MR 显示、缩略图、缩放、平移、侧栏及专注模式保留第 12 层，以及合成 CT 的 MPR 加载和激活视口操作。这些观察不等于最终版本已完成浏览器验收。

2026-10-30 对 `http://127.0.0.1:8769/` 的访问被浏览器保存的权限设置拒绝，已停止浏览器操作，没有改端口或换浏览器绕过。最终欢迎页的整体视觉、浅色/窄窗表现和连续按键操作仍需浏览器复核；导航队列已通过代码级回归与变异检验。

## 保留的改动与后续边界

未暂存、未提交原有文件：source-local 的 `parse.ts`、`scanner.ts`、`source-local.ts`、两份测试，app-web 的 `warning-presentation.ts`，以及 `core/domain/types.ts`。原 `.trae/documents/接手报告-2026-10-28.md` 保持原样。以上文件没有混入本轮提交。

- 当前文件夹通过选择器导入；欢迎页不宣称已支持文件夹拖放遍历。
- MR 示例有几何缺层，现有 CT 为单层；两者不作为完整 MPR 演示。CT 卡片使用「CT 示例影像」，不展示与实际数据不符的胸腹配图。
- 「默认窗」恢复初次装载窗口，不宣称会重新计算自动对比度。
- 测量/ROI、对比阅片、导出与完整移动触屏适配尚未实现。

后续增量可选：① 补充可重现的完整 MPR 示例并完成浏览器验收；② 接入测量/ROI 与标注管理；③ 打通截图/数据导出。均未在本轮开始实现。
