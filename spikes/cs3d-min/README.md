# Spike A · Cornerstone3D 最小渲染验证

> 对应 `docs/ARCHITECTURE.md` §14.1 的 Spike A。**这不是交付物**，存在的唯一目的是回答三个问题。
> 结论已经回填到 `docs/ARCHITECTURE.md` §14.1 与 §12.2，本文件只记录"怎么跑出来的"。
>
> 验证日期：2026-10-28 · 环境：macOS + Chrome 156 headless（SwiftShader 软件渲染）

## 复现

```bash
npm install
npm run gen          # 用主仓 fixture builder 生成 3 张合成 CT（128×128）
npm run build
npm run preview      # http://localhost:4319
```

验证（无需 Playwright，只用系统 Chrome + Node 内置 zlib）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=680,720 --virtual-time-budget=60000 \
  --user-data-dir=/tmp/p --dump-dom http://localhost:4319/     # 抓 #report 里的测量 JSON

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=680,720 --virtual-time-budget=30000 \
  --user-data-dir=/tmp/p2 --screenshot=screenshot.png http://localhost:4319/

node scripts/sample-screenshot.mjs screenshot.png    # PASS/FAIL + 像素统计
```

## Q1 · 真实 CS3D API 与 `RendererPort` 是否吻合

实测（`viewport` 为 `Enums.ViewportType.STACK` 实例）全部存在：

| RendererPort 需要的能力 | CS3D 实际方法 | 结论 |
| --- | --- | --- |
| 装载序列 | `await viewport.setStack(imageIds, index)` | 直接可用 |
| 切换切片 | `await viewport.setImageIdIndex(i)` | 直接可用 |
| 设置/读取调窗 | `viewport.setProperties({voiRange})` / `getProperties()` | 直接可用 |
| 触发绘制 | `viewport.render()` | **异步提交**，返回 ≠ 已呈现（见 Q3） |
| 取已解码像素 | `viewport.getImageData()` | 可用（返回图像数据，非画布像素） |
| 坐标变换 | `worldToCanvas()` / `canvasToWorld()` | 可用，测量工具可直接依赖 |
| 复位相机 | `resetCamera()` | 可用 |

`setProperties({voiRange})` 读回值与 DICOM 一致：文件里 `(0028,1050)=40 / (0028,1051)=400`，
读回 `voiRange = {lower: -160, upper: 239}`，即 `40±199.5`，与 PS3.3 C.11.2.1.2 的
`c-0.5±(w-1)/2` 吻合。**说明 CS3D 的 VOI 换算与 core 的 `voiToRange()` 是同一套口径**，
双实现不会打架。

调窗**不需要** `@cornerstonejs/tools`：右键拖动用 `setProperties + render` 手写约 30 行即可，
本 spike 就是这么做的（`src/main.js` 的 `bind-window-level` 段）。

## Q2 · 到底有没有把像素画到屏幕上

**有。** 判据是截图采样，不是页内 readback：

```
nonBlackRatio = 0.4423, min 0, max 255, distinctLevels 256 → PASS
```

`spikes/cs3d-min/screenshot.png` 就是证据：合成 phantom 的同心椭圆（软组织灰、骨环白、
脑室暗）清晰可见，顶部人为挖的缺口方向也正确（没有被上下翻转）。

**重要失败经验**：页内 `ctx.drawImage(webglCanvas)` 采样得到的永远是全黑
（本次读数 `nonBlackRatio: 0`）。原因是 WebGL drawing buffer 在合成后已被清空，
除非创建上下文时开 `preserveDrawingBuffer`——而 CS3D 创建上下文，我们不控制这个参数。
所以 **"真的渲染了"这条 e2e 断言只能对合成后的截图做采样**，`ARCHITECTURE.md` §12.2 已按此修正。

## Q3 · 帧时间能不能测

**在无头 + `--virtual-time-budget` 环境下测不出。** 证据：页面内跑 200 ms 的 rAF 循环，
`rafTicksIn200ms = 0`——虚拟时间模式下 rAF 根本不被驱动。

因此本次只能给出以下量级，**不能作为性能结论**：

| 指标 | 读数 | 说明 |
| --- | --- | --- |
| `setStack`（3 张未缓存切片，含 worker 解码与首次初始化） | 57–84 ms | 唯一可信的数字 |
| `render()` 同步耗时 p50/p95 | 0 / 0 ms | **`render()` 只做提交**，同步计时必然为 0 |
| `setImageIdIndex` p95 | 1.9–3.1 s | 软件渲染 + 定时器饥饿造成的假象，不可信 |

结论：§11 的「调窗响应 p95 < 16.7 ms」「连续翻页零掉帧」必须放到**有 GPU 的有头浏览器**
用 rAF 采样（S1 真机基准），CI 里既不能测也不能断——这与 §12.3「性能断言禁入 PR 门禁」互相印证。

## 附带的两个硬事实（直接影响技术选型）

### 1. CS3D 5.13.2 在 Vite 下不可用（dev 与 build 皆然）

```
TypeError: Class extends value undefined is not a constructor or null
    at ... class bQ extends u.EventEmitter ...
