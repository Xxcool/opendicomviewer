# 复审报告：source-local 修复验证（CR-2026-10-27-source-local-r2）

| 项 | 内容 |
| --- | --- |
| 复审对象 | `87da592` fix(source-local): resolve P0-P2 review findings |
| 复审日期 | 2026-10-27 |
| 门禁 | `tsc` 0 错误、`vitest` 28/28 通过 |
| **结论** | **部分通过。** 16 项中 11 项真修好，1 项半修，3 项未修，1 项测试造假 |
| 一句话 | 修得好的地方很扎实（LRU、offset 链、传输语法），但**"全部完成"这个说法不成立**：架构级要求 P1-1 一字未动 |

---

## 逐项核对

| 编号 | 问题 | 状态 | 证据 |
| --- | --- | --- | --- |
| P0-1 | 帧缓存无界 | ✅ **真修** | 新增 `LRUCache` 类（`source-local.ts:47`），handle 实例级、容量 64、`dispose` 只清自己（`:401`） |
| P0-2 | prefetch 丢弃结果 | ✅ **真修** | 走统一 `loadFrame` 并写入 LRU（`:391-394`） |
| **P1-1** | **零 Worker，主线程同步解析** | ❌ **未修** | `grep -rn "Worker" packages --include="*.ts"` → **零命中** |
| P1-2 | 全文件读取 | ✅ **真修** | `untilTag: 'x7fe00010'` 在 `scanner.ts:63/272/278` 与 `source-local.ts:246/251` 全部生效 |
| P1-3 | 封装传输语法 | ✅ **真修** | `isEncapsulatedTransferSyntax()` + 明确 throw；测试 `rejects.toThrow(/封装压缩传输语法/)` |
| P1-4 | 大端字节序 | ✅ **真修** | `transferSyntax === '1.2.840.10008.1.2.2'` 分支做字节交换（`:325`） |
| **P1-5** | **几何缺失静默兜底** | ⚠️ **代码对，测试假** | 见第 2 节 |
| P1-6 | DICOMDIR 静默回退 | ✅ **真修** | `source-local.ts:149-152` 产生 warning，集成测试有断言 |
| P1-7 | 未按 offset 链遍历 | ✅ **真修** | `offsetMap` + `(0004,1400)` 兄弟 / `(0004,1410\|1420)` 子节点 + `visited` 防环；补了"物理乱序"fixture 用例 |
| P1-8 | O(n²) 匹配 | ✅ **真修** | `dicomdir.ts:310` 改为 Map 查表 |
| **P1-9** | **ZIP 整包入内存** | ⚠️ **半修** | 深度限制 3 已加；**流式解包仍未实现**，注释与代码矛盾（见第 3 节） |
| N1 | modalityLUT 从不产出 | ✅ **真修** | `scanner.ts:125-148` 解析 `(0028,3002)` → `lutData` |
| N2 | scoreCjk 分支不可达 | ✅ **真修** | 改用 `codePointAt`（`charset.ts:29`） |
| **N3** | 文件名 0x80–0x9F 反推失真 | ❌ **未修** | `charCodeAt(i) & 0xff` 原样保留 |
| **N4** | numberOfFrames 语义混用 | ❌ **未修** | `scanner.ts:381` 仍是 `sortRes.sortedPlanes.length` |
| N5 | 路径大小写丢失 | ✅ **真修** | `referencedFileId` 保留原串，另存 `normalizedPath` 供匹配 |

**统计：11 真修 / 1 半修 / 3 未修 / 1 测试造假**

---

## 一、P1-1 完全没做（架构级）

这是本轮最需要说清的一条。`grep -rn "Worker" packages --include="*.ts"` **零命中**，`parseDicomMetadata` 与 `pixel()` 依然在主线程同步跑 `dicomParser.parseDicom`。

而 ARCHITECTURE §6.3 与 GEMINI.md §6 都写着"DICOM 解析、解压、降采样全部在 Worker 中执行"。

需要说明的是：**这一条确实比其他条目难**——它要求新增 worker 入口、消息协议、`Transferable` 传递、worker 池调度，不是局部改几行。但难不等于可以标记为"已完成"。

**若不修的后果**：1000 帧序列导入时主线程被同步解析占满，UI 冻结（`await` 只能在 I/O 边界让出，`parseDicom` 本身是硬同步 CPU）。这会让后面所有性能指标（p95 < 16.7ms）从源头失去意义——渲染再快，导入时也是卡死的。

**处理建议**：如果这一轮确实来不及，应该在回复里明确写"P1-1 延后到下一轮，原因是 X"，而不是并入"已全部修复"。**分类错误比未修复更麻烦**——它会让后续排期建立在错误假设上。

---

## 二、P1-5：生产代码修对了，但测试是空壳

生产侧是对的：`scanner.ts:102/173` 打上 `hasMissingGeometry` 标记，`core/pipeline/sort.ts:141-150` 汇总并产出 `MISSING_GEOMETRY` 警告。**这部分实现我认可。**

但配套测试（`integration.test.ts:238`）是这样的：

```ts
it('P1-5 验证：切片缺失空间几何 (0020,0032) 时产生 MISSING_GEOMETRY 警告', async () => {
  const rawNoGeom = buildDicomBuffer({ ... });
  // 模拟缺失：在解析时 hasMissingGeometry 为 true
  ...
  expect(handle.meta.planes[0]?.hasMissingGeometry).toBe(false); // 有默认 fixture
});
```

三个问题：

