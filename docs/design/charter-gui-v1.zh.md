# `dsh-charter` 0.3.0 GUI 全面重构方案（所有栏目统一）

> **状态：** `Active` —— 0.3.0 开发范围与设计权威（W0–W6 源码实现完成，人工验收待完成）。未发布；人工验收
> 通过前不得声称 0.3.0 可用或已发布，不得推送开发分支。
> **版本范围：** `0.3.0`（W0–W6，所有栏目统一重构；纯客户端，不改 record/Remote/prompt/模型能力；仅做 DSH 版本声明维护，见 §2）。
> 版本决策见 §2.1。
> **基准：** 2026-11-12，基于已发布 `0.2.2` 发布树（client 源码最后变更 `f9d93c0`，发布证据见
> [0.2.2 发布说明](../release-notes/0.2.2.md)）。本文所有度量均在 `main` @ `433bdce` 的工作树上重测。
> **权威边界：** 版本范围由[版本路线](version-roadmap.zh.md)决定；产品不变量由
> [v1 核心设计](charter-design-v1.zh.md)决定；Workspace/Proposal/依赖语义由
> [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md) §5、§6 决定。本文只细化 GUI 呈现、交互状态与验证证据；
> 与权威文档冲突时先修订权威文档。
> **视觉权威：** 2026-11-12 评审通过的高保真冻结稿 [docs/design/mockups/](mockups/README.md)（文档感方向）
> 是本文 §4.9/§5.7 的视觉基准；实现与验收以稿子对照为准，视觉调整必须先修订稿子与对应条文。
> **替代/被替代：** 无 / 无。
> **专题范围：** Pane 视觉设计系统、信息架构呈现、交互状态、响应式与可访问性、GUI 证据门禁。不涉及
> record schema、迁移、Host service、Remote/wire、prompt 投影、模型工具面；DSH 兼容维护仅限版本声明，见 §2。
> **调研快照：** 2026-11-11；宿主 DSH `0.2.2-rc.1` 的设计 token 事实与社区插件/skill 榜单见附录 A–C。
> **评审修订：** 2026-11-11 独立评审的 4 个 P1、11 个 P2 与 2 个外围修正已全部并入（见附录 E）。
> **执行边界：** 本地分支 `feat/0.3.0-gui`（未推送）；人工验收前不合并 `main`、不 tag/release/publish、
> 不声称 0.3.0 可用或已发布。

## 0. 摘要

0.2.2 的 Pane 不是“配色不好看”，而是三个叠加的问题：

1. **骨架问题**：目标被渲染两次、预算出现 5 类重复表达、Workspace 10–11 个同权重块平铺，主阅读任务
   （目标 → 硬约束 → 交付物 → 阻塞原因）没有视觉优先。
2. **导航问题**：三个一级区域只有“区域”没有“模块路由”；区内所有 section 同屏渲染，`section` 状态变化不
   改变内容，所有“打开”动作都不滚动、不聚焦，等于死导航。
3. **设计系统问题**：Pane 自建了 18 种字号、9 种圆角、12 种阴影、71 个颜色字面量；宿主已经把完整的
   `--dsw-*` token 合约（0.2.2-rc.1 共 414 个）交给插件，但 Pane 没有使用宿主的位置尺寸/层级/焦点 token，
   因此不会跟随 DSH 字体偏好与主题层（如 dsh-livery）变化。

本方案不修修补补，而是**三层重做**：

- **设计系统层**：字号/字重/行高/颜色/圆角/阴影/焦点/控件尺寸全部收敛到宿主 token 与宿主既有的
  13/14px UI 规范；自定义值只允许出现在“插件局部语义别名”和宿主没有 token 的间距档位上。
- **信息架构层**：Workspace 改为文档流（目标唯一、条目按时序、预算只留必要处），区内导航变成真实锚点
  （滚动 + 焦点 + `aria-current`），脏态才出现吸顶操作条；Review/Diagnostics 按“待处理优先”排序。
- **证据层**：以可重复的度量脚本 + 真实浏览器截图矩阵 + DOM/可访问性检查替代“看起来还行”的验收，并把
  截图、README、verification 与版本元数据同批更新。

**版本决策：`0.3.0`（所有栏目统一重构，W0–W6）**。纯客户端、不触碰契约；Workspace、Review Center、
Diagnostics & Maintenance 全部迁移到同一设计系统与交互合同；W5 的三栏/Change Set rail/sheet 与 Pane/store
拆分进入 0.3.0 范围。0.3.0 是开发目标版本，人工验收通过前不推送、不合并、不发布、不声称可用。

### 0.1 关键数字（基线 → 目标）

| 指标 | 0.2.2 实测基线 | 目标 |
| --- | --- | ---: |
| `font-size` 声明 / 不同值 | 108 处 / 18 种 | ≤ 7 个 UI 字号值（来自宿主 8 个 `--dsw-font-*` shorthand）+ 1 个动态内容字号（见 §4.2） |
| `font-weight` 不同值 | 6 种（400/500/550/600/650/700） | 3 种（400/500/600） |
| `border-radius` 声明 / 不同值 | 61 处 / 9 种 | ≤ 4 个值：sm/md/lg + pill（`--dsw-radius-panel` 仅 W5 浮层，见 §4.4） |
| `box-shadow` 声明 / 不同值 | 15 处 / 12 种 | 4 个宿主 elevation token |
| 颜色字面量 | 71 个 hex + 12 处 rgb/rgba 兜底 | 散落字面量 = 0；旧版兼容块单独计数且 ≤ 12 条（见 §8.2） |
| `padding`（含长写）/ `gap` 不同值 | 45 / 23 | ≤ 12 / ≤ 8 档 |
| `height` / `min-height` 不同值 | 37 | ≤ 8 档（28/32/34/36/40 + 图形区） |
| 宿主变量 | 21 个（17 个 `--dsw`、3 个 `--ds`、1 个运行时 `--dsh`） | 只用宿主 token；插件局部别名收敛为 1 层 |
| 容器最大宽度 | 1100px | 960px（阅读列 680–760） |
| `!important` | 1 处 | 0 |
| Workspace 同权重兄弟块 | 10–11 | ≤ 6 |
| 目标重复渲染 | 2 次 | 1 次 |
| 全局预算表达 | 5 类 | 2 类（header meter + Change Set 摘要；字段级计数保留，见 §5.2） |
| 死导航动作 | 4+ 处 | 0（全部可滚动/聚焦或删除） |
| 常驻操作条 | 恒驻 3 行 | 仅脏态/重放态吸顶 |

## 1. 基线证据（0.2.2 发布树）

### 1.1 Pane 结构与真实可用宽度

- Pane 通过 `conversation.view` 注册，在宿主 tab 行下占整个阅读面；宿主不提供内边距。**W0 运行时探针
  结论（2026-11-12，DSH Web 0.2.2-rc.1 / Chrome 157）**：宿主 `.kiGsTW_scrollBody`
  （`[data-conversation-scroll]`）才是滚动容器（clientH 824 / scrollH 1533–2149，1440/850/375 三档一致）；
  `.charter-root` 随内容增高（1533/1807/2149），自身不滚动；Composer 座位在契约视图下为 `display:none`，
  切回对话视图为 `display:flex`（170px）。因此**采用回退 A（宿主拥有滚动），Pane 保持文档流，不自建
  内层滚动**。
- **Sticky 失效根因（已实测）**：`.charter-root{overflow-x:hidden}` 使 root 成为 `overflow-y:auto` 的滚动
  容器，吸顶 actionbar/nav 在宿主滚动 500px 后分别掉到 top=-298/-232；把 root 改为 `overflow-x:clip`
  （或 `visible`）后 actionbar 稳定在 top=76、nav top=136，且无横向溢出（scrollWidth == clientWidth）。
- 当前实现：`.charter-root` 只有 `min-height:100%` 与 `overflow-x:hidden`，没有自己的滚动容器；外层
  `.charter-shell` 用 `max-width:1100px` 和内边距承担布局（[charter.css:35](../../src/client/charter.css)）。
- 受影响场景：窄屏下无自身滚动的 View 在 Composer overlay 时可能被宿主裁切；同时 1100px 比宿主管理页的
  960px 宽，内容行长超过可读范围。
- 真实宽度：桌面端 `conversation.view` 常见 700–900px（0.2.2 发布截图 `docs/assets/charter-pane.zh.png`
  的面板约 850px）；`@container (max-width: 880px)` 触发后左侧 172px 导航消失
  （[charter.css:1634](../../src/client/charter.css)）。**多数用户看不到设计稿里的左侧导航。**
- **待验证假设**：滚动所有权依赖宿主客户端实现（调研快照）。W0 必须做运行时探针；若宿主自己提供有界滚动
  容器，则采用 §4.1 回退方案 A（文档流，不自建滚动）。W0 退出前冻结结论，W1 不得在未冻结时按主方案合入。

### 1.2 信息架构：重复与同权

- 目标渲染两次：[CharterPane.tsx:1942](../../src/client/CharterPane.tsx) 与
  [:2028](../../src/client/CharterPane.tsx) 是两张同内容 objective 卡。
- 预算重复：header meter（[:1627](../../src/client/CharterPane.tsx)）、actionbar hint
  （[:1725](../../src/client/CharterPane.tsx)）、changeset 摘要（[:1855](../../src/client/CharterPane.tsx)）、
  overview 预算卡（[:2008](../../src/client/CharterPane.tsx)）、字段计数器
  （[:1952](../../src/client/CharterPane.tsx)、[:2122](../../src/client/CharterPane.tsx)）。
- Workspace 兄弟块：changeset、bootstrap callout、empty state、objective A、overview 双统计卡、
  budget card、objective B、invariants、dependency section、deliverables，共 10–11 块，全部 `.charter-card`
  同权重（[charter.css:190](../../src/client/charter.css)）。
- 类名漂移：`.charter-section`、`.charter-budgetcard` 在 CSS 中没有规则（grep 为 0），层级完全靠同质化
  `.charter-card` 与 10.5px kicker 表达。

### 1.3 导航与滚动路由：区内导航是死路

