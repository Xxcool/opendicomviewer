# 模块评审报告：source-local 本地导入层

| 项 | 内容 |
| --- | --- |
| 评审对象 | `packages/adapters/source-local` @ `752c9f6`（两次提交：`493b31c` + `752c9f6`） |
| 评审日期 | 2026-10-27 |
| 规模 | 源码 1059 行（7 文件）+ 测试 287 行 + fixture builder 470 行 |
| **结论** | **不通过**。2 个 P0、9 个 P1、5 个 P2 |
| 一句话 | 结构、用例覆盖、依赖管理都到位，但**内存纪律与线程纪律双双失守**，且有一处静默兜底会把"排序保护"悄悄废掉 |

### 门禁与验证

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `tsc --noEmit`（core + source-local） | ✅ 0 错误 |
| 测试 | `vitest run` | ✅ 22/22 |
| 依赖真实性 | `require.resolve('dicom-parser')` | ✅ 已装（pnpm 符号链接，lock 一致） |
| DOM 违规 | grep `document.` / `window.` / `createElement` | ✅ 零命中 |
| 变异测试（用例 4） | 禁用 GB18030 兜底 | ✅ **测试变红**，证明该用例真实有效 |
| Worker 使用 | grep `Worker` | ❌ **零使用** |

---

## P0 阻断项

### P0-1 `pixelFrameCache` 无界增长，直接违反内存纪律

`source-local.ts:46` 声明实例级缓存，`:273` 每读一帧就 `set` 进去，**没有任何淘汰策略**：

```ts
private readonly pixelFrameCache = new Map<string, PixelFrame>();
...
this.pixelFrameCache.set(plane.imageId, frame);   // 只进不出
```

按 ARCHITECTURE §6.2 的内存预算，一帧 512×512 int16 = 0.5 MB。**1000 帧 = 512 MB 常驻**，且这是"用户翻过的每一帧都留着"，翻完整条序列即达峰值。这正好撞上 iPad Safari 500 MB 被杀的红线。

更麻烦的是 `dispose()`（`:290`）清的是**这个共享 Map**：

```ts
dispose: (): void => { this.pixelFrameCache.clear(); }
```

同时打开两个序列、关掉其中一个，另一个的缓存被一起清空——不是泄漏，是"泄漏 + 误伤"。

**修法**：缓存必须挂在 handle 实例上（每个序列各自一份），并实现 LRU 滑动窗口（桌面 ±64 / 移动 ±16），`dispose` 只清自己的。

---

### P0-2 `prefetch()` 读了文件却把结果丢掉

`source-local.ts:276-288`：

```ts
prefetch: async (indices) => {
  const promises = indices.map(async (idx) => {
    const plane = seriesMeta.planes[idx];
    if (plane && !this.pixelFrameCache.has(plane.imageId)) {
      const candidate = candidateMap.get(plane.imageId);
      if (candidate) {
        await candidate.read();      // ← 读完就扔，返回值没有赋值给任何变量
      }
    }
  });
  await Promise.all(promises);
}
```

**做了全部 I/O 和内存分配，然后全部丢弃。** 下一帧真正要显示时，`pixel()` 会从头再读一遍、再解析一遍。

这不是"预取没实现"，是**负优化**：白白消耗带宽、GC 压力和文件句柄，命中率恒为 0。而它的调用方（渲染层）会以为自己已经预热好了。

**修法**：预取必须写进缓存，并走与 `pixel()` 相同的解析路径（抽一个 `loadFrame(plane)` 内部方法，两处复用）。

---

## P1 严重项

### P1-1 全流程零 Worker，解析全在主线程同步执行

`scanner.ts:72` 与 `source-local.ts:220` 都直接调用 `dicomParser.parseDicom(bytes)`——**同步 CPU 密集 + 主线程**。

ARCHITECTURE §6.3 明文要求"DICOM 解析、解压、降采样全部在 Worker 中执行，主线程只负责调度与合成"，GEMINI.md 第 3 节也写了。实测全文零 `Worker` 引用。

对 1000 帧序列，这意味着导入期间 UI 完全冻结（`await` 只能让出在 I/O 边界，解析本身是硬同步）。**60 fps 目标在这一层就已经不可能达成**，与渲染优化无关。

**修法**：把 `parseDicomMetadata` 与 `pixel()` 的解析搬进 Worker 池（`CodecPort` 附近，或独立的 `parser-worker`）。导入阶段用 `Promise pool` 并发 4–8 个。

---

### P1-2 元数据解析读全文件，且声明了 `untilTag` 却不用

`scanner.ts:203`：

```ts
const fullBuffer = await candidate.read(undefined, undefined, signal);  // 读整个文件
const parsed = parseDicomMetadata(new Uint8Array(fullBuffer), candidate);
```

