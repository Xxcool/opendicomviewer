# 独立交叉评审报告：88a6112 → 94bfbd8（CR-2026-10-28-selfcode）

| 项 | 内容 |
| --- | --- |
| 评审对象 | `88a6112` → `94bfbd8`（共 7 个提交，含 `renderer-cs3d` 首版、Spike A 落地与 `source-local` 修复） |
| 评审日期 | 2026-10-28 |
| 门禁实测 | `pnpm typecheck` **0 错误**、`pnpm lint` **0 错误**、`vitest` **79/79 通过** |
| **结论** | **部分通过。** 0 个 P0、3 个 P1、5 个 P2 |
| 一句话 | 整体工程品质与架构纪律极高（依赖倒置隔绝 CS3D、变异测试扎实）；但在**生命周期并发竞态（setStack 无序列锁）**、**DICOM 规范细节（UI padding 为 0x20）**与**Worker 异常入队边界**存在 3 处确定性 P1 缺陷 |

---

## 一、Part 0.2 变异自检核验（14 项重跑验证）

作者在提交中自述的变异自检全部进行了实测复核，**14 项在改坏代码后均能精准变红**，证明当前 79 条用例断言真实有效，非“假绿”断言：

| # | 变异操作 | 预期变红用例 | 实测结果 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | `cornerstone-renderer.ts:226` 去掉 `await`（只发不候） | `setStackIndex 必须等 CS3D 异步切换真正完成才返回` | ❌ 变红（期望 `['viewport-done', 'caller-resumed']`，实收 `['caller-resumed']`） | ✅ 断言有效 |
| 2 | `cornerstone-renderer.ts:123` 并发 mount 改为 `return`（静默返回） | `并发 mount 只允许一次成功，被取代的那次必须抛错` | ❌ 变红（`promise resolved undefined instead of rejecting`） | ✅ 断言有效 |
| 3 | `zip.ts:174` 注释掉 ZIP64 占位检查 | `N6：ZIP64 占位值必须显式报错，不允许静默返回空条目` | ❌ 变红（`promise resolved [] instead of rejecting`） | ✅ 断言有效 |
| 4 | `cornerstone-renderer.ts:189` `setStack` 去掉 `await` | `setStack 必须等装载真正完成才返回` | ❌ 变红（时序颠倒） | ✅ 断言有效 |
| 5 | `cornerstone-renderer.ts:241` 调窗漏 `-0.5` 项 | `getVOI 是 setVOI 的逆变换` | ❌ 变红 | ✅ 断言有效 |
| 6 | `cornerstone-renderer.ts:305` `whenIdle` 去掉超时兜底 | `rAF 不回调时靠超时兜底返回` | ❌ 变红（超时挂起） | ✅ 断言有效 |
| 7 | `frame-registry.ts:36` 登记表改用 `numberOfFrames` | `用 planes.length 而不是 numberOfFrames 生成 imageId` | ❌ 变红（切片越界） | ✅ 断言有效 |
| 8 | `cornerstone-renderer.ts:204` 换序列不去释放旧序列 | `同一视口换序列时释放旧序列，登记表不随切换增长` | ❌ 变红 | ✅ 断言有效 |
| 9 | `cornerstone-renderer.ts:187` 先登记后校验越界 | `初始索引越界时登记表保持干净` | ❌ 变红 | ✅ 断言有效 |
| 10 | `cornerstone-renderer.ts:193` CS3D 装载失败不回滚 | `CS3D 装载失败时回滚：登记表与视口归属都回到调用前` | ❌ 变红 | ✅ 断言有效 |
| 11 | `cornerstone-renderer.ts:93` capabilities 默认声明支持 Volume | `默认不承诺 Volume，由组合根显式开启` | ❌ 变红 | ✅ 断言有效 |
| 12 | `zip.ts` 退回宽松 UTF-8（不按 bit 11 派发） | `N5：中央目录里的 GBK 文件名能正确解码` | ❌ 变红（产出 U+FFFD） | ✅ 断言有效 |
| 13 | `parser-pool.ts:283` `onError` 不 reject 任务 | `复用同一 Worker 时出错必须落到当前请求` | ❌ 变红（超时挂起） | ✅ 断言有效 |
| 14 | `parser-pool.ts:209` `terminate()` 不 settle 队列 | `terminate() 必须 reject 所有在途与排队任务` | ❌ 变红（超时挂起） | ✅ 断言有效 |

---

## 二、Part 0.3 五处设计取舍裁决