- `area` 只把 `section` 投影成 3 个值（[:1269](../../src/client/CharterPane.tsx)）；Workspace 内
  `overview/objective/invariants/deliverables` 全部渲染同一批内容（[:1846](../../src/client/CharterPane.tsx)
  起）；`section` 变化不改变可见内容。
- `goSection` 只调用 `draft.setSection`（[:1274](../../src/client/CharterPane.tsx)），**没有 scroll/focus**。
  因此 `[打开]`（[:1964](../../src/client/CharterPane.tsx)）、统计卡（[:1980](../../src/client/CharterPane.tsx)、
  [:1992](../../src/client/CharterPane.tsx)）在视觉上都是 no-op。
- 跨区跳转同样丢失目标：`[预览上下文]` 切到 diagnostics（[:1730](../../src/client/CharterPane.tsx)），
  但上下文预览卡在 diagnostics 页面末尾（[:3398](../../src/client/CharterPane.tsx)），用户落在页首。
- 吸顶偏移是魔法数字：`.charter-nav{top:60px}`（[charter.css:967](../../src/client/charter.css)）依赖
  actionbar 的高度；actionbar 高度会随状态文案变化。

### 1.4 字体与排版：18 种字号撑不起层级

实测（`src/client/charter.css`，2026-11-11）：

| 项 | 基线 |
| --- | --- |
| `font-size` 声明 | 108 处 |
| 不同字号值 | 18 种：13 个 px 值（10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 15 / 18 / 20 / 22）+ 1 个宿主变量 + 4 个相对单位（1rem、0.625em、0.6875em、0.78em） |
| `font-weight` | 400 / 500 / 550 / 600 / 650 / 700（550、650 为非标准档） |
| `line-height` | 10 种不同值 |
| 根字号 | `var(--dsh-content-font-size, 13px)`（[charter.css:23](../../src/client/charter.css)）；宿主默认 14px，用户可设 10–22px |
| kicker | 10.5px / 650 / `uppercase` / `letter-spacing:.075em`（[charter.css:81](../../src/client/charter.css)），用于中文标签 |

后果：用户调整 DSH 字号偏好时 Pane 不跟随；CJK 标签被 uppercase/字距处理成“装饰性微字”，承担了过高比例的
视觉层级；0.5px 级字号差无法形成可感知的层级。

### 1.5 颜色、圆角、阴影、间距：宿主 token 没用到位

| 项 | 基线 |
| --- | --- |
| 宿主变量引用 | 21 个：17 个 `--dsw-*`（全部在 0.2.2-rc.1 token 合约中）、3 个 `--ds-*`（宿主 base.css 真实 token，但不在 `--dsw` 合约清单）、1 个运行时 `--dsh-content-font-size` |
| 颜色字面量 | 71 个 hex（#777×27、#999×21、#666×3、#aaa×3、#fff×5、#000×5）与 12 处 rgb/rgba 兜底 |
| `border-radius` | 61 处 / 9 种值：2/5/6/7/8/10/50%/999/inherit；宿主只有 4/8/12/16/20/28 六档 |
| `box-shadow` | 15 处 / 12 种值；宿主有 5 个 elevation token + 4 个 shadow token |
| 控件尺寸 | 23/26/27/28/30/32/34/36/44px 混杂；宿主按钮为 28（sm）/36（md） |
| 间距 | 45 种 padding 值（含 `padding-*` 长写；W0 脚本固化口径）、23 种 gap；宿主没有 spacing token，但官方组件用约 12 档字面值 |
| 动效 | 10 处 transition、9 组时长/缓动；宿主只有 3 个 duration token |

**合约核对（纠正一次常见误判）**：Pane 用到的 17 个 `--dsw-*` token 在 0.2.2-rc.1 全部存在；3 个 `--ds-*`
是宿主 base.css 的真实 token，只是不在 `--dsw` 合约清单；`--dsh-content-font-size` 是宿主运行时变量。
本轮不存在“6 个 token 家族不存在”的问题。真正的问题是：**没有使用宿主的 radius/elevation/focus/type token**，
并且用字面量兜底代替了 token。

### 1.6 状态、空态与可访问性

- 空态仍渲染 10+ 个零值块；切换加载态只有 260px 居中一行，随后整页跳动
  （[charter.css:808](../../src/client/charter.css)）。
- 最多 7 条 notice 可堆叠在内容之前（[:1650](../../src/client/CharterPane.tsx) 起），无优先级合并。
- disabled primary 从实心变描边（[charter.css:640](../../src/client/charter.css)），视觉权重跳变；尺寸与
  1px 边框不变（不是几何跳动）。
- 可访问性：根节点为 `<main>`（[:1605](../../src/client/CharterPane.tsx)）；`<footer>` 位于 `<nav>` 之前
  （[:1702](../../src/client/CharterPane.tsx)、[:1817](../../src/client/CharterPane.tsx)）；标题从 `h2` 起步；
  导航项、预览切换、历史开关、图形工具栏缺少 `:focus-visible`；帮助 tooltip 仅 hover 的 `::after`
  （[charter.css:1097](../../src/client/charter.css)），键盘/触屏拿不到可见帮助。

### 1.7 设计文档偏差

[v1 设计](charter-design-v1.md) §9.2 已承诺“语义 token 视觉语言 + 8px 间距节奏”
（[charter-design-v1.md:397](../design/charter-design-v1.md)），[workspace v2](charter-workspace-v2.zh.md)
已承诺三区域与 Change Set。实现一路漂移，原因是**没有可执行的度量/证据门禁**，不是缺少设计意图。

### 1.8 度量方法（可重复）

基线由下列检查得到（W0 会固化为 `scripts/verify/ui-metrics.mjs`）：

- `grep -o 'font-size\s*:' src/client/charter.css | wc -l` 与去重后的值集合；
- 同理统计 `border-radius` / `box-shadow` / `padding`（含长写）/ `gap` / `height` / `transition`；
  统计口径由 W0 的 `scripts/verify/ui-metrics.mjs` 固化，本文数字与脚本一致。
- 用正则提取 `var(--[a-z0-9-]+)` 并与宿主 token 合约比对；
- 统计 `CharterPane.tsx` 中 `area ===`、`section ===`、`goSection(` 的分布；
- 真实宽度截图在 §8.3 的矩阵中人工/脚本采集。

## 2. 版本归属与决策记录

GUI 全面重构**不改变 record schema、迁移、Host service、Remote/wire、prompt 投影与模型能力。
本分支同时包含一项**仅声明层**的 DSH 兼容维护：补齐 `0.2.2-rc.2` 的 engines/peer/`dshReleases`
精确声明，并把 `engines.dsh` 收敛为有界 0.2 线范围；不改任何 DSH ABI、wire 或 record，论证与矩阵见
[compatibility.zh.md](compatibility.zh.md)。

### 2.1 D0：目标版本 `0.3.0`，范围 W0–W6（所有栏目统一重构）

- 版本号：`0.3.0`（开发目标；普通递增，不使用 `rc` 后缀）。
- 范围：Workspace、Review Center、Diagnostics & Maintenance **所有栏目**统一迁移到同一设计系统与交互合同；
  设计 token 化、真实路由/滚动/焦点、Change Set 合同、Pane/store 拆分、DOM/浏览器可访问性与截图证据。
- 不做：0.2.3 单发、0.2.3+0.3.0 两段式（均不再作为实施路径）。
- 状态：W0–W6 完成，用户已验收；`0.3.0` 已从 `main` 发布，tag/GitHub Release/npm 均已生效。

### 2.2 D0b：Change Set 呈现路径

采用 [workspace-v2](charter-workspace-v2.zh.md) §5.1/§5.2/§5.7 的**最小合同**：桌面为有名称 complementary
region，窄屏为 modal bottom sheet（focus trap/Escape/focus restore/in-flight 写锁）；W5 完成完整 rail/sheet。
不修订 v2；若实现中出现无法满足合同的偏差，先修订 v2 再改实现。

### 2.3 D1：布局终态

窄屏（≤560 / ≤879px）使用 A-lite 文档流；宽屏（≥1100px）在 W5 落地三栏 + Change Set rail/sheet。所有栏目
共用同一套 token、组件、键盘与状态合同，不允许某栏目保留旧样式或旧交互。

### 2.4 硬执行边界

1. 开发在本地 `feat/0.3.0-gui` 分支；人工验收前不推送、不合并 `main`。
2. 不 tag、不 GitHub Release、不 npm publish；不在 README/CHANGELOG/release notes 中写“0.3.0 已发布/可用”。
3. 证据先行：每阶段 `npm run check` + §8 证据；人工验收覆盖 W1–W6 后才进入发布流程。
4. 旧记录与 DSH ABI/wire 不变；本分支只做版本声明维护（rc.2 + 有界 engines 范围），兼容矩阵仍按 AGENTS.md 门禁执行，证据见 compatibility.zh.md。

### 2.5 备选方案（已否决，仅存档）

| 方案 | 结论 |
| --- | --- |
| 0.2.3 单版本（W0–W4） | 已否决；补丁位不承载跨栏目结构重构 |
| 0.3.0 但 W5 可选 | 已否决；0.3.0 按“所有栏目统一重构”收口，W5 属范围内 |
| 0.2.3 视觉层 + 0.3.0 收口 | 已否决；两次发布/两套证据成本高，边界易失守 |

## 3. 目标与原则

### 3.1 体验目标

- G1：打开 Pane 第一屏能回答“目标是什么、哪些硬约束、下一个交付物、是否被阻塞”。
- G2：任何“打开/跳转”都到达明确位置并聚焦对应标题；键盘可完成全部导航。
- G3：空、加载、脏、冲突、未知结果、离线六种状态各有唯一、清晰、不跳动的呈现。
- G4：窄屏（560–900px）是一等公民，宽屏（≥1100px）只做增强。

### 3.2 设计系统目标

- G5：Pane 的视觉参数全部来自宿主 token/官方组件数值；默认明暗主题、用户字体偏好、主题层插件
  （如 dsh-livery）自动生效。
