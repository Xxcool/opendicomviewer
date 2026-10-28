# @opendicomviewer/renderer-cs3d

Cornerstone3D WebGL2 渲染适配器，实现 `@opendicomviewer/core` 的 `RendererPort`。

## 现状（2026-10-28）

| 能力 | 状态 |
| --- | --- |
| 端口实现（mount / setStack / setStackIndex / setVOI / getVOI / resetView / 坐标变换 / whenIdle / dispose / destroy） | ✅ 已完成，29 条单测覆盖 |
| 帧登记表与 `odv://series/<uid>#<index>` imageId 约定 | ✅ 已完成，纯逻辑可单测 |
| Vite + CS3D 4.22.13 可用性 | ✅ Spike A 实测通过（`spikes/cs3d-min/`） |
| **CS3D imageLoader 桥接**（把 imageId 解析成本包的 `PixelFrame`） | ⛔ **未做**，见下 |
| app-web 组合根接线 | ⛔ 未做 |

## 下一步（缺这步之前，真实浏览器里 setStack 会失败）

本包刻意**不使用** `@cornerstonejs/dicom-image-loader`（ADR-013，避免 1.98 MB codec wasm 被静态打包）。
代价是必须自己往 CS3D 注册一个 loader，把 `odv://` 的 imageId 解析成 core 的 `PixelFrame`：

```ts
// 组合根（app-web）里，伪代码
cs3d.imageLoader.registerImageLoader('odv', (imageId) => ({
  promise: renderer.frameRegistry.resolveFrame(imageId).then(toCs3dImage),
  cancelFn: undefined,
}));
```

`toCs3dImage` 需要把 `PixelFrame` 组装成 CS3D 期望的形状（`getPixelData` / `rows` / `columns` /
`windowCenter` / `slope` / `intercept` / `color`）。**这一步必须在真实浏览器里验**，
因为它属于"CS3D 内部数据结构"，Node 里无法证明对错——和 Spike A 一样，用截图 + 像素采样判据。

## 三条不能忘的契约

1. `setStack` / `setStackIndex` **必须 await**：CS3D 的切换是异步的，不 await 会在旧帧上做测量。
2. `render()` **只做提交**，不代表已呈现；要"画面已更新"就 `await whenIdle()`。
3. 调窗走 `VOIRange`（窗宽窗位），Adapter 内部用 core 的 `voiToRange()` / `rangeToVOI()`
   与 CS3D 的 `lower/upper` 互转——**不要在这里另写一套公式**，Spike A 已确认二者口径一致
   （WW 400 / WC 40 → lower −160 / upper 239，往返无损）。

## 为什么不 import `@cornerstonejs/core`

CS3D 模块通过 `Cs3dModuleLike`（见 `src/cs3d-surface.ts`）由组合根注入，好处：

- 本包能在没装 CS3D 的环境里 typecheck + 跑单测（CI 不需要 200 个包与 wasm）；
- 升级 CS3D 只需改注入点，Adapter 不感知版本；
- 避免用 `as unknown as` 之类的断言去糊类型（GEMINI §10 明令禁止）。

真实 API 形状由 Spike A 的 Q1 表格背书（`spikes/cs3d-min/README.md`）。