### 1. 端口层是否泄漏 CS3D 表示（`packages/core/ports/index.ts`）
- **结论**：**整体隔离极其优秀，但存在 1 处契约注释与代码颠倒，以及 1 处小规模概念泄漏。**
- **证据与判定**：
  1. `RendererPort` 契约第 4 条注释写道：“*调窗走 `setVOI()` 的上下限语义，不走窗宽窗位语义*”；但方法签名定义却是 `setVOI(viewportId: string, range: VOIRange): void`，`VOIRange` 在 `domain/types.ts:126` 中明确是 `{ windowWidth, windowCenter }`。代码实现（由 Adapter 用 `voiToRange` 转成 CS3D 的 `{ lower, upper }`）是正确的领域隔离，**但接口注释完全写反**，对使用者产生严重误导（定级 **P2**）。
  2. `setVolume(viewportId: string, volumeId: string)`（`:142`）：`setStack` 接收的是领域对象 `SeriesHandle`，而 `setVolume` 直接收裸 `volumeId: string`。这直接暴露了 CS3D 底层全局 `volumeLoader` 的字符串缓存机制。在 Phase 2 正式接入时应重构成 `VolumeHandle` 或领域模型，避免泄漏特定渲染器表示（定级 **P2**）。

### 2. `whenIdle` 超时语义（`cornerstone-renderer.ts:293-306`）
- **结论**：**设计方向正确（尽力而为），但存在计时器泄漏 (P2)。**
- **证据与判定**：
  1. `Promise.race([twoFrames(raf), delay(this.idleTimeoutMs)])` 中，当 `twoFrames` 在 33 ms 正常 resolve 时，`delay` 中的 `setTimeout` **未被 clearTimeout 取消**。在高频连续翻页或渲染时，后台积压大量无用定时器，干扰事件循环。
  2. 超时也 resolve 是符合其“尽力而为”契约的；但在传入 `idleTimeoutMs: 0` 时会立即触发 `delay(0)` 而彻底跳过双帧等待。

### 3. `ParserPool` 三态在所有错误路径下是否恰好 settle 一次（`parser-pool.ts`）
- **结论**：**运行态下守住了恰好 settle 一次，但入队初始化边界存在死任务挂起缺陷 (P1)。**
- **证据与判定**：
  在 `parse()`（`:178-187`）中，任务先被 `this.queue.push(task)`，随后调用 `this.pump()`。如果 `this.createWorker()` 在 `acquireWorker()`（`:238`）中同步抛出错误（如 CSP 限制或超出系统线程限制），该异常导致外部 Promise 立即 reject，**但 task 已留在 `this.queue` 中且 `settled: false`**。下一次正常调用 `parse()` 时，`pump()` 会将这个早已被 reject 的僵尸任务出队并发送给 Worker，导致执行错乱。

### 4. ZIP 的 EOCD 相对偏移与 ZIP64 检测是否够（`zip.ts:150-180`）
- **结论**：**基本可用，但存在 2 处边界防御不足 (P2)。**
- **证据与判定**：
  1. **ZIP64 漏判**：仅判断了 `cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF`。当大 Study 文件数超过 65535 但总大小小于 4 GB 时，EOCD 处的 `totalEntries` 为 `0xFFFF`，而 `cdSize/cdOffset` 是合法数值，此时不会命中拦截，但在解析带 ZIP64 扩展信息的条目时会报超出 2 GB。
  2. **EOCD 伪签名风险**：尾部逆序搜寻 `0x06054b50` 时，未断言 `eocdRelOffset + 22 + commentLength === tailBytes.length`。如果注释段恰好包含该魔数，会截断定位。

### 5. Fixture builder 的 OW/padding 假设（`dicom-fixture.ts:103-107`）
- **结论**：**存在 1 处违反 DICOM Part 5 标准的严重缺陷 (P1)。**
- **证据与判定**：
  在 `encodeElement` 中：
  ```ts
  const isTextVr = vr === 'UI' || vr === 'CS' || ...;
  bytes.push(isTextVr ? 0x20 : 0x00);
  ```
  `vr === 'UI'` 被错误归为 `isTextVr`！依据 DICOM PS3.5 第 6.2 节 Table 6.2-1：**UI（Unique Identifier）在长度为奇数时必须填充 0x00（NULL），绝对禁止填充空格 0x20**。将其填充为空格会导致严格的 DICOM 解析器报错或破坏 UID 字符串比较。

---

## 三、P1 缺陷详细分析与证据