- G6：不引入 UI 框架、不加载网络字体/图片资源；保持客户端单文件 factory 与宿主 React 模块表约束。
- G7：自定义只允许两类：①引用宿主 token 的插件局部语义别名（`--ch-*`）；②宿主没有 token 的间距/尺寸档位，
  且集中在一处定义。

### 3.3 原则

1. **文档不是仪表盘**：目标与条目按阅读顺序排版；统计只在真正回答问题时出现。
2. **一张卡只做一件事**：卡片只用于可交互容器（Change Set、编辑器、notice、图形区），纯展示用
   section + 发丝分隔线。
3. **层级靠尺寸阶与留白，不靠微字号**：能删的字号一律删。
4. **状态优先于装饰**：脏态/错误/未知结果必须在首屏可见；clean 状态不占常驻空间。
5. **证据可重复**：任何“更好了”的结论都要有度量或截图支撑。
6. **全栏目统一**：Workspace / Review Center / Diagnostics 共用同一套 token、组件、键盘与状态合同；不允许
   某栏目保留旧样式或旧交互。

## 4. 目标设计系统规格

### 4.1 画布、滚动与宽度

尺寸常量集中声明（不允许散落魔法数字；来源见注释）：

```css
.charter-root {
  /* 布局常量：宿主没有 spacing/size token，故集中在插件局部别名中 */
  --ch-content-max: 960px;                          /* 宿主管理页 max-width */
  --ch-reading-max: 720px;                          /* 60–72ch 阅读列 */
  --ch-page-inset-top: 28px;                        /* 宿主管理页 top inset */
  --ch-page-gutter: clamp(16px, 4vw, 32px);
  --ch-page-bottom: 48px;
  --ch-actionbar-h: 48px;
  --ch-scroll-margin: calc(var(--ch-actionbar-h) + 16px); /* 64px 派生，禁止再写字面量 */

  display: block;                 /* W0 结论：宿主 scrollBody 拥有滚动，Pane 保持文档流 */
  overflow-x: clip;               /* 不创建滚动容器；禁止 overflow-x:hidden（会让 sticky 失效） */
  padding: var(--ch-page-inset-top) var(--ch-page-gutter) var(--ch-page-bottom);
  max-width: var(--ch-content-max);
  margin-inline: auto;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  container-type: inline-size;
}
```

- 宿主 `.kiGsTW_scrollBody` 是唯一滚动容器（W0 探针：clientH 824 / scrollH 1533–2149）；**不新建**
  `.charter-scroll`，不写 `height:100%` / `overflow:hidden`。
- 吸顶 actionbar/nav 以宿主 scrollBody 为滚动祖先；`scroll-margin-top: var(--ch-scroll-margin)` 让锚点落在
  吸顶条下方。
- 页首 `--ch-page-inset-top` 来自宿主管理页数值；页脚 `--ch-page-bottom` 替代 `clamp(72px, 12vh, 120px)`。
- **Composer 开合**：契约视图下 composer seat 由宿主隐藏（`display:none`），切回对话视图为 170px；Pane 不
  依赖 composer 高度，不为其预留滚动空间。
- W5 的三栏/Change Set rail 复用同一宿主滚动容器；rail/sheet 不得创建第二个纵向滚动条。

### 4.2 字体与排版

宿主 0.2.2-rc.1 提供 8 个 `--dsw-font-*` shorthand token，共 7 个不同字号值
（11/12/13/14/16/20/24；其中 16 有 24 与 28 两个行高变体），以及跟随用户设置的 markdown 内容阶。
Pane 只允许下列角色（`--ch-font-*` 是引用宿主 token 的局部别名）：

| 角色 | Token / 值 | 用途 |
| --- | --- | --- |
| 页面标题 | `--dsw-font-l-20`（20/28，500） | Pane 唯一 h1/h2 级标题 |
| Section 标题 | `--ch-font-section`（600 · 14/22，基于 `--dsw-font-s-14`） | 目标、硬约束、交付物、执行路径 |
| 正文 | `--dsw-font-xs-13`（13/20） | 条目、说明 |
| 元信息 | `--dsw-font-xxs-12`（12/18） | 字节数、时间、revision、计数 |
| Caption / badge | `--dsw-font-xxxs-11`（11/14） | 仅 badge、tooltip；不承载正式层级 |
| 用户手写内容 | `--dsw-font-markdown-base`（`--dsh-content-font-size`，默认 14） | 预览、objective 原文；必须跟随字号设置 |
| 代码 | `var(--ds-font-family-code)` | 预览/JSON |
| 字重 | 400 / 500 / 600 | 禁止 550/650/700 |
| 行高 | 用 token 自带 | 禁止逐元素写行高 |

局部字体别名（集中定义，不引入新字号值）：

```css
--ch-font-section: 600 var(--dsw-font-s-14-font-size) / var(--dsw-font-s-14-line-height) var(--dsw-font-family);
--ch-font-kicker: 600 var(--dsw-font-xxxs-11-font-size) / var(--dsw-font-xxxs-11-line-height) var(--dsw-font-family);
```

规则：

- UI 字号只允许 7 个不同值（8 个宿主 shorthand + 上列 2 个局部别名，不新增字号）；用户手写内容跟随
  `--dsh-content-font-size`（动态值，不计入 UI 字号门禁）；`10/10.5/11.5/12.5/13.5/15/18/22px` 与 `em/rem`
  混用全部删除。
- Kicker 使用 `--ch-font-kicker`（11/14，600），`letter-spacing:.02em`、无 uppercase，只在 section 边界出现。
- 根字号不写死：UI 文字按固定阶，用户内容按 `--dsh-content-font-size`；移除 `font-size: var(..., 13px)` 的
  错误兜底与“子元素写死 px”的组合。
- 正文测量宽度 60–72ch；长文本 `overflow-wrap: anywhere`。

### 4.3 颜色与主题

只使用语义 alias token（自动明暗翻转）：

| 用途 | Token |
| --- | --- |
| 画布 | `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1` |
| 抬升表面（卡片/编辑器） | `--dsw-alias-bg-layer-2` / `-3` |
| 发丝分隔线 | `var(--dsh-hairline-width, .5px) solid var(--dsw-alias-border-l2)` |
| 输入焦点边框 | `--dsw-alias-state-business-primary` |
| 主文字 / 次文字 / 弱文字 | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` |
| 反色文字（主按钮上） | `--dsw-alias-label-primary-foreground` |
| 主按钮 | `--dsw-alias-button-primary-fill` / `--dsw-alias-button-primary-hover` |
| Hover / Active 表面 | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-interactive-bg-active` |
| 错误 / 警告 / 成功 / 业务 | `--dsw-alias-state-error-primary` / `-warn-primary` / `-success-primary` / `-business-primary` |
| Focus ring | `var(--dsw-focus-ring-width) var(--dsw-focus-ring-color)` |
| 阴影 | `--dsw-elevation-soft` / `--dsw-elevation-panel` / `--dsw-elevation-prominent` |

规则：

- 删除全部 71 个 hex 与 12 处 rgba 兜底；只保留裸 `var()`。旧 DSH 版本缺 token 的兼容块见 §9.1，其字面量
  按 §8.2 的独立口径计数（不是散落 fallback）。
- 不写任何 `[data-ds-dark-theme]` 覆盖；不引用 `--dsw-alias-brand-primary-new-colorprimary-new-color`
  这类拼写异常 token。
- 允许的衍生色：`color-mix(in srgb, <alias token> N%, transparent)`，仅用于 tag/notice 的 8–12% 底色。
- 语义色只表达状态，不做装饰性品牌色块。

### 4.4 形状、层级、间距

| 项 | 规格 |
| --- | --- |
| 圆角 | `--dsw-radius-sm`(8) / `md`(12) / `lg`(16)；pill 999；`--dsw-radius-panel`(28) 仅 W5 浮层；不使用 xl(20)。非 pill 圆角值 ≤ 3；W1–W4 合计 ≤ 4（sm/md/lg + pill），W5 浮层追加 panel |
| 层级 | 卡片/列表只留发丝边 + 表面色；弹层用 `--dsw-elevation-panel/prominent`；禁止自写 12 种阴影 |
| 间距 | 2/4/6/8/12/16/20/24/32/48；section 内行距 8–12，section 间 24–32 |
| 控件高度 | 28（sm 按钮）/36（md 按钮）/34（输入框）/40（触屏/设置行） |
| 触屏 | `@media (pointer: coarse)` 下可点目标 ≥ 40px；图形区除外，但图形区 toolbar 也 ≥ 32 |
| 尺寸常量 | 页边距/顶距/吸顶高/滚动偏移/内容宽全部走 §4.1 的 `--ch-*` 命名常量；新增常量必须带来源注释 |

### 4.5 组件规格（与宿主官方一致）

- **Button**：`h36 / radius-md / padding 0 14 / 14px`；sm `h28 / radius-sm / padding 0 10 / 12px`；
  primary = `button-primary-fill` + `label-primary-foreground`；outline = 内嵌发丝 `border-l3`；
  ghost hover = `interactive-bg-hover`；disabled 保持形状 + `opacity:.4` + `not-allowed`。
- **Input / Textarea / Select**：`h34 / radius-md / .5px border-l4 / bg-layer-3 / 13px`；focus 边框
  `state-business-primary`；invalid `state-error-primary`；label 13/500，hint 12 `label-tertiary`。
- **Tag / Status**：`11/17 / radius 999 / padding 1px 8`；底色 `color-mix(state-primary 10–12%)`；状态圆点 7px。
- **UnderlineTabs（区域导航）**：`nav` + 按钮；`padding 10px 0 8px`，13/500；inactive `label-tertiary`，
  hover `label-secondary`；active `label-primary` + 2px `state-business-primary` 下划线（`aria-current="page"`）；
  Review badge 用 pill 计数（11/600，business 10% 底）。不使用 SegmentedTabs 箱式容器与大写 kicker。
- **Card**：只用于 Change Set / notice / 编辑器 / 图形区；`radius-lg + .5px border-l2 + bg-layer-1`，
  内部不再嵌套卡片；纯展示 section 用标题 + 行 + 发丝线。
