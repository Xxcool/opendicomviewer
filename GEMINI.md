# GEMINI.md — OpenDicomViewer 编码约束

> **本文件是硬约束，不是建议。**
> 权威架构文档：`docs/ARCHITECTURE.md`（v2.0）。与本文件冲突时，以本文件为准。
> 生效范围：全仓库。修改本文件需人工批准。

---

## 0. 开工前必读

1. **先读 `docs/ARCHITECTURE.md` 全文**，再动代码。你在 v1 里会看到"WebGPU 渲染核心""OPFS 大容量缓存""Rust 遍历重写 Tag"等表述，**这些在 v2 已被否决**，不要按 v1 实现。
2. **不确定就停下来问，不要猜。** 尤其是 Cornerstone3D 的 API 名称、DICOM 标签语义、Tauri 配置字段——猜错会污染整个模块，修改成本远高于提问。
3. **不许自行扩大范围。** 只做当前任务描述里的事。发现"顺手可以优化"的地方，写进 PR 描述的"发现但未处理"段落，不要直接改。
4. 每次提交前跑第 12 节的自检清单，逐条对照。

---

## 1. 十条红线（违反即打回，不接受讨论）

| # | 红线 | 违规信号 |
| --- | --- | --- |
| R1 | **WebGL2 是唯一渲染基线**，WebGPU 只能作为能力探测后的可选增强 | 代码里直接 `navigator.gpu.requestAdapter()` 且无 WebGL2 回退；把 `webgpu` 写进默认配置 |
| R2 | **MPR / 体绘制只能用降采样 Volume**，全分辨率只走 Stack | 把整个序列的 imageIds 一次性喂给 `volumeLoader.createAndCacheVolume()` |
| R3 | **序列排序禁止用 InstanceNumber** | `sort((a,b) => a.instanceNumber - b.instanceNumber)` |
| R4 | **渲染循环内禁止 setState** | 指针移动事件里调用 `setState` / `useState` 的 setter |
| R5 | **零外部网络请求**，禁止任何第三方 CDN / 字体 / 埋点 / 错误上报 | 引入 `fonts.googleapis.com`、`cdn.jsdelivr.net`、Sentry、GA、PostHog |
| R6 | **`packages/core` 不得出现宿主 API** | core 里出现 `window.`、`document.`、`fetch(`、`localStorage`、`__TAURI__` |
| R7 | **禁止静默降级** | 缺层不提示、解码失败悄悄跳过、能力不支持却仍显示入口 |
| R8 | **脱敏必须白名单**，禁止黑名单式删除标签 | 只删除 `PatientName/PatientID/BirthDate` 等已知字段 |
| R9 | **大二进制禁止走 Tauri IPC** | `invoke('read_file')` 返回 `Vec<u8>` / `ArrayBuffer` |
| R10 | **禁止任何"诊断"表述** | 变量名、UI 文案、注释里出现"诊断""诊断报告""诊断结论" |

---

## 2. 技术栈锁定

### 允许

| 类别 | 选型 | 版本策略 |
| --- | --- | --- |
| UI | React 19 + TypeScript 5.x | 锁 minor |
| 样式 | TailwindCSS v4 | 锁 minor |
| 组件 | Radix UI + `react-resizable-panels` + `dnd-kit` + `cmdk` | 锁 minor |
| 状态 | Zustand（仅 UI 态与会话态） | 锁 minor |
| 渲染 | `@cornerstonejs/core` + `@cornerstonejs/tools` | **锁精确 4.22.13**（vtk.js 34.x）。5.x 在 Vite 下必现 `Class extends value undefined`，见 ARCHITECTURE §14.1.1；升级需先过 Spike |
| DICOM | `dcmjs` / `dicom-parser`（CS3D 自带） | 不额外引入 |
| 桌面 | Tauri 2 | — |
| 构建 | Vite | — |
| 测试 | Vitest + Playwright | — |

### 禁止引入

```
moment / dayjs        → 用原生 Intl + Date
lodash（全量）         → 需要时按需引入单函数
axios / ky            → 本项目无网络需求，禁止任何 HTTP 客户端
Sentry / LogRocket    → 违反 R5
任何 UI 组件库全家桶     → 会与 Tailwind + Radix 冲突
任何 DICOM 解析库（**core 内一律禁止**；adapter 层唯一豁免：`dicom-parser`）→ 会与 CS3D 元数据层打架
three.js              → 仅 Phase 4 高质量 VR 阶段允许，需先批准
```

