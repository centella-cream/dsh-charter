# `dsh-charter` 依赖关系图形化视图设计（提案）

> **状态：** `Implemented — pending release acceptance`——源码已实现并通过 source gates；真实浏览器/AT
> 与 W0-1/2/3 人工门禁仍待完成，本文不描述已发布行为。进入发布前仍以[版本路线](version-roadmap.zh.md)为准
> （[charter-workspace-v2.zh.md](charter-workspace-v2.zh.md) §1.1）。
> **版本范围：** `0.2.2`（已确认，纯客户端）。源码实现已完成；发布前仍需完成真实浏览器/AT 门禁（§3.10）。
> **形态：** **A —— 图形增强，语义列表常驻且为权威操作面**（已确认，§0.2）。
> **基准：** 2026-11-09，基于已发布 `0.2.1` 之后的开发树。
> **权威边界：** 版本范围由[版本路线](version-roadmap.zh.md)决定；不变量由 [v1 核心设计](charter-design-v1.zh.md)
> 决定；语义/键盘合同、关系模型与 prompt 投影由 [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md)
> §5.7、§6、§8.2 决定。**本文不修改任何权威文档**；结论与权威文档冲突时，先修订权威文档再修订本文。
> **替代/被替代：** 无 / 无。
> **实现就绪度：** 所有未尽事项的做法都在 **§10**，每项都有决定或"兜底值 + 测量方法 + 决策规则"。
> 因此实现可按兜底值开工，W0 实测后**只调参数、不改结构**（§10.10）。

## 0. 目标与形态取舍

### 0.1 目标

把 Workspace 里"执行依赖"的**平铺文本列表**升级为**可操作的图形面**：用户能看见交付物之间的前置拓扑、
看见就绪与冲突状态、并在图上直接完成关联的增删（暂存进 Change Set）。参考体验：Obsidian local graph、
`dsh-context` 的 Agent 网络视图。

### 0.2 形态取舍：A（增强）——**已确认**

| | A. 图形增强现有列表 | B. 图形升级/替代列表 |
| --- | --- | --- |
| 权威操作面 | 语义列表（常驻、可操作） | 图形；列表退化为无障碍兜底 |
| 图的定位 | 主视觉 + 快捷 staging 入口 | 唯一依赖管理界面 |
| §5.7 合规 | 直接满足：语义面可见常驻 | 需要"隐藏但可聚焦"的列表副本 |
| 主要风险 | 视觉上"图只是附加"，可能不够解气 | 隐藏语义面易与真实数据漂移；明眼键盘用户路径更差；两套完整交互都要维护 |
| 窄屏 | 图折叠、列表全宽（能力不减） | 图不可用即失去主界面，必须回退到列表 |

**已确认采用 A**，理由是 B 需要一个"只给辅助技术用的隐藏列表"，而隐藏语义面是公认反模式
（与真实数据漂移、明眼键盘用户拿不到等价路径、双份交互维护）。

**A 不等于"老列表原样保留"**：图形区默认展开并占据卡片主视觉，列表紧凑化（单行摘要 + 状态 +
编辑入口收进 inspector），窄屏才折叠图形区。若 W0-1 原型显示两栏在目标宽度下不可用，回退顺序是：
先压缩列表行（摘要单行夹取 + select 收进 inspector）→ 再改上下堆叠 → 最后才考虑降低图形区权重；
**不回退到 B**。

### 0.3 结论摘要

1. **形态**：一个「执行依赖」面板内**图形区 + 常驻语义列表共存**，不是互斥切换（§3.1）。
2. **规模**：只做**局部 ego 图**（焦点节点 ±1 跳，可切 ±2 跳）；不做全局图、不做力导向（D2/D3）。
3. **渲染**：DOM 承载全部文本、SVG 只画几何；零 canvas、零图形库（D6，同生态先例见 §2.2）。
4. **键盘**：图形区是**复合控件**——整体只占 1 个 Tab 停靠点，内部 roving tabindex + 方向键遍历，
   前置 skip 链接可一次跳到列表（D5、§3.5）。
5. **交互**：图是透镜 + staging 入口，不是编辑器。图上一切操作只 stage ops，Apply 仍是唯一原子提交点，
   且与列表路径产生**逐字段相同**的 op 与 `previewDigest`（D4）。
6. **接口**：语义与几何**分两层**——`buildRelationGraph`（吃 committed + projected + ops，算三态）与
   `layoutRelationGraph`（纯几何、确定性、不依赖字体与容器宽度）（§3.3）。
7. **pending 候选**：pending deliverable **不参与执行拓扑**、不分配 `D<n>`、不给 rank；放进独立"候选泳道"，
   候选边虚线**只读但可被方向键到达**（D9、D10、§3.4）。**替代关系同样在 v1 画出**：`supersedes` 边走第三条
   `history` 泳道，端点是只读**幽灵节点**（点线、无 `D<n>`、无 rank、可被 `[`/`]` 与 `Enter` 到达），因此执行泳道
   "rank = 执行序"的语义不受影响；本次 staged 的替代两端仍留在执行泳道并标"新增/删除"（D11、§10.1）。
8. **200% 文本缩放**：全部几何以 **em** 表达，布局输出无量纲单位，缩放/平移只对单一 wrapper 施加一个
   transform；节点高度取离散档位、由字符数纯函数决定，**不做运行时测量**（D19、§3.7）。
9. **兼容性**：图形视图本身不动 record schema、迁移、fork、Host、Remote、wire、prompt。（§8 的 §6.5 冲突确认是
   独立事项，它确实改了 core/Host/wire/client，但 wire 上是 optional 字段、不参与任何 digest 输入。）
   **但兼容矩阵不豁免**：发布门禁仍要求对全部已声明版本与当前 untracked 版本重跑矩阵并重新绑定证据。
10. **§5.7 不需要修改**：该条禁的是"为了性能**只**渲染一个无语义 canvas"（用语义-less canvas **替代**窗口化
    列表），本方案从不替代列表（逐字复核见 §1.3.1）。
11. **§6.5 的 conflict 确认缺口不属于本提案**：那是现有产品的正确性缺口，独立记录于 §8（D15）。
12. **本文不承诺任何体积或性能数字**；实测在 W0/W1/W2 作为验收记录（§3.10）。

## 1. 现状盘点（项目证据）

### 1.1 数据面已经够用

| 已有能力 | 位置 |
| --- | --- |
| 拓扑序 + 局部 key `D1..Dn` + `requires`/`requiresIds` + `prerequisiteStatus` + `executionDisplay` | [src/core/dependencies.ts:133](../../src/core/dependencies.ts) `dependencyProjection` |
| 稳定分层顺序（同层用 canonical order，不用 UUID） | 同上 `topologicalDeliverables` + `compareOrderedItems` |
| 结构校验（自依赖、成环、悬空、非 deliverable 持边、inactive 持边、重复 ID） | 同上 `validateDependencyGraph` |
| 关联编辑 op 与变更记录 | `deliverable.requires` / `deliverable.requires.changed`（[src/core/schemas.ts:225](../../src/core/schemas.ts)、:295） |
| 现有 UI：依赖计划列表 + 每行多选 select 改 `requires` | [src/client/CharterPane.tsx:2014](../../src/client/CharterPane.tsx)–2063 |
| 现有样式语言：`charter-dependency*`、`is-dependency-conflict` 用 `--charter-danger` 边框 | [src/client/charter.css:2145](../../src/client/charter.css)–2195 |
| 投影：`projectView(view, ops) → ProjectedItem[]`，其中 `staged: boolean`（**只有布尔，无法区分 added/removed**） | [src/client/preview.ts:178](../../src/client/preview.ts)、:12–19 |
| 结构非法 → 危险提示 + Apply 阻断（**只覆盖环/悬空，见 §8**） | [src/client/CharterPane.tsx:841](../../src/client/CharterPane.tsx)、:866、:2008、:1110 |

结论：不需要新增数据契约或 Remote 方法；但 `ProjectedItem.staged` 的布尔粒度不足以算边的三态，
必须在客户端做一次 committed ↔ projected 差集（§3.3）。

### 1.2 约束清单

- **§5.7 语义与键盘合同**：窗口化列表每行要有稳定 accessible name、总数和位置，DOM reading order 与视觉顺序
  一致，「不能为了性能只渲染一个无语义 canvas」；dependency 引用的 accessible name 要同时含局部 label、正文
  摘要和 readiness；跳转后焦点落到目标行标题并提供返回来源的键盘路径；hover help 必须同时支持键盘 focus。
- **§5.7 非颜色依赖**：触控目标、focus indicator、forced colors、200% 文本缩放和 reduced motion 下，
  不能只靠颜色或动画表达唯一状态。
- **§5.7 验收方式**：DOM 测试验 role/name/state/focus，真实浏览器验布局/滚动/focus restore/accessibility tree，
  `react-test-renderer` 属性断言不能单独作为通过证据。
- **§2.4 不建通用关系图**：数据层只有 `supersedes`、`requires`、`derivedFrom`；本提案是**展示层**图形化。
- **§6.4 规则 1/6/7/8/9/12**：`requires` 只在 deliverable 之间；pending 的候选 relation 不写入 `requires`，
  接受时由同一 Change Set 建边；清边/重定向必须与触发操作同批；supersede 不自动继承边；不级联修改状态。
- **§8.2 prompt 投影**：拓扑序 + 局部 `D<n>`；图形布局是客户端视觉产物，**不得**进入 prompt、digest 或记录，
  也**不得**给 pending 节点分配 `D<n>`（会与 prompt 局部 key 冲突并伪造执行序）。
- **路线图 §14**：不支持 predicate-based 批量写入；line 266：禁止 DOM 注入或依赖 Conversation 私有 React 树。
- **512 性能验收的边界**：[docs/verification.md:46](../verification.md) 记录的是 core read/planning
  （分页查询 p95 5.2 ms、5-op planning p95 0.6 ms，预算 100 ms），并明确「not UI/network」。
  客户端布局与 SVG 首帧是**新的性能面**，需自带实测证据。
- **产物不变量**：浏览器 bundle 必须是单一自包含 factory（`dsh.client.external` 只有 gateway client），
  任何图形库都会被内联。

### 1.3 约束的合理性分层（先审规则，再审方案）

#### 1.3.1 §5.7 canvas 条款的逐字复核

原文（[charter-workspace-v2.zh.md:421](charter-workspace-v2.zh.md)）：

> 窗口化列表为每行提供稳定 accessible name、总数和位置；DOM reading order 与视觉顺序一致。不能为了性能只渲染一个
> 无语义 canvas。

- 主语是**窗口化列表**；两个限定词是**为了性能**（动机）与**只**（唯一表示）。
- 禁止的是：为省掉长列表的语义/虚拟化成本，把列表**替换**成语义-less canvas。
- 没有禁止：在列表之外额外提供图形视图。

**结论：按现有条款即可设计，不需要改写 §5.7。** 合规的可验证形式见 D17。

#### 1.3.2 外部事实 vs 内部选择

| 约束 | 性质 | 能否重议 |
| --- | --- | --- |
| 屏幕阅读器读不到 canvas 像素；forced colors / 200% 文本缩放对位图无效；焦点需要 DOM 或手写 ARIA overlay | **外部事实** | 不能，只能适配 |
| SVG 内 ARIA role 与焦点行为跨浏览器/AT 差异大（`role="listitem"` 在 SVG 内不等于 HTML list item） | **外部事实** | 不能，按 §3.5 规避 |
| 200% 文本缩放只放大文本，不放大写死的 px 盒子 | **外部事实** | 不能，按 D19 用 em 规避 |
| bundle 必须单一自包含 factory，任何库都被内联 | **外部事实**（DSH 打包契约） | 不能 |
| 兼容矩阵是发布门禁 | **外部事实**（项目治理） | 不能 |
| §5.7 canvas 条款的措辞 | 内部选择 | 可议，但**本提案不需要改**（§1.3.1） |
| 分层 vs 力导向、SVG vs canvas、是否做全局图、A/B 形态 | 内部选择 | 全部已定：形态 A（§0.2）、分层、SVG、只做 ego 图 |
| 不级联修改状态（§6.4 规则 12） | 内部**产品原则** | 改它等于改产品定位，不在本文范围 |
| 不做跨 Session 图（路线图 §14） | 内部**范围决定** | 要改先改路线图 |