函数注释（`:55`）写着"不读取/解码大像素数据"，实际把整个文件读进了内存。

而他们自己在 `dicom-parser.d.ts` 里声明了：

```ts
export interface ParseOptions {
  readonly untilTag?: string;
  readonly maxBytesToParse?: number;
}
```

**声明了 `untilTag` 却从未使用**——这正是"读完元数据就停、不碰 PixelData"的标准做法（`untilTag: 'x7fe00010'`）。

雪上加霜：`pixel()` 里又 `candidate.read()` 读一遍整个文件（`source-local.ts:219`）。**同一文件在 probe 与显示阶段各读一次全量。**

**修法**：`read(0, 该文件的元数据长度上限)` + `untilTag`，或先用 `maxBytesToParse` 探测；`pixel()` 若能复用已读 buffer 则缓存 raw buffer 而非解析结果。

---

### P1-3 压缩传输语法未识别，会把 JPEG/J2K 序列解成垃圾

`source-local.ts:227-246` 拿到 `x7fe00010`（PixelData）后，无条件按原始 16-bit 数组解释：

```ts
const rawSlice = dataSet.byteArray.slice(dataOffset, dataOffset + length);
pixelData = isSigned ? new Int16Array(...) : new Uint16Array(...);
```

若序列是 `1.2.840.10008.1.2.4.70`（JPEG-Lossless）或 J2K，PixelData 是**封装的片段结构**（含 Basic Offset Table 与 Fragment 分隔符），按裸数组解读得到的是**噪声图像**，用户看到的是"一片雪花"，而不是"该格式暂不支持"。

`DataWarning` 里已经有 `UNSUPPORTED_TRANSFER_SYNTAX`，但从未产生。

**修法**：读 `x00020010`（TransferSyntaxUID），若为封装格式且 `CodecPort` 尚未接入，**明确报错**并给可读提示，不要静默画画。

---

### P1-4 大端字节序未处理

`1.2.840.10008.1.2.2`（Explicit VR Big Endian）在旧机型上仍有出现。当前直接 `new Int16Array(buffer)` 会按**主机小端**解释，图像数值全部字节序颠倒——HU 变得毫无意义，但图像"看起来还是像张 CT"，属于最难被发现的错误类型。

**修法**：判断 TransferSyntax 尾号为 `.2` 时做字节交换，或统一交给解码层处理。

---

### P1-5 几何信息缺失时静默兜底，恰好把 R3 的保护废掉

`scanner.ts:95-116`：

```ts
const ippFloats = parseFloats(dataSet.string('x00200032'), 3) ?? [0, 0, 0];
const iopFloats = parseFloats(dataSet.string('x00200037'), 6) ?? [1, 0, 0, 0, 1, 0];
```

若某序列缺 `ImagePositionPatient`，**所有切片 IPP 都是 `[0,0,0]`** → `sortByPosition` 里所有投影值相等 → 排序退化为 `instanceNumber` tie-breaker → **实际上等于按 InstanceNumber 排序**。

也就是说：**R3 辛苦防住的那件事，在这里被一个默认值绕回来了**，而且全程零告警（`MISSING_GEOMETRY` 这个 code 明明存在，却从未被使用）。

同理 IOP 缺失默认成轴位 `[1,0,0,0,1,0]`——一个冠状位序列若缺 IOP，会被当成轴位，MPR 直接错。

**修法**：`parseFloats` 返回 `undefined` 时，不要编造默认值，而是给该 plane 打上 `geometryMissing: true` 并产生 `MISSING_GEOMETRY` 告警；排序阶段对这类 plane 单独处理（或整序列拒绝排序并提示）。

---

### P1-6 DICOMDIR 损坏后静默回退，违反 R7

`source-local.ts:78-83`：

```ts
} catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') throw err;
  // DICOMDIR 损坏则静默回退全盘扫描
}
```

回退本身是对的，**静默是错的**。用户拿到一个"能打开但少了几个序列"的结果，永远不知道原因。应产出一条 warning（例如"索引文件损坏，已改为全盘扫描，可能较慢"）并冒泡到 UI。

---

### P1-7 DICOMDIR 未按 offset 链遍历，依赖"物理顺序 = 逻辑顺序"

`dicomdir.ts:65` 用 `for (const item of recordSeq.items)` 顺序遍历 + 记录类型状态机（PATIENT→STUDY→SERIES→IMAGE）。

DICOMDIR 的真实结构是**链表**：每条记录有 `OffsetOfTheNextDirectoryRecord (0004,1400)` 指向兄弟、`OffsetOfReferencedLowerLevelDirectoryEntity (0004,1420)` 指向子节点。标准并未规定记录必须按物理顺序写入。

对绝大多数标准写入器（记录本就连着写）这套状态机能跑通，但对非常规写入器会层级串位。**我在任务描述里专门提醒过这个坑**，实现选择了跳过链遍历。

