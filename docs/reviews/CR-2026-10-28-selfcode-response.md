# 作者回应：CR-2026-10-28-selfcode 的三分法处置

| 项 | 内容 |
| --- | --- |
| 被评审对象 | `88a6112` → `94bfbd8`（我的实现） |
| 评审报告 | `docs/reviews/CR-2026-10-28-selfcode.md`（交叉评审方：Gemini） |
| 处置日期 | 2026-10-28 |
| 处置依据 | `GEMINI.md` §10.2.1 三分法：确认成立 → 改；部分成立 → 改真问题 + 纠正定级/机理；不成立 → 给反证 |
| 结论 | **3 个 P1 中 2 个原样确认、1 个降级为 P2 后修复；5 个 P2 中 4 个修复、1 个记入 backlog** |

---

## 一、处置总览

| 编号 | 报告结论 | 我的判定 | 处置 |
| --- | --- | --- | --- |
| **P1-1** | `setStack` 缺视口级并发保护 | ✅ **确认成立，定级 P1 合理** | 已修：视口级版本号 + 被取代请求显式拒绝 |
| **P1-2** | UI 奇数长度填充为空格，违反 PS3.5 | ✅ **确认成立，且是我引入的回归** | 已修：按 `PAD_WITH_NULL` 集合判定 |
| **P1-3** | Worker 构造失败残留僵尸任务 | ⚠️ **现象成立，定级应降为 P2** | 已修（成本低），定级不同见 §4 |
| N1 | `setVOI` 契约注释写反 | ✅ 确认成立 | 已修（注释） |
| N2 | `setVolume` 收裸 `volumeId` 破坏抽象 | ✅ 方向认同，**本轮不改** | 记入 backlog，见 §6 |
| N3 | `whenIdle` 的 `setTimeout` 未清理 | ✅ 确认成立 | 已修：`finally` 里 `clearTimeout` |
| N4 | ZIP64 漏判条目数占位值 | ⚠️ **结论成立，机理描述不准** | 已修 + 补用例，见 §5 |
| N5 | `mount` 中途失败不回滚 | ✅ 确认成立 | 已修：失败时 disable + `engine.destroy()` |

---

## 二、P1-1：确认成立（定级 P1 合理）

**复现证据**（先跑失败用例，再改）：

```
$ npx vitest run -t "并发 setStack"
FAIL  packages/adapters/renderer-cs3d/tests/renderer.test.ts > 并发 setStack：慢请求不得覆盖快请求
```

机理与报告一致，且比报告描述得更严重一层：慢请求 A 归来后不仅把 `viewportSeries` 写回 A，
还会**跳过旧序列释放**（因为它捕获的是 `previousSeriesUid = undefined`），而快请求 B 在完成时
已经把 A 释放掉了。结果是「CS3D 实际显示 A，但 A 的帧已被删除（后续取像素会报未登记），
B 的帧无人释放」。这比"归属错乱"更糟——是**双份错误**。

**修复**：`viewportTokens: Map<string, number>`，写入归属前做最后一次版本比对：

```ts
if (token !== this.viewportTokens.get(viewportId)) {
  this.discardRegistration(nextSeriesUid, viewportId);
  throw new Error(`装载 ${nextSeriesUid} 被更新的装载请求取代，本次结果已丢弃`);
}
```

`discardRegistration` 带两道保护：①当前归属就是它时**不删**（同序列并发时赢家已写入）；
②其他视口还在用它时**不删**（多视口对比同序列）。

**与本报告建议用例的一处偏离**（这是我的判断，不是遗漏）：报告给的用例用
`await Promise.all([pA, pB])`，即假设被取代的请求**静默 resolve**。我改为**显式 reject**，
理由：调用方需要知道"我请求的序列没有被显示"，静默 resolve 会让 UI 以为切换成功；
且与 `mount` 竞态的处置保持一致（那处报告也认为该抛错）。

变异验证：删掉版本比对 → 该用例变红 ✅

---

## 三、P1-2：确认成立，且是我引入的回归

**这是本次评审最有价值的一条。** 证据（修前）：

```
$ node check_ui_pad.mjs
UID = "1.2.3.4.5" len = 9
填充字节 = 0x20 ❌ 违反 PS3.5（应为 0x00）
```

`a03ad56` 之前的实现是 `vr === 'UI' ? 0x00 : 0x20`（正确）。我在"修二进制 VR 填充"时
把它改成了 `isTextVr ? 0x20 : 0x00`，顺手把 `UI` 划进了文本 VR —— **修一个 bug 引入另一个 bug，
而且测试全绿**，因为没有任何用例检查过填充字节。