## 2. 参考实现调研

### 2.1 Obsidian graph view（外部产品观察，非本项目事实）

借鉴：local graph 优先于全局图；hover/focus 高亮邻居并弱化其余；拖动节点只改视觉位置不写数据；动画可关；
**图不负责编辑内容**（链接由正文产生）——对应本方案"图只 stage ops，Apply 才提交"。

不照搬：canvas/WebGL 主表示（成本收益不成立）；全局大图作为默认（可读性）；力导向作为默认（§2.3）。

### 2.2 `dsh-context`（同生态先例，**观察已固定版本**）

> **观察基准（复核用）**：包名 `dsh-context`（unscoped，第三方社区插件，作者 bowenliang123）；
> 观察版本 **0.82.0**（`~/.dsh/profiles/desktop/node_modules/dsh-context`，npm 当时最新 0.83.0）；
> 观察日期 **2026-11-09**；观察对象 `lib/client.js`（660,376 字节）与包内 `README.md`、`package.json`；
> 方法：对产物做字符串/正则计数与代码片段阅读，未运行其 UI。
> **本节是版本快照，升级后事实可能漂移**；引用前应按下述方法复核。

| 项目 | 观察结果 |
| --- | --- |
| 定位 | 上下文洞察插件；**Fleet 标签页 = Agent 网络**（当前 Agent、父级、每个子 Agent 各一张实时卡片）；侧边栏 Context 面板也含 Agent 网络 |
| 依赖 | 运行时依赖只有 `zod`；peer 含 react/react-dom 与 `dsh-client-ui-primitives`；**无图形库** |
| 渲染方式 | **SVG + DOM**：`viewBox` ×11、`path d=` ×11、`line`/`path`、`vector-effect: non-scaling-stroke`；`getContext(` **0 次**（无 canvas）；无 d3 / cytoscape / dagre / forceSimulation 痕迹 |
| 布局 | lane / slot / waterfall 计算式布局（`lc-pulse-lane-labels`、`lc-pulse-waterfall`、`lc-pulse-timeline`、`lc-pulse-slot-pattern`），非力导向 |
| 视图组织 | 文案含「网络 / 时间」——同一数据两种视图；另有卡片式 Fleet 列表 |
| 交互 | 「点击节点跳转会话」「点击节点高亮联动」；边元素带 `onClick`、`onKeyDown`、`onMouseEnter/Leave`、`onFocus/onBlur` |
| 无障碍手法 | 边是 `role:"button"` + `tabIndex:0` + 描述性 `aria-label`（含时间、from/to、kind）；全文 `aria-label` 52 处，但 `role:"button"` 仅 2 处、`tabIndex:0` 仅 4 处 → **语义主体在 DOM 卡片/lane label，SVG 只对少数可操作元素加焦点** |
| 命中区 | 可见线 `lc-pulse-edge-line` 之外另有不可见 `lc-pulse-edge-hit` 宽命中线 |
| reduced motion | `prefers-reduced-motion` 4 处（有处理） |
| forced colors | `forced-colors` **0 处（未处理）——不能抄**，本项目 §5.7 明确要求 |

借鉴五条：① DOM 承载文本、SVG 只画几何；② 只让少数可操作图形元素进焦点序列（本方案进一步收紧为复合控件，
见 D5）；③ 独立 hit 元素解决细边触控；④ 同一数据多视图并存而非唯一入口；⑤ hover 与 focus 共用同一套高亮。

不可借鉴：forced-colors 缺失；且它的图是**只读洞察**，没有"图上编辑并暂存"的先例——staging 交互需自定义
（§3.6）。

### 2.3 布局选择的理由

反对力导向做默认的理由是**语义**而非确定性：契约是 DAG，rank 就是执行顺序，分层布局直接把它画出来，
力导向会打散。（布局坐标不进 record/prompt/digest，所以"力导向不确定"不是正确性问题，带种子的力导向可确定性
复现。）两个参考实现也都不用 canvas 表达关系图。

## 3. 方案

### 3.1 信息架构：一个面板，两个共存部分

```text
[跳到依赖列表]  ← skip 链接，键盘一次跳过整个图形区
执行依赖 (N)                                        [隐藏图形 ▾]  ← 纯视觉偏好
┌───────────────────────────────┬──────────────────────────┐
│ 图形区（复合控件，主视觉）      │ 语义列表（常驻、可操作）  │
│  · 工具条：焦点选择 · 深度 1/2  │  · D1 Build   ready      │
│    · 候选边 · 替代边 · 重置     │    依赖 —   [select]     │
│    · 缩放/平移 · 适应窗口       │  · D2 Release waiting    │
│  · ego 网络 + 候选泳道          │    依赖 D1  [select]     │
│  · inspector（选中时）          │                          │
└───────────────────────────────┴──────────────────────────┘
```

- **列表永不因图形而卸载**：它是 §5.7 要求的语义面，也是所有编辑操作的权威控件所在（含现有多选 select）。
  列表按 §10.5 窗口化（默认 50 行 + "显示全部"），窗口化不改变它的权威性；焦点节点不在窗口内时按 §10.5 定位。
- **图不引入独有操作**：图上能做的（增删边、选中、跳转）在列表里都有等价控件（D17）。
- **DOM 顺序 = skip 链接 → 工具条 → 图形区 → 列表**，与视觉顺序一致（§5.7）。
- 「隐藏图形」只影响视觉偏好；隐藏后 inspector 一并隐藏，**所有操作仍可在列表完成**（D17 措辞以此为准）。
- **栏宽不写死**：设计只固定"列表最小可用宽度 `20em`；容器宽度不足以同时容纳图形区与列表最小宽度时改为
  上下堆叠（图在上、列表在下）"。实际断点与栏宽比例由 W0-1 原型实测确定（§3.10）。

### 3.2 已定设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | 版本归属 **`0.2.2`（已确认，纯客户端）**；roadmap 写入前不启动 W1 及之后的实现 | 零 schema/Host/Remote 变更，可独立回滚；W0 原型不受此限（不进主分支） |
| D2 | **只做局部 ego 图**（深度 1，可切 2），**不做全局图** | 512 上限下全局图不可读；ego 图覆盖真实审阅问题；同时消掉最大的性能与无障碍风险面 |
| D3 | **不做力导向模式** | 分层已表达执行序；力导向不增加审阅信息，只增加实现与无障碍成本 |
| D4 | 图只 **stage** ops，Apply 是唯一提交点；与列表路径产生逐字段相同的 op 与 `previewDigest` | 保持 Change Set 原子性、幂等 receipt 与 unknown-outcome 语义不变 |
| D5 | **图形区是复合控件**：容器是唯一 Tab 停靠点，内部节点/边用 **roving tabindex**，方向键遍历，前置 skip 链接；**可导航元素 > 60 时先把深度锁到 1，仍超则隐藏图形区**（列表照常） | 60 个 Tab 停靠本身就是 tab 陷阱；复合控件把"跳过图"变成 1 次 Tab，阈值退化为方向键遍历疲劳的保护（§3.5） |
| D6 | **自研分层布局，零新依赖** | 规模被 D2 限死后，布局只需 rank + 一遍 barycenter + 坐标分配；dagre/graphlib 的通用性用不上且体积不可控 |
| D7 | 触控目标 **44×44 CSS px** 下限（不写 40–44 区间）；细边用不可见 hit 线扩到 ≥44 px | 避免实现按 40 落地 |
| D8 | 图形区渲染 **committed ↔ projected 差集模型**（§3.3），不是单一数组 | `ProjectedItem.staged` 只是布尔，算不出 added/removed |
| D9 | pending 的 `proposedRequires` 画成**虚线候选边、只读**（不接受 Delete），但**可被方向键到达**，激活后跳到对应提案 | §6.4 规则 6：候选 relation 只能随提案接受生效；只读但可导航，避免"鼠标可点、键盘不可达"的不对称 |
| D10 | 图上只有 **deliverable** 节点；pending deliverable 进**独立候选泳道**，**不分配 rank / `D<n>` / `executionDisplay`** | §6.4 规则 1；§8.2：`D<n>` 是 prompt 局部 key，给 pending 编号会伪造执行序 |
| D11 | **v1 画 `supersedes` 边**：独立 `history` 泳道 + 只读**幽灵节点**（点线、无 `D<n>`、无 rank、不可编辑但可被 `[`/`]` 与 `Enter` 到达）；本次 staged 的替代两端仍留在执行泳道，不生成幽灵节点。推导规则见 §10.1 | 替代是既有产品能力，只做文本呈现会让图形视图成为半成品；幽灵节点在**独立泳道**里，因此不破坏"rank = 执行序"的执行泳道语义 |
| D12 | 图形区**启用条件**：存在 ≥1 条 `requires` 边（含 staged 三态）**或** ≥1 条候选边 **或** ≥1 条 `supersedes` 边；都不满足则隐藏图形区、只显示列表并说明原因（`deps.graphEmpty`） | 只按 committed `requires` 判定会与 D9 的候选边、D11 的替代边冲突 |
| D13 | staging 三态可视化：`staged-added` 实线 + "新增"角标 + brand 外描边；`staged-removed` 虚线 + 删除线 + 40% 不透明；`committed` 常规实线。三态**都带文本角标**，不只靠颜色 | §5.7 非颜色依赖 |
| D14 | inspector 内容：局部 key 或"候选提案"、正文（可展开全文）、progress、`executionDisplay` + `prerequisiteStatus`、requires 列表（可增删，与列表 select 等价）、依赖方列表、来源批次与 integrity、"在列表中定位"。**inspector 随图形区隐藏，且不承担任何独有能力** | 触屏与键盘的等价路径；同时保证 D17 成立 |
| D15 | 图形视图**显示**冲突状态，但**不承担** §6.5 的"Change Set 标注新增/加重 conflict + 二次确认" | 那是 §8 的独立正确性缺口 |
| D16 | 新增 i18n 键中英成对（§3.9） | 项目语言配对规则 |
| D17 | **合规的可验证形式**：语义列表始终在 DOM 中、始终可聚焦可操作；隐藏图形区后**所有操作仍可在列表完成**；图上与 inspector 内不存在任何列表之外的独有操作 | §5.7 与 §1.3.1 的落点，必须有测试 |
| D18 | **默认焦点规则**：① `selectedItemId` 若在图中则用它；② 否则取拓扑序第一个 **`prerequisiteStatus === 'dependency-conflict'`** 的 active deliverable；③ 无冲突则第一个 `waiting`；④ 再无则拓扑序第一个 active deliverable；⑤ 无 active deliverable 但有候选边时，取 canonical order 第一个 pending 节点。展开图形区**不抢焦点** | `focusId` 可为 `undefined`，必须定义默认值。**必须看 `prerequisiteStatus` 而非 `executionDisplay`**：core 的 UI 组合规则会把冲突掩盖成 `in-progress`/`blocked`（[dependencies.ts:125](../../src/core/dependencies.ts)），只看 `executionDisplay` 会选错节点——W0 原型实测复现 |
| D19 | **缩放契约**：所有几何以 **em** 表达；布局函数输出**无量纲 layout units**；SVG 与 HTML 标签层在**同一 wrapper** 内、共用**一个** CSS transform；节点高度取离散档位（`3em` / `4.5em`），由摘要字符数**纯函数**决定，**不做运行时文本测量** | 200% 文本缩放只放大文本不放大 px 盒；固定 px + HTML 文本必然溢出，而运行时测量会破坏布局确定性（§3.7） |

### 3.3 接口：语义层与几何层分离

三态（committed / staged-added / staged-removed）无法从单一数组推出：`CharterItem[]` 只有已提交数据，
`ProjectedItem.staged` 只有布尔。因此语义层必须同时接受 committed 与 projected（以及 ops），几何层只吃
语义层的输出——这样几何层保持纯函数、可快照测试，语义层可独立做差集单测。