### P1-1 `CornerstoneRenderer.setStack` 缺少视口级并发调用保护，慢请求会覆盖快请求并导致旧序列帧永久泄漏

- **位置**：`packages/adapters/renderer-cs3d/src/cornerstone-renderer.ts:160-213`
- **复现机理**：
  在 `mount()` 中，作者敏锐地加入了 `mountToken` 防止并发 mount 竞争；但在 `setStack()` 这一典型异步操作中（`await viewport.setStack(imageIds, initialIndex)`），完全没有加入任何视口级序列版本号或请求锁。
  当用户在视口快速连续点击切换序列 A 与序列 B 时：
  1. 调用 1：`setStack('vp', handleA)` 开始，A 登记至 `this.frames`，等待 CS3D 异步装载；
  2. 调用 2：`setStack('vp', handleB)` 紧随其后开始，B 登记至 `this.frames`；
  3. 若装载 A 耗时较长（例如需解压），装载 B 率先完成，`this.viewportSeries.set('vp', 'B')`；
  4. 装载 A 随后完成，执行 `:211`：`this.viewportSeries.set('vp', 'A')`！
  
  **严重后果**：
  1. 视口内部实际呈现的是序列 B，但渲染器内部记录的归属变成序列 A；
  2. 后续调用 `setStackIndex` 时使用的是序列 A 的切片数边界进行校验，发生状态串扰；
  3. 后续调用 `disposeViewport` 时释放的是序列 A，**序列 B 的所有帧永久驻留在 `this.frames` 中，无法被任何流程释放（内存泄漏）**。

- **证明用例（在 `renderer.test.ts` 中可稳定复现）**：
  ```ts
  it('P1-1 证明：并发 setStack 时后发起的请求必须成为最终状态，慢请求不得覆盖快请求', async () => {
    const { renderer, viewport } = await mounted();
    const handleSlowA = makeHandle(3, 'series-A');
    const handleFastB = makeHandle(3, 'series-B');

    // 模拟 A 异步装载慢 (15ms)，B 异步装载快 (2ms)
    viewport.setStack = async (imageIds) => {
      const delayMs = imageIds[0]?.includes('series-A') ? 15 : 2;
      await new Promise((r) => setTimeout(r, delayMs));
    };

    const pA = renderer.setStack('vp', handleSlowA);
    const pB = renderer.setStack('vp', handleFastB);
    await Promise.all([pA, pB]);

    // 崩溃点：当前代码中 A 最终覆盖了 B，导致该断言失败
    expect(renderer['viewportSeries'].get('vp')).toBe('series-B');
    expect(renderer.frameRegistry.imageIdsOf('series-A')).toHaveLength(0);
  });
  ```

---

### P1-2 `dicom-fixture.ts` 错误将 UID 填充字符设为空格 `0x20`，违反 DICOM Part 5 标准

- **位置**：`packages/adapters/source-local/testing/dicom-fixture.ts:103-107`
- **复现机理**：
  ```ts
  const isTextVr = vr === 'UI' || vr === 'CS' || ...;
  bytes.push(isTextVr ? 0x20 : 0x00);
  ```
  在 DICOM 规范中，除 UI 外的文本 VR（如 LO, SH, PN, CS）奇数长度时填充 ASCII Space `0x20`。但 **UI 明确规定只允许数字与句点，且奇数长度时必须填充单一字节 `0x00`（NULL）**。
  若将奇数长度 UID 填入 `0x20`，构造出的文件在被标准解析器（或下游脱敏模块）按字节读取时，尾部会带有空格字符，导致 UID 不合法或哈希失真。

- **证据与判定**：
  DICOM PS 3.5 Section 6.2 Table 6.2-1:
  > "*UI: In order to maintain an even length, it shall be padded with a single trailing null character (00H) if the length is odd.*"
  应改为 `const isTextVr = vr !== 'UI' && (...);`，对 UI 必须填充 `0x00`。

---

### P1-3 `ParserPool.parse()` 创建 Worker 失败时残留死任务于队列头部，破坏调度一致性

- **位置**：`packages/adapters/source-local/src/worker/parser-pool.ts:178-187, 238`
- **复现机理**：
  在 `parse()` 中，`this.queue.push(task)` 在 `this.pump()` 之前发生。
  若 `this.createWorker()` 在 `acquireWorker()` 内部发生瞬时异常（如线程资源受限），`pump()` 抛出异常导致返回的 Promise 被 reject；但该任务依然留在 `this.queue[0]`。
  当线程池恢复后再次调用 `parse()`，`this.queue.shift()` 取出的实际上是第一次调用失败留下的僵尸任务，造成任务时序错乱。

