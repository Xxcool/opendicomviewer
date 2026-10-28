# 复审报告：source-local 第三轮（CR-2026-10-27-source-local-r3）

| 项 | 内容 |
| --- | --- |
| 复审对象 | `dd49380` fix(source-local): resolve P1-1 Worker pool, P1-5 genuine testing, P1-9 streaming ZIP, and N3/N4 |
| 复审日期 | 2026-10-27 |
| 门禁实测 | `npm run typecheck` **0 错误**、`npm run lint` **0 错误**、`vitest` **30/30 通过** |
| **结论** | **部分通过。** 4 项里 2 项真修、1 项实现存在但**从未被执行过**、1 项修在了接不上调用链的位置 |
| 一句话 | P1-5 与 P1-9 这次是真修（已用变异验证证明）；但 **P1-1 的 45 行 Worker 代码零覆盖，且内含 3 个会挂死或抛错的确定性缺陷**，不能记为"已修复" |

---

## 一、逐项核对

| 编号 | 问题 | 状态 | 证据 |
| --- | --- | --- | --- |
| **P1-1** | 零 Worker，主线程同步解析 | ⚠️ **代码存在，从未被执行** | 见第 2 节。`ParserPool` 已被 `scanner.ts:275/279`、`source-local.ts:247/250` 真实调用，但**测试环境走的是同步回退分支**，Worker 分支零覆盖 |
| **P1-5** | 几何缺失静默兜底 | ✅ **真修（已变异验证）** | `sort.ts:130-138` 补上单切片路径的 warning；`dicom-fixture.ts` 支持 `omitImagePositionPatient`；`integration.test.ts:238-261` 断言 `hasMissingGeometry === true` + `MISSING_GEOMETRY`。**变异测试：把 `if (firstPlane.hasMissingGeometry)` 改成 `&& false` → 该用例立刻变红；还原 → 绿** |
| **P1-9** | 未按条目 Range 读取 | ✅ **真修** | `zip.ts:125-213`：尾搜 EOCD（`min(fileSize, 65557)`）→ 只读 CD 段 → 条目 `read()` 时才 `read(dataStart, dataStart + compressedSize)` |
| **N3** | cp1252 反查表 | ⚠️ **修在死代码上** | `charset.ts:114` 的 `decodeFilenameForDisplay` **生产代码零调用点**（全仓只有 `unit.test.ts` 引用）。且它救不回 ZIP 路径的乱码形态，见 N5 |
| **N4** | numberOfFrames 语义 | ✅ 达标 | `core/domain/types.ts:102-109` 注释澄清了"序列总帧数"与 `(0028,0008)` 的区别 |

上轮已确认成立、本轮未回退：P0-1（LRU 缓存）、P0-2（prefetch 结果入缓存）、P1-2（`untilTag` 全链路生效）、P1-3（封装传输语法显式抛错）、P1-4（大端字节序）、P1-6（DICOMDIR 损坏告警）、P1-7（offset 链遍历 + 防环）。

---

## 二、P1-1 的核心问题：验证了不存在的那条路径

`unit.test.ts:216` 的用例标题是 **"ParserPool 支持 Worker 解析通道与生命周期管理"**，但它实际覆盖的是：

```ts
// parser-pool.ts:50
if (!this.isWorkerSupported()) {
  const bytes = new Uint8Array(buffer);
  return parseDicomMetadata(bytes, candidate, { untilTag: 'x7fe00010' });  // ← 测试只走到这里
}
```

实测：`node -p "typeof Worker"` → `undefined`（Node v22.22.2）。**Node 没有全局 `Worker`**，所以 vitest 环境下 `isWorkerSupported()` 恒为 `false`。

结论：
- `parser-pool.ts:58-102` 的 **45 行 Worker 调度代码，行覆盖 = 0**。
- 该用例本质是"再测一遍 `parseDicomMetadata`"，与已有的 scanner 用例重复。
- 标题声称"生命周期管理"，但 `pool.terminate()` 是**调用**而非**断言**——没有验证 terminate 后 pending 请求的状态。

**这与前两轮的"假绿"是同一类问题**：不是测试造假（断言是真的），而是**测试证明的东西和声称的东西不是一回事**。这次更隐蔽，因为代码确实写了。

### 2.1 Worker 分支的确定性缺陷（读代码即可确认，不需要真机）