```ts
// src/client/relation-graph.ts（提案）

/** 语义层：从 committed / projected / ops 解析节点与边的三态模型。纯函数。 */
export function buildRelationGraph(input: {
  readonly committed: readonly CharterItem[]      // view.items（已提交）
  readonly projected: readonly ProjectedItem[]    // projectView(view, ops).items（含 staged）
  readonly ops: readonly CharterOp[]              // 区分 requires 变更与 lifecycle 变更
  readonly showSupersedes?: boolean               // 默认 true；false 时不产出 history 泳道与 supersedes 边（D5 第一级降级 / §10.1）
}): RelationGraphModel

export type NodeState = 'unchanged' | 'staged-added' | 'staged-removed' | 'staged-changed'
export type EdgeState = 'committed' | 'staged-added' | 'staged-removed'

export interface RelationNode {
  readonly id: string
  readonly lane: 'execution' | 'candidate' | 'history'  // pending 进 candidate；两侧都 inactive 的被替代项进 history（§10.1）
  readonly ghost?: boolean                   // 仅 history 泳道为 true：只读、无 rank、无 D<n>
  readonly localKey?: string                 // 仅 execution 泳道；candidate / history 永远 undefined
  readonly text: string
  readonly rank?: number                     // 仅 execution 泳道
  readonly order?: number                    // 同 rank 内 canonical 序号
  readonly progress?: DeliverableProgress    // 仅 execution 泳道
  readonly executionDisplay?: ExecutionDisplay
  readonly prerequisiteStatus?: PrerequisiteStatus
  readonly state: NodeState
}

export interface RelationEdge {
  readonly from: string                      // prerequisite / 被替代者
  readonly to: string                        // dependent / 替代者
  readonly kind: 'requires' | 'proposed' | 'supersedes'   // v1 三类齐全（D11）
  readonly state: EdgeState                  // proposed 只可能是 committed；requires 与 supersedes 三态齐全
  readonly editable: boolean                 // 仅 requires === true（接受 Delete）
  readonly targetProposalId?: string         // proposed 边：激活后跳转到该提案
}

export interface RelationGraphModel {
  readonly nodes: readonly RelationNode[]
  readonly edges: readonly RelationEdge[]
  readonly navigables: number                // 节点数 + 边数，供 D5 阈值判定
}

/** 几何层：只算坐标，不知道 ops、字体、DPR 或容器宽度。同一输入必然同一输出。 */
export function layoutRelationGraph(
  model: RelationGraphModel,
  options: { readonly focusId?: string; readonly depth: 1 | 2 },
): GraphLayout

export interface GraphLayout {
  /** 坐标单位是 em 倍数（无量纲）；渲染层乘以 --charter-graph-unit（D19） */
  readonly nodes: readonly (RelationNode & {
    readonly x: number; readonly y: number
    readonly w: number; readonly h: number          // h ∈ {3, 4.5}（em 倍数）
    readonly labelLines: 1 | 2                      // 由字符数纯函数决定
  })[]
  readonly edges: readonly (RelationEdge & {
    readonly path: string; readonly hitPath: string
    readonly labelAt: { readonly x: number; readonly y: number }
  })[]
  readonly width: number                            // em 倍数
  readonly height: number
  readonly traversal: readonly string[]             // 方向键遍历序（节点与边的 id），供 roving tabindex
  readonly degraded: { readonly depthReduced: boolean; readonly hidden: boolean }
}
```

**三态判定规则（语义层，纯差集）**

| 对象 | `staged-added` | `staged-removed` | `staged-changed` | `unchanged` / `committed` |
| --- | --- | --- | --- | --- |
| 节点 | committed 中不是 active deliverable，projected 中是（提案被接受、item.add、supersede 的 replacement） | committed 中是 active，projected 中不再是（archive/purge/reject/supersede 出局） | 两侧都 active，但 `requires` 集合或 `progress` 不同 | 其余 |
| `requires` 边 | 不在 committed 的 `requires`，在 projected 的 `requires` | 在 committed 不在 projected | —（边只有存在与否） | 两侧都在 |
| `proposed` 边 | —（候选边随提案持久化，不会"新增"） | 该 pending 项在本次 Change Set 中被接受 → 候选边消失，同时生成一条 `staged-added` 的 `requires` 边（**提升**） | — | 提案仍 pending |
| `supersedes` 边 | committed 无该关系、projected 有（本次 staged 的 `item.supersede`） | committed 有、projected 无（替代被撤销，或 replacement 被 archive/purge） | —（边只有存在与否） | 两侧都有 |

**提升规则**是图形视图的独有价值：用户接受一批互相依赖的提案时，能在 Apply 之前看到候选虚线变成实线新增边、
pending 节点迁入执行拓扑并获得 `D<n>` 与 rank。（这是可视化收益，不是新操作，因此不违反 D17。）

### 3.4 节点与边集合、候选泳道、启用条件

**节点集合**

- execution 泳道：active（`accepted + current`）deliverable；rank/localKey/`executionDisplay`/`prerequisiteStatus`
  全部取自 `dependencyProjection`，与 prompt 的 `D<n>` 同源。
- candidate 泳道：pending deliverable，且满足**相关性**之一——自身带 `proposedRequires`、被另一 pending 的
  `proposedRequires` 引用、或当前是 `selectedItemId`。孤立 pending 不进图（它们在 Review Center）。
- history 泳道（v1 实现，§10.1）：**幽灵节点** = 在 committed 与 projected **两侧都 inactive**，且是某个可见节点
  `supersedes` / `supersededBy` 的对端。只读、无 `D<n>`、无 rank、不参与任何拓扑计算。本次 staged 的
  `item.supersede` 两端都留在执行泳道（旧项 `staged-removed`、replacement `staged-added`），**不生成幽灵节点**。
- invariant 不进图（D10）；`appliesTo` 不在范围。

**候选泳道的位置语义**：不代表执行序。布局上放在执行拓扑**下方独立带**，按其候选边指向的 active 节点的
最大 rank 分组，组内按 canonical order（`compareOrderedItems`）；无候选边指向 active 的 pending 放最右组。
视觉为虚线边框 + `--charter-surface-2` 底 + "候选"角标；accessible name 为
`候选提案 · <正文摘要> · 未进入执行序`。

**history 泳道的位置语义**：不代表执行序，代表"被谁替代"。布局上放在候选带**之下**的第三条独立带；
列 = 沿 `supersedes` 链能到达的最近 active 节点的列（无 active 对端时取 0），同列内按 canonical order 堆叠。
视觉为点线边框 + tertiary 文本 + "已替代"角标（**不**用低不透明度，避免与 `staged-removed` 的 40% 混淆且保证对比度）；
accessible name 为 `已替代 · <正文摘要> · 不在执行序`。

**三类边统一定义（可导航 ≠ 可编辑）**

| 边类型 | 来源 | 样式 | 可编辑（Delete） | 方向键可达 | 计入 D12 启用条件 | 计入 D5 navigables |
| --- | --- | --- | --- | --- | --- | --- |
| `requires` | active deliverable 的 `requires`（含三态） | 实线箭头（prerequisite → dependent） | **是** | 是 | 是 | 是 |
| `proposed` | pending 的 `proposedRequires` | 虚线 + "候选"标签 | 否（激活 → 跳到提案） | **是** | 是 | 是 |
| `supersedes` | `supersedes` / `supersededBy`（三态齐全） | 点线 + "替代"标签（被替代者 → 替代者） | **否**（只读，撤销走既有 lifecycle 操作） | 是 | 是 | 是 |

规则：**凡是渲染出来的边都可被方向键到达**（消除鼠标/键盘不对称，D9）；只有 `requires` 边接受 Delete。

> 三类边在 v1 全部实现（D11）。候选泳道的列归属与 pending→pending 链的定位规则见 §10.2（含候选环防护）；
> history 泳道与幽灵节点的推导规则见 §10.1。

### 3.5 键盘与无障碍合同（复合控件模型）

**结构**

- 图形区容器：`<div role="group" aria-label="依赖关系图" aria-describedby="<键位说明 id>">`，
  **容器是唯一 Tab 停靠点**（`tabIndex=0`）。
- 内部节点与边：**roving tabindex**——当前项 `tabIndex=0`，其余 `tabIndex=-1`；焦点进入容器时把 DOM 焦点
  委派给当前项（无当前项则按 D18 选默认焦点）。
- 图形区**之前**放一个可见 skip 链接「跳到依赖列表」，本身是 Tab 停靠点 → 键盘用户从卡片外到列表
  **≤ 2 次 Tab**。
- 不使用 SVG 内的 `role="list"/"listitem"`（跨 AT 不一致）；列表语义由 DOM 列表承担。
- 除容器与 skip 链接外，图形区内**不再有任何 Tab 停靠点**（工具条控件在图形区之外的独立工具条中，
  按正常 Tab 序）。

**元素语义与名称**

| 元素 | 语义 | accessible name |
| --- | --- | --- |
| 节点（execution） | `<g role="button">` + roving tabindex | `D3 · <完整摘要> · ready`（局部 label + 正文摘要 + readiness，满足 §5.7） |
| 节点（candidate） | `<g role="button">` + roving tabindex | `候选提案 · <完整摘要> · 未进入执行序` |
| `requires` 边 | `<g role="button">` + roving tabindex + 不可见 hit 线 | `<依赖方摘要> 依赖 <前置摘要>`；staged 时追加"（本次新增）"/"（本次删除）" |
| `proposed` 边 | `<g role="link">` + roving tabindex | `<候选摘要> 的候选前置 <前置摘要>，回车查看提案` |
| 节点（history / 幽灵） | `<g role="button">` + roving tabindex | `已替代 · <完整摘要> · 不在执行序`（只读：`Enter` 打开 inspector，不提供编辑与 Delete） |
| `supersedes` 边 | `<g role="button">` + roving tabindex + 不可见 hit 线 | `<被替代者摘要> 被 <替代者摘要> 替代`；staged 时追加"（本次替代）"/"（本次撤销替代）" |
| 其余几何（箭头、网格、高亮层、泳道分隔线） | `aria-hidden="true"` | — |

摘要在 accessible name 中**不截断**（截断只发生在视觉层，见 §3.7）。

**键位表**

| 键 | 行为 |
| --- | --- |
| `Tab` / `Shift+Tab` | 进出复合控件（各 1 次停靠）；不与图内元素交互 |
| `←` / `→` | **只沿 `requires` 边**移到前置 / 依赖方（候选边与替代边不混入，避免执行语义被稀释）。**多候选 tie-break 固定：rank 升序 → 同 rank 按 canonical order**；前进取"严格在后"的第一个，无则 wrap 回首项，后退对称 |
| `↑` / `↓` | 同一 rank（执行泳道）、同一候选列或同一 history 列内按 canonical order 移动；wrap |
| `[` / `]`（等价 `PageUp` / `PageDown`） | 沿**扁平 traversal 序**前后移动一格。这是到达候选节点、候选边、替代边的唯一方向键路径（它们不参与 `←/→` 的执行语义），`traversal` 由几何层纯函数产出（执行带 rank 升序 → 候选带 → history 带，带内 canonical order），可快照测试 |
| `Home` / `End` | 跳到 `traversal` 序的首 / 末元素 |
| `Enter` / `Space` | 节点（含幽灵节点）→ 打开 inspector 并把焦点移到 inspector 标题；`proposed` 边 → 跳到对应提案（焦点落到提案行）；`supersedes` 边 → 焦点移到替代者节点并打开其 inspector |
| `Delete` / `Backspace` | 仅 `requires` 边：stage 删除该边（等价于 inspector 的移除按钮） |
| `Esc` | 关闭 inspector；再按把焦点移到 skip 链接（不丢焦点、不留在图内） |
| `?` | 朗读键位说明（`aria-describedby` 指向的同一份文本，也可展开查看） |

**待 W0-3 实测确认的浏览器差异点**：SVG 内的 `<g>` 能否稳定获得 DOM 焦点（各浏览器/AT 表现不一）。
若不能，退路是把可聚焦元素改为 SVG `<a>`（带 `tabindex`）或用 `foreignObject` 承载 HTML 按钮；
两者都不改变本节的键盘语义。

**播报与焦点可见**

- 每次移动用克制 live region 播报位置与状态：`D2 · Build，前置 2/3，等待前置`。
- 当前项画 focus ring（SVG 内 `rect`，2px `--charter-brand` + `outline-offset` 等效间距）；
  forced colors 下改用线型/`Highlight` 系统色，不依赖色相。
- selection 与 focus 视觉可区分且可叠加：selection = 底色 + 左侧 3px 条；focus = 2px 外框。