1. **断言与测试名相反**。名字说"缺失几何 → 产生警告"，断言却是 `hasMissingGeometry === false`，注释还顺手解释了为什么是 false（"有默认 fixture"）。
2. **完全没有断言 `MISSING_GEOMETRY`**。全仓搜索该字符串，只出现在这个用例的**标题**里，没有任何 `expect`。
3. **构造的数据根本没走缺失路径**。`buildDicomBuffer` 默认带 IPP/IOP，所以这个用例实际验证的是"正常切片被正确解析"——那是别的用例已经覆盖过的事。

换句话说：**这条测试如果删掉，覆盖率为零损失；但如果生产代码哪天把 `hasMissingGeometry` 判断写反，它也不会红。**

这属于上一轮 B2（测试副本）的同类问题在新模块复发。判定标准不变：**用例名承诺的行为，必须有对应的断言。**

**该补的测试**：

```ts
it('P1-5：IPP 缺失时序列必须产出 MISSING_GEOMETRY 告警', async () => {
  const raw = buildDicomBuffer({ /* 显式省略 ImagePositionPatient */ });
  ...
  const handle = await source.openSeries({ ... });
  expect(handle.meta.planes[0]?.hasMissingGeometry).toBe(true);
  expect(handle.warnings.some((w) => w.code === 'MISSING_GEOMETRY')).toBe(true);
});
```

前提是 fixture builder 要支持"故意省略某个标签"——如果它现在是"总是写全"，那需要先加一个 `omit: ['x00200032']` 之类的选项。

---

## 三、P1-9：注释说"流式"，代码在整包读

`scanner.ts:230-245`：

```ts
// 如果是 ZIP 压缩包，自动流式解包并将子条目入队（深度限制 3，P1-9）
if (isZipBuffer(headerBuffer)) {
  if (depth >= 3) { ... return; }
  const fullZipBuffer = await candidate.read(undefined, undefined, signal);  // ← 整包读入
  const zipEntries = await extractZipEntries(fullZipBuffer);
```

深度限制做了（对），但"流式解包"没做——这正是 ARCHITECTURE §7.5 明确要求的："流式解包，不整包解压到内存"。2 GB 的 zip 依然会 OOM。

**注释与实现不一致比不做更糟**：后来的人读到注释会以为这是流式的，不会再去优化。

**处理建议**：要么改实现（读中央目录 + 按条目解密/解压），要么改注释（写明"当前为整包读取，受内存限制，待优化"）。两者选一，不要维持矛盾。

---

## 四、N3 / N4 未修

- **N3**：`decodeFilenameForDisplay` 仍是 `charCodeAt(i) & 0xff`。`TextDecoder('iso-8859-1')` 在 WHATWG 规范里实为 **windows-1252**，`0x80–0x9F` 区间的字节（GBK 首字节常见区间）无法用 `& 0xFF` 还原。影响面小（仅展示层），但既然标了 P2 就该要么修要么在注释里写明已知限制。
- **N4**：`SeriesMeta.numberOfFrames` 仍填切片数。这个字段名对应 DICOM 的 `NumberOfFrames`（单文件内帧数），一旦接入 Enhanced Multi-frame 就会语义打架。建议要么改名（`sliceCount`），要么在类型注释里明确它在本项目中的定义。

---

## 五、值得肯定的部分

这一轮的修复质量整体高于前几轮，有几处做得比要求更好：

1. **P1-7 的 offset 链实现是完整正确的**：建 offset map → 沿 1400/1410/1420 遍历 → `visited` 集合防坏盘死循环 → 失败回退顺序遍历。还补了"物理乱序"的 fixture 用例来证明它真的在走链，而不是走了也看不出。这是本轮最扎实的一处。
2. **P1-3 没有偷懒**：没有"先当裸数据画出来再说"，而是明确抛错并指明需要 `CodecPort`。错误信息是可执行的。
3. **P1-6 学会了不静默**：回退时产生 warning 且被测试断言，R7 这次是真的守住了。
4. **N1 补了 ModalityLUT 的实际解析**，不是只加个类型字段了事。
5. **N5 的修法很对**：`referencedFileId` 保留原串、另存 `normalizedPath` 供匹配——既解决了大小写敏感问题，又没牺牲匹配效率。

---

## 六、通过条件

**必修（阻断）**

1. **P1-1**：实现 Worker 化（或在回复中明确声明延后，并写清理由与排期）
2. **P1-5**：把假测试改成真测试（fixture builder 需支持省略标签）

**建议同轮修掉**

3. **P1-9**：注释与实现二选一，消除矛盾
4. **N3 / N4**：修，或写明已知限制

**复核命令**

```bash
grep -rn "Worker" packages --include="*.ts"        # 应有命中
grep -rn "code: 'MISSING_GEOMETRY'" packages/*/tests  # 应有断言
npx tsc --noEmit -p packages/adapters/source-local/tsconfig.json
npx vitest run
```

---

## 七、一句提醒

这轮的教训不是"修得不好"，而是**"全部完成"这四个字的分量**。

16 项里有 11 项做得很好，但只要有 1 项没做、1 项是假测试，这个说法就变成了误报。而在这种项目里，**误报的代价是后续决策建立在错误的前提上**——比如现在如果按"已经 Worker 化"去排性能指标，等发现没做时，架构已经按错误假设铺开了。

更稳妥的表述方式是分三档报：`已修复 / 部分修复 / 延后（附原因）`。既不夸大，也让人知道该往哪儿看。
