# OpenDicomViewer

> "像看照片一样看 CT —— 纯本地运行，守护每位患者的隐私。"

[![CI](https://github.com/opendicomviewer/opendicomviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/opendicomviewer/opendicomviewer/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

---

### ⚠️ 预期用途与非诊断声明 (Intended Use)

> **OpenDicomViewer 仅供研究、教学与非诊断参考使用（For research, educational and non-diagnostic reference use only）。**
>
> 本软件不构成医疗器械，不用于疾病诊断、治疗决策或患者监护。软件显示结果未经临床验证，不保证符合 DICOM GSDF 校准显示要求。测量数值仅供参考。

---

## 项目定位

OpenDicomViewer 是一套**零安装、重隐私、极速流畅、现代化**的开源医学影像（DICOM）浏览器与分析套件。

- **纯本地运行**：零外部网络请求（可验证的零外部通信），全流程不向任何第三方回传数据。
- **光盘与本地文件即插即看**：专注解决手持光盘、文件夹拖入秒开场景，具备高容错的层序几何排序与缺层检测。
- **现代化架构**：六边形架构（Ports & Adapters），核心层纯 TypeScript 零 DOM 依赖，渲染基线基于 WebGL2。

权威架构设计请参阅：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。  
开发硬性编码约束请参阅：[GEMINI.md](GEMINI.md)。

## 仓库结构

```
packages/
  core/            # 纯 TS，零 UI、零宿主 API、零 DOM
    domain/        # Study / Series / ImagePlane / Measurement 领域模型
    ports/         # 六边形端口定义 (DataSourcePort, RendererPort, CodecPort...)
    pipeline/      # IPP 投影排序、鲁棒缺层检测、DICOM PS3.3 VOI LUT 映射
    testing/       # Phantom 物理断言与测试工具
  adapters/        # 端口的具体实现
    source-local/  # 本地文件系统 / DICOMDIR 适配器
    renderer-cs3d/ # Cornerstone3D 渲染适配器
  app-web/         # React 19 应用壳
docs/
  ARCHITECTURE.md  # 架构方案 v2.0
  adr/             # 架构决策记录
```

## 开发与验证

```bash
# 安装依赖
pnpm install

# 启动 Web 开发服务
pnpm --filter @opendicomviewer/app-web dev

# 类型检查 (严谨类型推导，无 unchecked 报错)
pnpm typecheck

# 代码与边界检查 (ESLint R6 规则)
pnpm lint

# 单元测试 (Vitest 覆盖率与 Golden Test)
pnpm test

# 构建与本地预览
pnpm --filter @opendicomviewer/app-web build
pnpm --filter @opendicomviewer/app-web preview
```

静态部署时复制完整的 `packages/app-web/dist/`，包括 `samples/manifest.json` 与示例文件。
构建会从仓库根目录 `sample-dicom/` 同时生成清单并复制样本，无需额外的示例数据服务。

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 授权开源。

### 完整头部教学示例

欢迎页的「MR 脑部影像」现在实际载入 `sample-dicom/brain-head-mr/head-sagittal.dcm`：从 [McGill ICBM152 2009c 平均 T1 头部模板](https://nist.mni.mcgill.ca/icbm-152-nonlinear-atlases-2009/) 导出的中线矢状面，包含完整颅脑轮廓。预览 PNG 来自同一份 DICOM。它是单层教学模板，不是个人原始检查，不提供完整体积 MPR。原有 36 帧 MR 仍可从顶部「示例」载入全部后选择。

来源、许可、派生方法和哈希见该目录的 `README.md`、`LICENSE.txt` 与 `provenance.json`。重现步骤：

```bash
python3 packages/app-web/testing/generate-head-sample.py /path/to/mni_icbm152_nlin_asym_09c_nifti.zip
node packages/app-web/testing/generate-sample-previews.mjs
```