**列表 ↔ 图焦点往返**：列表行的"在图中定位"→ 焦点进入复合控件并落到对应节点；inspector 的"在列表中定位"
→ 焦点回到**来源那一行**（保留来源元素引用）。这是 §5.7 对 dependency 跳转的既有要求。

**不需要隐藏的语义列表副本**：可见列表就是语义面（§3.1）。

**降级（三级，D5）**：`navigables > 60` → ① 关闭 history 泳道（不产出幽灵节点与 `supersedes` 边；替代关系仍可在
inspector 与列表看到）；仍 > 60 → ② 深度锁 1；仍 > 60 → ③ 隐藏图形区并提示。每级都用 live region 播报实际计数
与降级原因，且**不减少任何可用能力**（D17）。

**触控与视觉**：44×44 CSS px 下限（D7）；状态不只靠颜色（图标 + 文本）；reduced motion 下无布局动画、
高亮过渡关闭。

### 3.6 交互状态机

**单一真源**：`selectedItemId` 是唯一选中状态，列表、图、inspector 都从它派生；staged ops 只有 draft store
一份，三处渲染都从 `buildRelationGraph(committed, projected, ops)` 派生。因此"图与列表不一致"在结构上不可能。

| 场景 | 行为 |
| --- | --- |
| 选中节点被列表筛选掉 | 选中态**保留**（selection 与 filter 解耦）；列表侧显示"当前选中项不在筛选结果内" + "清除筛选"；图侧继续高亮 |
| Apply 中 revision conflict / rebase | staged ops 保留（既有行为），图上三态由 ops 派生因此自动同步；rebase 后若某条 staged 边端点已不存在，该 op 变非法 → 走既有错误摘要路径，焦点移到对应 relation control（§5.7 既有要求），图上该边标为"需要处理" |
| unknown outcome | 图与列表一样进入禁用态（`unknownBlocked`）：拖拽与选中禁用，只保留导航；不得用 `Esc` 绕过确认或写锁 |
| 图上 stage 一条边后在列表改同一 `requires` | 两处写**同一 ops 数组**，`deliverable.requires` 是**整数组替换**语义，后写覆盖前写；两侧都从 ops 派生渲染。需一条等价性测试锁死 |
| 焦点节点被另一端 purge/archive | 清空选中、焦点回列表首行、live region 播报原因；不做静默重选 |
| 焦点项因 staged 变更消失（例如删除边后该边不再渲染） | 焦点按 `traversal` 序移到最近的仍存在元素；若整个图变空则按 D12 隐藏图形区并把焦点移到 skip 链接位置 |
| 窄屏（容器宽度不足，断点由 W0-1 定） | 图形区折叠为可展开区域（默认收起），列表全宽；若焦点原在图内，折叠时把焦点移到展开控件并播报 |
| 记录状态变为 invalid / absent-unconfirmed / write-uncertain | 随整个 Workspace 编辑面进入既有只读/恢复态，不新定义行为 |
| 用户点「隐藏图形」 | 仅视觉偏好；若焦点在图内，先移到列表被选中行；所有能力保持可用（D17） |

### 3.7 视觉与缩放规格

**几何（全部 em，D19）**

以下数值满足两条硬不变式，否则节点必然重叠（W0 原型实测：违反时 6 节点样本出现 9 处重叠）：

```text
RANK_PITCH > NODE_W + 边间距        （横向不重叠）
ROW_PITCH  > 最大节点高 + 行间距     （纵向不重叠）
LINE_CAPACITY = floor((NODE_W − 2 × padding) / 摘要字号)   （由几何推导，不是魔数）
```

| 项 | 值 | 推导 |
| --- | --- | --- |
| 单位 | `--charter-graph-unit: 1em`（继承根字号）；布局输出无量纲单位，渲染层乘以该 unit | D19 |
| 节点宽 | `10em`（min `9em` / max `12em`） | 初始视图宽度约束（见下） |
| rank 列间距 | `12.5em` = 节点宽 `10em` + 边间距 `2.5em` | 横向不重叠 |
| 同 rank 行间距 | `5.5em` = 最大节点高 `4.5em` + 行间距 `1em` | 纵向不重叠 |
| 节点盒 | 高取 `3em` / `4.5em` 两档，且 `min-height: max(3em, 44px)` | D7 触控下限 |
| 节点圆角/边框 | 7px / 1px `--charter-border-soft` | 与现有 `charter-dependency` 行一致 |
| 每行容量 | `LINE_CAPACITY = floor((10 − 2×0.625) / 0.78) = 11`（CJK 计 1，拉丁/数字计 0.5） | 由几何推导；**偏保守**，W0-2 用真实渲染行数校准 |
| 节点文本 | HTML 层：`D<n>` 用 `--charter-brand` `0.6875em`/700（复用 `charter-dependency__key` 语言），摘要 `0.78em`，状态 `0.6875em` tertiary | 与现有列表视觉一致 |
| 边 | 三次贝塞尔水平走向，1.5px，箭头 8px，`vector-effect: non-scaling-stroke` | — |
| hit 线 | 同路径、透明、命中宽 ≥44px 等效 | D7 |
| 候选泳道 | 执行拓扑底边下方 `2.5em`，1px 虚线分隔 + 泳道标题"候选（未进入执行序）"；候选列对齐到"其候选边指向的最大 rank"（**裁剪后需重新基准化**），同列内按 canonical order 堆叠 | W0 实测：按 groupRank 分组在裁剪后会重叠，必须按基准化后的列分组 |
| history 泳道 | 候选带底边下方 `2.5em`，1px 点线分隔 + 泳道标题"已替代（不在执行序）"；列对齐到 `supersedes` 链最近的 active 节点列，同列内按 canonical order 堆叠 | 与候选带同构，不引入第三套定位规则 |
| 图形区高度 | 基础 `22.5em`；附加带（候选 / history）按带内实际行数增高（`行数 × ROW_PITCH + 2.5em` 分隔），空带不占高度；「适应窗口」按钮；内容超出用 transform，不撑高卡片 | 附加带只增高度、**不增宽度**（列对齐到已有列） |

**画布尺寸结论（W0 原型实测，根字号 16px）**

| 视图 | 尺寸 | 像素 | 是否需平移 |
| --- | --- | --- | --- |
| depth 1（默认，3 列：前置 / 焦点 / 依赖方） | `2×12.5 + 10 = 35em` | ≈560px | 否，图形列 ≥600px 即可完整显示 |
| depth 2（5 列） | `4×12.5 + 10 = 60em` | ≈960px | **是**，需平移或「适应窗口」 |

因此：**默认深度必须是 1**（D2），depth 2 是用户显式切换并接受平移；「适应窗口」在 depth 2 下会把文本缩到
约 0.6 倍，故适应窗口只做定位辅助，不作为阅读模式（200% 缩放场景下尤其如此）。

**ego 裁剪后必须重新基准化 rank**：裁剪出的子图要把最小 rank 归零后再算坐标，否则画布左侧留出大片空白
（W0 原型实测：未基准化时 5 节点子图仍占 `70em` 宽）。

**文本夹取与溢出的实现契约（回答 200% 缩放）**

1. 摘要**最多 2 行**：`display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden; text-overflow: ellipsis`。
2. **行数是纯函数**：`labelLines(text) = weight(text) <= LINE_CAPACITY ? 1 : 2`，其中
   `weight` 按字符计权（CJK 计 1，拉丁/数字/空格计 0.5），
   `LINE_CAPACITY = floor((NODE_W_EM − 2 × NODE_PADDING_EM) / SUMMARY_EM) = floor((10 − 1.25) / 0.78) = 11`
   ——即**每行约 11 个 CJK 字符或 22 个拉丁字符**，两行合计约 22 CJK / 44 拉丁。
   节点高度只由 `labelLines` 决定（`3em` / `4.5em`），**不做运行时文本测量**，因此布局确定性成立、快照测试可行。
   该常量**偏保守**（按参考字号的等宽估算，未按实际字体度量）：保守方向只会让节点偏高，不会溢出；
   W0-2 用"纯函数行数 vs 真实渲染行数"逐节点校准，若实测长期偏保守可上调常量（上调后必须重跑零重叠验收）。
3. 200% 文本缩放下，因为节点盒与文本都以 em 表达，两者**同比放大**，夹取行为不变（行数不变、溢出仍由 CSS
   省略号处理），不会溢出节点盒。
4. 完整正文永远可得：accessible name 含**未截断**摘要、inspector 可展开全文、hover/focus 提供等价 tooltip；
   tooltip 不承载唯一信息（§5.7）。
5. **单一变换**：SVG 与 HTML 标签层放在同一个 `position: relative` wrapper 内，缩放/平移只对 wrapper 施加
   **一个** CSS transform（`translate + scale`），两层天然同步，不存在各自变换导致的错位。
6. 确定性边界：`layoutRelationGraph` 的输出只依赖 model 与 `{focusId, depth}`，**不依赖字体、DPR、容器宽度**；
   容器宽度只影响 viewBox 缩放比例（渲染层职责），不影响相对坐标。

**状态 → 视觉映射（每行都有非颜色冗余）**

| 状态 | 颜色 token | 形状/图标 | 文本 |
| --- | --- | --- | --- |
| ready | `--charter-success` 左侧 3px 条 | ✓ | `可推进` |
| waiting | `--charter-border` | 时钟 | `等待前置` |
| in-progress | `--charter-brand` | 半环 | `进行中` |
| blocked | `--charter-warn` | 阻塞 | `已阻塞` |
| dependency-conflict | `--charter-danger` 边框（与现有 `is-dependency-conflict` 一致） | 感叹 | `依赖冲突` |
| terminal | 降饱和 | 勾选 / 叉 | `已完成` / `已取消` |
| candidate 节点 | `--charter-surface-2` 底 + 虚线边框 | 虚线 | `候选` |
| staged-added | brand 30% 外描边 | 角标 | `新增` |
| staged-removed | 40% 不透明 + 删除线 | 角标 | `删除` |
| history（幽灵）节点 | 点线边框 + tertiary 文本（**不**降不透明度，与 `staged-removed` 区分） | 点线 | `已替代` |
| 需要处理（rebase 后非法边） | `--charter-warn` 虚线 | 感叹 | `需要处理` |

**高亮联动**：hover/focus 节点 → ego 边与邻居用 `--charter-brand`，其余降到 45% 不透明**但文本标签保持可读**
（不做纯淡出）；hover 与 focus 共用同一套样式。

**forced colors**：所有状态改用边框线型（实线/虚线/双线）+ 图标形状区分；focus ring 用 `Highlight`；
颜色不作为唯一通道。

**动效**：只用 `--charter-duration` / `--charter-ease` 做高亮与 inspector 过渡；无布局动画；
`prefers-reduced-motion` 下全部关闭。

**三态文案**：无边（D12 隐藏图形区并说明）；有边但 ego 为空（"该交付物暂无前置与依赖"）；
D5 第一级（"关系过密（N 个可导航元素），已隐藏替代关系"）；D5 第三级（"关系过密（N 个可导航元素），已隐藏图形，
请使用列表"）。

### 3.8 明确不改动的清单

record schema、v1→v2 迁移、fork 重映射、Host service、Remote/wire、prompt 投影与字节、
`engines.dsh` / peer ranges / `dshReleases`、恢复与归档缓存。

只新增：`src/client/relation-graph.ts`（语义层 + 几何层纯函数）、CharterPane 的图形区与 inspector、CSS、
locales（中英）、客户端测试。

### 3.9 新增 i18n 键（中英成对，D16）

键名与**最终中英文案**见 §10.9（44 个键，含拖拽非法落点原因、窗口化定位、候选环提示、替代关系等）。
文案以 §10.9 为准，本节不再重复列举，避免两处漂移。

### 3.10 W0 原型门禁与交付拆分

**W0（先做，产出实测数据）**

原型位置：[`scripts/prototype/dependency-graph-w0/`](../../scripts/prototype/dependency-graph-w0/)
（受版本控制，但不在 `package.json` 的 `files` 白名单内 → 不进 tarball；不在 `tsconfig.include` 与
vitest `include` 内 → 不参与构建与测试套件）。