**DICOM 解析的层级规则（2026-10-27 定，ADR 待补）**

| 层 | 允许 | 说明 |
| --- | --- | --- |
| `packages/core` | **不允许任何 DICOM 解析库** | 只认已解析好的 `ImagePlane` / `PixelFrame`（R6） |
| `packages/adapters/source-*` | **仅 `dicom-parser`** | MIT、纯 JS、可在 Node 运行（可单测）；CS3D 的 dicom-image-loader 本就依赖它 |
| `packages/adapters/codec-*` | 允许 WASM 解码库（OpenJPEG / CharLS / RLE） | 仅解码像素，不做标签解析 |

**codec wasm 必须按需动态加载（Spike A 实测）**：空壳工程里 5 个 codec 的 wasm（合计 1.98 MB，
其中 JPEGXL 1.09 MB）会被静态打进产物，即便只读未压缩 DICOM。任何 `import` codec 包都必须包在
`await import()` 里，禁止顶层静态导入，否则 §11 的包体积预算当场失效。
| 其他任何位置 | 禁止，且**禁止再引入第二个 DICOM 解析库** | 两套解析器必然语义不一致 |

**新增任何依赖前必须问。** 包括"很小很方便"的工具库。

---

## 3. 目录结构与依赖边界

```
packages/
  core/            # 纯 TS，零 UI、零宿主 API、零 DOM
    domain/        # Study / Series / Measurement 领域模型
    ports/         # 所有 Port 接口定义（只放 interface）
    pipeline/      # 导入编排、排序、降采样、预取
  adapters/        # Port 的具体实现
    source-local/  # File API
    source-dicomweb/
    codec-wasm/
    renderer-cs3d/
    storage-idb/
    telemetry-null/
  app-web/         # React 应用（唯一允许碰 DOM 的地方）
  app-tauri/       # Tauri 外壳 + Rust 侧
docs/
  ARCHITECTURE.md
  adr/
```

**依赖方向（单向，禁止反向与跨层）**：

```
app-web / app-tauri  →  adapters  →  core
                ↘________↗
                     （都只依赖 core 的接口）
```

**强制手段**（必须配置，不能靠自觉）：

```jsonc
// .eslintrc 片段 —— packages/core 的 overrides
{
  "files": ["packages/core/**/*.ts"],
  "rules": {
    "no-restricted-globals": ["error", "window", "document", "localStorage", "fetch", "navigator"],
    "no-restricted-imports": ["error", {
      "patterns": ["../app-*", "../../adapters/*", "@cornerstonejs/*", "react*"]
    }]
  }
}
```

> `packages/core` 里**不允许** `import '@cornerstonejs/...'`。core 不知道 CS3D 的存在，只认 `RendererPort`。
>
> **`renderer-cs3d` 的额外纪律**（已落进 eslint）：允许 `@cornerstonejs/*`，但**禁止 `dicom-parser` 与任何网络/存储 API**。
> 渲染适配器不解析 DICOM，只消费 `SeriesHandle.pixel()` 的 `PixelFrame`（ADR-013）；
> CS3D 模块由组合根注入（`cs3d-surface.ts` 的 `Cs3dModuleLike`），Adapter 自身不 `import` CS3D，
> 这样它能在没有 200 个包和 wasm 的环境里跑单测。

---

## 4. 状态管理

| 状态 | 归属 | 规则 |
| --- | --- | --- |
| 相机、VOI、纹理、图层 | **Cornerstone3D** | 唯一真源，应用侧只读 |
| 标注几何 | Cornerstone3D annotation state | 单向订阅后转领域模型落库 |
| 布局、面板开合、激活工具 | Zustand | 不参与渲染循环 |
| 当前 study / 导入任务 | Zustand | 低频变更 |

**R4 的正确写法**：

```tsx
// ❌ 每帧 setState，拖拽必掉帧
const [voi, setVoi] = useState<VOIRange>(initial);
const onPointerMove = (e) => {
  setVoi(computeNext(e));                    // 违规
  viewport.setProperties({ voiRange: voi }); // 还读到过期值
};

// ✅ 渲染用 ref，UI 文本节流
const voiRef = useRef<VOIRange>(initial);
const onPointerMove = (e) => {
  voiRef.current = computeNext(e, voiRef.current);
  viewport.setProperties({ voiRange: voiRef.current });
  viewport.render();
  throttledSetLabel(voiRef.current, 100);    // 仅文本显示，100ms 节流
};
```