- **Meter**：宽 128–160px、高 4px；`label-secondary` 文字、`state-*` 填色；配 `role="meter"` 与 aria 值。
- **Graph**：语义列继续是权威操作面；图形区只做增强；完整视觉规格见 §5.7（冻结稿
  [mockups/mockup-graph.html](mockups/mockup-graph.html)）；窄屏默认折叠为 disclosure。
- **Notification**：单条内联区（dot + 文本 + 可选详情折叠），按 error > warning > info 去重；不再堆叠 7 条。

### 4.6 动效与反馈

- 只有一种 transition：`var(--ds-transition-duration) var(--ds-ease-in-out)`；禁止逐组件自定义时长。
- `prefers-reduced-motion` 下全部关闭；不引入关键帧装饰动画。
- 保存/应用/连接状态用文本 + 圆点表达，不依赖颜色单独传达。

### 4.7 响应式断点

| 容器宽度 | 布局 |
| --- | --- |
| ≤ 560px | 顶部下划线 tabs + 单列文档流；操作条可换行；触控 ≥ 40px |
| 561–879px | 顶部下划线 tabs + 单列文档流（阅读列 720 不受侧栏挤压） |
| 880–1099px | 顶部下划线 tabs + 单列容器 960，阅读列 720 居中 |
| ≥ 1100px | 顶部下划线 tabs + 文档列 720 + 右侧 Change Set rail 280（gap 48，容器 1080）；**无左侧纵向导航** |

同时要求：320px 可用（无横向滚动）、200% 文本缩放不破版、forced-colors 下边界仍可见、reduced-motion 下无动效。

### 4.8 可访问性基线

- 不用嵌套 `<main>`：Pane 根节点改为 `<section aria-label="会话契约">`（宿主已有 main）。
- 标题层级：页面标题 `h2`，section `h3`，子块 `h4`；每个 section 用 `aria-labelledby`。
- DOM 顺序 = 视觉顺序：操作条在内容之后。区域导航使用 `<nav aria-label>` + 三个按钮，按钮以
  `aria-current="page"` 标记当前区域，并 `aria-describedby` 关联帮助文本；**不使用 ARIA tablist**。
  理由：三个区域是真实路由/焦点跳转，不是同一 tabpanel 的显隐切换；[workspace-v2 §5.7](charter-workspace-v2.zh.md)
  的“路由链接等价”路径允许这种语义。键盘为 Tab 聚焦 + Enter/Space 激活，不要求左右方向键。
- 所有可交互元素有 `:focus-visible`；跳转后把焦点移到目标标题（`tabindex=-1`）；提供 skip link 到内容。
- 帮助文本不只依赖 hover：改为可聚焦的 popover 或常驻 hint。
- 对比度：正文 ≥ 4.5:1，非文本 ≥ 3:1；不依赖颜色单独传达状态。
- Change Set 窄屏 sheet：modal dialog 语义、focus trap、Escape 关闭、opener focus restore；
  in-flight/unknown 时写锁优先于 Escape（[workspace-v2 §5.7](charter-workspace-v2.zh.md)）。
- 真实浏览器键盘遍历 + 200% 缩放 + screen reader 人工抽查纳入 §8.5 证据。

### 4.9 视觉语言冻结（文档感，2026-11-12 评审通过）

本节规则由 [docs/design/mockups/](mockups/README.md) 的四份高保真稿冻结（`style-tile.html`、
`mockup-home-clean.html`、`mockup-home-dirty.html`、`mockup-graph.html`）；`mockup.css` 是参考实现，
W6 落地时按其合入 `charter.css`。实现与稿不一致时，要么修实现，要么先修订稿与本节，不允许静默漂移。

1. **文档感总原则**：Charter 是一份可读契约文档。层级由尺寸阶 × 字重 × 留白承载；不靠边框、底色、
   kicker 微字制造视觉重量。
2. **容器规则**：卡片（`bg-layer-1` + 发丝 `border-l2` + `radius-lg`）只用于可交互容器——行内编辑器、
   Change Set 面板、notice、依赖图形区；纯展示内容（目标、硬约束、交付物、诊断行）一律
   section + 行 + 发丝线，不装箱。
3. **页头**：icon + “会话契约” h2（20/28）一行；右侧元信息 = 版本标识 chip（**已批准的冻结稿偏离**，用户 2026-11-12 明确要求保留）+ `rev N` + prompt meter（128px 轨道 +
   字节数，`role="meter"`），与标题同 28px 行盒基线对齐；slogan/免责声明不进首屏；页头下发丝线。
4. **区域导航**：所有宽度使用顶部下划线 tabs（规格见 §4.5 UnderlineTabs）；左侧纵向导航删除。
5. **Section 解剖**：标题行 = h3（14/22 600）+ 计数摘要（12px tertiary，如“3 条生效 · 1 条待审”）+
   右侧动作（`+ 添加` ghost sm / quietlink）；section 间 32px，标题到首行 4–8px。
6. **行解剖**：`grid [16px 圆点 | 1fr 文本 | auto 元信息]`；圆点 5px 对准 20px 行盒中线；元信息
   （字节数、D 编号）12px tertiary `tabular-nums` 右对齐，与正文首行同 20px 行盒 → 基线天然对齐；
   行间发丝 `border-l1`；行 hover `bg-layer-1`。
7. **目标**：文档 lead 段落——用户内容字号（`--dsh-content-font-size`）× 1.7 行高，无盒子；
   “初始目标”“编辑”放 section 标题行右侧（quietlink + ghost sm）。
8. **暂存语言**：暂存行 = 左侧 inset 2px business 强调条 + 5% `color-mix` 底 + “已暂存” chip；暂存
   objective 同语言。只表达“未提交”，不改变 review/lifecycle 语义。
9. **chip 规格**：11/14、pill、padding 2px 8px、底色 `color-mix(state 10–12%)` + 6px 同色圆点；
   未开始/进行中/已完成/受阻/冲突用语义色；关系（依赖 D1）与来源（待审 · 消息提案）用 outline 发丝 chip。
10. **quietlink**：行级轻动作（撤销、初始目标、展开依赖图）用点状下划线文本链接，不用按钮。
11. **吸顶操作条**（仅 dirty/replay/conflict/unknown）：48px（`--ch-actionbar-h`），`bg-layer-1` +
    `elevation-soft` + 底部发丝线；左 = 状态点 + 计数 + 一句 hint，右 = ghost/ghost/primary sm 按钮组，
    单行盒垂直居中。
12. **Change Set rail**（≥1100，280px，sticky）：安静 margin note——标题 + 计数 pill、摘要 `dl`
    （Prompt 字节/条目，12px tabular）、分组 op 行（类别标签 11/600 tertiary + before→after 12px +
    quietlink 撤销）、底部一句 hint；不是重卡片。窄屏 sheet 沿用同一内容解剖。
13. **空态**：一行 36px 虚线“+ 添加”行；不渲染嵌套卡片与常驻编辑器。加载 = 3 行 skeleton
    （`bg-skeleton`，40/16/16）。
14. **notice**：单条内联（7px 语义色点 + 文本 + 可选详情），8% 语义色底 + `radius-md`；不堆叠。
15. **宽度**：阅读列 720（`--ch-reading-max`）居中；单列容器 960；rail 模式容器 1080
    （720 + 48 gap + 280 rail，`--ch-rail-w`/`--ch-rail-gap`/`--ch-rail-layout-max`）。

## 5. 信息架构与交互重构

### 5.1 区域模型

保持 v2 的三个一级区域，但**区内必须有模块路由**：

| 区域 | 内容 | 主要动作 |
| --- | --- | --- |
| Workspace | 目标、硬约束、交付物（进度/依赖）、执行路径、阻塞原因 | 编辑、暂存、Apply |
| Review Center | pending 批次、审阅时间线、inactive/rejected/archive | 接受/拒绝、查看来源 |
| Diagnostics & Maintenance | 上下文预算、来源完整性、记录健康、导出/恢复 | 预览、导出、恢复 |

Change Set 按 [workspace-v2](charter-workspace-v2.zh.md) §5.6/§5.7 实现：**W2 即交付最小合同**——桌面是
有名称的 complementary region（右侧栏，仅脏态出现），窄屏是 modal bottom sheet（focus trap、Escape 关闭、
opener focus restore；in-flight/unknown 时不可绕过确认或写锁）。Workspace 顶部只保留一行“N 项待应用”入口
摘要，它不是 Change Set 面板本体，也不承载 before→after。W5 增强为完整 rail/sheet（分组、逐项撤销、
canonical diff、reconcile 状态）。若 D0 选择改为内联卡片，则必须先修订 v2 §5.1/§5.2/§5.7 并给出等价论证，
且该修订是 W2 的前置条件（§2）。冻结稿 [mockup-home-dirty.html](mockups/mockup-home-dirty.html) 细化该合同
的视觉构成：吸顶操作条与 rail 解剖按 §4.9 规则 11/12 执行。

### 5.2 Workspace 文档流（替代 10 卡平铺）

```text
[页面头] 会话契约   rev 7 · 5.0 KiB / 8.0 KiB    [状态：已保存 / 2 项待应用]
──────────────────────────────────────────────────────────────
目标                                         [编辑]
交付一个持久、用户所有、可审计的会话契约。
──────────────────────────────────────────────────────────────
硬约束 (3)                                  [+ 添加]
· 交付前运行源码检查、十版本兼容矩阵和候选 artifact 验证。      12 B
· 用户正式进入 user role，模型只读……                            18 B
──────────────────────────────────────────────────────────────
交付物 (2)                                  [+ 添加]
· 依赖关系图视图……   进行中 · 依赖 D1                         86 B
──────────────────────────────────────────────────────────────
执行路径  [展开依赖图 / 收起依赖图]
目标 ← 硬约束 → 交付物 D1 → D2
──────────────────────────────────────────────────────────────
阻塞原因（仅在有阻塞时出现）
· D2 的候选 artifact 尚未生成 → 先完成 D1
```

- 目标只出现一次（删除 objective 卡 A）；**全局预算**只在页面头 meter 与 Change Set 摘要出现；条目行内字节数
  属于字段级计数器（保留，不计入“预算表达”门禁，见 §0.1/§8.2）。