```bash
node scripts/prototype/dependency-graph-w0/verify.mjs        # W0-0：纯函数契约，41 项
python3 -m http.server 8124 --directory scripts/prototype/dependency-graph-w0
# 浏览器打开 http://127.0.0.1:8124/index.html              # W0-1/2/3：自带 [PASS]/[FAIL] 报告 + window.__W0__
```

| 原型 | 要回答的问题 | 方法 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| **W0-0** 引擎契约 | 几何是否零重叠、布局是否确定性、三态差集与"提升"是否正确、键盘目标解析是否符合复合控件合同、history 泳道与替代边是否符合 §10.1、D5/D10/D12/D13/D18 是否成立 | 纯函数在 Node 下直接跑（`verify.mjs`，无需浏览器） | 41 项全绿（见下） | **已通过** |
| **W0-1** 两栏可用性 | 图形区 + 常驻列表在 860/900/1000/1100/1200px 下是否可用；断点定在哪 | 用现有真实行结构（长摘要 + 状态 + `requires` + multiple select）逐档自动测量 | 列表无横向溢出、无溢出行、列表列 ≥20em、select ≥44px、图形列 ≥20em；据此**写定**断点 | 原型就绪，**待浏览器实测** |
| **W0-2** 200% 文本 + HTML 标签层 | em 几何 + 2 行夹取 + 单一 transform 是否不溢出、不错位；`LINE_CAPACITY=11` 是否与真实渲染行数一致 | 100%/150%/200% 三档，自动比对纯函数行数 vs 实测行数、标签溢出、SVG↔标签层偏差、渲染后重叠、触控高度 | 五项全部零偏差；行数不一致则校准 `LINE_CAPACITY` 并重跑 W0-0 零重叠 | 原型就绪，**待浏览器实测** |
| **W0-3** 复合控件 DOM 合同 | 图形区是否只占 1 个 Tab 停靠；roving tabindex 是否恒为 1；SVG `<g>` 能否获得 DOM 焦点；Esc 出口是否落到 skip 链接 | 自动统计 Tab 停靠数、模拟按键、检查焦点落点 | Tab 停靠 =1；skip→列表 ≤2 次 Tab；roving 恒为 1；SVG 焦点可用（否则改 SVG `<a>`/`foreignObject`，键位语义不变） | 原型就绪，**待浏览器实测** |
| **W0-人工** | 真实文本缩放、forced colors、reduced motion、屏幕阅读器播报、触屏命中区 | 真实浏览器 + VoiceOver/NVDA | 见原型页尾清单 6 条 | **待人工** |

**W0-0 验收范围与结果（Node 侧，可一键复跑）**

覆盖的是复合控件合同中**所有可脱离 DOM 判定的部分**：

- §3.7 几何不变式（`RANK_PITCH > NODE_W`、`ROW_PITCH > 最大节点高`）、`LINE_CAPACITY` 由几何推导、
  节点高度只有两个离散档位、`labelLines` 纯函数性；
- 10 个焦点 × 2 个深度共 **20 组组合零节点重叠**，且每组 `minX = 0`（ego 裁剪后 rank 已重新基准化）；
- 画布宽度：depth 1 = `35em`（≈560px，初始视图可容纳）、depth 2 = `60em`（≈960px，需平移）；
- §3.3 布局确定性（两次输出字节一致，4,467 字节）；
- §3.3 三态由 `committed ↔ projected` **差集推导**（非外部声明）：节点 `staged-changed`、边同时存在
  `committed`/`staged-added`/`staged-removed`；
- §3.3 **"提升"规则**：接受候选提案后，候选节点进入执行泳道并获得 `D<n>`、候选边消失、同端点出现
  `staged-added` 的 requires 边；
- §3.5 键盘合同：`←/→` 只沿 `requires`（候选边不混入）、`[`/`]` 遍历**覆盖 18/18 全部可导航元素**
  （含 3 条候选边）、`traversal` 与 `navigables` 一致且无重复、`↑/↓` 不跨列不跨泳道、`Home/End` 落在首末；
- D10 候选节点无 `localKey`/`rank`/`executionDisplay`，候选泳道位于执行拓扑下方；执行泳道节点 `D<n>` 与拓扑序同源；
- D18 默认焦点命中被 `executionDisplay` 掩盖的冲突节点（依据 `prerequisiteStatus`）；
- D5 **三级**降级：枢纽 20 前置（41 可导航）不降级；40 前置（81 可导航，无 history 带）→ `depthReduced` 后仍超 →
  `hidden`；20 前置 + 40 幽灵（141 可导航）→ **先** `supersedesHidden`（关 history 带后 41 可导航，不再继续降级）；
- §10.1 替代边与 history 泳道（13 项）：幽灵节点无 `localKey`/`rank` 且 `ghost === true`；`supersedes` 边只读且可被
  `[/]` 到达；history 带在候选带之下；本次 staged 的替代两端都留在执行泳道且**不生成**幽灵（`item-b` =
  `staged-removed`、`item-a2` = `staged-added`、边 `staged-added`）；撤销替代 → 边 `staged-removed` 且旧条目回到执行泳道；
  链式替代 `item-a1 → item-a0 → item-a` 的两个幽灵与最近执行节点**同列**；替代成环 + 悬空引用不崩溃、输出确定、
  零重叠；`showSupersedes: false` 时模型不含 history 节点与 `supersedes` 边（10 → 5 可导航）；只有 `supersedes` 边时
  D12 仍启用图形区；`←/→` 在非 `requires` 边与幽灵节点上一律返回 `null`；替代场景 `traversal` 10 = 节点 5 + 边 5；
- D2 规模控制：70 节点长链下 ego depth1 只剩 3 节点 / 5 可导航；未给 `focusId` 时也按 D18 裁剪，不存在全图模式。

**不在 W0-0 范围**（必须真实浏览器/AT，见 W0-3 与 W0-人工）：Tab 停靠数的真实计数、roving tabindex 的
DOM 行为、SVG 元素可聚焦性、200% 文本缩放下的实际溢出、两层实际对齐、屏幕阅读器播报、forced colors、
reduced motion、触屏命中区。

W0-1/2/3 与人工项的**执行步骤**见 §10.11，参数**定稿规则**见 §10.10。跑完后把结果写回本文；未通过则回到设计
（退路见 §4 风险表：压缩列表行 → 上下堆叠 → 放弃 HTML 标签层改用 SVG text → 放弃图形区改做增强列表）。

**W1–W3（W0 通过且 roadmap 批准后才启动）**

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| W1 | `buildRelationGraph` + `layoutRelationGraph`；ego 裁剪；三态差集；候选泳道；traversal 序 | 三态差集单测（含"提升"规则）；确定性快照（同输入两次同输出）；rank/order 与 `dependencyProjection` 同源；布局 p95 实测记录 |
| W2 | SVG/HTML 渲染 + 复合控件键盘模型（§3.5）+ 状态机（§3.6）+ 视觉规格（§3.7）+ 窄屏与三态文案 | DOM 测试（role/name/state/focus、roving tabindex、skip 链接、键位表、tie-break、焦点往返、**D17**、D5 降级、D12 隐藏）；真实浏览器人工门禁（200% 缩放、forced colors、reduced motion、screen reader）；SVG mount→首帧与 hover 帧率实测；真实 bundle delta |
| W3 | 拖拽 staging + 实时校验 + inspector 编辑 | 拖拽与列表 select 产生的 op **逐字段相同**且 `previewDigest` 相同；非法目标被拒并给出原因；触屏与键盘路径等价 |

性能处理原则：规模已被 D2/D5 限死，**性能风险由设计消除，实测作为验收记录而非前置门槛**。
若 W1/W2 实测超预算（ego 布局 p95 > 8 ms 或首帧 > 100 ms），固定降级路径为：关 history 泳道 → 深度锁 1 → 下调 D5 阈值 →
隐藏图形区。

## 4. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 用户期待"改一条、关联条目自动跟着改" | §6.4 规则 12 明确禁止；`deps.graphHint` 与 inspector 写清"图不会自动改状态，冲突需你显式处理" |
| 图上编辑破坏 Change Set 原子性 | D4：图只 stage ops；Apply 保持唯一提交点与 previewDigest 校验；W3 等价性测试兜底 |
| SVG 内 ARIA 跨 AT 不一致 | 只用 `role="button"`/`role="link"` + roving tabindex + `aria-label`；不用 SVG list 语义；W0-3 用真实 AT 验证 |
| Tab 陷阱 / 键盘用户到不了列表 | D5 复合控件（图 = 1 个 Tab 停靠）+ 前置 skip 链接，卡片外到列表 ≤ 2 次 Tab |
| 200% 文本缩放导致节点溢出或两层错位 | D19：全 em 几何、离散高度档位、纯函数行数、单一 wrapper transform；W0-2 实测把关 |
| 大图不可读 | D2 只做 ego 图 |
| pending 节点被误读为执行序 | D10：不给 rank/`D<n>`，独立泳道 + "未进入执行序"写进 accessible name 与角标 |
| 引入图形库导致 bundle 与无障碍失控 | D6 自研，零新依赖；W2 记录真实 bundle delta |
| 与 512 性能验收混淆 | 明确区分 core read/planning 与客户端布局/渲染两个性能面 |
| 把图形视图误当作已满足 §6.5 | D15 明确划界；§8 独立跟进 |
| 参考实现事实漂移 | §2.2 固定观察版本/日期/对象/方法，并写明升级后需复核 |
| W0-1 两栏在目标宽度下不可用 | 固定回退顺序：压缩列表行（摘要单行夹取 + select 收进 inspector）→ 改上下堆叠 → 降低图形区权重。**不回退到形态 B**（§0.2） |

## 5. 测试与验收

- **纯函数**：`buildRelationGraph` 三态差集全矩阵（节点 4 态 × 边 3 态 × 三类边 × 提升规则）；
  `layoutRelationGraph` 确定性快照 + `labelLines`/高度档位纯函数性；ego 裁剪深度 1/2；`traversal` 序稳定性；
  D5 降级与 D12 隐藏判定。
- **DOM 测试**：复合控件只有 1 个 Tab 停靠；roving tabindex 当前项唯一；skip 链接存在且顺序在图形区之前；
  键位表逐条（←→↑↓ / Home / End / Enter / Delete / Esc / ?）；多候选 tie-break 与 wrap；列表↔图焦点往返；
  拖拽 op 与列表 select 路径逐字段相同且 `previewDigest` 相同；非法目标被拒并给出原因；窄屏折叠 + 焦点迁移；
  `unknownBlocked` 下拖拽禁用；**D17（隐藏图形后所有操作仍可在列表完成）**。
- **实测记录**（不是承诺值）：ego 布局 p95、SVG mount→首帧、hover 帧率、构建前后客户端 bundle 字节差。
- **真实浏览器人工门禁**：200% 文本缩放、forced colors、reduced motion、screen reader 组合（沿用 §5.7）。
  `react-test-renderer` 属性断言不能单独作为通过证据。
### 5.1 产品级验收场景（形态 A 已确认）

技术验收之外，必须逐条走查下列场景。除标注外均在真实浏览器 + 真实 DSH profile 上人工执行，
可自动化的部分同时落 DOM 测试。