| # | 缺陷 | 后果 |
| --- | --- | --- |
| a | `parser-pool.ts:81-83` `worker.onerror` 里 reject 的是**创建该 worker 的那个请求**的 promise | worker 被后续请求复用时出错，错误投给一个已 settle 的 promise（no-op），**真正等待的那条永远不 resolve** → 导入卡死在 87% |
| b | `parser-pool.ts:105-111` `terminate()` 直接 `pendingRequests.clear()`，不 reject | 所有在途 `await` **永久挂起**，且违反 R7（无用户可见失败） |
| c | `postMessage(request, [buffer])`（`:101`）转移所有权 → **调用方传入的 ArrayBuffer 被 detach** | `ImportCandidate.read()` 返回的 buffer 被 caller 复用时会抛 `TypeError: Cannot perform ... on a detached ArrayBuffer`。这个副作用没有写在 `parse()` 的任何注释里 |
| d | 无排队、无背压：1000 帧导入 = 1000 次 `postMessage` + 1000 个 pending promise，8 个 worker 串行消费 | 内存尖峰；与 §6.2 内存纪律冲突 |
| e | 无超时、未接入 `AbortSignal` | 用户点"取消导入"，worker 仍在跑，主线程继续等 |
| f | `new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })` | 只在 Vite 下成立。Tauri 构建、`base` 非根路径部署未验证 |
| g | 主线程（`scanner.ts`）与 worker（`parser.worker.ts`）**各自 import 一份 `dicom-parser`** | 打包重复，直接影响 §11 的 1.5 MB 初始包预算 |

### 2.2 修法（二选一，建议都要）

**（1）把调度策略做成可注入的，让 Node 能测 Worker 分支**

```ts
export interface WorkerLike {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}
export interface ParserPoolOptions { readonly createWorker?: () => WorkerLike; }
```

测试里注入 fake worker，断言四件事：① `postMessage` 的 transfer list 含 buffer ② `onmessage` 正确 resolve 对应 id ③ **复用 worker 出错时 reject 的是当前请求**（覆盖缺陷 a）④ `terminate()` 后所有 pending 被 reject（覆盖缺陷 b）。

**（2）"解析真的在 worker 里跑"只能由 e2e 证明**——这是浏览器独有的观测能力（`page.on('worker')`）。已同步写入 `ARCHITECTURE.md` §12.2 白名单第 4 条。

**顺带必修**：a/b/c/d/e 五项。其中 c 要么改成不转移（`postMessage(request)` 结构化克隆，metadata 只有几十 KB，代价可忽略），要么在 `parse()` 注释里明确"本方法会接管 buffer 所有权"并让所有调用点改用 `buffer.slice(0)`。

---

## 三、N5（新发现）：ZIP 里的中文文件名仍然乱码，N3 救不了

`zip.ts:169`：

```ts
const filename = new TextDecoder().decode(filenameBytes);   // 无条件 UTF-8
```

ZIP 规范里文件名编码由 **General Purpose Bit Flag bit 11**（CD 偏移 `+8` 的 uint16）决定：置位 = UTF-8，未置位 = CP437 / 本地代码页（中文 Windows 下实际是 GBK）。中国医院的光盘镜像打包工具十有八九不置位。

现在的行为：GBK 字节被 UTF-8 严格解码 → **U+FFFD 替换字符**。U+FFFD 是**信息已丢失**的形态，`WINDOWS_1252_REVERSE` 反查表（N3）救不回来——那张表只对"字节被当成 cp1252 解释"的形态有效（比如 `File.name` 这类路径），对 UTF-8 失败的 U+FFFD 无效。

而且 `decodeFilenameForDisplay` **在生产代码里一次都没被调用**（只有单测引用）——N3 修在了一个没有调用链的位置。

**修法**：

1. `zip.ts` 解析 CD 条目时读 `getUint16(offset + 8, true) & 0x800`；
2. 置位 → `new TextDecoder('utf-8', { fatal: false })`；
3. 未置位 → 走**字节级**解码：先试 UTF-8（fatal），失败则 GB18030（已有的 `scoreCjk` 打分逻辑复用），都不要 `decodeFilenameForDisplay(string)` 那条路；
4. 补一条集成用例：fixture 造一个 GBK 文件名、GP flag 未置位的 ZIP，断言读出的文件名是正确中文（不是 U+FFFD）。**这条用例现在能红，改完必须绿**——这是"测试先失败"的正确用法。

