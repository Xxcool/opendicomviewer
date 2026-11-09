# Windows 发行版本校验 CRLF 修复独立审查

日期：2026-11-09。范围仅限 `packages/app-tauri/testing/release-artifacts.mjs` 与新增 `release-artifacts.test.mjs`，未修改实现、工作流或提交。

## 发现与复核

构建任务 `42551784889` 的 Windows job 在“Verify source and application versions”失败。保存日志 `/private/tmp/odv-windows-build.log:247` 显示 `Release tag base version must match package.json, Tauri, Cargo.toml, and Cargo.lock`。日志本身没有输出工作区文件原始字节；CRLF 原因由下面的独立复现支持，最终仍须 Windows runner 重跑确认。

旧代码对 Cargo.lock 应用包段使用严格 LF 正则，Windows CRLF 换行会使 `lockVersion` 成为 undefined，即使版本完全相同也拒绝构建。修复仅将读取规则提取为 `desktopLockVersion()`，包段换行改为 `\r?\n`；版本比较、源提交检查与其他发行约束保持不变，没有关闭门禁或用其他包的版本作回退。

独立读取仓库当前实际 Cargo.lock，分别保留 LF 与转换为 CRLF 后运行旧/新表达式，输出：

```json
{"oldLF":"0.1.0","oldCRLF":null,"fixedLF":"0.1.0","fixedCRLF":"0.1.0"}
```

新增测试直接 import 被测实现，覆盖 LF、CRLF，以及应用包不存在时不得取其他包版本。将严格 LF 表达式恢复会使 CRLF 断言失败；独立上述旧表达式运行已经证实对应失败输入，不需要改动工作区实现。

## 验证结果

```bash
pnpm exec vitest run packages/app-tauri/testing/release-artifacts.test.mjs
pnpm exec eslint packages/app-tauri/testing/release-artifacts.mjs packages/app-tauri/testing/release-artifacts.test.mjs
```

2项测试通过，ESLint退出0。当前范围未发现确认阻塞，修复适合重新进行相同固定提交的双平台构建。未执行 Windows/macOS 安装或GUI验收，不将本地测试通过表述为安装包已成功生成。