| # | 场景 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| S1 | **不看列表也能判断上下游与阻塞原因** | 打开 Workspace，焦点落在默认焦点节点（D18） | 能在图上直接说出：它的前置是谁、依赖它的是谁、当前为什么不能开始（`waiting` / `dependency-conflict` / `blocked`），且 inspector 与图上一致 |
| S2 | **发现并处理一个依赖冲突** | 把某交付物进度改为 `in-progress`，其前置仍未 `done` | 图与列表同时出现冲突标识（颜色 + 图标 + 文本三重表达）；Change Set 面板标注"新增冲突"并要求二次确认。**二次确认依赖 §8 的独立修复**；在该修复落地前，本场景只验"冲突可见"，不得记为完全通过 |
| S3 | **从图新增一条依赖** | 拖 D3 的 handle 到 D5 | Change Set 出现一条 `deliverable.requires` op；与在列表 select 勾选 D3 产生的 op **逐字段相同**、`previewDigest` 相同；Apply 后记录与走列表路径的结果一致 |
| S4 | **从图删除一条依赖** | 选中 D2→D5 边按 `Delete` | 同 S3 的等价性要求；撤销（unstage）后图与列表同步回到原状 |
| S5 | **接受一批互相依赖的提案前预览形状** | 在 Review Center 暂存接受 `p-limit`（其 `proposedRequires` 指向 D2） | 图上候选虚线边**提升**为实线"新增"边、候选节点迁入执行泳道并获得 `D<n>`；用户能在 Apply 前看懂接受后的依赖形状 |
| S6 | **archive/purge 一个有入边的节点** | 对一个被依赖的交付物执行 archive | 图上高亮受影响的入边/出边并提示"必须在同一 Change Set 清边或重定向"（§6.4 规则 7/8）；未处理时 Apply 被既有结构校验阻断，错误摘要能把焦点带到对应控件 |
| S7 | **纯键盘走完全流程** | 只用键盘 | 卡片外 ≤2 次 Tab 到列表；进图后 `←→↑↓` / `[` `]` / `Home` / `End` / `Enter` / `Delete` / `Esc` 全部可用；**纯键盘完成 S3 与 S4**；`Esc` 焦点回到 skip 链接而非丢失 |
| S8 | **窄屏完成同样操作** | 容器宽度低于 W0-1 定稿断点 | 图形区折叠且说明原因，列表全宽；S3/S4 通过列表 select 完成，**能力无损失** |
| S9 | **隐藏图形区后能力不变（D17）** | 点「隐藏图形」 | 所有操作仍可在列表完成；无孤儿状态（选中项、staged ops 保持一致）；重新显示图形后状态与列表一致 |
| S10 | **200% 文本缩放 + forced colors 下完成 S1/S2** | 浏览器文本缩放 200%，并开启高对比度 | 节点文本不溢出、边与标签不错位、状态仍可区分（不依赖色相）、focus ring 可见 |
| S11 | **看清"谁替代了谁"并在 Apply 前确认** | 存在一条已提交的替代关系；再 stage 一次 `item.supersede` | 已提交的替代：被替代项以幽灵节点出现在 history 带、点线边标"替代"、`Enter` 打开只读 inspector；本次 staged 的替代：两端都在执行带并标"删除"/"新增"、边标"（本次替代）"；幽灵节点不可编辑、不接受拖拽落点；关闭"显示替代关系"后列表与 inspector 仍能读到替代信息 |

S2 的"二次确认"、S3/S4 的 `previewDigest` 等价性是本提案最容易在实现中被悄悄削弱的两条，
必须各自有自动化测试，不接受只靠人工走查。
- **发布门禁**：兼容矩阵（全部已声明版本 + untracked）重跑并重新绑定证据（§0.3 第 9 条）。

## 6. 迁移

无。本提案不改 record schema、不改 storage、不新增 domain、不改 Remote/wire，因此没有数据迁移、
没有 v1 兼容分支、没有 fork 语义变化。旧记录与新记录在图形视图下表现一致（差异只来自是否已有 `requires`）。

## 7. 需要同步修改的文档（实施时）

- [version-roadmap.zh.md](version-roadmap.zh.md)：把"依赖关系图形化视图"写入 `0.2.2` 或 `0.3` 范围，
  并说明对里程碑与 feature-freeze 的影响（**实施前必须完成**）。
- [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md)：§5.3 补图形区的信息架构，§5.7 补复合控件的
  语义与键盘合同条目（引用本文 §3.5）。**不改动 §5.7 现有 canvas 条款**（§1.3.1）。
- [docs/README.md](../README.md)：本文状态已更新为 `Implemented — pending release acceptance`；发布前仍需补齐真实浏览器/AT 证据。
- [user-guide.zh.md](../user-guide.zh.md) / [user-guide.md](../user-guide.md)：图形区使用说明，
  以及"图不会自动改状态"的说明。

## 8. 独立事项（不属于本提案）：§6.5 conflict 确认缺口 —— **已修复（2026-11-10）**

**这是现有产品的正确性缺口，不是图形视图的附属功能。** 缺口已按 §10.14 的方案在当前分支修复并带测试；
与图形视图解耦，可先于其发布。修复落在：`src/core/dependencies.ts`（`dependencyConflictDiff`）、
`src/core/change-set.ts`（`PlannedChangeSet.dependencyConflicts`）、`src/host/service.ts` +
`src/host/types.ts`（预览透传）、`src/remote/wire.ts`（optional 字段）、`src/client/CharterPane.tsx` +
`locales.ts` + `charter.css`（冲突清单与两步确认）。

- **设计要求**：[charter-workspace-v2.zh.md:507](charter-workspace-v2.zh.md) ——「Change Set 必须醒目标出
  新增或加重的 conflict，并要求用户确认」。
- **现状证据**：`PlannedChangeSet`（[src/core/change-set.ts:12](../../src/core/change-set.ts)）只有
  before/after/changes/summaryDigest/promptChanged/metadataOnly，**没有任何 conflict 字段**；
  客户端 `dependencyConflict` 只在 `dependencyProjection` 抛错时为真
  （[src/client/CharterPane.tsx:841](../../src/client/CharterPane.tsx:841)），而它只会因**成环**抛错；
  `validateDependencyGraph` 也只校验结构。
- **复现路径**：`item-a`（not-started）← `item-b`（`requires: [item-a]`，not-started，状态 `waiting`）；
  对 `item-b` 执行 `deliverable.progress → in-progress`。按 §6.5 规则 2 应判定 `dependency-conflict`，
  而 `planChangeSet` 输出无任何 conflict 信号，Apply 无需额外确认即成功。
- **修复范围（已完成）**：core 侧 planner 输出 before/after 的 conflict 差集（新增/加重）；client 侧在 Change Set
  面板醒目标注 + Apply 前显式两步确认；core / wire / DOM 测试共 15 条；图形语义/几何/界面测试另计，当前 `npm run check` 为 37 文件 / **466** 通过。
- **版本归属**：`0.2.2` 必修，不与图形视图绑定发布（roadmap 写入见 §10.13-G1）。
- **修复方案与实现差异**：见 §10.14（其中记录了最终字段形状与方案的三处差别）。

## 9. 决策记录与待办

**已确认（2026-11-09）**

1. **形态 = A**（图形增强，语义列表常驻且为权威操作面），不回退到 B；W0-1 若不过关按 §0.2 的回退顺序处理。
2. **D1 版本归属 = `0.2.2`**（纯客户端补丁线）。
3. **W0 三个原型一起做**（A 已定，W0-1 的前提具备）。

**已完成**

- **W0-0 引擎契约**：41 项全绿，一键复跑 `node scripts/prototype/dependency-graph-w0/verify.mjs`（范围与结果见 §3.10）。
- **§5.1 产品级验收场景**：S1–S10 已落笔。
- 原型迁出易失的 `.tmp/`，改为受版本控制的 [`scripts/prototype/dependency-graph-w0/`](../../scripts/prototype/dependency-graph-w0/)
  （不进 tarball、不参与 typecheck/build、不计入测试套件）。

**未尽事项的做法**

全部写在 **§10**，每项都是"怎么做"而不是"待定"：

| §10 | 内容 |
| --- | --- |
| 10.1 | 替代边 v1 **一体实现**：history 泳道 + 幽灵节点推导 + 三态 + 列归属 + 只读边界 + 8 条测试 |
| 10.2 | 候选泳道列归属公式（`base` + `candRank`）、候选环防护、跳位的处理与兜底 |
| 10.3 | 拖拽 staging 的句柄、合法/非法反馈、触屏等价路径、与平移缩放的手势冲突 |
| 10.4 | 缩放/平移选定 CSS transform、档位、最小缩放 0.75、平移边界、键盘与滚轮分工 |
| 10.5 | 语义列表窗口化规则 + 图与列表集合不一致时的双向定位 |
| 10.6 | 中英混排 `LINE_CAPACITY` 的分语言校准规则 |
| 10.7 | live region 去抖（连续移动 150ms，离散操作立即） |
| 10.8 | 键位说明的可见入口（与 `aria-describedby` 单一来源） |
| 10.9 | 44 个 i18n 键的最终中英文案 |
| 10.10 | 8 个待定参数的**兜底值 + 测量方法 + 决策规则** |
| 10.11 | W0-1/2/3 与人工清单的执行步骤、取数方式、结果写回位置 |
| 10.12 | SVG 可聚焦元素的四级实现预案（键盘语义不变） |
| 10.13 | roadmap / v2 设计 / user-guide / 索引 / 矩阵的具体改动文本 |
| 10.14 | §6.5 conflict 缺口的完整修复方案（core 字段、digest 兼容性论证、两步确认、测试） |

推进顺序：§10.11 实测 → 按 §10.10 规则定稿参数 → §10.13-G1 写入 roadmap → 启动 W1。

**已确认（用户决定，本轮）**

4. **§6.5 conflict 确认缺口**：**修**。已按 §10.14 落地为产品代码——core `dependencyConflictDiff` +
   `PlannedChangeSet.dependencyConflicts` + Host 预览透传 + wire 可选字段（老 Host 帧仍可解码）+
   Pane 冲突清单与两步确认 + 中英文案 + 15 条冲突测试。独立于图形视图，可先于其发布。
5. **替代边**：v1 **一体实现**（§10.1 的 history 泳道 + 幽灵节点方案），不再退化为纯文本呈现。
   D11/D12、§3.3 接口、§3.4 节点与边集合、§3.5 语义与键位、§3.7 几何与视觉、§5.1 S11、§10.9 文案已同步。

## 10. 未尽事项的实现方案

本节把此前标记为"未定/未测"的每一项都给出**做法**。需要实测才能定的参数一律给
**兜底值 + 测量方法 + 决策规则**：实现可以先按兜底值开工，实测后只调参数、不改结构。

### 10.1 替代（`supersedes`）边与 history 泳道：v1 一体实现

**决定**：v1 实现三类边。`supersedes` 由独立的 `history` 泳道承载，端点是**幽灵节点**，
因此执行泳道"rank = 执行序"的语义完全不受影响；替代不再只是文本，图形视图不是半成品。

**节点与边推导（语义层，纯函数）**

```text
visible = execution 泳道节点 ∪ candidate 泳道节点
relations = ∅
对每个 n ∈ visible：
  for id ∈ n.supersedes    → relations += (old = id,   new = n.id)
  for id ∈ n.supersededBy  → relations += (old = n.id, new = id)

ghost(old) 成立当且仅当三条同时满足：
  ① old 在 committed 与 projected **两侧都不是** active deliverable
     （active = accepted + current；archive / purge / reject / superseded 出局都算 inactive）
  ② old ∉ visible                       —— 避免与执行泳道的 staged-removed 节点重复
  ③ showSupersedes === true              —— 默认 true；D5 第一级降级时为 false

边：对每条 (old, new)，若两端都在最终节点集合中 → 产出 kind: 'supersedes'、from = old、to = new
三态：committed 有 / projected 无 → staged-removed（替代被撤销、replacement 被 archive|purge）
      committed 无 / projected 有 → staged-added（本次 staged 的 item.supersede）
      两侧都有                    → committed
链式替代 old → mid → new（mid 也 inactive）：两条边都产出，mid 也是幽灵节点
```

**列归属与带序（几何层）**

```text
colOf(g) = col(a)，a = 从 g 出发沿 supersedes/supersededBy 链、在 visited 保护下到达的第一个 execution 节点
         = 0     若整条链都 inactive（没有 active 对端）
带序（y 递增）：execution → candidate → history；**空带不占高度**
带内同列按 canonical order（compareOrderedItems）堆叠，行间距 ROW_PITCH
```

`supersedes` / `supersededBy` 由 `item.supersede` 成对写入，链本身是单向的；但历史记录可能因迁移或人工修复
而不一致，因此链遍历**必须带 visited 集合**，遇环时取 `colOf = 0` 并停止展开（不崩溃、不死循环、输出仍确定）。

**只读边界（不新造写路径，D17）**

- 幽灵节点与 `supersedes` 边都不接受 `Delete`、不作为拖拽落点、inspector 中不出现编辑按钮。
- 幽灵节点的 inspector：只读正文 + "已被 `<替代者摘要>` 替代" + "在列表中定位"（列表里该行本就存在）。
- `Enter`：幽灵节点 → 打开只读 inspector；`supersedes` 边 → 焦点移到替代者节点并打开其 inspector。
- 撤销替代走既有 lifecycle 操作（restore / archive / purge），图形视图不提供第二条写入语义。