同时建议把 `decodeFilenameForDisplay` 要么接进真实调用点（源目录里 `File.name` 的展示路径），要么删掉。**留着不调用的解码函数，下次 CR 只会再问一遍"它到底在哪生效"。**

---

## 四、N6（新发现）：ZIP64 静默产出空序列

`zip.ts:147-148`：

```ts
const cdSize = tailView.getUint32(eocdRelOffset + 12, true);
const cdOffset = tailView.getUint32(eocdRelOffset + 16, true);
```

ZIP64 用 `0xFFFFFFFF` 占位，真实值在 ZIP64 EOCD 里。现在会拿 `0xFFFFFFFF` 当偏移去 `candidate.read(...)`，然后在 `while` 循环第一次 `getUint32(offset) !== 0x02014b50` 时 `break` → **返回空数组 → "导入成功，0 个序列"**。

这正是 R7 明确禁止的静默失败，且用户完全无从判断发生了什么（以为光盘是空的）。

**修法**：`cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF` 时抛出明确错误，文案给出可执行建议（"该压缩包为 ZIP64 格式，请先解压后导入文件夹"）。真正的 ZIP64 支持列入 backlog，不做现在。

---

## 五、P2 清单

| # | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| 1 | `zip.ts:179/188` | 条目内两次 `read()` 没透传 `signal` | 透传，否则"取消"对已在解压的条目无效 |
| 2 | `zip.ts:176-200` | 无 `uncompressedSize` 上限、无解压总量上限 | 单条目 > 2 GB 或累计 > 4 GB 直接拒绝（zip bomb） |
| 3 | `zip.ts:151` | CD 段读失败直接向外抛 | catch 后回退 `extractZipEntries(全量)`，只对"读不到 CD"降级，不放大成致命错误 |
| 4 | `zip.ts:227-229` | `zipEntryToCandidate` 首次 read 就整条目解压进内存 | 与 §5.1 预算冲突。大 zip 内大文件应解压到 OPFS 再走 Range；至少在注释里写明这是已知上限 |
| 5 | `scanner.ts:90` | `(dataSet.string('x00080060') \|\| 'OT') as Modality` | 违反 GEMINI §10「禁止 as 强制断言」。脏值会被断言成合法 Modality 漏到下游，应走白名单校验后回退 `'OT'` |
| 6 | `core/tests/sort.test.ts:190` | 单切片缺失几何在 **core 层无用例** | 变异验证时的旁证：改坏 `sort.ts` 后 `sort.test.ts` 全绿，唯一变红的是 adapter 集成测试。单切片告警是 core 的职责，应在 core 补一条 |
| 7 | `unit.test.ts:216` | 标题与覆盖内容不符 | 改成两条：`ParserPool 在无 Worker 环境下回退同步解析`（真话）+ `ParserPool Worker 通道调度`（注入 fake worker） |

---

## 六、结论与放行判断

**已真修、可结案**：P1-5（有变异验证背书）、P1-9、N4，以及上轮的 P0-1/P0-2/P1-2/P1-3/P1-4/P1-6/P1-7。

**不能结案**：

| 项 | 要求 |
| --- | --- |
| **P1-1** | 必修 2.1 的 a/b/c（挂死 + detach 是功能性缺陷，不是品味问题）。测试改为注入 fake worker；"真在 worker 里跑"由 e2e 断言。**在此之前不得在任何文档/交付说明里写"P1-1 已修复"** |
| **N5**（新） | ZIP 文件名按 GP flag bit 11 派发解码 + 一条 GBK 文件名集成用例 |
| **N6**（新） | ZIP64 显式报错，禁止静默空序列 |

**关于门禁**：`typecheck 0 / lint 0 / 30 tests pass` 三项全绿，但本轮 4 个问题里有 3 个**是在全绿状态下存在的**。这不是门禁失灵，是门禁的覆盖边界——绿只证明"已写的断言没被违反"，不证明"该写的断言写了"。这也正是 `ARCHITECTURE.md` §12.4 把"变异自检"写成硬性规则的原因。

**是否阻塞下一步**：不阻塞。上面 3 项与渲染层 / `RendererPort` 完全解耦，可以与 Spike A（CS3D 最小验证）并行修。但 `renderer-cs3d` 正式实现前必须清掉 P1-1。
