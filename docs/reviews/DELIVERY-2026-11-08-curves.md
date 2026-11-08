# 折线与手绘交付记录

日期：2026-11-08。实现及首轮桌面操作发生于 2026-11-05，收尾时重新检查工作树与验证结果。范围仅限 1×1 原始 Stack，不能据此宣称 Phase 1/2 全部完成。

- 折线：逐点点击、Enter 完成、Esc 取消；按可信原图行列间距逐段求和，不做平滑近似。手绘：拖动后隐式闭合，只保存轮廓和备注，不计算面积/HU/灰度统计。
- 所有控制点可编辑，支持整体移动、删除、撤销重做及 JSON 恢复；恢复核对源序列/SOP/帧/坐标并重算物理长度。2048 点上限，手绘超限取消整次绘制并提示，不能静默截断。
- 数值和恢复测试见 `packages/app-web/tests/annotation-path.test.ts`；实现方六项隔离变异全部击杀。独立审查及已修发现见 [CR](CR-2026-11-05-curves.md)。

桌面教学样本第97层实测：三点折线111.35mm；中间点拖动后108.08mm，撤销恢复111.35mm。通过系统保存框写 `/private/tmp/odv-curves-20261105.json`，读回含三个原图控制点及111.35305412232806mm。合成合法手绘备份恢复后五顶点显示、拖动、删除、撤销通过。

证据：[折线](assets/curves-export-2026-11-05/polyline.png)、[恢复后手绘编辑](assets/curves-export-2026-11-05/freehand-restored.png)。手绘截图来自恢复的教学轮廓，**不是实际连续手绘成功的证据**。当前自动桌面工具只提供起终点直线拖动，退化轮廓被拒绝；真实自由轨迹、多触点及Web最新交互仍待覆盖。

验证命令：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm --filter @opendicomviewer/app-web build`、`PATH=/Users/xiabin/.cargo/bin:$PATH pnpm --filter @opendicomviewer/app-tauri exec tauri build --debug --bundles app`。首轮包含并行原图增量的375项测试及双端构建通过；原图后续新增测试另记其交付结果，不把构建当作完整UI验收。