- 脏态时页面头出现一行“N 项待应用”入口（打开 §5.1 的 Change Set region），不在文档流里重复 before→after。
- 统计卡删除；数量放 section 标题（如“硬约束 (3)”）。需要跨区信息时用 header 摘要，不再用统计卡。
- 空态：只渲染一个 empty-state 卡 + “设置目标 / 添加硬约束”两个主操作；不渲染零值块。
- 依赖图默认折叠为“执行路径”disclosure；语义列表始终可见（保持 v2 §5.7 的权威操作面）。

本节 ASCII 示意只保留结构意图；视觉构成以冻结稿 [mockup-home-clean.html](mockups/mockup-home-clean.html)
为准（页头、下划线 tabs、行解剖、chip、quietlink、空态按 §4.9 执行）。

### 5.3 真实导航与滚动路由

- 每个 section 加稳定 `id`（`charter-objective` 等）与 `scroll-margin-top: var(--ch-scroll-margin)`（由吸顶高
  + 16px 派生，不写字面量 64px）。
- 锚点/跳转挂在 W0 冻结的滚动容器上（Pane 内层或宿主 `scrollBody`），不得写死 `window`。
- `goSection(section)` 除写 store 外，必须滚动到目标并聚焦其标题；跨区跳转先切 area，再在布局完成后
  滚动/聚焦（使用 `requestAnimationFrame` 或 effect）。
- `[预览上下文]` 指向 `#charter-context-preview`；`[查看历史草案]` 指向 `#charter-review-pending`。
- 删除所有 no-op “打开”：要么改为真锚点/真路由，要么删除文案。
- 保留 `section` 持久化（draft-store 现行为不变），但把“当前可视模块”与“最后位置”分开记录，避免切 tab
  后回到错误位置。

### 5.4 状态可见性

| 状态 | 呈现 |
| --- | --- |
| clean | 页面头右侧小字“已保存 · rev N”；无吸顶操作条 |
| dirty | 吸顶 `var(--ch-actionbar-h)`（48px）操作条：状态点 + “N 项待应用” + [预览][丢弃][应用]；只在此状态出现 |
| replay pending | 吸顶条替换为“正在重试/等待服务端确认” + 重试入口 |
| conflict | 首屏 notice + rebase 动作；Change Set 保留并重新计算 diff |
| unknown outcome | 吸顶条持续显示“结果未知”，只允许 Retry / 显式 Abandon |
| offline/reconnecting | 顶部单条 notice；恢复后自动消失 |

- disabled 的 Apply 必须在按钮旁显示**首要原因**（editor 未关闭、预算超限、revision conflict、只读等），
  不靠 tooltip 隐藏。
- 加载态：3 行 skeleton（44/16/16），避免整页跳动；bootstrap 检查中同理。

### 5.5 Review Center 与 Diagnostics

- Review Center 顺序改为 **pending 批次 → 审阅时间线 → inactive/rejected/archive → 已应用历史**；
  空态显示“没有待审阅内容”+ 已应用计数 + 返回 Workspace 的链接。
- 消息提案表单默认折叠，不在页面顶部占据首屏；有 pending 时才展开。
- Diagnostics：记录健康/来源完整性在前，validator 与证据其次，**Context Preview 提到诊断页顶部或作为固定
  anchor**，导出/恢复与本地导入放最后的 disclosure。

### 5.6 i18n 与文案

- 所有新文案进 `locales.ts` 的同一命名空间，中英同步；禁止硬编码中文。
- rail、inspector、图形工具条与节点脚注不得出现原始枚举/op 类型串（如 `in-progress`、`accept`、
  `verification.set`），一律走 `t()`；现有 `progress.*`、`changeset.op.*` key 复用。
- 页面头保留版本 chip、revision 与预算 meter；slogan/免责声明移入空态或帮助 popover，降低首屏噪声。
- 计数、revision、字节数使用 `Intl` 或现有格式化函数，保持 `tabular-nums`。

### 5.7 依赖关系图视觉规格（冻结，稿：mockup-graph.html）

图形区在“执行路径”disclosure 内，属可交互容器，允许卡片（§4.9 规则 2）。

- **卡片与工具条**：`graphcard`（`bg-layer-1` + 发丝 `border-l2` + `radius-lg`）；工具条单行 =
  标题（14/22 600）+ 焦点 select（sm，h28）+ 候选/历史开关（checkbox，12px）+ 缩放组
  （− / 百分比 / +，h28 发丝分组）。
- **画布**：`bg-base` 内嵌 + 发丝 `border-l1` + `radius-md`，min-height 360，overflow hidden；边用 SVG。
- **节点**：固定宽 184px、**全 px 几何**——节点尺寸不随用户字号设置缩放（这是对旧版 em 几何 × 固定 px
  字号失配导致文本裁切回归的修复；用户字号只影响语义列表）；解剖三层 = `[Dn key · 状态 chip] /
  正文 13/20 两行截断 + 完整 title / readiness 脚注 12px tertiary`；左侧 3px 状态强调条
  （done success / in-progress business / blocked warn / conflict error 且边框同色）；候选 = 虚线边框；
  暂存 = focus-ring outline；选中 = business 边框。
- **边状态语言**：实线 1.5px `label-tertiary` = 生效依赖（prerequisite → dependent 箭头）；
  2px business 虚线 = 已暂存新依赖（随 Change Set 原子提交）；点线 = 候选提案依赖（接受后生效）。
  画布底部一行静态 legend 说明三种边。
- **inspector**：画布下方一行式区域（顶部发丝分隔）：选中节点 `Dn + 正文 + 进度 chip` /
  依赖与被依赖 outline chips / 暂存变更 chip / 右侧 [编辑][+ 依赖] ghost sm。不使用重面板。
- **边界**：语义列表始终是权威操作面；<880px 图形区随 disclosure 默认折叠且不渲染画布；节点为
  button 语义可聚焦（`aria-current` 标记选中），画布 `role="img"` + 完整文本替代；拖拽仅是增强。

## 6. 实施阶段（W0–W6）

| 阶段 | 目标 | 主要变更 | 退出条件 |
| --- | --- | --- | --- |
| W0 设计冻结（1d） | 决策、探针与度量工具 | D0/D0b/D1 决策记录入 roadmap；建立本地 `feat/0.3.0-gui`（不推送）；**宿主滚动所有权运行时探针**（Web/Desktop × Composer 开合 × 375/850/1440）；token 覆盖审计与兼容块规则；`DESIGN.md`；`scripts/verify/ui-metrics.mjs`；截图基线 | 决策入 roadmap；分支建立；滚动所有权冻结；基线可一键复测 |
| W1 视觉基础层（1–2d） | 以 CSS 为主 + 最小 TSX 壳改动 | `charter.css` token 化：字号/字重/行高/颜色/圆角/阴影/控件；新增滚动容器与 landmark 修正（不改状态机/数据流）；去 `!important` | §0.1 指标达标；现有测试全绿；明暗可用；滚动行为符合 W0 冻结方案 |
| W2 IA 骨架（2–3d） | 去重、真实路由与 Change Set 最小合同 | 删除重复 objective；section id/滚动/聚焦；脏态操作条；预算收敛；空态折叠；Workspace 文档流；桌面 Change Set complementary region + 窄屏 modal bottom sheet（v2 §5.7） | 目标唯一；无死导航；DOM 测试覆盖路由；Change Set 合同通过；窄屏截图通过 |
| W3 Review/状态收口（1d） | 次级区域与状态机 | Review 顺序、Diagnostics 预览锚点、notice 去重、skeleton、disabled 视觉权重、a11y 语义 | 六种状态各有唯一呈现；键盘遍历无死角 |
| W4 证据与发布（1–1.5d） | 可验收 | 截图矩阵（含 320）、滚动/Change Set/a11y 证据、livery 主题抽查、README/截图/verification/CHANGELOG/release notes 同步 | §8 全部证据完成；发布门禁按 `docs/releasing.md` |
| W5 结构终态（2–3d，0.3.0 范围内） | 宽屏与结构收口 | 完整 Change Set rail/sheet 交互（视觉按 §4.9 冻结稿）、Pane/store 拆分、DOM/浏览器 a11y 门禁工具 ADR | W1–W4 证据通过后实施；与 W1–W4 同一个 0.3.0 分支/版本 |
| W6 视觉语言落地（2–3d） | 冻结稿对照实现 | 按 §4.9/§5.7 将 `mockups/mockup.css` 合入 `charter.css` 并调整页面组件：容器规则（纯展示去卡片）、行解剖与基线对齐、下划线 tabs（移除左侧纵向导航）、吸顶条/rail 构成、空态/skeleton、依赖图 px 几何重建与 inspector；rail/inspector 文案全部 `t()` | before/after × 冻结稿并排对照评审通过（明暗 × 320–1440）；`--gate=final` PASS；`npm run check` 全绿；用户字号 10/14/22 下图形无文本裁切 |

估计：W0–W6 合计 10–15 个工程日（不含人工验收等待；W2 因 Change Set 最小合同、W5 因 rail/sheet、
W6 因视觉落地增加），单分支、每阶段独立提交、`npm run check` 全绿才进入下一阶段。

**W0 进度（2026-11-12）**：本地分支 `feat/0.3.0-gui` 已建立（未推送）；`DESIGN.md` 与
`scripts/verify/ui-metrics.mjs` 已落盘；基线由 `npm run verify:ui-metrics` 生成并保存在
`.tmp/gui-baseline/`（本地证据，不随包发布）；**Web 滚动所有权探针已完成并冻结**（证据：
`.tmp/gui-acceptance/2026-11-12/`，结论见 §1.1/§4.1），采用回退 A（宿主滚动、Pane 文档流）。**Token 覆盖
审计已完成（2026-11-12）**：10 个声明 DSH 版本的 theme package 中，41 个静态 host token 均有定义，唯一动态
`--dsh-content-font-size` 已有 14px fallback，compat 块保持为空；`npm run check` 已包含 token gate。**待完成**：
Desktop 侧确认。W1 可开始，但不得新建内层滚动容器。