**判断标准**：这段代码是否会在 16 ms 内被反复执行？会 → 不许碰 React state。

---

## 5. DICOM 数据正确性

### 5.1 排序（对应 R3）

```ts
import { metaData } from '@cornerstonejs/core';

const sub = (a: number[], b: number[]) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a: number[], b: number[]) => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0],
];
const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

export function sortByPosition(imageIds: string[]): string[] {
  const m0 = metaData.get('imagePlaneModule', imageIds[0]);
  const iop = m0.imageOrientationPatient as number[];
  const normal = cross(iop.slice(0, 3), iop.slice(3, 6));

  return imageIds
    .map((id) => {
      const m = metaData.get('imagePlaneModule', id);
      return {
        id,
        k: dot(m.imagePositionPatient as number[], normal),
        inst: (m.instanceNumber as number) ?? 0,
      };
    })
    .sort((a, b) => a.k - b.k || a.inst - b.inst)  // InstanceNumber 仅做 tie-breaker
    .map((x) => x.id);
}
```

> ⚠️ `imagePlaneModule` 的字段集随 CS3D 版本变化。实现前先查 https://www.cornerstonejs.org/docs 确认，不要照抄上面字段名后不验证。

### 5.2 灰度换算

- 读取像素做任何**数值计算**（ROI 均值、HU 显示、测距后的密度）时，必须确保已应用 `RescaleSlope × pixel + RescaleIntercept`，以及存在 `ModalityLUTSequence` 时的查表。
- 若走 CS3D 的默认渲染路径，它已处理 Modality LUT；**一旦你自己碰原始像素，责任就转移到你身上**。
- 用 phantom 断言：水 ∈ [-5, 5] HU、空气 ∈ [-1050, -950] HU、皮质骨 > 300 HU。任何一条不满足即为 bug，不许"调一下容差"了事。

### 5.3 多帧

- 单文件多帧时必须逐帧展开为虚拟 imageId，帧级几何从 `PerFrameFunctionalGroupsSequence` 取，**不要假设顶层标签有值**。
- 不要把多帧塞进"一文件一层"的假设里。

### 5.4 MPR 几何

MPR 采样必须使用：

- 三线性插值（不是最近邻）
- 各向异性 spacing（`PixelSpacing` + `SpacingBetweenSlices`），不要假设各向同性
- 缺层检测：相邻间距 > 1.5 × 中位数 → 产生 `DataWarning`，**必须冒泡到 UI**

### 5.5 导入容错

```ts
// ✅ 必须的形态：逐文件隔离失败
const results = await Promise.allSettled(files.map(parseOne));
const ok = results.filter(isFulfilled).map(r => r.value);
const failed = results.filter(isRejected);
if (failed.length) emit('import:partial', { ok: ok.length, failed });
```

- 判定 DICOM 文件**不许依赖扩展名**（光盘文件常无扩展名），读偏移 128 处的 `DICM` 魔数。
- 文件名编码见 5.6：**浏览器拿不到原始字节，不要对 `File.name` 调用 `TextDecoder`**。
- 任何单文件异常**不得中断整批导入**。

### 5.6 字符集（中国场景，最易写错的一处）

**文件名解码与标签值解码是两个函数，禁止合并。** 一个的输入是字符串，一个的输入是字节，混写必然出错。

**线 1：文件名**

- ❌ 禁止：`new TextDecoder('gb18030').decode(new TextEncoder().encode(file.name))` —— 这是把已解码的字符串再编码一次，只会得到垃圾。
- ✅ 允许：仅在展示路径时做还原启发式——把字符串按 latin-1 转回字节（`charCodeAt(i) & 0xFF`），再用 `gb18030` 解码，CJK 占比更高则采纳。
- 能否打开与文件名**完全无关**，一律靠魔数判定。
- 桌面端才有字节级文件名（Rust `encoding_rs`），那是另一条实现，不要试图在 Web 端复刻。

**线 2：DICOM 标签值（真正的主战场）**