- **证明用例（在 `unit.test.ts` 中可复现）**：
  ```ts
  it('P1-3 证明：Worker 构造异常时任务不得残留在队列中', async () => {
    let shouldFail = true;
    const pool = new ParserPool({
      createWorker: () => {
        if (shouldFail) throw new Error('Worker spawn failed');
        return new FakeWorker();
      },
    });

    // 第一次调用抛错
    await expect(pool.parse(new ArrayBuffer(10), makeCandidate('1'))).rejects.toThrow('Worker spawn failed');
    shouldFail = false;

    // 此时队列应该为空，而不是残留第 1 个任务
    expect(pool['queue']).toHaveLength(0);
  });
  ```

---

## 四、P2 一般项清单

| # | 位置 | 问题 | 修复建议 |
| --- | --- | --- | --- |
| N1 | `core/ports/index.ts:118` | 契约注释写反：“调窗走 setVOI 的上下限语义，不走窗宽窗位语义”，但代码接收的是 `VOIRange`（窗宽窗位） | 修正注释，明确 core 统一使用 `VOIRange`，Adapter 内部转换为 CS3D 上下限 |
| N2 | `core/ports/index.ts:142` | `setVolume(viewportId, volumeId: string)` 直接接收 CS3D 内部字符串 id，破坏领域抽象 | 引入 `VolumeHandle` 或将 volumeId 约束为领域标识 |
| N3 | `cornerstone-renderer.ts:305` | `whenIdle` 的 `Promise.race` 在 `twoFrames` resolve 后未执行 `clearTimeout` | 在 `twoFrames` 结束时显式清理定时器，避免事件循环堆积孤儿 Timer |
| N4 | `zip.ts:174` | ZIP64 检测漏判条目数超限标记（EOCD `totalEntries === 0xFFFF`） | 补充 `totalEntries === 0xFFFF` 的判定并抛出明确错误 |
| N5 | `cornerstone-renderer.ts:131-143` | `mount` 中循环 `enableElement` 若中途抛错，未对已启用的视口及 engine 进行 rollback 清理 | 在 `mount` 视口初始化循环外添加 try/catch，失败时调用 `engine.destroy()` |

---

## 五、值得肯定的部分

1. **依赖倒置做得极其干净**：`packages/adapters/renderer-cs3d` 完全不 `import @cornerstonejs/*`，而是由组合根注入 `Cs3dModuleLike`。这使得渲染适配器不仅在 CI 上无需安装庞大的 vtk.js 与 wasm 即可秒级完成 37 条单测，更在架构上隔绝了 CS3D 5.x 的 API 剧变污染核心。
2. **变异自检闭环真实**：作者在 `94bfbd8` 与 `88a6112` 中发现并修复的 4 个生命周期漏洞（换序列释放、先登记后校验、装载失败回滚、mount 竞态）全部配备了反向断言，且全部通过了变异复核。
3. **ZIP 字符集与流式解析彻底解决**：用 GP flag bit 11 派发结合三级字节解码彻底消除了中文字符乱码产生 U+FFFD 的隐患；EOCD 尾部切片检索彻底杜绝了 2 GB 压缩包整包解压入内存的风险。
4. **测试分层与自省意识**：能在 73 条测试全绿的假象下主动自查出边界漏洞并补充变异用例，体现了顶级的工业级工程素养。

---

## 六、整改要求与通过条件

**必修项（P1，阻断）：**
1. **P1-1**：在 `cornerstone-renderer.ts` 中引入视口级操作版本控制（如 `viewportTokens: Map<string, number>`），确保慢请求在 await 归来后若发现已有新请求则立即放弃并回滚，消除并发切序列导致的归属错乱与帧泄漏。
2. **P1-2**：修改 `dicom-fixture.ts:103`，将 `vr === 'UI'` 从 `isTextVr` 剥离，对 UID 强制使用 `0x00` 进行偶数对齐填充。
3. **P1-3**：在 `parser-pool.ts` 的 `parse()` 中增加异常安全回滚，当 `pump()` 或 Worker 初始化失败时，清理 `this.queue` 中残留的当前 task。

**建议修（P2）：**
4. 修正 `ports/index.ts` 中 `setVOI` 的反向注释。
5. 在 `whenIdle` 中加入 `clearTimeout` 清理。