**W1 进度（2026-11-12）**：CSS token 层已完成并通过 `npm run verify:ui-metrics -- --gate=css`——
UI 字号 6 档、字重 3 档、非 token 圆角 0、非 token shadow 0、散落颜色字面量 0（compat 块 0）、
padding 10 档、gap 8 档、`!important` 0；根节点改为 `overflow-x:clip`，宿主滚动 + sticky 已实测。
`charter-token-compat` 有界块审计后保持为空（所有使用 token 在 10 个声明版本均存在）。证据：
`.tmp/gui-acceptance/2026-11-12/w1-ui-metrics.json` 与 `w1-*.png`。**待完成**：控件高度/间距的
人工视觉确认（W1 尚未验收完成，不得对外声称 GUI 已优化完成）。

**W2 进度（2026-11-12）**：W2 源码层完成并通过 `--gate=ia`——目标只渲染 1 次、旧
overview/stat/budget 标记为 0、`goSection` 真实滚动 + 聚焦标题、clean 状态不渲染操作条；Change Set v2
最小合同落地：桌面 named complementary region、窄屏 modal bottom sheet（focus trap / Escape / backdrop /
focus restore），面板含 ops、prompt/items delta 与依赖冲突摘要。新增 Change Set 测试，`npm run check`
476/476。**真实浏览器证据（2026-11-12）**：通过 CDP 将新构建的 `lib/client.js` 注入安装宿主（未替换磁盘
bundle）完成真实 DOM/截图验收——clean 无操作条、objective 单卡；dirty 显示桌面 complementary region；
850px 触发 modal sheet 且 Escape 后焦点回到触发按钮。证据：`.tmp/gui-acceptance/2026-11-12/w2-w3-browser-evidence.md`。
**待完成**：exact packed artifact 安装到隔离 profile（W4 门禁）、W2 人工验收。W3 可继续，但 W2 未验收前不得
对外声称 GUI 完成。

**W3 进度（2026-11-12，部分）**：Review Center 以 flex order 调整为 pending 批次 → pending proposals →
消息提案 → 历史草案 → 目标历史 → inactive/archive；Diagnostics 的 Context Preview 置顶并保留稳定锚点；
Workspace 顺序显式化为 objective → invariants → deliverables → execution path；加载态改为 3 行 skeleton；
disabled primary 保持填充形状 + opacity；Pane 根由嵌套 `<main>` 改为带 label 的 `<section>`，操作条改为
`role="group"`；补充通用 `:focus-visible`。`--gate=ia` 与 `npm run check` 通过（476/476）。**真实浏览器 a11y（2026-11-12）**：AX tree 显示 Pane 根为命名 region「契约」、无嵌套 main、无空名按钮，
窄屏 Change Set sheet 为命名 `role=dialog`；`nestedMains=0`、`rootTag=SECTION`、`rootLabel=契约`、Pane 内 10 个
focusable。导航 help 已改为独立的可聚焦 `?` 按钮（`aria-label` + `title` + `data-tooltip`），键盘/触屏
focus 均可显示帮助；**待完成**：200% zoom/forced-colors/reduced-motion 与完整键盘走查、AT 人工验收，以及
W3 人工验收。证据：`.tmp/gui-acceptance/2026-11-12/w3-a11y-summary.md`。**真实浏览器抽查（2026-11-12）**：Review `H2` 获得焦点、Diagnostics Context Preview `H3` 获得
焦点、Workspace objective `H3` 获得焦点，均触发真实 host scroll；dirty sheet 的 Escape/focus restore 已实测。
证据：`.tmp/gui-acceptance/2026-11-12/w2-w3-browser-evidence.md`、`w3-new-bundle-review-1440.png`。

**W4 进度（2026-11-12，部分）**：开发 artifact（W5 后曾打包为 `dsh-charter-0.2.2.tgz`，SHA-256 `67c3e005…`）
已按审查删除，避免与已发布不可变 0.2.2 同名冲突；最终开发候选 `0.3.0`（`package.json`/`src/version.ts` 均为
0.3.0，开发期构建）打包并部署到本地 `web` 与 `desktop` profile（node_modules 版本 0.3.0，client bundle 含 0.3.0）：Web 验收服务运行在 `http://127.0.0.1:52080/`，
Desktop 的 Pane 由 Host profile 重组 + client bundle HMR 热替换（2026-11-12 实测无需重启）；最终 0.3.0 已于 2026-11-13 正式发布。
exact artifact client 已通过 CDP 注入真实 Host 验证 Pane 与 Change Set rail；并完成 320/375/560/850/1440、
明/暗、forced-colors、reduced-motion、2x page-scale 的截图矩阵。**待完成**：fresh-profile Host+Session、Desktop
重启后的真实窗口、zh/en 切换、真实 AT 证据、README/verification 发布同步。

**W5 进度（2026-11-12）**：**页面级 Pane 拆分完成**——`WorkspacePage` / `ReviewCenterPage` / `DiagnosticsPage`
从 `CharterPane` 抽出（3459 → 1842 行），通过 typed `PaneScope` 接收页面状态；共享 UI/格式化抽到 `pane-ui` /
`pane-format`。同时完成视觉减负：平铺 section（去卡片堆叠）、删除重复 kicker/count/说明小字与目标免责声明、
移除行内字节数和重复进度标签、进度控件收敛为行尾单一 select、空态去虚线框、表单次级按钮按需出现。Change Set rail 的分组 / before→after / 单条撤销 / 桌面 complement + 窄屏 sheet 均已落地。
`npm run check` 492/492、`--gate=final` PASS；真实浏览器 v0.3.0 已验证三区域路由、objective 单卡和诊断
Context Preview。**剩余**：per-domain store 的细粒度拆分（当前以 `draft-store`、`change-set-model`、
`useChangeSetSheet`、`section-routing`、`page-order` 为 store 边界）与 W1–W6 人工验收。

## 7. 版本与发布策略

- **目标 `0.3.0`（D0 已定）**：纯客户端，无 record/Remote/prompt/ABI 变化；0.3.0 是开发目标，不是发布声明。
  人工验收通过前不推送、不合并、不 tag/publish；不提前写“0.3.0 已发布/可用”。
- 发布元数据仍按 AGENTS.md Lesson 4 的同一原子集合更新：`package.json` 版本、README/README.zh 的能力清单与
  截图、CHANGELOG/CHANGELOG.zh、`docs/release-notes/<version>.md`、docs 索引、`docs/verification*.md`、
  `SHA256SUMS`、artifact digest；本轮仅维护 DSH 版本声明（rc.2 + 有界 engines 范围），不改 ABI/wire；声明证据见 compatibility.zh.md。
- 兼容矩阵不豁免：发布前对全部声明版本与当前 untracked 版本跑
  `node scripts/verify/compat-matrix.mjs --versions all`。
- 截图与 README 从**验收通过的 exact build** 重新采集；不得复用未验收构建的截图。
- README/发布截图必须使用**合成演示数据**（无真实 Session 内容、用户名、路径或记录）；截图前清理 Host 信息。
- 不 push/tag/publish，除非收到明确发布指令；先 tag 后 npm 的顺序按 `docs/releasing.md`。

## 8. 验证与证据计划

### 8.1 源码门禁

- `npm ci && npm run check`（typecheck + build + remote/client smoke + Vitest + token gate）在最终树上通过。
- 新增/修改客户端测试：路由目标、焦点移动、去重后的 objective 只渲染一次、操作条仅脏态出现、
  空态折叠、notice 去重。
- CI 仍只承诺 `npm run check` + `npm run smoke:package`（Node 22.19.0/24）；不得把人工证据写成 CI 证据。

### 8.2 度量门禁

W0 固化 `scripts/verify/ui-metrics.mjs`，输出 §0.1 的指标；W1/W2/W4 各跑一次并把结果记入
`docs/verification*.md`。统计口径（脚本内固化，不允许人工改口径）：

- `padding` 统计包含 `padding-*` 长写（基线因此为 45 个不同值，而非仅 shorthand 的 44）；
- 颜色分两类：**token 派生**（`var(--dsw-*)`/`var(--ds-*)` 与基于它们的 `color-mix`）与**兼容块字面量**
  （仅允许出现在 `/* charter-token-compat:begin */ … /* charter-token-compat:end */` 包裹的
  `.charter-token-compat` 作用域内，每条必须注释缺失 token 与受影响 DSH 版本）。

目标阈值：

- UI 字号不同值 ≤ 7（`--dsh-content-font-size` 动态内容字号不计入）；字重 ≤ 3；非 pill 圆角值 ≤ 3
  （pill 999 与 W5 的 panel 28 为受控例外）；box-shadow 不同值 ≤ 4；`padding` ≤ 12、`gap` ≤ 8；
- 散落颜色字面量 = 0；兼容块字面量 ≤ 12 条且逐条标注（超出需 ADR）；
- `!important` = 0；目标渲染 1 次；Workspace 兄弟块 ≤ 6；死导航 = 0；clean 状态无吸顶条。

### 8.3 真实 UI 截图矩阵

| 维度 | 取值 |
| --- | --- |
| 宽度 | 320 / 375 / 560 / 850 / 1440（容器宽度，非浏览器窗口） |
| 主题 | light / dark；如本机装有主题层插件，额外抽查 2 个非默认主题 |
| 语言 | zh / en |
| 状态 | 空 Pane、已应用、脏 Change Set、review pending、冲突/错误、diagnostics |

证据保存在本机 `.tmp/gui-acceptance/<date>/`（不随包发布）；发布用主截图从验收构建重采后放
`docs/assets/`。每张截图记录构建 commit、DSH 版本、语言、主题、宽度。另需两类专项证据：

- **滚动所有权探针**：Web/Desktop × Composer 开合 × 375/850/1440 的 computed height/overflow、双滚动条、
  吸顶位置，结论与 §4.1 主方案/回退方案一致。
- **合成数据**：发布用截图只使用合成演示 Session；`.tmp/gui-acceptance/` 中的真实记录证据不得提交或外传。
- **冻结稿对照**：W6 完成后按 [docs/design/mockups/](mockups/README.md) 同宽度/主题/状态截图并排对照，
  差异逐条写入验收记录（允许实现细节微调，不允许视觉语言替换）。

