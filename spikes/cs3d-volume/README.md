# Spike B · 体素缓冲 → ImageVolume → 三向 MPR

> 对应 `docs/ARCHITECTURE.md` §14.1 的 S2 前置验证。**这不是交付物**，存在的唯一目的是
> 在写 P1/P2 之前确认"降采样体素缓冲能直接变成可渲染的 MPR 体积"。
>
> 验证日期：2026-10-28 · 环境：macOS + Chrome 156 headless（SwiftShader 软件渲染）· CS3D 4.22.13

## 复现

```bash
npm run build
npm run preview                # http://localhost:4320
```

```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# 证据截图（四象限各 320×320）
"$CH" --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=680,1000 --virtual-time-budget=90000 \
  --user-data-dir=/tmp/odv-final --screenshot=/tmp/spikeb.png http://localhost:4320/

node scripts/sample-screenshot.mjs /tmp/spikeb.png     # PASS / FAIL + 四象限统计

# 页内诊断 JSON（构造耗时、相机读数、sliceIndex、jumpToWorld）
"$CH" --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader \
  --window-size=680,1000 --virtual-time-budget=90000 \
  --user-data-dir=/tmp/odv-final2 --dump-dom http://localhost:4320/
```

对照开关：`?noWarmup=1`（复现首个视口全黑）、`?axLast=1`（把轴向换到最后启用）、
`?camFix=1`（手动摆相机）、`?skipJump=1`、`?z=100`（改 jump 目标的世界 z）。

## Q1 · 裸体素缓冲能否直接建体积

**能，用 `volumeLoader.createLocalVolume()`，不需要任何 DICOM imageIds。**

```ts
const volume = volumeLoader.createLocalVolume(volumeId, {
  metadata,       // BitsAllocated / BitsStored / BitsAllocated 等，必填（内部 structuredClone）
  dimensions,     // [cols, rows, slices]
  spacing, origin, direction,
  scalarData,     // Uint8Array（降采样后的缓冲，可 Transferable 进来）
});
```

实测（192³ Uint8，7,077,888 体素）：

| 项 | 读数 |
| --- | --- |
| 构建耗时 | 16.5 ms |
| 合成数据生成耗时 | 104 ms（仅 spike 的填充循环，真实数据不走这段） |
| 自动派生的 slice imageId | 192 条（内部按 `volumeId_slice_i` 建 local image，无需我们提供） |
| 是否进 cache | 是（`cache.getVolume(id)` 返回同一实例） |
| `volume.sizeInBytes` | **null**——local volume 的 voxelManager 未实现该字段，内存要按 `dims × 字节数` 自己算 |

## Q2 · 三个 ORTHOGRAPHIC 视口能否出三个方向的图

**能。** 截图四象限采样（三张图必须互不相同，防止"三格画了同一个视角"）：

| 象限 | nonBlackRatio | distinctLevels | 判定 |
| --- | --- | --- | --- |
| AXIAL | 1.00 | 67 | 出图 |
| CORONAL | 0.51 | 173 | 出图 |
| SAGITTAL | 0.51 | 152 | 出图 |
| STACK（对照） | 0.0016 | — | 全黑，符合预期（见 Q3） |

`meanSpread = 30.14`，三张图的亮度分布明显不同，说明方向设定真的生效。

## Q3 · 端口要新增的三个方法是否真实存在

| 端口计划 | CS3D 实际 | 结论 |
| --- | --- | --- |
| `setVolume(viewportId, volume)` | `VolumeViewport.setVolumes([{volumeId}])` | 存在，且**只有** ORTHOGRAPHIC/Volume 视口有；`STACK` 视口调用直接抛 `setVolumes is not a function` |
| `currentSliceIndex(viewportId)` | `getSliceIndex()` / `getNumberOfSlices()` | 存在，但映射是反的，见下方"坑 2" |
| `focusAt(viewportId, world)` | `jumpToWorld(world)` → `boolean` | 存在，会真的移动相机到含该点的层 |
| 方向控制（新增，原方案没列） | `setOrientation('axial' \| 'coronal' \| 'sagittal')` | 存在，比手算相机可靠 |

## 三个必须写进适配器的坑

### 坑 1 · 首个 ORTHOGRAPHIC 视口不预热就渲染成纯黑

`enableElement()` 之后直接 `setVolumes + setOrientation + resetCamera + render`，
**第一个启用的视口**画面全黑（`nonBlackRatio 0.0015`，只剩左上角标签文字）。
相机读数看着正常（`position z=-43.2 / focal z=192 / parallelScale 95.5`），数据也在 cache 里。

对照组结论：

| 实验 | 轴向象限 | 说明 |
| --- | --- | --- |
| 原始顺序（轴向第一个） | 0.0015 | 故障复现 |
| `?axLast=1`（轴向第三个启用） | 1.00 | 只要不是第一个就正常 |
| `?camFix=1`（手动 setCamera 覆盖） | 0.99 | 相机被显式赋值就正常 |
| `?warmup=1`（enable 后先空 render 一次） | 1.00 | **推荐做法** |

**适配器结论**：`mount()` 里 enableElement 之后，对每个视口先 `render()` 一次再挂体积。
一行预热即可，不要自己算相机去绕开它。

### 坑 2 · `getSliceIndex()` 与世界 z 反向

轴向相机被 CS3D 放在体积**下方**（`position z = -43.2`，`focalPoint z = 192`），
即从 -Z 朝 +Z 看。于是层号沿相机方向计数，与世界 z 增长方向相反：

| 世界 z | 期望 `z/spacing` | 实测 `getSliceIndex()` |
| --- | --- | --- |
| 100 | 50 | 141 |
| 300 | 150 | 41 |
| 320 | 160 | 31 |

三组都满足 `sliceIndex ≈ 191 − z/2`，即 `sliceIndex = (numberOfSlices − 1) − 真实层号`。

**适配器结论**：角标显示的层号不能直接用 `getSliceIndex()`，必须按视口方向做一次翻转；
否则"第 41 层"会显示成第 151 层，而且是**静默错**——最危险的一类错误。

### 坑 3 · 第四格不能用 STACK 装体积

`STACK` 视口没有 `setVolumes`，调用直接抛错。原计划的"2×2 第四格放原始轴位 Stack"
仍然成立，但那一格必须**单独用 `setStack(imageIds)`**，与三个 ORTHOGRAPHIC 视口是两条通路。
`mount()` 需要支持同一次挂载里混用两种 viewport type。

## 性能读数（不可当结论用）

| 项 | 读数 |
| --- | --- |
| `setVolumes`（首格，含纹理上传） | 6.7 ms |
| `setVolumes`（后续格，共享同一体积） | 1.6–3.3 ms |
| `render()` 同步返回 | 0 ms |

**这些数字全部不可信**：SwiftShader 软件渲染 + 无头虚拟时间，与真机 GPU 差一个数量级；
且 `render()` 只做提交（Spike A 已证）。真实帧时间必须按 §11 在有头环境测。

## 绘制诊断入口（2026-11-03）

`pnpm --dir spikes/cs3d-volume exec vite build --config paint-diagnostic.vite.config.js` 构建至 `dist/paint-diagnostic/`。开发时运行该目录的 `pnpm dev`，访问 `/paint-diagnostic.html`。页面仅用合成体积，提供布局/主题切换、10次布局/5次主题循环、画布尺寸和事件/异常记录。用于将实际查看器问题缩减到可复现范围，构建通过不能证明桌面绘制故障已修复；完整 Tauri 与真实浏览器视觉验收另计。