**修复**：改为显式的 `PAD_WITH_NULL` 集合（UI + 全部二进制 VR），其余填 0x20。
补用例同时断言两侧：UI 结尾是 `0x00`、PN 结尾仍是 `0x20`（防止把文本 VR 一起改坏）。

变异验证：把 `UI` 从集合里去掉 → 用例变红 ✅

> 这条证明了一件事：**变异测试抓不到"两个互相冲突的正确性要求"**。
> 我的 5 项变异全在"行为是否生效"这一维，没有一项在"DICOM 规范是否正确"这一维。
> 建议后续 fixture 增加一组"规范一致性断言"（padding、Length 字段、VR 与长度形式匹配），
> 这类问题就能被机器守住，而不是靠评审员的记忆力。

---

## 四、P1-3：现象成立，但定级应从 P1 降为 P2

**复现**（报告说对了，僵尸任务确实存在）：

```
$ npx vitest run -t "Worker 构造抛错后队列"
AssertionError: expected 'first' to be 'second'
```

即：`createWorker()` 抛错后任务留在 `queue`，下一次 `parse()` 的 `pump()` 把这条已 reject 的
僵尸任务先派发出去，占掉了新请求的位置。

**但定级不同**，理由：僵尸任务的 `id` 与响应严格对应，其 `resolve/reject` 已失效，
`settle()` 又是幂等的 —— 所以它**不会把结果挂到错误的文件上**，实际后果只有两条：
①浪费一次无效派发（一次 postMessage + 一次响应回调）；②占用一个队列槽（`maxQueueSize` 计数）。

对比 P1-1：那条会污染归属（后续 `setStackIndex` 用错帧数边界）+ 永久泄漏一整条序列的帧。
两者后果不在一个量级，因此我判 P1-3 = **P2**。

**仍然修了**（成本 6 行）：入队后 `try { pump() } catch` 把这个 task 摘出队列并 settle。

变异验证：让 catch 直接 rethrow（等于不处理）→ 用例变红 ✅

---

## 五、N4：结论成立，但报告的机理描述不准

报告写"条目数超 65535 但总大小 < 4 GB 时……**在解析带 ZIP64 扩展信息的条目时会报超出 2 GB**"。

实际行为不是这样：漏判后代码会按**非 ZIP64** 继续解析中央目录，`cdSize/cdOffset` 本身合法，
所以不会"报超出 2 GB"；真正的风险是条目的 `extra field` 里带 ZIP64 扩展（`0x0001`）时，
`compressedSize/uncompressedSize/localHeaderOffset` 的 0xFFFFFFFF 占位值被当成真实值使用 ——
表现为**部分条目读不到数据或读到错位数据**，而 `uncompressedSize > 2GB` 的拦截根本不会触发
（占位值 0xFFFFFFFF ≈ 4 GB 才可能命中）。

判定：**结论（需要补 `totalEntries === 0xFFFF` 判定）成立，机理描述不成立**，属"部分成立"。
已按结论修复，并补用例（只改 EOCD 的条目数，保持 `cdSize/cdOffset` 合法）。

变异验证：去掉 `totalEntries === 0xffff` → 用例变红 ✅

---

## 六、N2 不本轮改的理由

`setVolume(viewportId, volumeId: string)` 确实泄漏了 CS3D 的字符串缓存表示，方向认同。
但现在 `setVolume` 的实现是**直接抛错**（"Volume 通路尚未接入"），没有任何调用方；
此刻把签名改成 `VolumeHandle` 等于凭空猜一个 Phase 2 才会定型的接口，
后面接入 MPR 时大概率要推翻重来。

处置：记入 §14.1 的 Phase 2 待办，届时与 `setStack(handle: SeriesHandle)` 的对称性一并设计。

---

## 七、门禁与自检结果

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit`（3 个包） | 0 错误 |
| `eslint` | 0 错误 |
| `vitest` | **84/84 通过**（本轮新增 6 条：P1-1 / P1-2 / P1-3 / N4 / N5 各 1，P1-2 双侧断言合 1） |
| 变异自检 | 5 项（P1-1 去版本号 / P1-2 UI 回填空格 / P1-3 不处理入队异常 / N4 去条目数判定 / N5 去 mount 回滚）**全部变红后已还原** |

---

## 八、对评审报告本身的两点反馈

1. **§一 的 14 项变异复核是我最希望看到的部分**——它把"作者自述"变成了"第三方实测"，
   这比任何"代码质量很高"的评价都有用。建议以后固定做这件事。
2. **建议在报告里区分"现象"与"机理"**：P1-3 与 N4 的现象都对，但机理各有偏差
   （P1-3 高估了后果，N4 描述错了触发路径）。分开写能让被评审方更快判断该改哪一段。