```ts
const CHARSET_MAP: Record<string, string> = {
  '': 'iso-8859-1',
  'ISO_IR 6': 'ascii',
  'ISO_IR 100': 'iso-8859-1',
  'ISO_IR 192': 'utf-8',
  'GB18030': 'gb18030',
  'GBK': 'gb18030',
  'ISO 2022 IR 58': 'gb18030',   // 调用前须先剥离 ESC 转义序列
  'ISO_IR 13': 'shift_jis',
  'ISO_IR 149': 'euc-kr',
};

export function decodeDicomText(bytes: Uint8Array, specificCharacterSet?: string): string {
  const label = CHARSET_MAP[(specificCharacterSet ?? '').trim()] ?? 'gb18030';
  const primary = new TextDecoder(label).decode(bytes);
  if (!primary.includes('\uFFFD')) return primary;
  // 国产老机型常写中文却不声明字符集，必须兜底
  const fallback = new TextDecoder('gb18030').decode(bytes);
  return scoreCjk(fallback) > scoreCjk(primary) ? fallback : primary;
}
```

- `scoreCjk` 统计 CJK 码点数量，只用于择优，不参与业务逻辑。
- `ISO 2022 IR 58` 是带 ESC 的状态化编码，`TextDecoder` 不直接支持，先剥离 `0x1B` 开头的转义序列再解。
- 该函数必须复用于：标签面板、序列描述、脱敏报告、脱敏后文件名生成。**不许各处自己 `new TextDecoder()`。**

---

## 6. 渲染与内存

### 6.1 双精度路径（对应 R2）

```ts
// ❌ 1000 帧全量入 volume —— 移动端必崩
const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: allIds });

// ✅ Stack 走全分辨率（滑动窗口），Volume 走降采样
const stackHandle = await source.openSeries(ref);            // 全分辨率，按需取层
await viewport.setStack(stackHandle.imageIds, index);

const { imageIds: downIds } = await downsampleInWorker(stackHandle, {
  target: 256,
  valueRange: [-1024, 3071],   // 8-bit 固定映射区间，不允许随窗宽变化
});
const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: downIds });
await volume.load();
```

- **降采样只在 Worker 里做**，结果用 `Transferable` 交还，不做结构化克隆。
- 8-bit 映射区间固定为 `[-1024, 3071]`。**不允许**根据当前窗宽动态改变映射——否则同一序列在不同窗口下 MPR 观感会跳变。

### 6.2 内存纪律

| 场景 | 允许驻留 |
| --- | --- |
| 桌面 Stack | 当前层 ±64 |
| 移动 Stack | 当前层 ±16 |
| Volume | 单一降采样实例，禁止缓存多份 |
| 解码缓冲 | 池化复用，上限 8 个 worker |

- 组件卸载、切换 study 时必须 `viewport.destroy()` / `renderingEngine.destroy()` / `volume` 从 cache 移除。**泄漏判定**：连续切换 10 次 study 后 `measureUserAgentSpecificMemory()` 增长应 < 20%。

### 6.3 预取

方向性预取（桌面 32 层 / 移动 8 层），停顿 200 ms 后停止。禁止无条件预取全序列。

---

## 7. 隐私与安全（对应 R5、R8）

- **禁止**任何外域请求：字体用系统字体栈，图标用内联 SVG，WASM 从本地静态目录加载。
- 页面必须带 CSP（通过 meta 或部署配置）：`default-src 'self'`，`connect-src 'self'`。
- `TelemetryPort` 默认注入 `NullTelemetry`，实现体不得引入任何网络调用。
- 错误处理**只写本地日志**，日志中禁止出现 `PatientName` / `PatientID` / `AccessionNumber` / 原始 UID。需要区分身份时用 `sha256(uid).slice(0, 8)`。
- OPFS / 持久缓存**默认关闭**，开启必须用户显式同意；缓存目录名用随机 UUID，不得含患者信息。

### 脱敏实现要求

必须采用**白名单**：只保留渲染与测量必需的标签，其余全部移除。

```
保留：SOPClassUID, SOPInstanceUID(重生成), StudyInstanceUID(重生成),
      SeriesInstanceUID(重生成), Modality, Rows, Columns,
      PixelSpacing, SliceThickness, ImagePositionPatient,
      ImageOrientationPatient, RescaleSlope, RescaleIntercept,
      WindowCenter, WindowWidth, BitsAllocated, PixelRepresentation,
      TransferSyntaxUID, PhotometricInterpretation, SamplesPerPixel
移除：其余一切（含所有 private tag 0x0009-0xFFFF 奇数组）
```

