# 原始 DICOM 导出独立审查

日期：2026-11-05。范围：SeriesHandle原始来源、source-local映射、Web DICOM/ZIP、导出控件与Tauri授权/原始文件复制。原生PNG尚未实现，本报告不将原始DICOM复制冒充PNG保存。未改实现、未提交、未操作GUI；主线另做构建和原生验收。

## 发现与处置

- **EX-01：缓存读取的同步CRC循环阻塞取消。** 原系列导出逐文件await立即resolve的cached read，再逐字节同步CRC；大量缓存ZIP条目/示例会形成连续微任务，浏览器无法处理取消点击，下载可能先于用户取消完成。反馈后实现方在完整读取后task yield、CRC每256KiB task yield并检查signal。新增“即时缓存读取后setTimeout取消”测试，确认中途取消能进入事件循环而不是只验证预先取消。静态控制流和新回归关闭原路径，不宣称完成设备p95/大序列性能测试。
- **EX-02：PNG重新捕获期间保留旧Blob/预览的风险。** 格式切换增加了重捕获入口；仅清snapshot会让旧图片短暂可下载，而identity选项已重置。审查时实现方已补setBlob(null)，并按反馈补setPreview('')；最新capture入口同步清snapshot/blob/preview，下载按钮依赖blob，修正后无可下载旧快照的窗口。真实快速切换GUI未由Node测试证明。
- **EX-03：原生中途取消与批次崩溃边界。** 保存选择器可cancel，但HostOriginalSaver没有AbortSignal/任务取消；开始原生复制后UI禁用关闭/Esc。窗口关闭/应用退出未与导出任务联动。原子发布保证每个已发布文件完整，不保证整条series在应用被终止时事务回滚；异常终止可能留下本次新目录中的部分完整实例/临时文件。该项为当前明确能力缺口，不能写成close/unmount已取消原生写盘。源文件不会因此被覆盖。

## 数据链

- source-local的originalCandidates按现有candidateMap读取实际来源；单层映射到其底层完整candidate，不以frameIndex截取文件。全部实例以candidate对象去重，避免同一多帧文件按每帧导出；包括ZIP展开候选，不从imageId/文件名猜原生路径。
- 本轮原始导出不调用PixelFrame重编码、VOI或标注写回；原始字节含全部标签、像素与多帧。当前序列仅包含已成功导入的原始来源，不能因此声明原光盘所有文件均导出。
- Web单实例application/dicom直接Blob；多实例ZIP32 store，文件名为instance序号，不泄露来源路径/患者文件名。CRC32与目录字段按实际字节生成，超ZIP32边界明确拒绝，完整读取大小变化明确失败。
- ZIP32格式上限不是设备内存预算；当前Blob持有全批缓冲，大序列峰值内存与目标设备尚未验收。不要用“支持4GiB”表述可安全导出规模。

## 宿主安全和原子发布

- HostOriginalSaver只接来源id与size，原图二进制不经IPC；Rust从AuthorizedOriginals表取实际已选路径，不接受任意前端source/target路径。
- 未授权ID、大小不一致、ZIP虚拟条目或教学样本ID明确拒绝。原生ZIP来源不静默退为选中ZIP本身。原生PNG仍明确禁用，未把PNG以base64送入文本保存桥。
- copy_original先拒绝非文件/符号链接/大小变化，打开后和复制后再查大小；同目录create_new临时文件完整copy并sync、关闭，再hard_link到不存在的目标。目标已有文件/符号链接/源文件自身会因no-clobber发布失败而保留，避免此前直接写目标时的部分文件风险。
- 单文件失败清理本次临时文件；series先独占create_dir新子目录，任一文件失败仅移除本次新目录。清理是最佳努力；权限变化或进程被终止不属于已保证回滚。未宣称抵抗同机并发恶意路径替换的全部TOCTOU情形。
- UI保存请求开始时固定候选列表；Web关闭/卸载abort且token失效，不继续触发下载。Native保存选择器返回cancelled与完成copy后的saved区分；Web只说已发起下载，不称落盘，不改变标注dirty。

## 独立验证与边界

已执行：

```bash
pnpm exec vitest run packages/app-web/tests/original-dicom.test.ts packages/app-web/tests/roi-source-values.test.ts packages/adapters/source-local/tests/integration.test.ts
pnpm --filter @opendicomviewer/app-web typecheck
PATH=/Users/xiabin/.cargo/bin:$PATH cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml
```

当前独立重跑3文件38项通过、Webtypecheck通过；Rust6项通过，含完整复制、源=目标、目标已存在、大小变化拒绝。首次读取测试文件尚在补充；最终新增真实多帧与ZIP来源闭环的结果在后续追加，不把任意7字节完整copy测试伪称真实多帧DICOM验收。授权表/对话框取消/series失败回滚目前主要为静态审查，没有由上述copy helper单测实例化完整tauri命令。

GUI仍需：原生单实例/多文件目录另存后读回、cancel、Web实际取得.dcm/.zip、ZIP再导入、完整多帧文件比对、快速切换PNG选项。主线已完成的其他截图和此前PNG预览不代替本轮原图保存验证。

### 最终跨层回归补证（10:23）

实现方补齐后，独立重跑：`pnpm exec vitest run packages/app-web/tests/original-dicom.test.ts packages/adapters/source-local/tests/integration.test.ts`，2文件31项通过，其中原图导出7项。新增测试以fixture生成真实带NumberOfFrames=2的DICOM，经LocalDataSource.probe/open后，两帧originalCandidates指向同一完整实例、全序列去重为1个，任一帧导出的全部字节与原始buffer相同。另一项将2个真实DICOM装入ZIP，经现有导入→原图候选→新ZIP→现有ZIP读取器逐实例字节比对→LocalDataSource再次导入，重导入仍为2帧；不再依赖任意字节测试推断多帧/ZIP来源完整性。

独立运行`/Users/xiabin/.cargo/bin/cargo test --manifest-path packages/app-tauri/src-tauri/Cargo.toml`，7项全部通过。新增Unix来源符号链接替换拒绝测试；已有目标/目标目录发布失败后目录计数断言确认没有遗留本轮临时文件。`git diff --check`通过。第一次裸`cargo`因当前shell未配置PATH返回127，使用明确工具路径后成功，非构建失败。

结论：本次已发现的EX-01、EX-02有代码闭环和上述边界回归；未发现新增源文件覆盖或多帧截断阻塞。EX-03原生中途取消/应用终止恢复、完整宿主命令对话框/授权集成验收，以及大序列内存预算仍是明确未覆盖项。原生PNG仍未实现。本报告不将单元测试替代主线原生另存和下载GUI验收。