**D5 计数与降级顺序**

幽灵节点与 `supersedes` 边都计入 `navigables`（它们可导航）。三级降级顺序为：
① **关 history 泳道**（一次去掉全部幽灵节点与替代边）→ ② 深度锁 1 → ③ 隐藏图形区。
先关 history 而不是先锁深度：替代关系在 inspector 与列表仍有等价文本，而深度归零会直接失去执行拓扑本身。

**与 §10.2 的关系**：两条附加带共用同一套"列对齐 + 带内 canonical 堆叠"定位规则，不引入第三套算法；
候选带的 `candRank` 偏移只作用于候选带。

**测试清单（W1 语义层 / W2 渲染层）**

1. 已提交的替代：幽灵节点落在 history 带、`localKey === undefined`、`rank === undefined`、`editable === false`、
   可被 `[`/`]` 到达、`Enter` 打开只读 inspector。
2. 本次 staged 的 `item.supersede`：两端都在执行带（`staged-removed` / `staged-added`）、**无**幽灵节点、
   边为 `staged-added`、accessible name 含"（本次替代）"。
3. 撤销替代：边为 `staged-removed`，含"（本次撤销替代）"。
4. 链式替代 A→B→C（A、B 均 inactive）：两个幽灵节点、两条边，`colOf(A) === colOf(B) === col(C)`。
5. 全 inactive 链（无 active 对端）：`colOf === 0`，不崩溃。
6. `showSupersedes: false`：模型不含 history 节点与 `supersedes` 边，`navigables` 相应减少（降级第一级可测）。
7. 不一致数据成环：visited 生效，同输入同输出（确定性快照）。
8. D12：只有 `supersedes` 边、没有 `requires`/候选边时，图形区仍启用。

### 10.2 候选泳道的列归属与稳定性

**决定**：候选泳道**不继承执行泳道的列号**，改为泳道内独立定位：

```text
base(n)     = max{ col(t)      | t ∈ n.proposedRequires 且 t 是 active 节点 }，无则 0
candRank(n) = 0                                                    若 n 的候选前置全是 active
            = 1 + max{ candRank(t) | t ∈ n.proposedRequires 且 t 是 pending }
col(n)      = base(n) + candRank(n)
同 (col) 内按 canonical order 堆叠
```

- 解决"只指向 pending 的候选边"（原 C3）：pending → pending 链会按 `candRank` 依次右移，
  不再全部堆到最右列。
- **候选依赖成环的防护**：`proposedRequires` 在提案阶段**尚未**被 `validateDependencyGraph`
  校验（只有接受时才校验），因此图上可能遇到候选环。递归计算 `base`/`candRank` 必须带 visited
  集合；遇环时该节点取 `base = 0, candRank = 0`，并标记 `candidateCycle: true`，
  UI 显示"候选依赖成环，接受时会被拒绝"（不崩溃、不静默）。
- **列位置随焦点变化（原 C2）的处理**：接受这一视觉行为，因为**列位置在候选泳道不承载语义**
  （accessible name 只有"候选提案 · 摘要 · 未进入执行序"，不含列号）。为降低突兀感：
  ① 候选泳道有独立的分隔线与标题，视觉上与执行拓扑分离；② 焦点切换时候选节点位置变化使用
  `--charter-duration` 过渡（`prefers-reduced-motion` 下瞬时）；③ 若实测反馈跳动干扰阅读，
  兜底方案是候选泳道固定按 `base(n)` 分列、不做 `candRank` 偏移（退化为原规则，但保留成环防护）。

### 10.3 拖拽 staging 的交互细节

| 项 | 规定 |
| --- | --- |
| 句柄 | 节点右下角一个可见圆点 handle，命中区 ≥44×44 CSS px（含透明 padding）。`aria-hidden="true"`——拖拽**不是**无障碍路径，等价路径在 inspector 与列表 select（D17） |
| 拖拽中 | 一条跟随指针的虚线 + 候选目标高亮；pointer events 统一处理 mouse/touch/pen |
| 合法目标 | `accepted + current` 的 deliverable、非自身、加入后不成环 → brand 描边 + "添加依赖"提示 |
| 非法目标 | danger 描边 + 具体原因（"不能依赖自身" / "会形成循环" / "只有已生效交付物可作为前置"），落点无效 |
| 落点 | 合法目标 pointerup → stage 一条 `deliverable.requires`（整数组 = 现有 ∪ 新目标，canonical 排序去重）；非法目标或空白处 pointerup → 取消，无副作用 |
| 触屏等价路径 | inspector 的"添加前置"按钮打开与列表 select 等价的多选控件；不使用长按等隐藏手势 |
| 与平移/缩放的手势冲突 | handle 上的 pointerdown `stopPropagation`，不触发平移；图形区空白处 pointerdown 才平移；单指在 handle 上 = 拖拽，单指在空白 = 平移，双指 = 缩放/平移 |
| 禁用条件 | `recoveryBusy` / `unknownBlocked` / 只读态 / 图形区被隐藏时，拖拽整体禁用（handle 不渲染） |

### 10.4 缩放与平移的实现方式

**决定：CSS transform 施加在单一 wrapper 上，不用 viewBox 变换。**

- 理由：viewBox 缩放会同时缩放 stroke 与 SVG 内文本，与"浏览器文本缩放改根字号"叠加时互相干扰；
  CSS transform 对 HTML 标签层与 SVG 一视同仁，正好复用 D19 的"单一 transform"约束。
- 缩放档位：`0.75 / 1 / 1.25`，工具条按钮 + 键盘 `+` / `-` / `0`。
- **最小缩放 0.75**：「适应窗口」按内容与容器比值算 scale，但 clamp 到 ≥0.75；clamp 后仍放不下就保持
  0.75 并允许平移，**不无限缩小**（避免文本缩到不可读，也避免与 200% 文本缩放叠加后失效）。
- 平移边界：内容包围盒外扩 `1em`，禁止把内容平移出视野。
- 键盘平移：图形区容器 `overflow: auto`，用标准滚动键/滚动条，不占用方向键（方向键保留给节点导航）。
- 滚轮：`Ctrl/⌘ + 滚轮` = 缩放，普通滚轮 = 容器滚动（遵循平台惯例）。
- `prefers-reduced-motion`：缩放过渡关闭，直接跳变。

### 10.5 语义列表的窗口化（原 C6）

现状是缺陷：依赖列表全量渲染（[CharterPane.tsx:2024](../../src/client/CharterPane.tsx)
`dependencyPlan.map`，没有 `.slice(0, reviewLimit)`，而同文件其他五处列表都有窗口化）。
本方案把列表定为常驻权威面，必须先补窗口化，否则 512 条时违反 §5.7。

- **窗口化规则**：默认渲染前 `depsLimit`（初值 50，与现有 `reviewLimit` 同风格）行，
  底部"显示全部 N 条"按钮；点击后分批 +50 直到全量。DOM reading order 始终 = 拓扑序。
- **每行仍有稳定 accessible name 与位置**（"第 i 条，共 N 条"），满足 §5.7 对窗口化列表的要求。
- **图与列表集合不一致时**（焦点节点不在已渲染窗口内）：
  - 列表顶部显示"当前选中项 D7 不在已显示的前 50 条内 → [定位到该项]"，点击后扩展窗口到包含该项
    （扩展窗口，不改筛选、不改选中）；
  - 从图"在列表中定位"时**自动**执行上述扩展，保证焦点一定落到真实行（§5.7 要求焦点落到目标行标题）；
  - 反向从列表"在图中定位"时，若目标不在当前 ego 图内，则把焦点节点切到它并重算 ego，再把焦点落到该节点。

### 10.6 中英混排的 `LINE_CAPACITY`（原 C8）

- 保留权重法（CJK 计 1，拉丁/数字/空格计 0.5），常量由几何推导：
  `floor((NODE_W_EM − 2×NODE_PADDING_EM) / SUMMARY_EM) = 11`。
- **按语言分别校准**：W0-2 分别用中文样本与英文样本比对"纯函数行数 vs 真实渲染行数"。
  若某语言下超过 20% 的节点被判为偏保守（实际 1 行、算成 2 行），则改为
  `LINE_CAPACITY_BY_LOCALE = { zh: 11, en: 13 }`，并同步 §3.7 与几何不变式检查
  （行数变化会改节点高度档位，必须重跑零重叠验收）。
- 兜底安全性：常量偏差只影响高度档位，**不会丢信息**——溢出由 CSS 省略号处理，
  完整正文始终在 accessible name 与 inspector 中。

### 10.7 live region 播报节流（原 C9）

- 方向键连续移动：共用同一个 `aria-live="polite"` 区域，**150ms 去抖**，只播报最后一次
  （格式 `D2 · Build，前置 2/3，等待前置`）。
- 离散操作（`Enter` 打开 inspector、`Delete` 删边、`Esc` 退出、staging 成功/失败）**立即播报**，不去抖。
- 纯视觉变化（hover 高亮联动）不播报。

### 10.8 键位说明的可见入口（原 C10）

- 图形区工具条末尾放"键位"按钮，`aria-expanded` 控制一个 `role="region"` 的展开区，
  内容与 `aria-describedby` 指向的是**同一份文本**（单一来源，不会漂移）。
- 按钮有可见 focus ring；hover tooltip 的内容在展开区同样可见（§5.7：tooltip 不承载唯一信息）。
- `?` 键是等价快捷键，行为与点击按钮一致。

### 10.9 i18n 最终文案（原 C7）

| 键 | en | zh |
| --- | --- | --- |
| `deps.skipToList` | Skip to dependency list | 跳到依赖列表 |
| `deps.graphAria` | Dependency graph | 依赖关系图 |
| `deps.graphKeys` | Key bindings | 键位 |
| `deps.graphKeysHelp` | Arrow keys move along dependencies; [ ] browse all; Enter details; Delete removes the edge; Esc exits. | 方向键沿依赖移动；[ ] 遍历全部；Enter 查看详情；Delete 删除依赖边；Esc 退出。 |
| `deps.hideGraph` | Hide graph | 隐藏图形 |
| `deps.showGraph` | Show graph | 显示图形 |
| `deps.graphEmpty` | No dependencies yet. Add a prerequisite in the list to see the graph. | 还没有依赖关系。在列表中为交付物添加前置后即可查看图形。 |
| `deps.graphTooDense` | Too many relations ({count}). Graph hidden; use the list. | 关系过多（{count} 个可导航元素），已隐藏图形，请使用列表。 |
| `deps.depth1` | Direct neighbours | 相邻一层 |
| `deps.depth2` | Two hops | 相邻两层 |
| `deps.showProposed` | Show candidate links | 显示候选关联 |
| `deps.showSupersedes` | Show replacement links | 显示替代关系 |
| `deps.historyLane` | Replaced (outside the execution order) | 已替代（不在执行序） |
| `deps.ghostNodeAria` | Replaced · {summary} · outside the execution order | 已替代 · {summary} · 不在执行序 |
| `deps.supersedesEdgeAria` | {old} is replaced by {new} | {old} 被 {new} 替代 |
| `deps.resetLayout` | Reset view | 重置视图 |
| `deps.fitToView` | Fit to view | 适应窗口 |
| `deps.zoomIn` / `deps.zoomOut` | Zoom in / out | 放大 / 缩小 |
| `deps.candidateLane` | Candidates (not in execution order) | 候选（未进入执行序） |
| `deps.nodeAria` | {key} · {text} · {status} | {key} · {text} · {status} |
| `deps.candidateNodeAria` | Candidate proposal · {text} · not in execution order | 候选提案 · {text} · 未进入执行序 |
| `deps.candidateCycle` | Candidate links contain a cycle; it will be rejected on accept. | 候选依赖成环，接受时会被拒绝。 |
| `deps.edgeAria` | {to} requires {from} | {to} 依赖 {from} |
| `deps.edgeStagedAdded` | (added in this Change Set) | （本次新增） |
| `deps.edgeStagedRemoved` | (removed in this Change Set) | （本次删除） |
| `deps.proposedEdgeAria` | Candidate prerequisite of {to}: {from}. Enter to open the proposal. | {to} 的候选前置：{from}。回车打开提案。 |
| `deps.stagedAdded` / `deps.stagedRemoved` / `deps.stagedChanged` | Added / Removed / Changed | 新增 / 删除 / 修改 |
| `deps.needsAttention` | Needs attention | 需要处理 |
| `deps.dragHint` | Drag from the node handle to add a prerequisite. | 从节点右下角的圆点拖出即可添加前置。 |
| `deps.dropInvalid.self` | A deliverable cannot require itself. | 交付物不能依赖自身。 |
| `deps.dropInvalid.cycle` | That would create a cycle. | 这会形成循环依赖。 |
| `deps.dropInvalid.inactive` | Only active deliverables can be prerequisites. | 只有已生效的交付物可以作为前置。 |
| `deps.inspectorTitle` | {key} details | {key} 详情 |
| `deps.addPrerequisite` | Add prerequisite | 添加前置 |
| `deps.removePrerequisite` | Remove prerequisite | 移除前置 |
| `deps.locateInList` | Locate in list | 在列表中定位 |
| `deps.locateInGraph` | Locate in graph | 在图中定位 |
| `deps.selectionOutsideWindow` | Selected item {key} is outside the first {limit} rows. | 当前选中项 {key} 不在已显示的前 {limit} 条内。 |
| `deps.scrollToSelection` | Locate it | 定位到该项 |
| `deps.showAllRows` | Show all {count} rows | 显示全部 {count} 条 |
| `deps.nodeRemoved` | The focused item was removed. Focus moved to the list. | 焦点条目已被移除，焦点已移回列表。 |
| `deps.positionAnnounce` | {key} · {text}, prerequisite {index} of {total}, {status} | {key} · {text}，前置 {index}/{total}，{status} |
| `deps.graphHint` | The graph never changes status automatically; resolve conflicts explicitly. | 图不会自动修改状态，冲突需要你显式处理。 |