- 必须维护 **UID 映射表**：同 study 内保持一致，跨 study 打散。
- 日期字段统一偏移同一 delta（保留时间间隔），不是逐字段随机。
- 必须检测 `BurnedInAnnotation`；为 `YES` 或缺失时，输出中标记"该序列可能含像素内烧录信息，需人工复核"。
- 必须生成脱敏报告（移除了什么、保留了什么、风险提示），不许无声完成。

---

## 8. 桌面端（对应 R9）

```rust
// ❌ 大文件走 IPC
#[tauri::command]
fn read_file(path: String) -> Vec<u8> { std::fs::read(path).unwrap() }

// ✅ 自定义协议 + Range 请求，WebView 侧按需分段读取
// tauri.conf.json 注册 asset 协议；Rust 侧实现 Range 解析，
// 只返回请求的字节区间，避免整文件进内存。
```

- 桌面端**只允许**通过自定义协议 / `convertFileSrc` 读像素数据。
- Rust 侧仅负责：文件索引、Range 读取、批量脱敏写盘、DICOMDIR 解析。
- **禁止**在 Rust 侧重新实现 DICOM 解析（与 CS3D 元数据层重复，必然不一致）。

---

## 9. 错误处理与降级（对应 R7）

每个降级必须携带可展示的原因：

```ts
type Degradation = {
  feature: 'mpr' | 'volumeRendering' | 'fusion' | 'multiViewport';
  reason: string;        // 面向用户的自然语言，中文
  action?: 'hide' | 'disable' | 'fallback';
};
```

| 情况 | 正确行为 |
| --- | --- |
| 设备内存不足 | 关闭 MPR 入口，提示"当前设备内存不足，已关闭三维重建" |
| WebGL2 不可用 | 全站横幅提示"当前浏览器不支持硬件加速，请更换浏览器" |
| 序列缺层 | 序列列表标黄 + 视口角标，点击看到明细 |
| 部分文件解码失败 | 汇总面板，可展开，可"仅载入成功项"继续 |
| wasm 加载失败 | 明确报错 + 重试按钮，**不许**静默退化成空白图像 |

**禁止** `catch {}` 空块。**禁止** `console.error` 当作错误处理。

---

## 10. 代码质量

- TypeScript `strict: true`，禁止 `any`（确需时用 `unknown` + 类型守卫，并写注释说明）。
- 禁止 `as` 强制断言绕过类型检查（`as unknown as X` 一律打回）。
- 函数超过 40 行、文件超过 300 行 → 拆分。
- 所有 `async` 函数必须有错误路径；所有 `useEffect` 必须有清理函数。
- 命名用领域词：`series` / `layer` / `voi` / `annotation`，不要 `data` / `info` / `obj` / `tmp`。
- 注释写"为什么"，不写"是什么"。禁止 `// 设置窗宽窗位` 这种废话注释。
- **提交信息**：`type(scope): 中文描述`，例如 `feat(import): 支持 DICOMDIR 优先索引`。

### 10.1 测试分层纪律（放错层 = 打回）

| 层 | 写什么 | 禁止写什么 |
| --- | --- | --- |
| **单测（Vitest / Node）** | 一切数值与规范正确性：HU 换算、VOI 边界、序列排序、字符集、LUT、脱敏字段筛选 | — |
| **集成（Vitest / Node + 真实字节流）** | adapter 与 fixture 协作：DICOMDIR 偏移链、畸形文件不抛、缓存边界、Transfer Syntax 分支 | 断言"屏幕上有没有图像" |
| **e2e（Playwright / chromium）** | 只做三件事：①零外部请求 ②canvas 真的出了像素（采样非全黑且有灰度方差）③全路径冒烟无 `pageerror`/`console.error` | 数值断言、性能断言、整屏像素级视觉回归、`waitForTimeout` |

**硬性规则**：

- **测试文件必须 `import` 被测实现**。禁止在测试里手抄期待值、或复刻一份实现来断言自己。本项目已因此出现过"删掉整个 `sort.ts` 后测试依旧全绿"的假绿事故。
- **关键逻辑改完要做一次变异自检**：删掉/改坏实现，确认测试变红，再恢复，并在 PR 描述里写明做过。
- e2e 总数 **≤ 7 条**，单条 ≤ 30 s。新增 e2e 必须在 PR 里说明"抓到了哪个单测/集成测试抓不到的 bug"。
- e2e 的样本只能来自 fixture builder 生成的合成文件或仓库内已提交的小样本，**禁止在 e2e 里从网络拉样本**（会让"零请求"断言自相矛盾）。

