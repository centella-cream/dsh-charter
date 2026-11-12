# dsh-charter Design Contract（0.3.0 GUI）

> **Status:** Active — 0.3.0 development contract. Not implemented, not released, not a release note.
> **Scope:** 所有 Pane 栏目（Workspace / Review Center / Diagnostics & Maintenance）的设计系统与交互合同。
> **Authority:** `docs/design/charter-gui-v1.zh.md`（设计与实施权威）；`docs/design/version-roadmap.zh.md`
> （版本范围权威）；`docs/design/charter-workspace-v2.zh.md`（Workspace/Change Set 语义）。
> **Guardrail:** 人工验收通过前不推送 `feat/0.3.0-gui`、不合并 `main`、不 tag/release/publish、不声称 0.3.0
> 可用或已发布。
> **Runtime boundary:** 纯客户端；不改 record schema、迁移、Host service、Remote/wire、prompt 投影、模型能力、
> `engines.dsh`/peer ranges/`dshReleases`。

## 1. 产品意图

Charter 是一份**可读的契约文档**，不是仪表盘：

1. 第一屏回答：目标是什么、哪些硬约束、下一个交付物、是否被阻塞。
2. 目标只出现一次；条目按阅读顺序排列；统计只在真正回答问题时出现。
3. 所有栏目共用同一套 token、组件、键盘与状态合同；不允许某个栏目保留旧样式。
4. 窄屏（≤560 / ≤879px）是一等公民；宽屏（≥1100px）在 W5 提供三栏 + Change Set rail/sheet。

## 2. 设计 token

### 2.1 字体

| 角色 | 实现 |
| --- | --- |
| 字体族 | `var(--dsw-font-family)`（跟随宿主/用户设置）；代码 `var(--ds-font-family-code)` |
| 页面标题 | `var(--dsw-font-l-20)`（20/28，500） |
| Section 标题 | `--ch-font-section` = `600 var(--dsw-font-s-14-font-size) / var(--dsw-font-s-14-line-height) var(--dsw-font-family)` |
| 正文 | `var(--dsw-font-xs-13)`（13/20） |
| 元信息 | `var(--dsw-font-xxs-12)`（12/18） |
| Caption / badge | `var(--dsw-font-xxxs-11)`（11/14） |
| Kicker | `--ch-font-kicker` = `600 var(--dsw-font-xxxs-11-font-size) / var(--dsw-font-xxxs-11-line-height) var(--dsw-font-family)`；`letter-spacing:.02em`；无 uppercase |
| 用户手写内容 | `var(--dsw-font-markdown-base)`（`--dsh-content-font-size`，默认 14；动态值，不计入 UI 字号门禁） |
| 字重 | 只用 400 / 500 / 600 |
| 行高 | 用 token 自带，禁止逐元素写行高 |

UI 字号只允许 7 个不同值；禁止 10/10.5/11.5/12.5/13.5/15/18/22px、`em/rem` 混用、550/650/700 字重。

### 2.2 颜色与主题

只用 `--dsw-alias-*` 语义 token（自动明暗翻转）：

- 画布/表面：`bg-base`、`bg-layer-1/2/3`、`bg-module-platform`、`bg-skeleton`。
- 文字：`label-primary/secondary/tertiary/caption`、`label-primary-foreground`。
- 边界：`border-l1/l2/l3/l4`；发丝线用 `var(--dsh-hairline-width, .5px)`。
- 交互：`interactive-bg-hover/active`、`state-business-primary`。
- 状态：`state-error/warn/success-primary`（及 secondary/tertiary）。
- 按钮：`button-primary-fill/hover`、`button-ghost-active-*`。
- 焦点：`var(--dsw-focus-ring-width) var(--dsw-focus-ring-color)`。
- 阴影：`--dsw-elevation-stroke/soft/panel/prominent`。
- 衍生色只允许 `color-mix(in srgb, <alias token> 8–12%, transparent)` 用于 tag/notice 底色。

禁止：hex/rgba 散落字面量（旧版兼容块除外）、`[data-ds-dark-theme]` 覆盖、拼写异常 token。

### 2.3 圆角、层级、间距、尺寸

| 项 | 规格 |
| --- | --- |
| 圆角 | `--dsw-radius-sm`(8) / `md`(12) / `lg`(16)；pill 999；`--dsw-radius-panel`(28) 仅 W5 浮层；不使用 xl(20) |
| 阴影 | 只用 elevation token；卡片不留重阴影，用发丝边 + 表面色 |
| 间距 | 2/4/6/8/12/16/20/24/32/48；`padding` 值 ≤12 种、`gap` ≤8 种 |
| 控件高度 | 28（sm 按钮）/36（md 按钮）/34（输入框）/40（触屏/设置行） |
| 命名常量 | `--ch-content-max:960px`、`--ch-reading-max:720px`、`--ch-page-inset-top:28px`、`--ch-page-gutter:clamp(16px,4vw,32px)`、`--ch-page-bottom:48px`、`--ch-actionbar-h:48px`、`--ch-scroll-margin:calc(var(--ch-actionbar-h) + 16px)`；禁止散落魔法数字 |

