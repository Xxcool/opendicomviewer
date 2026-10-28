# 设计 Token 规范（v1 · 2026-10-28）

> **本文件是视觉层唯一的数值来源。** 任何颜色、间距、字号、圆角、层级都不允许在组件里写死，
> 必须引用这里的 token。评审时只要看到 `#0B0F17`、`text-[13px]`、`z-[50]` 这类字面量出现在
> 组件代码里，一律视为违反本规范。

配套产出：`docs/design/prototype.html`（可交互基线）、`docs/design/ui-spec.md`（逐元素规格）。

---

## 1. 为什么需要这一层

2026-10-28 之前，颜色全是魔法值、`color-scheme: dark` 写死，直接后果是：

- 设计稿里的「深色/浅色」切换**不可能实现**（没有可切换的机制）；
- 改一处主色要全仓搜 `#2563EB`；
- 语义色缺失 →「缺层标黄、失败标红、不支持置灰」这条规则无处落地。

---

## 2. 主题机制（硬约束）

| 规则 | 说明 |
| --- | --- |
| 切换方式 | `<html data-theme="dark｜light">`，**不做** `prefers-color-scheme` 自动跟随 |
| 为什么 | 阅片主机常年深色、教学投屏要浅色，**与实际系统主题无关**；自动跟随会在投影时突然变脸 |
| 默认值 | `dark`（诊所/个人环境的主场景） |
| 持久化 | `localStorage` 键 `odv.theme`；首屏用内联脚本在 CSS 加载前写入 `data-theme`，避免闪白 |
| 图像区 | **画布区域永远纯黑 `#000`**，浅色模式下也不变（灰底会改变感知对比度、影响判读） |

---

## 3. 色彩

### 3.1 语义色（两套主题共用语义，值不同）

| Token | 用途 | 深色 | 浅色 |
| --- | --- | --- | --- |
| `--color-ok` | 正常/已脱敏/能力可用 | `#34D399` | `#047857` |
| `--color-warn` | 缺层、层距异常、未脱敏、降级可用 | `#F59E0B` | `#B45309` |
| `--color-danger` | 解码失败、导入失败、几何无效 | `#EF4444` | `#B91C1C` |
| `--color-info` | 提示、可忽略的说明 | `#38BDF8` | `#0369A1` |
| `--color-disabled` | 能力不支持（入口置灰） | `#4B5563` | `#9CA3AF` |

> **一个状态只允许一种颜色**。同一件事在列表徽标、视口角标、右栏提示里必须是同一个语义色，
> 否则用户会以为是两件事。

### 3.2 界面色

| Token | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--bg-app` | `#0B0F17` | `#F5F7FA` | 应用底色（架构定稿的极黑） |
| `--bg-panel` | `#0D111A` | `#FFFFFF` | 左右栏、状态条 |
| `--bg-elevated` | `#121826` | `#FFFFFF` | 浮层、弹窗、命令面板 |
| `--bg-hover` | `#161C28` | `#EEF1F6` | 行悬浮 |
| `--bg-active` | `#1B2436` | `#E3E9F2` | 选中行 |
| `--border` | `#1F2937` | `#D8DEE8` | 常规分隔线 |
| `--border-strong` | `#374151` | `#B6BFCC` | 强调分隔、输入框 |
| `--text-primary` | `#E5E7EB` | `#101418` | 主文本 |
| `--text-secondary` | `#9CA3AF` | `#4B5563` | 次要说明 |
| `--text-muted` | `#6B7280` | `#6B7280` | 占位、单位 |
| `--accent` | `#2563EB` | `#1D4ED8` | 主操作、当前选中 |
| `--accent-hover` | `#3B82F6` | `#2563EB` | 主操作悬浮 |
| `--canvas-bg` | `#000000` | `#000000` | **画布恒黑，不随主题变** |

### 3.3 叠加层（overlay）

画布上的文字必须能在任意灰度背景上读清，因此用「半透明底 + 纯白字」而不是直接描边：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--overlay-scrim` | `rgba(0,0,0,0.45)` | 角标文字的背景胶囊 |
| `--overlay-text` | `#FFFFFF` | 角标文字（永远白色，与主题无关） |
| `--overlay-shadow` | `0 1px 2px rgba(0,0,0,0.8)` | 文字投影 |

