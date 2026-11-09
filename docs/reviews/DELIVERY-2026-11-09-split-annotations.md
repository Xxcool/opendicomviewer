# 独立分屏标注与测量验收

日期：2026-11-09。对应原“标注测量限1×1”的界面限制。本次扩展原始Stack，不在降采样MPR上输出测量值。

## 实现与边界

- `MprPane`提供宿主ref给原始格叠加层；`SplitWorkspace`每格复用`AnnotationLayer`和各自原始句柄，全局只挂一个活动序列列表。
- `annotation-viewport.ts`让活动原始格独占绘制及键盘，避免四个window监听器把一次撤销执行四次；卸载移除监听。
- 切活动格前通过已有`FLUSH_ANNOTATION_NOTE`提交备注草稿；活动格/布局变更取消几何草稿，ROI异步提交时再次校验活动格。
- 分屏翻层前取消草稿，成功后按新帧重绘；修正独立审查SPLIT-01旧层标注残留。绘制工具开启时暂停Cine，右键与Shift调窗沿用现有优先级。
- 记录仍绑定会话、序列、SOP和frameIndex；没有新增每格副本，保存与恢复沿用同一版本化JSON真源。

## macOS实际GUI

以`pnpm desktop:build`生成的arm64应用及内置ICBM152样本验收：

1. 独立2×2第一格轴位第97层绘制测距78.47mm。备注输入`split note retained without enter`，不按Enter直接点击第二格并分配另一矢状序列，返回后列表仍保留完整备注。
2. 第二格矢状原图绘制85.89mm并写`sagittal note`。第一格列表定位97层，再翻98层，第一格旧标注立即消失，第二格标注仍在。
3. 第一格活动时Cmd+Z只撤销末次备注，第二格85.89mm保留，备注消失；Cmd+Shift+Z恢复该备注。四格监听没有重复撤销。
4. 第一格活动时，直接在第二格拖动，首次即激活并新建57.26mm，无需额外点击一次。
5. 原生保存JSON后界面取消“未保存”。磁盘读回3条记录、2个序列，长度78.47/85.89/57.26mm与两条备注吻合。文件临时位于`/private/tmp/odv-split-annotations-20261109/annotations.json`，不提交产物。
6. 从第二格切回1×1，原始矢状影像的两条标注、备注与长度均继续显示，按新相机投影。

## 验证

- `pnpm test`：43文件396项通过（含2项发布脚本）；`pnpm typecheck`、`pnpm lint`通过。
- Web构建与Tauri Release应用构建通过。构建仍有既有大chunk提示，没有为此修改预算或依赖。
- 门禁变异：暂时移除活动格键盘判断，四监听撤销测试变红；恢复后通过。
- 独立审查：[CR-2026-11-09-split-annotations.md](CR-2026-11-09-split-annotations.md)。React检查覆盖effect清理、稳定readIndex、无指针循环setState和单一标注真源。

## 未覆盖

本轮GUI覆盖测距和备注，不代表分屏内全部ROI/角度/手绘、Web窄屏或Windows实机均已验收。分屏PNG导出仍不开放。降采样MPR不可测量属于正确性约束，未移除此限制。历史macOSMPR重绘缺陷没有可证实的根因修复，本次不宣称关闭。