```

- CS3D 5.13.2 依赖 `@kitware/vtk.js@36.4.1`，而该版本的产物是 **Rolldown 生成的 bundle**
  （`_virtual/_rolldown/runtime.js` + `__exportAll` 惰性 getter）。经 Rollup（`vite build`）
  或 esbuild（`vite dev` 的 optimizeDeps）处理后，跨模块循环里取到的类是 `undefined`。
- 已排除：重复安装（只有一份 core / 一份 vtk）、摇树副作用（`treeshake.moduleSideEffects: true` 无变化）、
  单纯 exclude 预打包（会连带触发 vtk 的 CJS interop 错误）。
- **降级到 4.22.13（vtk.js 34.15.1）后，dev 与 build 均正常**——本 spike 的所有结论都基于 4.22.13。

→ 建议 `ARCHITECTURE.md` §13 的 CS3D 版本基线从"锁 minor"改成**明确锁到可用的 4.22.x**，
并把这条件写进 Spike S2 的前置检查，避免后面才发现要重做渲染层。

### 2. Vite 配置（4.x 实测可用）

```js
optimizeDeps: {
  exclude: ['@cornerstonejs/dicom-image-loader'],   // 否则内部的 ESM 环被打包成单 chunk → Class extends undefined
  include: [
    'dicom-parser',
    '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',  // 必须写到子路径
    '@cornerstonejs/codec-charls/decodewasmjs',
    '@cornerstonejs/codec-openjpeg/decodewasmjs',
    '@cornerstonejs/codec-libjxl/decodewasmjs',
    '@cornerstonejs/codec-openjph/wasmjs',
    'jpeg-lossless-decoder-js',
  ],
},
worker: { format: 'es' },
```

不写子路径只写包名不生效，浏览器会按原生 ESM 加载 CJS 工厂函数并报
`does not provide an export named 'default'`。

### 3. 包体积实测（3 张 128×128 切片的空壳）

```
dist/assets/index-*.js                 1,450.81 kB │ gzip: 405.90 kB
dist/assets/*.wasm（5 个 codec 全部被拉入）  合计 1.98 MB │ gzip 约 0.70 MB
```

一个只有 20 行业务逻辑的空壳，gzip 后主包就 406 KB，且 **JPEGXL（1.09 MB）等 codec 的 wasm
全部被静态打进产物**——即便本次只读未压缩 DICOM。§11 的「初始包 1.5 MB」与「全量 wasm 2.5 MB」
预算是可能的，但**前提是 codec 必须按需动态加载**，这是 renderer 层落地时的第一条纪律。

（CS3D 5.13.2 同样的空壳是 3.07 MB / 854 KB gzip——版本选择对体积也有 2 倍差异。）