---

## 4. 字体与字号

系统字体栈，**不加载任何外部字体**（零请求纪律 + 离线可用）：

```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
```

| Token | 字号/行高 | 用途 |
| --- | --- | --- |
| `--text-2xs` | 11px / 16px | 角标、单位、辅助说明 |
| `--text-xs` | 12px / 18px | 面板标签、表格 |
| `--text-sm` | 13px / 20px | 主界面文本（默认） |
| `--text-base` | 15px / 22px | 对话框标题、强调值 |
| `--text-lg` | 18px / 26px | 空态标题 |
| `--text-xl` | 24px / 32px | 数值大屏（可选） |

**数值一律用 `--font-mono` 且加 `font-variant-numeric: tabular-nums`**：WW/WL、层数、测量值、
帧数在变化时不能左右抖动——这是阅片界面的硬要求，用比例字体会让数字"跳舞"。

---

## 5. 间距、圆角、边框

| Token | 值 | 用途 |
| --- | --- | --- |
| `--space-1` … `--space-6` | 2 / 4 / 8 / 12 / 16 / 24 px | 全部间距只用这六档 |
| `--radius-sm` | 4px | 徽标、角标 |
| `--radius-md` | 6px | 按钮、输入框、面板内块 |
| `--radius-lg` | 8px | 浮层、对话框 |
| `--border-width` | 1px | 唯一边框宽度 |

> 不允许出现 `p-[7px]`、`rounded-[10px]` 之类的手调值。刻度少才有一致性。

---

## 6. 层级（z-index）

| Token | 值 | 层 |
| --- | --- | --- |
| `--z-canvas` | 0 | 画布 |
| `--z-overlay` | 10 | 画布角标、方位标记 |
| `--z-toolbar` | 20 | 视口内工具条、滑块 |
| `--z-panel` | 30 | 左右栏、顶栏 |
| `--z-popover` | 40 | 命令面板、下拉 |
| `--z-toast` | 50 | 全局提示 |
| `--z-modal` | 60 | 导入进度、确认框 |

---

## 7. 尺寸约束

| 项 | 值 | 理由 |
| --- | --- | --- |
| 顶栏高 | 56px | 与 14 行高一致，图标 + 文字单行 |
| 左栏宽 | 264px（可拖 200–360） | 容得下"序列描述 + 帧数 + 徽标"三行 |
| 右栏宽 | 288px（可拖 240–400） | 容得下"测量与工具"数值列 |
| 视口内工具条高 | 36px | 状态条；滑块条 48px |
| 最小窗口 | 1024 × 640 | 低于此值折叠右栏，再低提示"窗口过小" |

---

## 8. 与 Tailwind 的对应

Tailwind v4 用 `@theme` 把 token 映射成工具类，**组件里只允许用工具类或 `var(--…)`**：

```css
@import "tailwindcss";

@theme {
  --color-app: var(--bg-app);
  --color-panel: var(--bg-panel);
  --color-line: var(--border);
  --color-txt: var(--text-primary);
  --color-txt-dim: var(--text-secondary);
  --color-accent: var(--accent);
  --color-ok: var(--color-ok);
  --color-warn: var(--color-warn);
  --color-danger: var(--color-danger);
  --font-mono: var(--font-mono);
}

:root[data-theme="dark"] { /* 上表深色值 */ }
:root[data-theme="light"] { /* 上表浅色值 */ }
```

组件写法：`bg-panel text-txt-dim border-line` ✅ ／ `bg-[#0D111A]` ❌

---

## 9. 自检清单（提交前逐条过）

- [ ] 组件里没有十六进制颜色字面量
- [ ] 没有非 token 的字号/间距/圆角（`text-[13px]`、`p-[7px]`、`rounded-[10px]` 都算违规）
- [ ] 所有状态色来自 `--color-ok/warn/danger/info/disabled`，没有临时调色
- [ ] 数值类文本用了 `font-mono` + `tabular-nums`
- [ ] 新增界面元素已登记到 `ui-spec.md`（含数据来源与缺失表现）
- [ ] 浅色主题下逐屏看过一遍（尤其画布角标与告警条）