### 8.4 可访问性证据

- 键盘：Tab 顺序、区域导航的 Enter/Space 激活、跳转后焦点、Change Set sheet 的 focus trap/Escape/
  focus restore、in-flight 写锁优先。
- DOM/AT：landmark、heading 层级、`aria-current="page"`、meter、live region。
- 200% 文本缩放、forced-colors、reduced-motion。
- 若引入浏览器自动化（Playwright/axe），先写 ADR 与依赖评估；最低要求是人工记录 + 可复现脚本。

### 8.5 主题与字体偏好证据

- 明暗两主题默认值；用户字号设置（10/14/22）下不破版；内容文字跟随、UI 文字保持固定阶。
- 主题层插件（如已安装的 dsh-livery）抽查：shape/typography 变化时 Pane 不应出现自写圆角/阴影的“钉子户”。

### 8.6 兼容与发布证据

- 十版本矩阵 + 当前 untracked `latest`/`next`（AGENTS.md 兼容门禁）。
- 精确 artifact、fresh profile、Desktop/Web UI、zh/en 切换、旧记录读取；按 `docs/verification.md` 标注
  CI / local / manual，不夸大覆盖范围。

## 9. 风险与回滚

### 9.1 旧 DSH 版本缺新 token

Pane 仍声明最低 `0.1.7-rc.2`。0.2.2-rc.1 的 token 合约不能假设旧版本全有。W0 审计已按 10 个声明版本完成
（2026-11-12）：用 `scripts/verify/token-coverage.mjs` 对 `scripts/verify/token-coverage.inventory.json` 与
CSS 实际使用的 host token 逐项比对；**41 个静态 host token 在全部 10 个版本的
`@deepseek-ai/dsh-client-ui-theme` 中均有定义**，唯一动态 token `--dsh-content-font-size` 已带 `14px` fallback。
因此 `charter-token-compat` 块保持为空（不是漏填），不再需要旧版 fallback 字面量；新增 host token 必须先更新
inventory 并让 `npm run check` 中的 token gate 通过。若未来某版本确实缺失，仍按原规则在有界块内集中定义、
逐条标注（字面量 ≤ 12 条、独立计数），不得用 `--legacy-peer-deps`/`--force` 掩盖。

### 9.2 大面积 CSS 改动的回归风险

- W1 以 CSS 为主，允许最小 TSX 壳改动（滚动容器、landmark；不改状态机/数据流/路由行为）；每步跑
  `npm run check` 与截图抽查。
- **宿主滚动合同风险**：W0 探针未通过时，W1 不得按 §4.1 主方案合入，先按 W0 冻结的回退方案实现；不得用
  “看起来没裁切”代替证据。
- 现有 37 文件/475 测试是回归基线；IA 变更（W2）必须补 DOM 断言。
- 若 W1 指标未达标或出现明暗/字体偏好回归，回滚该提交，不进入 W2。

### 9.3 IA 变更的可逆性

- 本方案不改 record/Remote/prompt，回滚只需回退客户端代码；旧记录仍可读。
- `section` 持久化语义不变；新增的滚动/焦点逻辑只影响客户端。
- W5 的 Pane/store 拆分在同一个 0.3.0 分支内以独立提交/可回滚开关实施，不与 W1–W4 混在同一提交；人工验收
  覆盖 W1–W6 后才算 0.3.0 GUI 完成。

## 10. 决策状态

| 编号 | 决策 | 状态 | 结论 |
| --- | --- | --- | --- |
| D0 | 目标版本 | **已决策** | `0.3.0`，W0–W6，所有栏目统一重构 |
| D0b | Change Set 呈现路径 | **已决策** | 实现 workspace-v2 §5.7 最小合同；W5 完整 rail/sheet；不修订 v2 |
| D1 | 布局终态 | **已决策**（2026-11-12 冻结稿修订） | 全宽度顶部下划线 tabs + 文档列 720；≥1100 加右侧 Change Set rail 280（容器 1080）；不做左侧三栏 |
| D2 | 旧 DSH 版 token 缺失策略 | **已决策**（2026-11-12） | 10 版本 token 覆盖审计通过：41 个静态 token 全有定义，动态 token 有 fallback；兼容块保持空 |
| D3 | 证据工具：人工截图/axe vs 新增浏览器自动化 | **已决策**（2026-11-12） | 人工 + CDP 脚本 + `ui-metrics`/`token-coverage` 门禁；不引入 Playwright/axe 依赖（若引入先写 ADR） |
| D4 | 设计 skill 的落地方式 | **已决策**（2026-11-12） | 用户级 `--copy` 安装（跨项目），未提交仓库、未加入发布依赖 |
| D5 | 视觉方向 | **已决策**（2026-11-12） | 文档感；冻结稿 `docs/design/mockups/`（style tile + clean/dirty/依赖图三屏），规则见 §4.9/§5.7 |
| D6 | 页头版本 chip（冻结稿偏离） | **已批准偏离**（2026-11-12） | 用户明确要求保留插件版本标识；在 §4.9 规则 3 记为受控偏离，位于页头右侧元信息，不恢复 slogan/免责声明 |

0.3.0 未发布；发布流程只在人工验收通过并获得明确发布指令后启动。

## 附录 A：宿主 0.2.2-rc.1 设计 token 速查

- **合约规模**：414 个 `--dsw-*` token（static 82 / alias 114 / font 182 / specific 10 / radius 7 /
  elevation 5 / shadow 4 / focus 2 / other 8），明暗成对，选择器为 `body` 与 `body[data-ds-dark-theme]`。
- **字号阶**：8 个 shorthand token、7 个不同字号值——11/14、12/18、13/20、14/22、16/24、20/28、24/32；
  其中 16 另有 28 行高变体（m-18），strong 变体 12/13/14/16 为 500/600。
- **圆角**：4 / 8 / 12 / 16 / 20 / 28 + `--dsw-corner-shape: superellipse(1.5)`。
- **台阶/阴影**：`--dsw-elevation-stroke/soft/panel/prominent`；`--dsw-shadow-lv1..lv3`。
- **字体**：`--dsw-font-family`（跟随用户设置）；`--ds-font-family-code`（代码）；brand 为 Montserrat 栈。
- **运行时变量**：`--dsh-content-font-size`（10–22，默认 14）、`--dsh-code-font-size`（10–16，默认 11）、
  `--dsh-font-family-text/code/terminal`、`--dsh-hairline-width`、`--dsh-frame-top-clearance`。
- **不存在**：spacing、control-height、z-index token；这些用宿主官方组件的字面值词汇（28/32/34/36/40）。
- **官方组件基准**：Button md 36 / sm 28；Input 34；Tag 11/17；Pill 24；SegmentedTabs tab 34；
  Modal `min(380px,100%)` + radius-panel；管理页 `max-width:960`、页边距 `clamp(24,4vw,48)`、顶距 28。

## 附录 B：官方参考实现

- 视图类 Pane：Trajectory（root 100% 高、flex column、自滚动、sticky toolbar 32px、发丝分隔线）。
- 管理列表页：Plugin Manager（960px、clamp(24,4vw,48) 页边距、20/500/28 标题、13/20 简介、卡片 radius-xl）。
- 设置与表单：Settings（行 16px 0 + `.5px border-l2`、标题 14/20、描述 12/18、对话框 800px + radius-panel）。
- 基础组件：Button / Input / Tag / Pill / SegmentedTabs / Modal 的官方数值见附录 A。

## 附录 C：社区工具、插件与 skill（跨项目使用）

> 这些是**研发工具与参考**，不是 `dsh-charter` 的运行时依赖，也不应提交进本仓库或加入 `package.json`。

### C.1 DSH 插件参考（“可看结构”，不是设计工具）