## 3. 布局与 IA

- Pane 位于宿主 `[data-conversation-scroll]`（`.scrollBody`）滚动容器内：**保持文档流，不新建内层滚动**；
  `overflow-x: clip`，禁止 `overflow-x: hidden`（会让 root 变成滚动容器并破坏 sticky，W0 已实测）。
  吸顶 actionbar/nav 以宿主 scrollBody 为滚动祖先；锚点用 `scroll-margin-top: var(--ch-scroll-margin)`。
- Composer 在契约视图下由宿主隐藏（`display:none`），切回对话视图为 170px；Pane 不依赖其高度、不预留滚动空间。
- 内容 `max-width:960px`，阅读列 720px；页边距/吸顶高/滚动偏移全部走命名常量。
- 页面头：标题 + revision + 预算 meter；slogan/免责声明移入空态或帮助 popover。
- 操作条：仅 dirty/replay/conflict/unknown 时吸顶（高 `--ch-actionbar-h`）；clean 状态不常驻。
- 一级区域：Workspace / Review Center / Diagnostics & Maintenance，使用宿主风格 tab/segmented 控件；
  每个 section 有稳定 `id` 与 `scroll-margin-top: var(--ch-scroll-margin)`；跳转必须滚动 + 聚焦标题。
- Workspace 文档流：目标（唯一）→ 硬约束 → 交付物 → 执行路径（依赖图 disclosure）→ 阻塞原因；
  全局预算只在 header meter 与 Change Set 摘要出现；条目行内字节数属于字段计数器。
- Change Set：按 workspace-v2 §5.6/§5.7 最小合同——桌面有名称 complementary region，窄屏 modal bottom sheet
  （focus trap/Escape/focus restore/in-flight 写锁）；W5 完成完整 rail/sheet。
- Review Center：pending 批次 → 时间线 → inactive/rejected/archive → 已应用历史；空态明确。
- Diagnostics：健康/完整性在前，validator/证据其次，Context Preview 有固定锚点，导出/恢复在最后。
- 状态：clean / dirty / replay / conflict / unknown / offline 各有唯一呈现；disabled Apply 旁显示首要原因；
  加载用 3 行 skeleton。

## 4. 可访问性

- 不嵌套 `<main>`；使用 `<section aria-label>`；标题从页面 h2 → section h3 → 子块 h4。
- DOM 顺序 = 视觉顺序；操作条在内容之后。
- 区域导航使用 `<nav aria-label>` + 按钮 + `aria-current="page"` + `aria-describedby`；不使用 ARIA
  tablist（真实路由/焦点跳转，workspace-v2 §5.7 的路由链接等价路径）。
- 所有可交互元素有 `:focus-visible`；跳转后焦点到目标标题；提供 skip link。
- Help 不只依赖 hover；触控目标 ≥40px；对比度 AA；200% 缩放、forced-colors、reduced-motion 通过。
- 窄屏 Change Set sheet：modal dialog 语义 + focus trap + Escape + opener focus restore。

## 5. 证据门禁

- `npm run verify:ui-metrics -- --gate=css`：UI 字号 ≤7、字重 ≤3、非 pill 圆角 ≤3（pill/panel 受控例外）、
  box-shadow ≤4、散落颜色字面量 0（兼容块 ≤12 且独立计数）、padding ≤12、gap ≤8、`!important` 0。
- `--gate=ia`：目标只渲染 1 次；`goSection` 必须滚动/聚焦；所有栏目共用同一路由与状态合同。
- `npm run check` 全绿；截图矩阵 320/375/560/850/1440 × 明暗 × 中英 × 六状态；滚动探针与 a11y 证据入
  `.tmp/gui-acceptance/`；发布截图只用合成数据。
- 证据按 CI / local / manual 标注；人工验收覆盖 W1–W5 后才进入发布流程。

## 6. 非目标

- 不改变 record schema、迁移、Host service、Remote/wire、prompt 投影、模型能力与兼容声明。
- 不引入 UI 框架、网络字体/图片、CDN、第二条 React。
- 不为“看起来像大版本”添加无必要的新 domain 或新能力。
- 不在人工验收前推送、合并、tag、release、publish 或宣称 0.3.0 可用。