### 10.2 交叉评审纪律（2026-10-28 定）

**写代码的人不自审。** 变异测试只能证明"断言有效"，证明不了"该断言的都断言了"——因为断言是自己挑的，盲区会被原样继承。

| 角色 | 职责 |
| --- | --- |
| 写码方 | 提交时列出：改了哪些文件、对应哪条问题、做了什么变异自检、哪些地方**自己觉得不确定** |
| 评审方 | 按 `docs/reviews/CR-*.md` 格式逐条核对，产出报告；**报告只增不改**，复审另起 `-rN` |
| 双方 | 分歧以"能否用一条失败测试证明"为准，不以谁说得响为准 |

历史教训：`62558ba`（渲染适配器首版）在 73 条测试全绿的情况下仍有 4 个缺陷——全部发生在错误路径与生命周期边界（换序列泄漏旧帧、校验前已登记、mount 竞态静默返回、能力默认吹支持）。**用例集中在 happy path 与非法入参，就会漏掉"动作失败后状态是否干净"。**

---

## 11. API 事实校验

以下 API 在 CS3D 各版本间**发生过变化或仍处实验状态**，使用前必须查当前版本文档，不许凭记忆写：

| 项 | 注意 |
| --- | --- |
| `registerRenderBackend()` | 官方标注 **experimental**，API 形状预期变更，不要用于生产默认路径 |
| `renderBackend` 选项 | 生产可用值是 `gpu`(WebGL2/VTK) 与 `cpu`，**不含 webgpu** |
| `metaData.get(module, imageId)` 的 module 名与字段 | 版本间有增删 |
| `volumeLoader.createAndCacheVolume` 的 options 形状 | 有变动 |
| Tauri 2 的权限配置（capabilities） | 与 v1 差异大，不要抄网上旧教程 |

**规则**：不确定的 API，先写一个 20 行的最小验证脚本跑通，再写业务代码。不要"先写完再调"。

---

## 12. 提交前自检清单

复制到每个 PR 描述里逐条勾选：

```markdown
- [ ] 我没有用 InstanceNumber 排序（R3）
- [ ] MPR/体绘制用的是降采样 volume，不是全分辨率（R2）
- [ ] 渲染循环里没有 setState（R4）
- [ ] 没有引入任何外域请求、CDN、字体、埋点（R5）
- [ ] packages/core 里没有 window/document/fetch/cornerstone（R6）
- [ ] 所有失败路径都有用户可见的提示，没有空 catch（R7）
- [ ] 如果涉及脱敏，用的是白名单 + UID 映射表（R8）
- [ ] 如果涉及大文件读取，走的是自定义协议不是 IPC（R9）
- [ ] UI 文案与变量名里没有"诊断"字样（R10）
- [ ] 新增依赖？→ 已人工批准（否则删除）
- [ ] 新代码有不依赖 CS3D 版本的单元测试
- [ ] 测试文件 import 了被测实现（不是手抄期待值）
- [ ] 数值类改动做过变异自检（改坏实现后测试确实变红）
- [ ] 没有把数值/性能断言塞进 e2e（10.1）
- [ ] 涉及数值的改动有 phantom 断言
- [ ] 涉及中文文本解码时，按 SpecificCharacterSet 派发且有 GB18030 兜底（5.6）
- [ ] 切换/卸载路径有资源释放
- [ ] 没有 `any`、没有 `as unknown as`
```

---

## 13. 遇到这些情况，停下来问

不要自己决定，直接提问：

1. 需要新增依赖。
2. 需要改动 `docs/ARCHITECTURE.md` 里的任何架构决策（尤其双精度路径、渲染基线、端口划分）。
3. 需要在 `packages/core` 里引入新的宿主能力。
4. 发现方案本身有错（比如某个 DICOM 场景架构没覆盖）——**记录下来提问，不要自己扩展架构**。
5. 需要改脱敏规则。
6. 需要写"看起来像诊断功能"的东西。

---

**最后一句**：这个项目的技术难点不在"能不能渲染出来"，在"渲染出来的东西是不是对的"。宁可少一个功能，不要多一个悄悄出错的功能。