| 资源 | 数据（2026-11-11） | 用途 |
| --- | --- | --- |
| [dshfind.com](https://dshfind.com/en/plugins) | 社区插件索引 | 浏览 DSH 插件生态 |
| [dshmarket / dsh-market](https://github.com/dsh-market/dsh-market) | 11.9k★、1.21M 下载/30 天、MIT | 密集 Pane 的布局/层级参考 |
| [dsh-claude-style](https://github.com/Nwflower/dsh-claude-style) | 561★、49.6k 下载/30 天 | 排版/主题参考；**不得复制其字体资产** |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 已安装 0.82.0，DSH 团队推荐 | 语义 token 与高密度仪表盘参考 |
| 主题层插件（如已安装的 dsh-livery） | 24 套风格 | 验证 Pane 是否真正消费宿主 token |

DSH 插件是**profile 级**安装（Desktop/Web 各自一个 profile），安装后对该 profile 下所有 Session/项目生效，
不是 per-project。参考用插件（尤其会改全站样式的 dsh-claude-style）不建议装进日常 profile；需要时用独立
测试 profile 或仅阅读源码。

### C.2 Agent skills（设计工作流）

| Skill | 数据 | 作用 |
| --- | --- | --- |
| [frontend-design](https://www.skills.sh/anthropics/skills/frontend-design) | 1.10M 安装 | 先定审美方向、字号阶与版式决策 |
| [impeccable](https://www.skills.sh/pbakaus/impeccable/impeccable) | 400.1K 安装、107.6k★、Apache-2.0 | `critique`/`audit`/`typeset`/`polish` 设计总监工作流 |
| [web-design-guidelines](https://www.skills.sh/vercel-labs/agent-skills/web-design-guidelines) | 847.9K 安装 | 逐条 UI 规范审计并输出 `file:line` |
| [web-design-reviewer](https://www.skills.sh/github/awesome-copilot/web-design-reviewer) | 14.3K 安装、MIT | 对运行中的 Pane 做多宽度截图审阅 |
| [better-typography](https://www.skills.sh/jakubkrehel/skills/better-typography) | 41.1K 安装、MIT | 字号/行高/字距/行宽专项 |

使用顺序：frontend-design 定方向 → impeccable `critique`/`typeset` 处理本方案 → web-design-guidelines
回归 → better-typography 治字体 → web-design-reviewer 对真实 GUI 截图验收。

**跨项目安装（用户级，所有项目共享）**：DSH 的原生 skill 根目录为
`<project>/.dsh/skills`（rank 100）、`<project>/.agents/skills`（rank 200）、`<dshHome>/skills`（rank 400）、
`~/.agents/skills`（rank 500）。`skills` CLI 没有 DSH target，故用 `-a codex` 写标准 `.agents/skills` 布局，
再让 DSH 扫描到：

```bash
# 用户级：所有项目共享，不污染仓库
npx --yes skills add https://github.com/anthropics/skills --skill frontend-design -g -a codex -y --copy
npx --yes skills add https://github.com/pbakaus/impeccable --skill impeccable -g -a codex -y --copy
npx --yes skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines -g -a codex -y --copy
npx --yes skills add https://github.com/jakubkrehel/skills --skill better-typography -g -a codex -y --copy
```

放到 `~/.agents/skills/<name>/SKILL.md` 即可被 DSH 热发现；不需要重启 DSH。项目级安装把 `-g` 换成
`<repo>/.agents/skills`（会进仓库，需明确决定是否提交）。skill 提供的是词汇表/清单/审阅回路，不替代设计
决策与重构本身；不要把它们加入 `package.json` 依赖，也不要在发布文档中宣称依赖这些工具。

**安装前必须审阅**：第三方 skill/脚本以完整 agent 权限运行。通读 `SKILL.md` 与 `scripts/`、固定来源
URL/commit、拒绝无许可证或行为不明的包；impeccable 的 launcher 首次运行会下载二进制，需单独批准。本轮
已安装的 4 个 skill 使用 `--copy` 落盘、仅位于用户级，未进入本仓库、未加入任何发布依赖。

## 附录 D：验收清单（发布前逐项勾）

- [x] D0/D0b/D1 已写入版本路线，本文状态为 Active 且版本范围 0.3.0（§2.1、§10；路线图 §14.2）。
- [x] 指标门禁全部达标（§0.1），结果记入 verification；统计口径与 `ui-metrics.mjs` 一致（`verify:ui-metrics --gate=final` 全项 PASS）。
- [x] 目标只渲染一次；全局预算只剩 2 类表达（字段级计数保留）；Workspace ≤ 6 个兄弟块（`ui-metrics` legacy objective=0；WorkspacePage 4 个 section + notices）。
- [x] 所有“打开/跳转”落到锚点并聚焦；无 no-op（`section-routing` 测试 + 浏览器路由证据）。
- [ ] clean 状态无常驻操作条；dirty/replay/conflict/unknown 各自唯一呈现。
- [ ] W0 滚动所有权运行时探针（Web/Desktop × Composer 开合 × 三种宽度）完成并冻结。
- [ ] Change Set 按 v2 §5.7 最小合同（桌面 complementary region、窄屏 modal bottom sheet）通过键盘/焦点验收。
- [ ] 明暗 × 中英 × 320/375/560/850/1440 × 六状态截图完成，主截图来自验收构建且使用合成数据。
- [ ] 字体偏好 10/14/22 下不破版；内容文字跟随、UI 文字固定阶。
- [ ] 键盘全路径 + 200% 缩放 + forced-colors + reduced-motion 通过。
- [ ] 与冻结稿（docs/design/mockups/）并排对照评审通过：明暗 × 320/375/560/850/1440 × 六状态。
- [x] 依赖图节点 px 几何 + 正文两行截断；用户字号 10/14/22 下无文本裁切、无节点溢出（`DependencyGraph.tsx` PX_PER_EM/PX_PER_EM_Y、184px；CDP scrollWidth/scrollHeight 检查）。
- [x] rail、inspector、图形工具条无原始枚举/op 类型串，全部走 locales（`changeset.*`/`deps.*`/`progress.*` 审计；`grep` 无原始状态串）。
- [x] 区域导航为顶部下划线 tabs（nav + aria-current）；旧左侧纵向导航已移除（`charter-tabs`、`aria-current`；DOM 无 `.charter-nav`）。
- [x] 旧版 DSH token 覆盖审计完成（2026-11-12，10 版本 / 41 静态 token / 1 动态 fallback）；兼容块为空且有门禁。
- [ ] `npm run check`、兼容矩阵、exact artifact/fresh profile 门禁通过，证据按 CI/local/manual 标注。
- [ ] README/README.zh、CHANGELOG、release notes、docs 索引、SHA256SUMS 同批更新；未 push/tag/publish。
- [x] 人工验收前未推送 `feat/0.3.0-gui`、未合并 `main`、未 tag/publish；仓库与 README 无“0.3.0 可用/已发布”声明。

## 附录 E：变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-11 | 创建本提案（Proposed）：基线度量、设计系统目标、IA 重构、W0–W5（后扩展至 W6）、证据计划、社区工具附录。 |
| 2026-11-11 | 评审修订 v2：修复 P1×4（圆角门禁、滚动运行时探针、Change Set v2 合同、兼容块计数）与 P2×11（预算口径、字阶表述与 section token、padding 口径、魔法数字、W1 范围、disabled 措辞、320 截图、合成数据、skill 审阅、内部一致性），并同步外围索引与 AGENTS.md 状态词汇表。 |
| 2026-11-11 | 评审修订 v3：Card 规格统一为 `radius-lg`（H17/P1 残留）；附录 C 补齐 better-typography 安装命令，与“已安装 4 个 skill”一致。 |
| 2026-11-12 | D0 决策：目标版本 `0.3.0`（所有栏目统一重构，W0–W5，后扩展至 W6）；D0b 采用 workspace-v2 最小合同；D1 采用窄屏 A-lite + 宽屏三栏/rail。执行边界：本地 `feat/0.3.0-gui`，人工验收前不推送/合并/发布/宣称可用；状态转 `Active`。 |
| 2026-11-12 | W0/W1 进展：Web 滚动探针冻结（宿主滚动、`overflow-x:clip`）；CSS token 层通过 `--gate=css`；W1 人工视觉确认仍未完成。 |
| 2026-11-12 | W2a 进展：目标单次渲染、旧 overview/stat/budget 移除、真实 section 路由（滚动+聚焦）、clean 状态隐藏操作条；`--gate=ia` 与 `npm run check` 通过；Change Set rail/sheet 待 W2b。 |
| 2026-11-12 | W2b 完成：Change Set v2 最小合同（桌面 complementary region、窄屏 modal sheet + focus trap/Escape/focus restore）、冲突摘要入面板、Change Set 测试；W2 源码层完成，真实浏览器证据与人工验收仍待。 |
| 2026-11-12 | W3 收口进展：notice 改为单条优先级横幅；导航帮助改为可聚焦 `?` 按钮（键盘/触屏可见）；真实 AX tree 抽查（命名 region、0 空名按钮、命名 dialog）；200%/forced-colors/AT 证据仍待。 |
| 2026-11-12 | W4 部分：WIP artifact 打包（SHA-256 `12c66dbc…`）、隔离 profile exact install、隔离 Host 启动、exact artifact client 真实 Host 渲染；fresh-profile session、Desktop、截图矩阵与发布文档仍待。 |
| 2026-11-12 | W5 页面级拆分完成：WorkspacePage/ReviewCenterPage/DiagnosticsPage + typed PaneScope + pane-format/pane-ui；CharterPane 3459→1842；492/492 + final gate；真实浏览器 v0.3.0 三区域验证；per-domain store 细粒度拆分仍待人工验收边界。 |
| 2026-11-12 | 审查修复：W0 token 覆盖门禁（9 版本/35 静态 token/1 动态 fallback）落盘；rail 状态文案本地化；导航 a11y 文档统一为 nav+aria-current；补 `--ch-reading-max` 并移除 sticky 60px 魔法数字；dev artifact 删除以保护已发布 0.2.2。 |
| 2026-11-12 | 本地验收部署：`0.3.0` dev candidate（`1d1963f1…`）安装到本地 web+desktop profile；Web 验收服务 52080；Desktop 当时按重启验证。后续 2026-11-12 确认 Desktop 支持 bundle 热更新，见下方 W6 记录。 |
| 2026-11-12 | DSH rc.2 适配：声明 `0.2.2-rc.2`（engines/peers/dshReleases/token inventory/测试/文档），十版本矩阵 PASS；rc.2 兼容 artifact `31c4c61d…` 安装 web+desktop；engines 改为有界 0.2 线范围。 |
| 2026-11-12 | UX 减负：平铺 section、去除冗余小字/角标/免责声明、行内字节与重复进度标签移除、单一进度控件、空态/表单降噪；492 测试 + final gate PASS；artifact `1d1963f1…` 已部署 web+desktop。 |
| 2026-11-12 | 本地验收部署：W6 验收构建 `dist/dsh-charter-0.3.0-w6-final.tgz`（`ab74591c…`，client `986f8403…`）已安装到本地 web+desktop profile；恢复 Pane 页头 `v0.3.0` 版本标识；Desktop 实测热更新（bundle 824ms / CSS 402ms / 最终 886ms；后续披露标签修复构建 `ab74591c…` 已热更新，tabs=3、style=1、无异常），无需重启；人工验收待完成。 |
| 2026-11-12 | W6 视觉语言落地（源码）：按 docs/design/mockups 合入文档感 CSS 与组件——顶部下划线 tabs、720 文档列 + 280 Change Set rail、section/行解剖与对齐、36px 虚线空态、40/16/16 skeleton、quietlink/notice、依赖图 px 几何 + 紧凑 inspector；492/492 + final gate PASS；CDP 截图 320/850/1440，root/document 横向溢出 0，图形区 320/850 隐藏、1440 可见，字号 10/14/22 节点文本无裁切；冻结稿并排评审与人工验收仍待完成。 |
| 2026-11-12 | 视觉语言冻结（文档感）：style tile + clean 首屏 / 脏态 rail / 依赖关系图三份高保真稿入库 `docs/design/mockups/`（含 `mockup.css` 参考实现与 `tokens.css` 宿主 token 快照）；新增 §4.9 视觉冻结与 §5.7 依赖图规格；更新 §4.5/§4.7/§5.1/§5.2/§5.6/§8.3、D1/D5 决策与 W6 实施阶段；区域导航定为顶部下划线 tabs（去左侧纵向导航）。 |