**修法**：先按 `dataOffset` 建立 `offset → item` 的 Map，再从根记录沿 `(0004,1400)` / `(0004,1420)` 走一遍；状态机可作为兜底。至少要在注释里标注这个假设，并写一个"物理乱序"的 fixture 用例验证。

---

### P1-8 `matchCandidateByRefId` 是 O(n²)

`source-local.ts:155` 对每张图都线性扫一遍全部输入文件（`dicomdir.ts:163-175`），且每次比较都对两个字符串做 `normalizeReferencedPath`（含 `toLowerCase`）。

1000 张图 × 5000 个文件 = 500 万次规范化 + 字符串比较，全在主线程。

**修法**：`probe` 时一次性建立 `normalizedPath → candidate` 的 Map，查表 O(1)。

---

### P1-9 ZIP 整包读入内存，且嵌套无深度限制

`scanner.ts:187`：

```ts
const fullZipBuffer = await candidate.read(undefined, undefined, signal);
```

ARCHITECTURE §7.5 明确要求"流式解包，不整包解压到内存"。一个 2 GB 的 zip 会直接 OOM。

另外 `queue.push(zipEntryToCandidate(...))` 没有层数上限——zip 套 zip 套 zip 可以无限递归。

**修法**：流式读取中央目录 + 按需解压单条目；给嵌套深度设上限（如 3 层）并在超限时告警。

---

## P2 一般项

| # | 位置 | 问题 |
| --- | --- | --- |
| N1 | `scanner.ts` 全文 | `modalityLUT` 在类型与 `PixelFrame` 里都有，但**导入层从不产出**（未解析 `ModalityLUTSequence (0028,3002)`）。S2 的能力在导入链上是断的，等于空实现 |
| N2 | `charset.ts:33` | `scoreCjk` 的 CJK Extension B 分支（`>= 0x20000`）**不可达**——`charCodeAt` 返回 UTF-16 code unit，最大 0xFFFF。需用 `codePointAt` |
| N3 | `charset.ts:81` | `decodeFilenameForDisplay` 用 `charCodeAt & 0xFF` 反推字节，但 `TextDecoder('iso-8859-1')` 实际是 **windows-1252**，`0x80–0x9F` 区间的字节无法正确还原。建议改用显式码表或只在 `>= 0xA0` 时信任 |
| N4 | `scanner.ts:305` | `numberOfFrames` 填的是切片数，与 DICOM 的 `NumberOfFrames`（多帧文件内的帧数）语义冲突，后续接多帧时会踩 |
| N5 | `dicomdir.ts:41-47` | `normalizeReferencedPath` 把小写化后的字符串存进 `referencedFileId`，**原始大小写丢失**。目前靠 candidate 对象而非路径取文件，暂不致命；一旦改为按路径读取，Linux 大小写敏感文件系统会取不到文件 |

---

## 做得好的部分

- **fixture builder 是真建的**（470 行），不是把字节硬编码进用例。这是本轮最有价值的产出，codec 模块可以直接复用。
- **6 个要求用例一个不缺**，且变异测试证明"字符集兜底"那条不是假绿。
- **没有碰 DOM**，`app-web` 与 adapter 的边界守住了。
- **依赖管理干净**：`dicom-parser` 在 lock 中、pnpm 符号链接正确、手写 `.d.ts` 精准够用。
- **字符集两条线确实分开了**，`stripIso2022Escapes` 的 ESC 处理也对（这是很多人会跳过的细节）。
- **单文件失败隔离**做得对，`AbortSignal` 贯穿到了每个 I/O 边界。

---

## 修复顺序

**第一轮（阻断，必修）**
1. P0-1 缓存改为 handle 实例级 + LRU 窗口
2. P0-2 预取写入缓存，与 `pixel()` 共用 `loadFrame()`
3. P1-5 几何缺失不得编造默认值，必须告警

**第二轮（正确性）**
4. P1-3 / P1-4 传输语法识别：封装格式明确报错，大端做字节交换
5. P1-1 解析搬进 Worker
6. P1-2 用 `untilTag`，停掉全文件读取

**第三轮（健壮性与性能）**
7. P1-7 DICOMDIR 链遍历 + 乱序 fixture 用例
8. P1-8 建 map 替代 O(n²)
9. P1-9 ZIP 流式 + 深度上限
10. P1-6 回退必须告警

**第四轮（P2 择机）**

---

## 是否需要返工

**不需要推倒重来。** 目录结构、端口实现、用例设计都是对的，问题集中在三处工程纪律（内存、线程、传输语法识别），都是局部可修的。

但 P0-1 与 P1-5 必须在这一模块内解决——它们不是"以后优化"，而是会随数据规模放大成必然故障的两颗雷。