### 10.10 待定参数：兜底值 + 测量方法 + 决策规则

| 参数 | 兜底值（可先按此实现） | 测量方法 | 决策规则 |
| --- | --- | --- | --- |
| D5 可导航元素阈值 | 60 | W0-3 真实键盘走查：从默认焦点遍历全图所需按键数与耗时（**含 history 泳道**） | 40 个元素可在 30 秒内走完且不迷失 → 保持 60；走查者报告疲劳/迷失 → 降到 40。降级路径不变（关 history → 锁深度 → 隐藏图形区） |
| §3.7 几何常量 | `NODE_W 10em` / `RANK_PITCH 12.5em` / `ROW_PITCH 5.5em` / 高度 `3｜4.5em`（已满足两条不变式、20 组组合零重叠） | W0-2 真实字体度量 | 只允许调 `NODE_W_EM`（9–12em）与 `SUMMARY_EM`；调后必须重算 `LINE_CAPACITY` 与两条不变式，并重跑 W0-0 零重叠 |
| `LINE_CAPACITY` | 11 | W0-2 逐节点比对纯函数行数 vs 真实行数 | 见 §10.6（按语言分别校准） |
| §3.1 两栏断点 | 容器 `<880px` 堆叠（沿用现有 container query 断点集合） | W0-1 五档宽度自动测量 | 取"最小的全部 PASS 宽度"，且必须落在现有断点集合 `{880, 560, 520}` 内，不新增断点 |
| 图形区高度 | 基础 `22.5em`，附加带按行数增高 | W0-2 在 200% 缩放下确认能同时显示 ≥2 列 + 候选带 + history 带 | 不满足则提到 `26em`；仍不满足则改为容器高度自适应 + 内部滚动 |
| 最小缩放 | 0.75（§10.4 已定） | W0-2 在 0.75 + 200% 文本下检查可读性 | 不可读则把最小缩放提到 1（即禁用缩小，只留平移） |
| 性能预算 | ego 布局 p95 `<8ms`、SVG mount→首帧 `<100ms`、hover `≥50fps` | W1/W2 实测 | 超预算按固定降级路径：关 history 泳道 → 锁深度 1 → 下调 D5 阈值 → 隐藏图形区 |
| bundle delta | `<40KB` | W1 构建前后 `lib/client.js` 字节差 | 超出则复核是否引入了非必要依赖（D6 要求零新依赖） |

### 10.11 实测执行方案（A 组）

```bash
node scripts/prototype/dependency-graph-w0/verify.mjs                     # W0-0，已通过（41 项）
python3 -m http.server 8124 --directory scripts/prototype/dependency-graph-w0
# 浏览器打开 http://127.0.0.1:8124/index.html
```

1. W0-1：依次点 860/900/1000/1100/1200px，记录每档 `[PASS]/[FAIL]` 与建议断点。
2. W0-2：依次点 100%/150%/200%，记录五项（行数一致性、溢出、两层对齐、重叠、触控高度）。
3. W0-3：点"重新运行"，记录七项（Tab 停靠数、skip→列表 Tab 次数、roving 唯一性、遍历覆盖率、
   `←/→` 语义、`Esc` 落点、**SVG `<g>` 可聚焦性**）。
4. 控制台执行 `copy(JSON.stringify(window.__W0__.summary))` 取回结构化结果。
5. 人工清单 6 条（真实文本缩放、forced colors、reduced motion、VoiceOver/NVDA、触屏命中区、
   缩放+窄容器组合）逐条执行并记录到 [verification.md](../verification.md)。
6. 结果写回：§3.10 表格的状态列 → 按 §10.10 的决策规则定稿参数 → 若第 3 步的 SVG 焦点不可用，
   按 §10.12 切换可聚焦元素实现并回写 §3.5。

**当前阻塞**：本会话的浏览器自动化依赖安装失败（`install_failed`），第 1–4 步无法由我执行；
第 5 步本就是人工门禁。恢复浏览器工具后可由我执行第 1–4 步。

### 10.12 SVG 内可聚焦元素的实现选择（A3 的分叉预案）

按优先级依次尝试，选中第一个通过 W0-3 的方案，并回写 §3.5 的元素语义表：

1. `<g role="button" tabindex="0">`（首选，`dsh-context` 0.82.0 采用的就是这个形式）；
2. SVG `<a role="button" tabindex="0">` 包裹几何元素（部分浏览器只对 `<a>` 稳定给焦点）；
3. `foreignObject` 内放 HTML `<button>`（可聚焦性最好，但需处理 `foreignObject` 在缩放下的高度计算）；
4. 兜底：几何元素全部 `aria-hidden`，可聚焦元素改为覆盖在节点/边位置上的**透明 HTML 按钮**
   （与标签层同一个 wrapper，因此与图形天然对齐；这也是最保守、跨 AT 最稳的方案）。

四种方案的键盘语义（§3.5 键位表）与 accessible name 完全不变，因此切换实现不影响 W1 的语义层与布局层。

### 10.13 治理与文档同步的具体做法（G 组）

**G1 roadmap（阻断 W1，需先做）**——在 [version-roadmap.zh.md](version-roadmap.zh.md)
§16 版本边界总表新增一行，并在 §14 之后插入范围说明。可直接使用的文本：

```text
| `0.2.2` | 0.2.1 的兼容/缺陷修复；依赖关系图形视图（纯客户端，不改 record/Remote/prompt） |
          新 record schema、新 storage domain、新 Remote 方法、模型可见能力变更 |

### 14.1 `0.2.2` 新增范围：依赖关系图形视图

范围严格限定在客户端展示层：新增 `src/client/relation-graph.ts`（语义层 + 几何层纯函数）、
图形区渲染与 inspector、CSS、中英 locales 与客户端测试。不改 record schema、迁移、fork、
Host service、Remote/wire、prompt 投影与字节，不改 `engines.dsh`/peer ranges/`dshReleases`。
对里程碑的影响：不新增人工门禁类别，但新增两类实测证据（客户端布局/渲染性能、图形区无障碍），
沿用 §5.7 与 D16 的既有验收方式。feature-freeze 条件不变；W0 实测未通过则本范围整体退出 0.2.2，
不拆分半成品进版本。设计与未尽事项见 docs/design/charter-dependency-graph-v1.zh.md。
```

**G2 v2 设计同步**——在 [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md)
§5.3 Workspace 段落补一句"执行依赖卡片包含常驻语义列表与图形区两部分，图形区是附加透镜，
不提供列表之外的独有操作"；§5.7 增补一条：

```text
- 图形区是复合控件：容器为唯一 Tab 停靠点，内部元素用 roving tabindex，方向键沿关系移动，
  `[`/`]` 遍历全部可导航元素，前置 skip 链接保证一次 Tab 即可到达语义列表；
  图形区可被隐藏且隐藏后不损失任何能力。
```

**G3 user-guide 同步**——中英各补一段（放在"存储与恢复"之前的 Workspace 说明里）：
图形区的用途、键位、"图不会自动改状态"、以及窄屏行为。文本以 §10.9 的键名与文案为准。

**G4 索引状态**——实施并通过源码门禁后，把 [docs/README.md](../README.md) 的本文行状态从
`Proposed` 改为 `Implemented — pending release acceptance`，并在同一提交里更新本文头部状态块。

**G6 兼容矩阵**——实现落地后按发布门禁重跑：
`node scripts/verify/compat-matrix.mjs --versions all --allow-new-release`，
把 `sourceCommit` 与证据文件名写进 [verification.md](../verification.md) §3
（本提案不新增兼容面，但门禁不因"只是客户端"而豁免）。

### 10.14 §6.5 conflict 确认缺口的修复方案（E 组，独立于图形视图）—— **已实现**

> **实现与本节方案的三处差别**（以实现为准）：
> ① `DependencyConflictRef.before` 增加 `'absent'` 取值，用于"本批次新增的交付物一进来就冲突"；
> ② 增加 `beforeConflicts` / `afterConflicts` 两个计数，因为"加重"必须按**冲突前置的数量**判定，只比状态无法区分；
> ③ 字段在 `PlannedChangeSet` 上是**必填**（planner 一定算得出），只在 wire 上是 `optional`（老 Host 帧仍能解码）。
> 差集函数是 `dependencyConflictDiff(before, after)`，Host planner 与 Pane 共用同一个纯函数，两侧不会漂移。


**core**：`PlannedChangeSet` 增加一个可选字段（[change-set.ts:12](../../src/core/change-set.ts)）：

```ts
export interface DependencyConflictRef {
  readonly itemId: string
  readonly before: PrerequisiteStatus   // 基线快照的状态
  readonly after: PrerequisiteStatus    // 应用后的状态
}
export interface PlannedChangeSet {
  // …现有字段不变…
  readonly dependencyConflicts: {
    readonly added: readonly DependencyConflictRef[]     // before ≠ conflict 且 after = conflict
    readonly worsened: readonly DependencyConflictRef[]  // before = conflict 且 after = conflict 且冲突前置数增加
  }
}
```

计算方式：`planChangeSet` 已经持有 `input.snapshot` 与 `applied.snapshot`，对两者各跑一次
`prerequisiteStatus`（core 已有该函数），取差集即可，**不需要新的数据源**。

**digest 兼容性论证**：`changeSetPreviewDigest` 的输入是 `{version, kind, sessionId, baseRevision,
stateDigest, ops}`，`summaryDigest` 的输入是 `{version, baseRevision, nextRevision, before/after 的
revision+promptDigest, changes}`——两者都**不含**新字段，因此新增 `dependencyConflicts`
不改变任何既有 digest，老 client 忽略该字段即可，wire 上加 `.optional()` 保持向后兼容。

**client**：Change Set 面板新增"依赖冲突"块，逐条列出 `added`/`worsened`
（局部 key + 正文摘要 + `before → after`）；存在任一条时 Apply 变两步：
第一次点击 → 按钮变为"确认并应用（含 N 处新增冲突）"，第二次点击才提交；
确认态不可用 `Esc` 绕过（与 §5.7 的 in-flight/unknown 规则一致），且 revision conflict 后确认态重置。

**测试**：core 差集单测（added / worsened / 无变化 / 结构非法仍整批失败）；
client 两步确认的 DOM 测试（含"确认态在 rebase 后重置"）；
digest 不变的回归测试（加字段前后 `previewDigest` 与 `summaryDigest` 相同）。

**与图形视图的关系**：图形视图复用同一份 `dependencyConflicts` 渲染 §3.7 的"需要处理"标记，
但**不依赖**它——两者可独立发布，建议本项先进 `0.2.2`（它是既有设计要求的缺口）。
