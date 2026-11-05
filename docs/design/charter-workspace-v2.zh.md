# `dsh-charter` 0.2 会话契约工作区设计

> **状态：** Implemented — pending release acceptance。0.2.0 功能范围（workspace、query、validator）已实现并通过
> 源码验收；真实 Gateway/Desktop/可访问性/性能等发布人工门禁尚未完成。
> **版本范围：** `0.2.0`（从该版本起不再使用 `rc` 后缀）。
> **基准：** 2026-11-02；最后复核 2026-11-05。
> **权威边界：** [版本路线](version-roadmap.zh.md)决定版本范围，[v1 核心设计](charter-design-v1.zh.md)
> 决定不变量。本文只细化 Workspace、Proposal 时间线和 deliverable 依赖；发生冲突时先修订权威文档。
> **专题范围：** 本文覆盖 workspace、query/proposal 以及 Evidence Integrity/Fact Validity/validator；发布
> 验收矩阵与人工门禁仍由版本路线图、验证记录和发布文档约束。
> **替代/被替代：** 取代 v1 工作区交互；被替代时保留为历史文档。

## 0.1 实现状态与已知差距

本文件的状态是 **Implemented — pending release acceptance**。workspace/query/proposal/evidence/validator 的
主要合同已实现并通过源码门禁，但仍有功能边界和发布人工门禁，不能把当前分支读成完整可发布 0.2.0。

已实现：

- Pane active/history/pending/inactive/batch 列表窗口化；store 走 summary + 分页 query，旧 Host 保留 full-watch fallback。
- queryItems/queryProposals/queryChanges 的 facets、validity filter、filter digest、revision-bound cursor 和响应
  字节上限；`objectiveProposals` 独立 cursor 和字节上限。
- message proposal 的选择器、正文范围、kind 和 projection digest；Change Set canonical preview digest/
  `PREVIEW_MISMATCH`；proposedRequires 支持 batch-candidate 和同 Change Set 接受顺序；fork 重置 validity 并重映射
  proposedRequires/evidence；bootstrap active item dedupe；来源派生的 origin。
- Evidence Integrity/Fact Validity：registered validator、owner-only、文件大小/总字节/总时长/并发边界、
  timeout/权限/不可读→unknown、正文变更→stale、结果不进 standing prompt；v1 verification→v2 validity 映射。
- source registry 按 source kind/projectionVersion 复算 message/compaction/agent-tool projection；Review/query 面
  使用同一投影上下文并展示 batch integrity；未知投影返回 unsupported，缺 digest 返回 missing，不把“有 digest”当作
  intact。message selection 以 trim 后正文为 canonicalization 基准；agent source 不绑定会在 accept 时剥离的
  proposedRequires 元数据。

仍存在的功能边界：

- fork source integrity 为 `unsupported`：child record 不保存父来源投影；fork typed refs 已保留但完整复算需要父记录。
  fork 将 validity 结论重置为 `unassessed`，保留 evidence/source 引用；不会把父 Session 的有效性结论带入 child。
- `charter_propose` 的 requires 仍只解析当前 active deliverable IDs；agent batch-candidate 引用暂不支持。
- message proposal 目前只接受真实 user message，不支持 assistant/tool 消息选择。
- Pane 仍一次取回全部分页（渲染已窗口化），网络层分页/窗口化仍是优化项。
- queryProposals 的 review 过滤是 batch 级命中，响应保留该 batch 的全部 candidate；这是当前契约，不是 candidate 级过滤。
- 真实 Gateway 授权/配额、Desktop ABI/Plugins UI、可访问性/触屏/200% 文本、真实模型 compaction、512 条性能人工
  证据和最终 artifact 门禁仍未完成。

## 1. 决策摘要

0.2 将当前平铺的 Charter 编辑器升级为会话契约工作区。工作区包含三个一级区域：

| 一级区域 | 主要内容 | 是否进入模型上下文 |
| --- | --- | --- |
| Workspace | 当前目标、有效硬约束、交付物、进度和执行依赖 | 是，经过确定性投影 |
| Review Center | 提案批次、来源、审阅时间线、替代链和近期变更 | 否 |
| Diagnostics & Maintenance | prompt 预览、预算、来源完整性、记录健康、导出与恢复 | 否 |

0.2 的主要产品变化是：

1. 当前契约从平铺列表变成有明确顺序和前置条件的执行计划。
2. 历史草案从单条候选列表变成按来源批次组织的审阅时间线。
3. 目标、当前约束、待审阅内容和诊断信息不再作为同级页面并列。
4. 关系采用少量明确类型，不建设任意节点都能连线的通用图。
5. 历史、时间、来源和诊断元数据不进入常驻 prompt。
6. 模型只能读取当前契约和提出 proposal，不能接受提案、改变依赖、归档条目或切换当前重点。

本文建议首个依赖模型只覆盖 deliverable 的 `requires`。该新增范围需要先修订版本路线，再形成实现承诺。
约束适用范围 `appliesTo` 和用户控制的 Focus 作为后续实验项，只有受控 A/B 显示收益后才进入稳定契约。

### 1.1 与完整 0.2 路线的关系

本文沿用路线图已经确定的 Change Set、Proposal Inbox、provenance、查询面、三个一级区域和 record v2 方向。
它不推迟或替代以下既定工作：

- evidence binding 与 source integrity；
- Fact Validity 和注册式 validator；
- v1 verification 到 v2 validity 的迁移；
- message proposal 与 `charter_propose`；
- 授权矩阵、查询配额、无障碍和真实 Gateway 验收。

第 14 节的 W0–W5 是本专题内部阶段，不等同于版本路线图的 M0、alpha、beta 和 RC 里程碑。将 `requires` 纳入
0.2 stable 前，必须先更新版本路线图，说明它对原有里程碑、工期和 feature-freeze 条件的影响。

## 2. 评审结论

### 2.1 当前设计的问题

0.1 的领域模型可以保存目标、硬约束和交付物，但呈现方式仍接近数据表：

- 条目只有 `order` 和 `createdRevision`，没有执行依赖。
- `supersedes` 只能表达新条目替代旧条目，不能表达交付物的前置条件。
- accepted、pending 和历史条目主要依赖 tag 区分，视觉优先级不足。
- compaction summary 草案按 kind 分组后平铺，来源、批次和审阅结果不够突出。
- archived、rejected、superseded 条目散落在硬约束和交付物页面内。
- Overview、Objective、Invariants、Deliverables、History、Context、Recovery 作为同级导航，无法表达
  “当前必须遵守”“等待审阅”“仅供诊断”的差别。

### 2.2 “历史”不是一个状态

当前产品中的“历史”至少包含四类数据：

| 名称 | 含义 | 权威来源 |
| --- | --- | --- |
| 历史草案 | 从 compaction summary 提取、尚未提交的候选 | Session event 投影 |
| Pending proposal | 已进入记录、等待用户接受或拒绝的条目 | Charter record |
| 非当前条目 | rejected、archived、superseded 条目 | Charter snapshot |
| 近期变更 | revision、actor、时间和结构化 change receipt | 有界 history receipts |

0.2 必须在术语、查询和 UI 上拆开这四类数据。它们可以在 Review Center 汇合，但不能继续共用一个含糊的
`History` 列表。

### 2.3 UI 重构不会自动改善模型行为

模型自动看到的内容仍然只应包含：

- 当前目标；
- `accepted + current` 的 invariant；
- `accepted + current` 的 deliverable 及其必要执行信息。

Proposal、来源、时间、revision、verification 和历史正文不进入自动上下文。因此，时间线和视觉层级主要改善
用户审阅；依赖关系只有进入当前契约的确定性投影，才可能改善模型的执行顺序和长会话约束保持。

### 2.4 不建设通用关系图

以下概念不能使用同一个无类型 `edges` 集合表达：

- 条目替代；
- 交付物前置条件；
- 约束适用范围；
- proposal 来源；
- validator 读取的文件或环境事实。

通用图会增加循环、级联更新、权限、prompt 渲染和移动端交互的复杂度，也会把产品推向通用任务管理器或知识图谱。
0.2 采用少量有明确端点和状态规则的关系。

### 2.5 rc.6 回归基线

本次回归以 `release/0.1.0-rc.6` 当前源码、现有验证脚本和发布文档为边界。2026-11-02 在 Node
`v22.23.1`、npm `12.0.2` 上执行 `npm run check`，TypeScript、构建、Remote/client smoke 和 Vitest 通过；
Vitest 结果为 30 个测试文件、379 项测试。没有发现 rc.5 已修复的原子提交、UTF-8 准入、future-schema 围栏、
unknown-outcome exact replay、普通 Discard 保留 unknown evidence 等行为在当前源码中重新回归。

这个结果只证明当前源码门禁通过，不能替代以下证据：

- rc.6 唯一候选 tarball 及 SHA-256；
- exact-artifact package、recovery、Gateway、profile 和兼容矩阵；
- 真实 Web 浏览器、当前目标 DSH Desktop、真实模型 compaction；
- npm/GitHub Promotion 和无版本 Desktop Install/Update 路径。

因此，本次结论是“源码增量回归通过，发布验收未完成”，不能称为 rc.6 终审或发布 GO。

### 2.6 rc.6 问题与 0.2 覆盖表

覆盖状态使用四个值：

- **覆盖**：本方案已有明确产品合同，完成实现和对应验收后可关闭；
- **补合同**：方向正确，但原方案不足以直接派生实现和测试；本文后续章节补齐合同；
- **上游/边界**：插件不能独立修复，只能 fail closed、披露限制并保留证据；
- **发布治理**：不属于 0.2 产品功能，必须在对应版本发布前单独关闭。

| ID | 优先级 | rc.6 当前问题或限制 | 性质 | 0.2 处理 | 覆盖状态 |
| --- | --- | --- | --- | --- | --- |
| R01 | P2 | 七个平级技术栏目不能区分当前契约、待审内容和诊断 | 0.1 产品限制 | 三个一级区域和独立 Change Set | 覆盖 |
| R02 | P2 | pending、inactive 和 transient draft 缺少 Proposal Batch 与可靠来源时序 | 0.1 产品限制 | Proposal Inbox、Batch、provenance、`legacy-unknown` | 覆盖 |
| R03 | P2 | Apply 只有客户端投影，没有可对账的 Host canonical Change Set | 0.1 产品限制 | 单一 planner、before/after、summary digest 和 Host 回执 | 补合同 |
| R04 | P2 | deliverable 只有顺序和 progress，不能表达前置条件 | 候选新增范围 | `requires`、图校验和依赖感知 prompt；须先更新版本路线 | 覆盖，待范围批准 |
| R05 | P2 | review、source integrity 和 fact validity 在 0.1 verification 中混合 | 0.1 数据限制 | 三个独立维度；完整 schema 由 Core V2 规格负责 | 覆盖 |
| R06 | P1 | 512 items / 512 pending 下无查询分页、窗口化，watch 传完整视图 | 规模风险 | summary watch、revision-bound query、窗口化列表 | 补合同 |
| R07 | P1 | Pane 自动测试主要是 React tree，不能证明真实焦点、布局和 accessibility tree | 证据缺口 | DOM E2E、axe、真实键盘和 screen reader 门禁 | 补合同 |
| R08 | P1 | `charter_read standing` 没有独立结果 envelope 上限 | 工具合同缺口 | 完整返回或显式拒绝；写入准入与 tool envelope 联动 | 补合同 |
| R09 | P2 | 模型没有可追踪的 pending-only proposal 入口 | 0.1 安全边界 | `charter_propose` 专用 handler，不能复用 owner edit | 覆盖 |
| R10 | P2 | traffic checker 能诊断 snapshot 和 usage，但不能证明 cache 因果 | 证据边界 | 固定 provider/model/tools/input 的受控 A/B | 覆盖 |
| R11 | P1 | DSH runtime-context append 会重复携带未变化的 Charter bytes | 上游限制 | 保留完整最新投影和观测；不以返回空正文规避 | 上游/边界 |
| R12 | P1 | `contextOrder` 和 compaction 后最终消息顺序缺少目标 profile 冻结证据 | 待验收 | 真实 assembled-message snapshot 与 compaction 门禁 | 补合同 |
| R13 | P2 | bootstrap 仍依赖已弃用的 `snapshotEvents()` | 上游限制 | 保持单点 adapter；有公开替代 API 后切换 | 上游/边界 |
| R14 | P0 影响 | storage 外层 JSON 不可读时可能与记录不存在混淆 | 上游数据安全限制 | 禁止声称自动区分；保留停 Host、备份、离线修复流程 | 上游/边界 |
| R15 | P1 | 旧 DSH 没有 per-Peer Session resource enforcement | 上游权限限制 | 0.2 新接口要求现代 resource enforcement，不增加旧版降级写路径 | 上游/边界 |
| R16 | P1 | fork 复制不能与 Session fork boundary 构成同一事务 | 上游生命周期限制 | 验收现有弱保证；严格边界等待 awaited fork participant | 上游/边界 |
| R17 | P2 | mutation/maintenance receipt 只有有界 replay 窗口 | 明确产品边界 | UI 显示 retention；不宣称永久幂等或永久审计 | 覆盖 |
| R18 | P2 | 多 Host 共享 JSON storage 没有跨进程事务 | 明确非目标 | 继续作为部署限制，不在插件内模拟 lease | 上游/边界 |
| R19 | P1 | 新 DSH 版本可能因 Cordis/peer 图变化无法进入测试 | 兼容风险 | 每个候选重新发现、隔离安装和分类；失败版本明确 unsupported | 发布治理 |
| R20 | P0 | rc.6 尚无 candidate-bound browser、Desktop、model 和 registry evidence | 发布阻断 | 第 15 节定义 0.2 门禁；rc.6 仍须按自己的发布流程补齐 | 发布治理 |

R20 还包含一个具体版本缺口：当前 candidate fresh-profile job 固定在 DSH `0.2.1-rc.4`，Gateway 默认只跑
`0.2.1-rc.3` / `rc.4`。rc.6 新增声明的 `0.2.1-rc.5` 目前只有 source compatibility matrix，没有 candidate artifact 的 Gateway、fresh profile 或真实浏览器诊断。

另有两项与 0.2 设计无关的当前发布配置问题，不能推迟到 0.2：

1. `package.json` 设置 `publishConfig.provenance: true`，Promotion 却使用 repository token、没有
   `id-token: write`，发布文档还明确声明不生成 provenance。任何发布前必须统一为 OIDC/provenance 或明确关闭
   provenance，并通过真实 Promotion preflight 验证。
2. rc.5 文档同时要求“不重建同版本字节”和“从当前 main 重新构建 candidate”。恢复发布时只能推广已冻结的精确
   rc.5 字节，或者放弃 rc.5 npm 发布并用新版本修复前进；不能为同一版本重建另一份 tarball。

### 2.7 rc.6 与 0.2 证据路径

| 问题 | rc.6 当前权威路径 | 0.2 未来门禁 | 关闭规则 |
| --- | --- | --- | --- |
| Source 行为回归 | [`verification.zh.md`](../verification.zh.md) 和当前 `npm run check` | L1/L2 | 各自在目标源码 commit 重跑 |
| 唯一候选与 SHA | [`release-candidate.yml`](../../.github/workflows/release-candidate.yml) | 第 15.11 节 Candidate bundle | 版本自己的 exact artifact evidence |
| 真实浏览器 | 本地人工诊断（可选） | L4/L5 Web E2E | 不作为 promotion 门禁 |
| Desktop ABI/update | [`verification.zh.md`](../verification.zh.md) 的人工缺口 | 第 15.10 节 Desktop 路径 | 目标 Electron/DSH + 隔离 profile |
| 真实模型 compaction | [`verification.zh.md`](../verification.zh.md) 和 compaction checker | L6 | candidate-bound transcript，不复用旧版本 PASS |
| Registry/Promotion | [`releasing.zh.md`](../releasing.zh.md) 与 [`release-promote.yml`](../../.github/workflows/release-promote.yml) | Promotion/release bundle | 发布后 registry bytes 与 candidate SHA 一致 |
| Desktop catalog maturity | [`releasing.zh.md`](../releasing.zh.md) 的用户路径 | Installability addendum | maturity 后实测，无版本路径单独 PASS |
| provenance 配置 | package/workflow/发布文档统一 | D15 + Promotion preflight | 不允许 OIDC 与 token-only 声明混用 |

0.2 合同覆盖某个风险，只表示未来版本已经定义修复和验收方法，不会把 rc.6 对应 evidence 自动改成 PASS。

## 3. 目标与非目标

### 3.1 产品目标

0.2 需要让用户快速回答：

1. 当前任务的目标是什么？
2. 哪些约束始终不能违反？
3. 当前应该推进哪个交付物？
4. 它依赖哪些尚未完成的工作？
5. 哪些内容正在等待审阅？
6. 一条 proposal 来自哪里，后来如何处理？
7. 当前实际发送给模型的文本是什么，是否超出预算？

### 3.2 模型上下文目标

模型可见投影需要满足：

- 目标、硬约束和执行计划分区明确；
- 交付物按依赖关系确定性排序；
- 未满足的前置条件可见；
- 历史和诊断信息不占用常驻 prompt；
- 相同正本 revision 和 renderer version 生成逐字节相同的文本；
- 超预算时拒绝增长，不静默删除、摘要或改写用户内容。

### 3.3 非目标

0.2 不包含：

- 跨 Session 长期记忆；
- 通用项目管理、甘特图或日历；
- 任意关系图编辑器；
- `decision`、`environment` 等新 item kind；
- 模型直接接受、拒绝、归档、恢复或清除条目；
- 自动修改 deliverable progress；
- 自动推断并激活依赖；
- 永久且不可裁剪的全文审计日志；
- 把用户正文提升到 system role；
- 让 validator 或 compaction summary 成为 Charter 正本。

## 4. 术语

### 4.1 当前契约

当前契约是 `accepted + current` 条目和当前目标组成的有效工作集。它是自动 prompt 投影的唯一业务来源。

### 4.2 Proposal

Proposal 是尚未生效的候选变化。来源可以是：

- `manual`：用户直接创建；
- `message`：用户从 Session 消息创建；
- `compaction-summary`：从压缩摘要提取；
- `agent-tool`：模型通过只读受限工具提出；
- `fork`：从父 Session 继承或派生；
- `legacy-unknown`：无法恢复可靠来源的 v1 pending 条目。

Proposal 在用户接受前不进入当前契约，也不进入自动 prompt。

### 4.3 Proposal Batch

Proposal Batch 表示同一次来源事件产生的一组候选。批次保存来源和有类型的候选引用，不复制候选正文。Item proposal
的正文由 proposal item 持有；objective proposal 在进入 current 前由独立候选实体持有。两者使用不同引用类型，不能把
objective 当成普通 item。

### 4.4 近期变更

近期变更是有界的结构化 receipt。它支持审阅和诊断，不用于恢复 current，也不承诺永久保存。

### 4.5 依赖与就绪状态

`requires` 表示一个 deliverable 必须等待其他 deliverable 满足前置条件。前置条件派生为 `satisfied`、`waiting` 或
`dependency-conflict`；UI 再与用户记录的 progress 组合显示 `ready`、`waiting`、`dependency-conflict`、`in-progress`、
`blocked` 或 `terminal`。这些派生值都不写入记录，也不能覆盖 progress。

### 4.6 Proposal 生命周期

| 阶段 | 正本位置 | 是否有持久 ID | 是否进入 Prompt |
| --- | --- | --- | --- |
| Transient draft candidate | Session event 的只读投影或客户端草案 | 否，只允许临时 fingerprint | 否 |
| Persisted proposal | Charter record 内的 pending item/objective proposal | 是 | 否 |
| Accepted item proposal | 同一个 item 转为 accepted/current，并保留 proposal metadata | item ID 不变 | 是 |
| Applied objective proposal | 正文移入 current objective；候选只保留 digest、来源和 applied revision | proposal ID 保留 | 是，作为 objective |
| Rejected proposal | Charter record 内的 rejected item/objective proposal | 是 | 否 |
| Purged proposal | 正文删除；batch 只保留不含正文的 tombstone | 原 ID 作为 tombstone reference | 否 |

打开 Review Center 不会把 transient draft 写入记录。只有用户执行“保存到待审阅”或受限 `charter_propose` 成功时，
Host 才原子创建 Proposal Batch 和 persisted proposal。

## 5. 信息架构

### 5.1 桌面布局

```text
┌ 一级导航 ──────┬ 主内容 ───────────────────────────┬ Change Set ─────┐
│ Workspace      │ 当前目标                           │ before → after  │
│ Review Center  │ 必须遵守                           │ prompt 影响     │
│ Diagnostics    │ 执行路径                           │ bytes / counts  │
│                │                                    │ Apply           │
└────────────────┴────────────────────────────────────┴─────────────────┘
```

### 5.2 窄屏布局

- 顶部 tab 在三个一级区域间切换。
- 筛选器进入 sheet，不长期占用内容宽度。
- Change Set 使用 bottom sheet。
- 依赖以缩进列表、状态文本和可跳转引用呈现，不依赖二维画布。

### 5.3 Workspace

Workspace 是默认首页，不再保留独立 Overview 页面。

```text
┌ 当前目标 ───────────────────────────────────────────┐
│ 当前目标正文、是否有暂存 redirect、最近提交 revision │
└─────────────────────────────────────────────────────┘

┌ 必须遵守 ─────────────────┐  ┌ 当前执行路径 ─────────┐
│ 全局硬约束                 │  │ D1 → D2 → D3          │
│ 验证异常和适用范围         │  │ progress / prerequisites│
└────────────────────────────┘  └───────────────────────┘
```

Workspace 的显示优先级固定为：

1. 当前目标；
2. 全局硬约束；
3. 当前可推进和等待前置条件的 deliverable；
4. 当前 revision、未应用修改和首要阻塞原因。

Objective 不再作为一级导航。Invariants 和 Deliverables 可以保留局部筛选或详情页，但不与 Workspace、Review Center
并列。

### 5.4 Review Center

Review Center 统一承载：

- 待处理 Proposal Batch；
- pending proposal；
- 尚未保存的 compaction summary transient draft；
- archived、rejected、superseded 条目；
- supersede lineage；
- stale/conflict Change Set；
- Recent Changes。

默认视图先显示待处理数量和提案批次，再显示历史时间线。Transient draft 与 persisted proposal 必须使用不同状态文案；
非当前条目不与 active 条目混排。

提案批次建议呈现为：

```text
2026-11-02 · Compaction summary · seq 1842
提取时 revision: 17
2 accepted / 1 rejected / 3 pending

目标候选
硬约束候选
交付物候选
与当前契约的差异
```

批次内候选按原始来源顺序稳定排列，并标明：

- new；
- duplicate；
- possible replacement；
- possible conflict；
- accepted as item；
- rejected；
- purged。

`duplicate`、`possible replacement` 和 `possible conflict` 首版可以是本地派生诊断。它们不能自动改变 proposal
或当前契约。

### 5.5 Diagnostics & Maintenance

该区域包含：

- 当前 prompt 的格式化预览；
- prompt bytes、record bytes 和数量预算；
- runtime-context 和 cache 观测；
- provenance source integrity；
- validator 结果；
- record health 和 future-schema 状态；
- export、restore、recovery；
- 兼容性和 capability 诊断。

Context 和 Recovery 不再作为与 Objective 同级的产品页面。

### 5.6 Change Set

Change Set 面板显示：

- objective 和 item 的 before → after；
- `requires` 的新增、删除和重定向；
- 会改变 prompt 的操作；
- 只改变 metadata 的操作；
- prompt bytes、record bytes 和 item counts 变化；
- revision conflict 后重新计算的 canonical diff；
- unknown outcome 对应的 Change Set ID 和 Retry/Abandon 状态。

一次 Apply 仍然对应一次单记录原子 update。

### 5.7 语义与键盘合同

- 三个一级区域使用一个有名称的 tablist；方向键移动 tab focus，Enter/Space 激活，当前 tab 使用
  `aria-selected`，每个 panel 与 tab 双向关联。页面若最终改用路由链接，必须保留等价 landmark 和当前页语义，不能混用
  两套键盘模型。
- 桌面 Change Set 是有名称的 complementary region；窄屏 bottom sheet 使用 modal dialog、focus trap、Escape 关闭和
  opener focus restore。存在 in-flight/unknown attempt 时不能用 Escape 绕过确认或写锁。
- Apply 成功、revision stale、query 失败和 outcome unknown 使用克制的 live region；正文和大段 diff 不自动朗读。
- 错误摘要列出首个阻塞原因和所有字段错误。激活错误链接后，焦点移动到对应 editor、proposal 或 relation control。
- 批量选择使用原生 checkbox 语义和 mixed state；批量操作只针对明确 ID 集合，切换筛选后不扩大选择集。
- 窗口化列表为每行提供稳定 accessible name、总数和位置；DOM reading order 与视觉顺序一致。不能为了性能只渲染一个
  无语义 canvas。
- dependency 引用的 accessible name 同时包含局部 label、正文摘要和 readiness。跳转后把焦点放到目标行标题，并提供返回
  来源的键盘路径。
- 所有 hover help 同时支持 keyboard focus；tooltip 不承载完成操作所必需的唯一信息。
- 触控目标、focus indicator、forced colors、200% 文本缩放和 reduced motion 不能依赖颜色或动画表达唯一状态。

DOM 测试验证 role/name/state/focus，真实浏览器验证布局、滚动、focus restore 和 accessibility tree；
`react-test-renderer` 属性断言不能单独作为本节通过证据。

## 6. 关系模型

### 6.1 稳定关系

| 关系 | 起点 | 终点 | 持久化位置 | Prompt 行为 |
| --- | --- | --- | --- | --- |
| `supersedes` | item | 同 kind item | item 字段 | 只投影最新有效条目 |
| `requires` | deliverable | deliverable | deliverable 字段 | 投影完整 active 依赖图 |
| `derivedFrom` | Proposal Batch | source | batch provenance | 不投影 |

### 6.2 实验关系

| 关系 | 起点 | 终点 | 状态 |
| --- | --- | --- | --- |
| `appliesTo` | invariant | deliverable | 受控 A/B 后决定是否进入稳定 schema |

首版不持久化 `blockedBy`、`ready`、`conflictsWith` 和 `duplicateOf`。前两者由确定性规则派生，后两者先作为
Review Center 诊断。

### 6.3 `requires` 候选数据形状

```ts
interface DeliverableItemV2 extends CharterItemBaseV2 {
  readonly kind: 'deliverable'
  readonly progress: DeliverableProgress
  readonly requires?: readonly string[]
}
```

不建立独立 edge table。依赖随 Session record 一起原子提交，fork 时和 item ID 一起 remap。

Pending deliverable proposal 不直接写 `requires`，而是在 proposal metadata 中保存候选引用：

```ts
type ProposedPrerequisiteRefV2 =
  | { readonly kind: 'current-deliverable'; readonly itemId: string }
  | { readonly kind: 'batch-candidate'; readonly proposalId: string }

interface DeliverableProposalMetadataV2 {
  readonly proposedRequires?: readonly ProposedPrerequisiteRefV2[]
}
```

接受时，所有 `batch-candidate` 必须在同一个 Change Set 中被接受并解析为 deliverable item。未选择的 prerequisite
candidate 不会静默丢边；planner 要求用户删除、替换该引用或同时接受 prerequisite。

### 6.4 `requires` 规则

1. 起点和终点都必须是同一 Session record 中的 deliverable。
2. 条目不能依赖自身。
3. 整个依赖图不得成环。
4. `requires` 使用 canonical ID 顺序持久化，重复 ID 非法。
5. 只有 `accepted + current` deliverable 可以持有 `requires`，也只有它们可以成为依赖目标。
6. Pending proposal 可以携带候选 relation change，但该候选不写入 item 的 `requires`；接受时由同一个 Change Set 创建边。
7. Archive、reject、supersede 或 purge dependent 前，必须在同一 Change Set 中显式清除它的全部出边。
8. Archive、reject、supersede 或 purge prerequisite 前，必须在同一 Change Set 中显式删除或重定向全部入边。
9. Supersede 不自动继承旧条目的入边或出边；replacement 的依赖由 Change Set 明确给出。
10. Restore 后的条目没有历史依赖；需要依赖时由新的 Change Set 重新建立。
11. 任一提交完成后，全记录 active dependency graph 都必须无悬空引用。
12. 不根据依赖自动修改 progress、review、lifecycle 或 verification。

### 6.5 依赖满足规则

alpha 规则只适用于 active dependency graph。先独立计算 prerequisite status：

1. 任一 prerequisite 为 `cancelled`，返回 `dependency-conflict`。
2. 任一 prerequisite 不是 `done`，且 dependent 已为 `in-progress` 或 `done`，返回 `dependency-conflict`。
3. 任一 prerequisite 不是 `done`，且 dependent 尚未开始、处于 `blocked` 或已经 `cancelled`，返回 `waiting`。
4. 所有 prerequisite 都为 `done`，返回 `satisfied`。
5. 非 `accepted + current` prerequisite 是结构非法，不进入上述派生计算。

UI 组合规则固定为：`done/cancelled → terminal`，但仍单独显示 prerequisite conflict；`blocked → blocked`；
`in-progress → in-progress`；只有 `not-started + satisfied` 显示 `ready`，`not-started + waiting` 显示 `waiting`，
`not-started + dependency-conflict` 显示 conflict。用户明确记录的 `blocked` 不能因为 prerequisite 已完成而显示为 ready。

结构非法会使整个 Change Set 失败。`dependency-conflict` 反映用户记录的实际状态，不自动回写 progress，也不把记录判为
损坏；Change Set 必须醒目标出新增或加重的 conflict，并要求用户确认。`charter_propose` 不能确认或直接制造这类冲突。
首版不允许 inactive prerequisite，避免 prompt 中出现无法用局部标签引用的历史节点，也避免 restore 后恢复出悬空关系。

### 6.6 `appliesTo` 实验

候选形状：

```ts
interface InvariantItemV2 extends CharterItemBaseV2 {
  readonly kind: 'invariant'
  readonly appliesTo?: readonly string[]
}
```

语义建议：

- 缺少 `appliesTo` 表示全局硬约束；
- 非空列表表示只适用于指定 deliverable；
- 全局硬约束始终进入 prompt；
- scoped invariant 只在对应 deliverable 进入当前投影时出现；
- 模型不能自行修改 scope。

该字段可能减少无关约束噪声，也可能导致约束被错误隐藏。它不进入首个 v2 schema 冻结范围，先用受控 fixture 和
prompt 实验验证。

### 6.7 Core V2 状态维度

以下状态互相独立，不能由一个字段推导另一个字段：

| 维度 | 持久化 | 作用 |
| --- | --- | --- |
| `review` | 是 | proposal 是否 pending、accepted 或 rejected |
| `lifecycle` | 是 | accepted item 是否 current、archived 或 superseded |
| `sourceIntegrity` | 否；evidence binding 持久化 | 读取时派生来源投影是否仍可复算 |
| `validity` | 是 | `unassessed / attested / valid / invalid / unknown / stale` |
| `progress` | deliverable 专有 | 用户记录的执行进度 |
| prerequisite status / execution display | 否 | 根据 `requires` 与 progress 分层派生 |

Item 的合法 review/lifecycle 组合为：

| `review` | 合法 `lifecycle` | 说明 |
| --- | --- | --- |
| `pending` | `current` | 尚未生效，不能持有 active `requires` 或 replacement edge |
| `accepted` | `current`、`archived`、`superseded` | 只有 `current` 进入 standing |
| `rejected` | `current` | 非当前 proposal；`current` 只表示实体仍存在，不表示进入 standing |
| purged | 无 item 实体 | 只允许保留不含正文的 batch tombstone |

`sourceIntegrity` 和 `validity` 不改变 review 或 lifecycle。来源消失不会自动 reject proposal，validator 失败也不会自动
archive accepted item。`attested` 只表示用户确认，不冒充 validator 通过；`invalid` 是 validator 的否定结论；`unknown` 是
已提交但因 timeout、权限或依赖不可读而无法判断；正文、evidence 或 validator 参数变化后，旧结论必须变为 `stale`。
manual proposal 的 source integrity 在 UI 中派生为 `not-applicable`，不伪造 `intact`。取消或提交前失败是操作结果，不新增
持久 `unavailable` validity。

### 6.8 状态转换矩阵

所有转换都由同一个 planner 校验，Client 不能只靠隐藏按钮建立权限或状态边界。

| 操作 | 合法源状态 | 结果 | 调用者 |
| --- | --- | --- | --- |
| 直接新增 item | 无 | `accepted + current` | owner / user |
| 保存 item proposal | transient 或新输入 | `pending + current` 和 Proposal Batch | owner / user / pending-only agent tool |
| 保存 objective proposal | transient 或新输入 | persisted objective proposal | owner / user |
| 接受 item proposal | `pending + current` | 同 ID 转为 `accepted + current` | owner / user |
| 接受 objective proposal | persisted pending | initialize 或带 reason 的 redirect；候选转 applied metadata | owner / user |
| 拒绝 proposal | pending | rejected，正文仍受 record 配额和 purge 规则约束 | owner / user |
| 编辑正文或 order | `pending + current` 或 `accepted + current` | review/lifecycle 不变；validity stale | owner / user |
| archive | `accepted + current` | `accepted + archived`；同批处理全部边 | owner / user |
| restore | `accepted + archived` | `accepted + current`，不恢复历史依赖 | owner / user |
| supersede | `accepted + current` | 原 item superseded，新 item accepted/current | owner / user |
| purge | rejected、archived 或 superseded | 删除正文和泄漏正文的 metadata，只留最小 tombstone | owner-only |
| 修改 progress | `accepted + current` deliverable | progress 改变并重新派生 readiness | owner / user |
| 修改 `requires` | active deliverable endpoints | 原子更新关系并校验整张图 | owner / user |
| 写 validator result | 已授权 validator run | 只更新 validity/evidence metadata | Host，必须由 owner 发起 |

以下情况是稳定的 `INVALID_TRANSITION` 或 `INVALID_CHANGE_SET`，不得部分提交：no-op、非当前 proposal 的
accept/reject、inactive item 编辑、模型调用 owner op、一个 objective proposal 与另一个 objective 修改同时生效、purge 与
其他同 ID 操作并存、混合授权的 batch、非法 relation endpoint、环和悬空引用。

## 7. Proposal 与时间线

### 7.1 Proposal Batch 候选形状

```ts
interface SessionProposalSourceBaseV2 {
  readonly sessionId: string
  readonly sessionCreatedAt: number
  readonly projectionVersion: number
  readonly digest: `sha256:${string}`
}

type ForkProposalSourceRefV2 =
  | { readonly kind: 'item'; readonly itemId: string }
  | { readonly kind: 'objective'; readonly setAtRevision: number }

type ProposalSourceV2 =
  | SessionProposalSourceBaseV2 & {
      readonly kind: 'message'
      readonly seqs: readonly number[]
      readonly role: 'user' | 'assistant' | 'tool'
      readonly selection?: MessageTextRangeV2
      readonly at?: number
    }
  | SessionProposalSourceBaseV2 & {
      readonly kind: 'compaction-summary'
      readonly summarySeq: number
      readonly at?: number
    }
  | {
      readonly kind: 'manual'
      readonly actor: 'owner' | 'user'
      readonly at: number
    }
  | SessionProposalSourceBaseV2 & {
      readonly kind: 'agent-tool'
      readonly toolCallId: string
      readonly callEventSeq?: number
      readonly at: number
    }
  | {
      readonly kind: 'fork'
      readonly parentSessionId: string
      readonly parentSessionCreatedAt: number
      readonly parentRevision: number
      readonly sourceRefs: readonly ForkProposalSourceRefV2[]
      readonly at: number
    }
  | {
      readonly kind: 'legacy-unknown'
      readonly originHint?: 'user' | 'agent' | 'fork'
    }

type ProposalCandidateRefV2 =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'objective'; readonly id: string }
  | {
      readonly kind: 'tombstone'
      readonly candidateKind: 'item' | 'objective'
      readonly id: string
      readonly disposition: 'accepted' | 'rejected' | 'purged'
      readonly atRevision: number
      readonly appliedItemId?: string
    }

interface ProposalBatchV2 {
  readonly id: string
  readonly source: ProposalSourceV2
  readonly capturedAtRevision: number
  readonly candidates: readonly ProposalCandidateRefV2[]
}
```

字段名、message range 单位和完整 schema 在实现计划中冻结。这里先确定以下边界：

- message、summary 和 agent-tool provenance 由 Host 生成，调用者不能提交 seq、role、digest 或 actor；
- `projectionVersion` 与 digest 同时保存，source integrity 才能按相同投影复算；
- fork 保存父 Session identity、revision，以及有类型的 item/objective source references；
- 批次保存有类型的候选引用，不复制 item text；
- 候选仍存在时，review 和 disposition 从候选实体派生；
- 候选被 purge 后，batch 只保留不含正文的 tombstone；
- batch 不保存一份可与候选状态漂移的综合 disposition。

Objective proposal 是独立的有 ID 候选，因为 objective 不是 item。其规则是：

- current objective 为空时，接受候选执行 initialize；
- current objective 已存在时，接受候选执行 redirect，并要求用户在 Change Set 中填写非空 reason；
- 一个 Change Set 最多接受一个 objective proposal；
- pending/rejected objective proposal 持有候选正文；
- 接受后正文进入 current objective，候选只保留 text digest、batch reference 和 applied revision；
- purge 后只保留不含正文的 batch tombstone。

Item proposal 沿用同一个 item ID。接受后 item 变为 `accepted + current`，并保留 `proposalBatchId` 和
`reviewedAtRevision` metadata；不会再复制一份 accepted item 正文。

### 7.2 从 transient draft 到 persisted proposal

1. 打开 Review Center 只读提取最新可用 compaction summary，不写 Charter record。
2. 用户明确执行“保存到待审阅”后，Host 在一个 Change Set 中创建 Proposal Batch 和所选 proposal。
3. 未选择或丢弃的 transient candidate 不写入 record，也不变成 pending item。
4. 同一 source projection digest、candidate kind 和规范化正文重复保存时，如果原 proposal 尚未 purge，则返回已有
   proposal，不创建副本。
5. 用户在 Workspace 直接新增条目仍创建 accepted/current item；只有明确选择“保存为提案”才创建 manual batch。
6. `charter_propose` 直接创建 agent-tool batch 和 pending item，但不能创建 objective proposal。
7. 创建 batch 本身是 durable mutation，使用 mutation ID、request digest、base revision 和原子 update。

Purge tombstone 不保留 normalized-text digest 或等价 dedupe key。永久清除后再次保存同源同文候选会创建新 proposal；
这是清除语义优先于跨 purge 去重的明确取舍。

### 7.3 时序规则

时间线排序使用：

1. Session event seq 或 record revision；
2. 同位置内使用 batch ID 或 item ID 做确定性 tie-break；
3. wall-clock `at` 只用于展示，不作为唯一顺序依据。

Proposal 的来源时间、进入 inbox 的 revision 和审阅结果 revision 必须分开。它们回答不同问题：

- 来源内容何时出现；
- 插件何时捕获；
- 用户何时接受或拒绝。

每个 persisted proposal 保存 `createdRevision`；接受或拒绝后保存 `reviewedAtRevision`。Receipt 被裁剪后，Review Center
仍能显示 proposal 的最终 review revision。墙上时间可以从有界 receipt 显示；receipt 已裁剪时只显示 revision，不伪造
时间。

### 7.4 Recent Changes

Recent Changes 继续使用有界 receipt：

- 保存 revision、actor、时间和结构化 change；
- 不复制 proposal 或 item 正文；
- 不作为 current 的恢复来源；
- 允许按既定配额裁剪旧 receipt；
- purge 后清理可能泄露被删除正文的字段；
- UI 明确显示可查询历史的边界，不伪装成永久审计。

### 7.5 来源完整性

`digest` 只能证明来源记录仍可按相同投影读取，不能证明 proposal 内容当前仍然有效。

UI 分开显示：

- source integrity：intact、missing、mismatch、unsupported；
- review：pending、accepted、rejected；
- validity：unassessed、attested、valid、invalid、unknown、stale。

这三个维度不得合并成单一状态。

### 7.6 Proposal 与来源配额

Record 总字节上限不能替代入口和查询配额。W0 必须为以下项目冻结独立上限：

- 每个 record 的 Proposal Batch 数；
- 每个 batch 的候选数；
- 每个 source 的 seq 数和投影字节；
- 单次保存到 inbox 的候选数和正文总字节；
- 单次 Change Set 的 op 数和 relation op 数；
- source integrity 单次读取的 event 数、输入字节和超时；
- query page size、最终响应字节和每 Session 并发；
- `queryChanges` 的 page size 和最终响应字节；
- `charter_propose` 的条目数、正文和结果 envelope。

Host 只能先做 transport hard cap 和资源路由所需的最小 envelope decode；随后完成 principal、Session resource、endpoint
capability 和低成本 shape/size admission，再读取 storage、Session event 或 workspace。
任何来源都不能绕过最终 record bytes 和 prompt bytes 准入。

### 7.7 Source projection registry

每一种可复算来源都必须在注册表中定义 `(sourceKind, projectionVersion)`，内容至少包括：

- 允许读取的 Session event 类型和字段；
- message selection 的边界单位；
- canonical normalization 和字段顺序；
- digest 的 domain separator；
- 单次 event、seq、投影字节和执行时间上限；
- 旧 projection version 的读取期限和删除条件。

来源 digest 对注册表生成的 canonical bytes 求值，而不是对 UI excerpt、整条原始事件或 proposal 正文求值。Host 创建
message、summary 和 agent-tool proposal 时生成 seq、role、projection version 与 digest；Remote 调用者不能提交或覆盖这些
字段。proposal 正文后来被用户编辑时，原 source digest 保持不变，UI 另行显示 `content modified`，不能把编辑后的正文
伪装成原消息投影。

复算结果固定为：

| 结果 | 条件 | 对 review/standing 的影响 |
| --- | --- | --- |
| `intact` | 相同 registry version 可读且 digest 相同 | 无 |
| `missing` | Session/event/seq 已不存在 | 无 |
| `mismatch` | 可读，但 canonical bytes 的 digest 已改变 | 无 |
| `unsupported` | projection version 已不受支持 | 无 |

读取超时、取消或暂时权限不足返回操作级 `SOURCE_UNAVAILABLE`，不写 record，也不把暂时不可用持久化为 integrity 结论。Purge 删除 proposal 正文和 excerpt；
最小 tombstone 可以保留 source kind、batch ID、revision 和 source digest，但不能保留可还原正文的 selection 内容。registry
version 进入兼容 fixture；删除旧 version 前必须证明所有受支持 record 已迁移或仍可安全显示 `unsupported`。

## 8. Prompt 投影

### 8.1 输出结构

V2 继续使用现有固定前缀和 canonical JSON。用户正文必须经过现有 `encodePromptText()` 编码，不能直接插入 XML、
Markdown heading 或自定义分隔符。没有 active `requires` 时，renderer 必须逐字节输出 v1 格式：

```text
Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.
{"objective":"Release the candidate safely.","invariants":["Do not rewrite published history."],"deliverables":[{"text":"Verify the exact artifact.","progress":"done"}]}
```

存在 active `requires` 时，使用版本化的 dependency-aware JSON shape：

```text
Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.
{"objective":"Release the candidate safely.","invariants":["Do not rewrite published history."],"deliverables":[{"key":"D1","text":"Verify the exact artifact.","progress":"done","requires":[]},{"key":"D2","text":"Run the compatibility matrix.","progress":"in-progress","requires":["D1"]}]}
```

`D1`、`D2` 由 renderer 根据当前投影生成，不持久化，也不使用 item UUID。v2 第一次业务 mutation 会把 item order
规范化为保持 v1 canonical 顺序的唯一序号；fork 保留这些序号。只要正文、规范化顺序、progress 和依赖图相同，fork
前后的 dependency-aware prompt 就逐字节相同。

### 8.2 排序

1. 没有 active dependency edge 时继续使用 v1 `order + id` 顺序，保证只读投影和迁移前后 prompt 字节不变。
2. 第一次成功 v2 mutation 按 v1 canonical 顺序分配唯一规范化 order；order 数值本身不进入 prompt。
3. 存在 dependency edge 时，deliverable 按 active dependency graph 做稳定拓扑排序。
4. 同一拓扑层按唯一规范化 order 排序，不使用会在 fork 时变化的 UUID 做 prompt tie-break。
5. 每个 `requires` 数组按 prerequisite 的局部 `D<n>` 顺序输出，不按持久 UUID 排序。
6. 全局 invariant 按唯一规范化 order 排序。
7. Scoped invariant 若进入实验，紧邻其目标 deliverable 渲染。

Prompt 投影全部 active dependency edge，包括 progress 已为 `done` 的 prerequisite。完整执行顺序比只显示未满足边更稳定；
`ready`、`waiting` 和 `dependency-conflict` 仍根据 progress 派生。只显示未满足依赖可以作为 UI 筛选，不能改变 prompt
合同。

### 8.3 不进入 Prompt 的内容

- proposal 和 Proposal Batch；
- rejected、archived、superseded 正文；
- revision、时间和来源；
- verification、source integrity 和 validator run；
- Change Set ID、mutation ID、request digest；
- dependency 的持久 UUID；
- UI 展开、筛选、排序偏好和已读状态。

### 8.4 Prompt 变化规则

| 变化 | 是否改变 prompt digest |
| --- | --- |
| 当前目标正文变化 | 是 |
| accepted/current invariant 正文或顺序变化 | 是 |
| accepted/current deliverable 正文、progress、顺序变化 | 是 |
| active `requires` 变化 | 是 |
| proposal 来源或时间变化 | 否 |
| verification 变化 | 否 |
| UI 筛选、展开或已读状态变化 | 否 |
| receipt 裁剪 | 否 |

### 8.5 预算

预算仍以最终 UTF-8 prompt 总字节为准：

- `requires` 渲染计入 prompt bytes；
- Change Set preview 和 Host commit 共用同一 renderer；
- 超预算增长整批拒绝；
- 已经超预算的记录允许通过缩小编辑收敛；
- 不按重要性自动删除 invariant 或 deliverable；
- 不在客户端和 Host 使用不同的近似 token 规则作为最终准入标准。

## 9. Focus 实验

长会话可能包含大量 accepted/current deliverable。全部长期注入会降低信噪比，也增加输入字节。0.2 后期可以探索用户
控制的 Focus：

```text
全部全局硬约束
+ 当前重点 deliverable
+ 尚未满足的 prerequisite closure
+ 明确作用于这些 deliverable 的 scoped invariant
```

Focus 不在首个 v2 schema 中冻结。实验需要满足：

- 只能由用户显式选择或确认；
- 模型只能提出 focus change proposal；
- 全局 invariant 永不因 Focus 消失；
- 正本继续保留完整 accepted/current 工作集；
- UI 明确显示哪些 active deliverable 当前未进入 prompt；
- Context preview 能逐项解释 inclusion reason；
- 开启前后必须进行强制 compaction 的模型行为 A/B。

如果实验不能稳定降低约束违反、错误执行顺序或用户纠正次数，就保持完整 active 投影。

## 10. Record V2 与迁移

### 10.1 Schema 演进

新增持久字段必须使用正式 `recordSchemaVersion: 2`。现有 schema 和 Remote wire 都是 strict，不能把可选字段写进
v1 后继续宣称旧插件可读。

默认方案沿用同一个 storage domain，并在首次正常 v2 Change Set 中完成迁移和业务修改。若路线图 M0 性能探针证明单记录
无法满足 record 大小、查询或原子写要求，再评估新 domain 和 side-by-side copy。

### 10.2 V1 → V2

迁移规则：

- objective 和 item 正文逐字保留；
- review、lifecycle、verification、progress、order 和 supersede 链保留；
- 现有条目默认没有 `requires`；
- 无可靠来源的 pending 条目标记为 `legacy-unknown`；
- 不从正文、创建顺序或相邻列表猜测依赖；
- 不伪造 message seq、summary seq 或 source digest；
- v1 只读内存投影不写 record，standing prompt 逐字节不变；
- 第一次 v2 mutation 按 v1 `order + id` canonical 顺序分配唯一 order；正文顺序和无依赖 prompt 字节不变；
- v1 verification 固定映射：`unchecked → unassessed`、`verified/user → attested`、
  `verified/validator → valid + legacy validator metadata`、`failed → invalid`、`unavailable → unknown`；
- history、recent mutations 和 maintenance receipts 保持既有幂等、unknown-outcome 和恢复语义；
- v1 archive 原样保持 v1，restore 后仍为 v1，下一次正常业务 mutation 才迁移；
- fork remap item ID、supersede、provenance、evidence 和 dependency references；
- state digest 按 v2 canonical shape 重算；
- 整次迁移在一个 `table.update()` 中完成；
- 迁移或业务校验失败时不写入任何 v2 字节，原 v1 record 保持可读；
- request digest、迁移、planner 和幂等 receipt 严格遵守第 10.5 节的线性化顺序。

本文不重复定义 evidence、validity、archive envelope 和 maintenance receipt 的完整 v2 schema；它们继续由版本路线图和后续
Core v2 schema 规格负责。Workspace/关系实现不得跳过这些迁移要求。

### 10.3 降级

包含 v2 字段的记录必须触发 0.1 stable 的 future-schema read-only fence：

- 允许诊断导出；
- 禁止普通 edit、initialize 和 restore 覆盖；
- 原始字节保持不变；
- 重新升级到 0.2 后继续读取。

不承诺降级到未包含 future-schema fence 的旧 RC 后仍可安全恢复。

### 10.4 Canonical Record V2 边界

Core V2 规格可以调整最终字段名，但不能改变以下所有权和单正本边界：

| 数据 | 唯一持有位置 | 约束 |
| --- | --- | --- |
| Session identity | record 顶层 identity | lifecycle 绑定，所有 Remote 先检查 |
| objective、items、replacement、`requires` | current snapshot | standing 的唯一业务来源 |
| item proposal 正文 | pending/rejected item 实体 | accepted 后同 ID 进入 current，不复制正文 |
| objective proposal 正文 | objective proposal 集合 | applied 后移入 current objective，候选只留 metadata |
| Proposal Batch | batch 集合 | 只保存来源和有类型引用，不复制候选正文 |
| evidence 与 validity | 由稳定 item/proposal ID 引用 | 输入 digest 改变后旧结果 stale |
| history / recent mutation / maintenance receipt | 各自有界数组 | 不作为 current 恢复正本，不承诺永久审计 |
| prompt text、prompt digest、state digest | current snapshot 的 canonical projection | 必须由同一个 renderer/planner 生成 |

`recordSchemaVersion: 2` 使用 strict structural parser。结构解析通过后还必须运行 semantic validator，检查 ID 唯一性、
引用完整性、review/lifecycle 合法组合、replacement 双向一致、dependency DAG、proposal/batch 引用、evidence binding、receipt
revision 和所有 digest。结构错误与语义错误都进入 quarantine/read-only 路径，不能用默认值修补后覆盖原字节。

Canonical serialization 固定字段构造顺序和数组排序；不能依赖对象来源、数据库返回顺序或 locale compare。最终
`maxRecordBytes` 对完整序列化结果计算，history trimming 必须先按既定规则执行，再重新计算 digests 和最终 record bytes。
任何正文只能有一个持有位置；preview、batch、receipt 和 tombstone 只保存引用、digest 或有界非正文摘要。

Core V2 schema 文档、Zod schema、wire schema、migration fixture 和 archive schema 必须在 W2 写入前同时冻结。本文不是用
“后续 schema”豁免 evidence、validity、archive 或 maintenance receipt；任一部分缺失都阻断首个 v2 write。

### 10.5 首次写入与幂等线性化

`applyChangeSet` 对 v1 和 v2 使用同一顺序：

1. 执行 transport hard cap 和只含 method/Session resource 的最小 envelope decode，再完成 principal、Session resource、
   endpoint capability 和低成本 request admission；此时不能读取 record 正文、Session event 或 workspace。
2. Host 对 versioned canonical request body 计算 `requestDigest`。输入字段固定为 schema version、Session lifecycle binding、
   operation/Change Set ID、base revision、canonical ops 和 client preview summary digest；不包含 digest 字段本身、响应时间、
   Host 随机 ID、wall-clock 或当前 record bytes。客户端可以计算 claimed digest 用于 outbox 诊断，但它不是权威请求字段。
3. 进入 per-Session mutation queue，在 storage update 内读取原始 record，分类为 absent、v1、v2、future 或 corrupt，并检查
   Session lifecycle。
4. 先按 Change Set ID / mutation ID 查 recent receipt。ID 相同且 request digest 相同则直接返回已提交结果；ID 相同但
   digest 不同返回稳定 `ID_REUSE`。这一步先于 base revision conflict。
5. 对 v1 只建立内存中的 canonical v2 projection。现有 item ID 保留；migration 需要的新 ID 按 Session identity、旧实体 ID
   和 migration version 确定性生成，不读取 wall-clock，也不伪造来源。
6. 检查 base revision，运行同一 planner、op 授权、状态转换、relation、quota、prompt 和 record 校验。Canonical preview
   summary 使用 clientRef 表示尚未分配的新实体，不包含随机 ID 或时间。
7. Preview digest 一致后，Host 才分配 ID 和提交时间，生成 ID mapping、result digest 和有界 receipt。客户端 preview digest
   只用于检测不一致，不替代 Host 结果。
8. 一次 storage update 同时写入 v2 record、业务结果和 receipt。这次 durable commit 是唯一线性化点；此前的异常保持原始
   v1/v2 bytes，此后的响应丢失归类为 `OUTCOME_UNKNOWN`。
9. 响应只从已提交 snapshot/receipt 构造。exact retry 必须返回相同 committed revision、ID mapping 和 result digest，不再执行
   第二次业务修改。

`initialize`、`restore`、validator-result commit 和 fork 保持独立 operation kind 与授权，但共享 receipt-before-conflict、
单一线性化点和 commit-then-error 收敛规则。Query、source-integrity read 和尚未提交的 validator evaluation 是只读操作；
它们失败后可以安全重新读取。Validator evaluation 生成绑定 input digest 的结构化结果后，result batch 通过一个有
operation ID、base revision 和 receipt 的 durable Change Set 提交；该提交发生 response loss 时进入 unknown 并 exact retry，
不能重新评估后直接覆盖第一次结果。

### 10.6 0.2 prerelease schema policy

- 每一个公开 0.2 prerelease schema 都必须有受版本控制的原始字节 fixture、预期 canonical v2 bytes、digests 和迁移结果。
- alpha 可以调整 schema，但新 alpha 必须读取并迁移所有已公开 alpha fixture，除非发布前明确声明该 alpha 不产生可保留
  用户数据；已经发布后不能追溯声明。
- beta 冻结 record、archive、Remote reason code 和 cursor codec；之后只接受兼容修复和发布阻断修复。
- 0.2 stable 必须读取 v1、所有公开且承诺保留数据的 0.2 prerelease fixture，以及 stable 自身 canonical fixture。
- migration 失败时允许诊断导出原始字节，禁止部分写入。旧 alpha 打开新 schema 时只能依赖其已有 future-schema fence；
  没有 fence 的版本不列为安全降级目标。
- 进入实现前同步修订现行设计第 6.4 节：同 domain `recordSchemaVersion: 2` 是默认方案，只有 M0 探针失败时才切换新
  domain 和 side-by-side copy，不能同时保留相反的默认规则。

## 11. Remote 与查询面

0.2 使用既定查询方向：

```text
charter.watchSummary
charter.queryItems
charter.queryProposals
charter.queryChanges
charter.applyChangeSet
charter.runValidators
```

### 11.1 `watchSummary`

只推送小型摘要：

- revision；
- objective 是否存在；
- active、pending、history counts；
- pending batch count；
- prompt/record budget summary；
- record health；
- capability flags。

它不再在每次变更时推送完整 `CharterView`。

### 11.2 `queryItems`

支持：

- kind、review、lifecycle；
- source kind 和 Proposal Batch ID；
- verification 和 validity facet；
- prerequisite status 和 execution display；
- search；
- cursor 和 limit；
- revision-bound cursor；
- filter digest；
- revision 变化后的显式 stale 响应。

### 11.3 `queryProposals`

`queryItems` 只返回 Charter item，包括 pending/rejected item proposal；它不把 objective proposal 伪装成 item。
`queryProposals` 返回：

- Proposal Batch summary 和 provenance；
- objective proposal 正文与状态；
- item proposal ID 引用和有界 preview；
- source kind、review、batch ID 和 candidate kind facet；
- revision-bound cursor、limit、filter digest 和 stale 响应；
- purge tombstone，但不返回已清除正文或 dedupe digest。

Review Center 通过 `queryProposals` 获取批次和 objective proposal，通过 `queryItems` 分页读取 item proposal。两者绑定
同一个 revision；任一查询 stale 时不拼接跨 revision 结果。

该新增端点需要与 `requires` 一起先修订版本路线图，再形成 Remote 实现承诺。

### 11.4 `queryChanges`

使用 revision 作为主顺序，返回有界结构化 change：

- actor 和时间；
- Change Set ID；
- item/proposal/batch references；
- operation kind；
- prompt-affecting 标记；
- 不复制用户正文。

它支持在 receipt retention window 内按 exact Change Set/operation ID 查询，供 outbox/restart reconciliation 使用。返回
`not-found` 只表示当前有界窗口内没有 receipt，不能证明一个已超出窗口的历史请求从未提交；UI 不据此自动重放。

### 11.5 `applyChangeSet`

请求包含：

- Change Set ID；
- base revision；
- exact item IDs；
- exact relation changes；
- 客户端 preview summary digest。

Host 在 per-session mutation queue 内重读 revision，运行同一 planner 和全部图校验，再执行一次原子 update。禁止
predicate-based 批量写入。Host 计算的 canonical summary digest 与客户端提交值不同时，返回
`INVALID_CHANGE_SET` / `PREVIEW_MISMATCH` 和新的 canonical summary，整批不写；用户重新审阅后才能再次 Apply。
`requestDigest` 由 Host 按第 10.5 节重算并写入 receipt；wire 不接受调用者提供的权威 digest。

### 11.6 授权矩阵

| 入口 | 调用者 | 权限与执行顺序 |
| --- | --- | --- |
| `watchSummary` / `queryItems` / `queryProposals` / `queryChanges` | owner 或获准访问该 Session 的 user | Gateway 先完成 Session resource 决策，再读取 storage |
| `applyChangeSet` | owner / user | 复用 op 级授权；purge 和等价不可逆清除仍为 owner-only |
| `runValidators` | owner-only | 先检查 principal、Session resource、validator capability 和 workspace 权限，再读取文件或 storage |
| `charter_propose` | 当前 live Session 的 agent tool call | 使用 pending-only 专用 handler，不复用 owner/user edit 权限 |
| export / initialize / restore | owner-only | 保持现有维护授权和 healthy-target 拒绝规则 |

`runValidators` 是一个 RPC 内的两阶段协议：先在已授权 workspace 上 evaluation，生成 validator version、input digest 和
结构化结果；再在 mutation queue 内重读 base revision 和 input binding，以一个 durable Change Set 提交整批结果。Evaluation
前先按 operation ID/request digest 探测 existing receipt，commit 前在 queue 内再次检查 receipt 和 input binding。Evaluation 失败
或取消且尚未提交时可安全重跑；result commit 复用第 10.5 节 receipt、unknown outcome 和 exact retry 规则。已提交请求的
exact retry 直接返回 receipt，不因 workspace 后来变化而重新 evaluation。

所有入口按固定顺序执行：

1. 执行 transport hard cap，并只解码 method、Session ID 和资源路由所需字段；不得深解析正文数组。
2. 检查 principal 和 Session resource，拒绝 missing principal 与跨 Session 请求。
3. 检查不依赖 record 内容的 endpoint capability；`runValidators` 还要先检查 validator capability 和 workspace permission。
4. 执行低成本完整 envelope、shape、count、ID count 和 byte admission。
5. 只读取 record identity，检查 Session lifecycle mismatch。
6. 使用最小必要 metadata 完成 op 级授权；混合授权 Change Set 整批拒绝。
7. 上述步骤均通过后，才读取 item 正文、来源事件、workspace 文件或执行 validator evaluation。

L3 spy 必须证明第 1 步只解析资源路由字段，且 validator capability/workspace permission 被拒绝时没有 storage 或 workspace
read。若未来某个 op 授权确实依赖 record metadata，Remote 规格必须列出最小读取字段，不能扩大成正文预读。

错误语义需要覆盖 `FORBIDDEN`、`NOT_FOUND`、`STALE_REVISION`、`INVALID_CHANGE_SET`、`LIMIT_EXCEEDED` 和
`OUTCOME_UNKNOWN`，具体稳定 reason code 在 Remote 规格中冻结。

### 11.7 查询与写入配额

- `watchSummary` 只发送固定上限摘要，不携带 item 正文数组。
- `queryItems`、`queryProposals` 和 `queryChanges` 同时限制 page size、响应字节和每 Session 并发。
- cursor 绑定 Session lifecycle、revision、filter digest 和 query kind。
- `applyChangeSet` 在 storage 读取前限制 envelope bytes、op count、relation op count 和 ID count。
- source integrity 和 validator 分别限制读取字节、条目数、超时和并发。
- 超限返回稳定错误，不通过静默缩页、截断正文或丢弃 relation 继续执行。

### 11.8 0.2.x 兼容适配

现有 `charter.watch` 和 `charter.edit` 在 0.2.x 保留为兼容适配面，避免 Host 与 Client bundle 短暂错位时白屏。
新旧入口必须调用同一 core query/planner/command handler，不能维护两套关系校验、授权或迁移逻辑。旧入口无法表示的
v2 能力通过 capability 明确禁用，不做有损转换。

### 11.9 Query snapshot 与 cursor codec

每次 query 只读取一次 immutable record snapshot，并在该 revision 上完成 filter、sort、分页和响应字节计算。不得在同一页
构造过程中再次读取更新后的 record，也不得把两个 revision 的结果合成一页。

Cursor 对客户端不透明，使用 versioned canonical payload，至少绑定：

```text
codecVersion
queryKind
sessionLifecycleDigest
revision
filterDigest
sortVersion
lastExclusiveSortKey
```

客户端只能原样回传 cursor。Host 在 resource authorization 后解码，并按以下规则处理：

- malformed、未知 codec、query kind 或 filter 不匹配：`INVALID_CURSOR`；
- Session lifecycle 或 revision 已改变：`STALE_REVISION` / `CURSOR_REVISION_CHANGED`，响应带当前 revision，不自动从头继续；
- cursor 属于其他 Session：不泄露目标是否存在，返回 `FORBIDDEN`；
- 相同 revision 和 filter 下，`lastExclusiveSortKey` 保证后续页无重复、无遗漏；
- filter 使用固定字段顺序和显式缺省值计算 digest，数组先去重再按 code-unit 排序；
- search 在 Host 端按版本化算法执行，v2 初始算法为 NFC 后的 locale-independent Unicode lowercase substring；算法变化
  必须提升 `sortVersion` 或 codec version，并使旧 cursor 明确失效。

响应按完整 row 逐个加入，下一行会超过 response byte cap 时停止并返回 `nextCursor`。单行本身超过 cap 时返回
`LIMIT_EXCEEDED` / `RESULT_BYTES`，不能截断 item/objective 正文继续。仅用于列表提示的 preview 可以按 Unicode code point 明确截断，但必须
返回 `previewTruncated: true` 和完整正文的稳定 ID；preview 从不参与 Apply、digest 或来源完整性计算。

Query 取消、超时和 receiver detach 必须释放 per-Session concurrency slot。取消前已经生成的只读结果不能写入 record；
客户端收到迟到响应时仍须按 request token、Session lifecycle 和 revision 三重检查后再更新 cache。

### 11.10 Operation 授权与稳定错误

| 能力 | owner | 获准 user | agent tool | Host internal |
| --- | --- | --- | --- | --- |
| summary/query | 允许 | 允许 | 不经 Remote；仅使用专用 tool handler | 允许 |
| add/edit/accept/reject/archive/restore/supersede/progress/relation | 允许 | 允许 | 禁止 | 只用于迁移/fork，不冒充用户 |
| purge / initialize / archive restore | 允许 | 禁止 | 禁止 | 仅恢复协议内部步骤 |
| run validator | 允许发起 | 禁止 | 禁止 | 执行已注册 validator 并写结果 |
| create pending proposal | 允许 | 允许 | 仅 `charter_propose` 白名单 | fork/migration 可创建带真实 provenance 的 proposal |

一个 Change Set 含任一未授权 op 时整批返回 `FORBIDDEN_OPERATION`，不能先提交可授权子集。业务校验使用稳定 code 与 reason：

| Code | 典型 reason |
| --- | --- |
| `FORBIDDEN` | `MISSING_PRINCIPAL`、`SESSION_RESOURCE_DENIED`、`WORKSPACE_CAPABILITY_DENIED` |
| `NOT_FOUND` | 已授权 Session 内的 item/proposal/source 不存在 |
| `STALE_REVISION` | `BASE_REVISION_CHANGED`、`CURSOR_REVISION_CHANGED` |
| `INVALID_CHANGE_SET` | `ILLEGAL_TRANSITION`、`MIXED_OBJECTIVE_CHANGE`、`DEPENDENCY_CYCLE`、`DANGLING_REFERENCE` |
| `LIMIT_EXCEEDED` | `REQUEST_BYTES`、`OPS`、`RELATIONS`、`RESULT_BYTES`、`CONCURRENCY`、`TIMEOUT` |
| `OUTCOME_UNKNOWN` | transport 在 mutation 可能 durable 后中断；只允许 exact retry 或显式 abandon |
| `ID_REUSE` | operation ID 相同但 request digest 不同 |
| `SOURCE_UNAVAILABLE` | 来源读取超时、取消或临时不可读，不覆盖上次 integrity 结论 |

Reason code 进入 Remote contract fixture，UI 只根据 code/reason 决定恢复动作，不解析英文错误文案。

## 12. 模型工具

### 12.1 `charter_read`

`standing` 返回依赖感知的当前契约视图，但保持有界：

- objective；
- active invariant；
- active deliverable；
- progress；
- 完整 active dependency graph 的局部 label。

`all` 继续作为显式历史读取入口，增加 cursor、limit 和 `nextCursor`，并保持最终 item count 与 32 KiB envelope cap。
`standing` 仍返回完整有效工作集，不静默分页硬约束。Proposal provenance 和完整 change timeline 默认不返回，避免工具
结果变成第二份全量历史。

### 12.2 `charter_propose`

0.2 可以增加只创建 pending proposal 的工具。它必须：

- 绑定 live Session resource；
- 记录 `agent-tool` provenance；
- 只允许 invariant、deliverable 和候选 `requires`；
- 不能 accept、reject、archive、restore、purge 或修改 progress；
- 不能改变 objective；
- 不能运行 validator；
- 受单次 proposal 数量和字节上限约束。

模型提出的 dependency 只有用户在 Review Center 接受并提交 Change Set 后才生效。

### 12.3 Tool envelope 与授权边界

`charter_read standing` 的业务语义仍是完整有效工作集。实现必须为结构化 tool envelope 设置独立 hard cap，并与
`maxPromptBytes`、`maxItems` 和单 item/objective bytes 配置一起做启动诊断：

- 完整结果在 cap 内时一次返回，不分页硬约束；
- 完整结果超出 cap 时返回 `LIMIT_EXCEEDED` / `RESULT_BYTES`、实际 bytes、cap 和 item counts，不返回看似完整的截断结果；
- `all` 和 proposal/change 查询继续使用显式 cursor；
- profile 调高正文或 prompt 配额后，如果 standing tool 可能超限，Diagnostics 必须在模型调用前显示该风险；
- tool result 的最终序列化 bytes 参与 fixture，不能只计算 item JSON；
- tool handler 必须从当前 live Session resource 获取 identity，模型参数不能指定任意 Session、actor、seq 或 digest。

W0 冻结具体 cap；候选默认不得低于默认 8 KiB prompt 加完整结构化开销，也不得高于 Gateway/tool transport 已实测通过的
上限。无论最终数值为何，超限行为必须是显式失败，不能静默丢弃 invariant、deliverable、dependency 或正文。

## 13. 客户端架构

单体 Pane 拆分为：

```text
CharterShell
├── WorkspacePage
├── ReviewCenterPage
├── DiagnosticsPage
├── ChangeSetPanel
└── RecoveryPanel
```

状态拆分为：

```text
summary-store
item-query-store
change-set-store
review-store
bootstrap-store
maintenance-store
operation-coordinator
```

约束：

- committed state、projected state 和 query cache 分开；
- Change Set 是唯一未提交业务变化来源；
- query cache 不能成为正本；
- stale revision 使相关 query page 明确失效，不静默拼接；
- unknown outcome 继续阻止普通丢弃；
- recovery 不复用普通 edit 流程；
- 512 条样本使用分页或窗口化列表；
- 节点关系图只能作为可选详情视图，不能是唯一可操作界面。

### 13.1 Operation coordinator 状态机

每个 Session lifecycle 最多有一个会改变 record 的 active attempt。`applyChangeSet`、保存 Proposal Batch、validator-result
commit、initialize 和 restore 使用不同 operation kind，但共享以下状态：

```text
idle → staged → in-flight → settled-success
                    ├──────→ settled-business-error
                    └──────→ outcome-unknown → in-flight (exact retry)
                                          └──→ abandoned
```

规则：

- 从 `staged` 进入 `in-flight` 时冻结完整 versioned request bytes、operation ID、request digest、base revision 和 Session
  lifecycle；之后普通编辑不能改写这份 attempt。
- 明确成功清除 attempt，并用 Host committed result 刷新 committed state。
- 明确业务错误结束 attempt，但保留用户 Change Set；revision conflict 进入 rebase，而不是丢弃修改。
- dispatch 后发生 disconnect、timeout、receiver detach、Host shutdown 或无法分类的异常时进入 `outcome-unknown`。
- `outcome-unknown` 锁住同 Session 的所有写操作和普通 Discard；query、export 和诊断读取仍可用。
- Retry 逐字节重放冻结的 request，不重新生成 Change Set ID、request digest、client refs 或 relation list，也不先用当前
  draft 重新规划。
- 只有 Host 的成功 receipt 或确定性业务错误能自动结束 unknown。`UNAVAILABLE`、再次超时和 lifecycle source 暂时消失都
  保留 exact attempt。
- Abandon 只清除客户端 attempt 证据，不声称 Host 未提交，也不清除 staged Change Set。UI 必须显示这个风险。
- initialize/restore unknown 与普通 mutation unknown 互斥；不能通过切换到 Recovery 绕过写锁。
- validator evaluation 尚未进入 commit 前可以取消或重跑；一旦 result batch dispatch 到 mutation queue，就使用相同写锁、
  unknown 和 exact retry 规则，不能重新读取文件后覆盖未知结果。

Store gate 和 UI gate 使用同一 selector。所有按钮隐藏、禁用、快捷键和 programmatic action 都必须经过 coordinator，不能只在
视觉层防重入。

### 13.2 Client ownership 与数据保留矩阵

| 事件 | committed state | staged Change Set | query cache | unknown attempt |
| --- | --- | --- | --- | --- |
| 切换一级区域、筛选、语言或主题 | 保留 | 保留 | 可保留 | 保留并继续锁写 |
| Pane unmount/remount，同一 JS runtime | 重订阅 | 按 Session 保留 | 按 revision 校验 | 必须保留 exact request |
| 切换 Session | 各 Session 隔离 | 进入有界 per-Session LRU | 隔离 | 不得被 LRU 驱逐 |
| connection/source `UNAVAILABLE` | 保留最后 committed 并标 stale | 保留 | 失效或只读 | 保留 exact request |
| 同 Session lifecycle 改变 | 丢弃旧 committed authority | 标为 stale，禁止直接 Apply | 全部失效 | 保留证据，禁止向新 lifecycle 重放 |
| query 返回旧 revision 或旧 request token | 不改变 | 不改变 | 丢弃迟到响应 | 不改变 |
| revision conflict | 更新 committed 后显式 rebase | 保留全部 op 和用户正文 | 失效 | 已知业务错误后结束 attempt |
| 普通 Discard | 不改变 | 清除普通 staged 内容 | 不改变 | 存在 unknown 时拒绝 |

Per-Session LRU 只能驱逐没有 dirty Change Set、没有 unknown attempt 且没有 maintenance 草案的 entry。达到上限但没有可驱逐
entry 时，拒绝打开新的 editable Session，并允许只读查看；不能静默删除用户草案。

### 13.3 Reload 与 Desktop restart

Same-runtime exact retry 是 0.2 必须保证的基线。跨 browser reload 或 Desktop restart 的 exact retry 只有在 M0/W0 证明存在
获准的、按 profile 和 Session lifecycle 隔离的非正本 outbox 后才能承诺。Outbox 若启用，必须：

- 保存完整 versioned request、operation ID、digest 和 lifecycle，不保存认证 token；
- 有独立字节、条目和保留时间上限；
- settle 或用户明确 abandon 后删除；purge 后清理可能包含被清除正文的 entry；
- 启动时先查询 Host receipt，再决定 exact replay；不把 outbox 当 Charter 正本；
- 通过浏览器 reload、Desktop restart、commit-then-crash 和 storage quota fixture。

如果 DSH 没有合适的持久化 API，0.2 不得使用私有 Conversation store、DOM 或受限 plugin record API 模拟 outbox。此时
stable 合同明确限定为 same-runtime recovery；重启后通过 Recent Changes 和 record revision 帮助人工核对，但不自动断言
旧请求成功或失败。该降级必须在 W0 冻结，并进入 UI 文案、风险说明和验收例外清单。

## 14. 实施阶段

### W0：关系语义和证据

交付：

- 冻结 Proposal、Proposal Batch、Recent Changes、inactive item 的术语；
- 冻结 Core V2 record 所有权、状态转换、canonical serialization 和第 10.5 节线性化协议；
- 冻结 `requires` 端点、archive/supersede/purge 规则；
- 建立 v1 flat prompt 与 dependency-aware prompt fixture；
- 接入路线图 M0 的单记录 v2 大小和更新时间探针；
- 冻结 source projection registry、cursor codec、reason code、方法级授权和 proposal/query/relation/tool 配额；
- 冻结 operation coordinator、same-runtime recovery 和 persistent outbox 可行性；
- 冻结第 15.9 节性能预算和第 15.12 节 A/B promotion threshold；
- 定义模型行为 A/B 任务集和指标；
- 完成桌面、窄屏、512 条数据的低保真交互原型。

前置文档动作：版本路线正式决定 `requires` 和 `queryProposals`；现行设计第 6.4 节与同 domain v2 默认方案对齐；发布文档
关闭 provenance 配置冲突和 rc.5 同版本重建歧义。

退出条件：没有状态、迁移、授权、依赖语义、存储和发布证据边界的未决 P0，且路线图已经明确是否将 `requires` 纳入
0.2 stable。Core V2 schema、Remote contract 和 acceptance fixture manifest 已完成评审。

### W1：信息架构与 Read Plane

交付：

- 三个一级区域；
- Workspace 和 Change Set 基础布局；
- `watchSummary`、`queryItems`、`queryProposals`、`queryChanges`；
- active、pending、inactive 和 recent changes 分离；
- revision-bound cursor；
- 现有 v1 数据的只读适配。

此阶段不写 v2 record，也不改变 prompt。

退出条件：v1 只读适配零写入；query/cursor fixture 和 512/512 read-plane 性能门槛通过；旧 Client/新 Host 与新 Client/旧
Host capability mismatch 不白屏、不发生有损写入。

### W2：Proposal Inbox 与 Record V2

交付：

- v2 schema 和原子迁移；
- Proposal Batch 和 provenance；
- compaction、message、manual、agent-tool、fork 来源；
- `legacy-unknown` 迁移；
- 批量 accept/reject；
- Recent Changes；
- full future-schema downgrade gate 验证。

Evidence Integrity、Fact Validity 和 validator 仍按版本路线图实施；W2 不能把它们从 record v2 或 beta 完整性门槛中移除。

退出条件：第 15.2–15.4、15.6、15.7 节对应 L1/L2 全部通过；packed 0.1 stable → 0.2 migration/downgrade smoke 已建立，
不是只用内存对象证明迁移。

### W3：依赖感知执行计划

交付：

- deliverable `requires`；
- 环、自依赖和悬空引用校验；
- supersede/purge 入边规则；
- fork ID remap；
- dependency-aware Workspace；
- stable topological prompt rendering；
- `charter_read standing` 更新；
- Change Set relation diff；
- 强制 compaction 的模型行为 A/B。

退出条件：dependency/prompt/tool fixture 全部通过；真实 compaction 证明 rematerialization；A/B 达到路线图已冻结门槛，或明确
撤回“改善模型执行顺序”的产品主张并重新决定 `requires` prompt 是否进入 stable。

### W4：验收与发布硬化

交付：

- source 与 exact-artifact compatibility matrices；
- 真实 Gateway 的 method × principal × resource × op × fault matrix；
- Web DOM/E2E/a11y、Desktop ABI/update/restart 和 screen reader evidence；
- 同一 candidate bytes 的 package、recovery、migration、downgrade、profile 和 model gates；
- 512/512 性能与流量基线；
- registry exact install、无版本 Desktop Install/Update 和 Promotion 失败重入；
- 第 15.11 节机器 evidence bundle。

退出条件：第 15.13 节所有 P0 域通过；任何上游限制都有明确运行边界和文档，不以 waiver 冒充产品能力。

### W5：可选实验

候选：

- invariant `appliesTo`；
- 用户控制的 Focus；
- 可选 dependency graph 详情视图；
- proposal conflict/duplicate 辅助诊断。

这些功能不在 0.2 关键路径，也不因进入 W5 自动成为 stable 范围。只有证据显示收益且不破坏预算、权限和确定性约束时
才进入稳定契约；W4 不得等待这些实验。

## 15. 验收与证据

0.2 的验收追踪表固定使用：`要求 → 权威来源 → 实现位置 → 测试/证据 → 状态`。测试数量、版本、日期、digest 和
registry 状态都从候选实际输出记录，不预填未来值。低层测试不能替代高层证据，例如 source Vitest 不能替代真实 Gateway，
Web bundle smoke 不能替代 Desktop，fixture checker 不能替代真实模型 compaction。

### 15.1 证据层级

| 层级 | 证明内容 | 典型产物 |
| --- | --- | --- |
| L1 Core fixture | schema、状态转换、planner、renderer、migration 的确定性 | golden JSON/bytes、property/table tests |
| L2 Host integration | storage、queue、fault、restart、Remote handler 和 client store | Host/Client integration result |
| L3 Real Gateway | principal、Session resource、workspace capability、cancel 和 transport | gateway evidence JSON |
| L4 Browser/Desktop | DOM、布局、文件选择、WebCrypto、Electron ABI、真实 profile | trace、screenshot、a11y、Desktop evidence |
| L5 Exact artifact | 实际待发布 tarball、隔离依赖图、升级降级和安装路径 | artifact SHA、lock/graph digest、smoke JSON |
| L6 Real model | runtime-context、工具、compaction 和受控行为对比 | transcript digest、model run manifest |

Alpha 每个已实现域至少通过 L1/L2；beta 前通过对应 L3/L4；RC 必须通过全部适用层级和第 15.11 节发布门禁。任何
waiver 必须写明范围、原因、失效日期和批准人，不能把待验收项记为 PASS。

### 15.2 Core 状态、planner 与原子性

L1/L2 必须覆盖：

- 第 6.7、6.8 节 review、lifecycle、validity、progress 的每个合法和非法转换，以及 source integrity、prerequisite status 和
  execution display 的全组合派生矩阵；派生结果不得回写 review、lifecycle、progress 或 standing；
- 同一 snapshot、request 和 planner version 在 ID allocation 前生成逐字节相同的 canonical semantic plan、prompt 和 summary
  digest；完整 committed record/result 的 golden test 注入固定 ID allocator 与 clock，生产 exact retry 则以 receipt 保证相同
  ID mapping、revision 和 result digest；
- Client preview 与 Host canonical summary 的 differential fixture；不一致时 Host 以 `PREVIEW_MISMATCH` 拒绝并返回新的
  canonical summary，客户端不能把本地 preview 当提交结果；
- Metadata-only Change Set 不改变 prompt digest，Proposal、来源、时间、validator 和 receipt 不进入 standing prompt；
- 一次 Change Set 只产生一个 revision 和一次 durable record update；任一 op、授权、relation 或 quota 失败时整批零可见；
- no-op、重复 clientRef、operation ID reuse、混合 objective 修改、purge 与同 ID 其他操作的稳定错误；
- history/receipt trimming 后 current、prompt 和幂等窗口仍合法；purge 后 record、receipt、outbox 和 batch metadata 不泄漏正文；
- 随机 op permutation/property tests 证明 canonical sort、DAG 和引用完整性不依赖输入对象顺序。

Core fixture 保存输入 bytes、canonical record bytes、prompt bytes、state/prompt/request/result digest、预期 revision、ID mapping 和
错误 code/reason。只比较 JavaScript 对象不算通过。

### 15.3 迁移、降级与恢复

受版本控制的 fixture corpus 至少包含：空 v1；objective；active/pending/rejected/archived/superseded；完整 replacement chain；
所有 v1 verification；history 和 mutation/maintenance receipt 边界；fork parent/child；Unicode、CRLF、NFC/NFD、emoji；最大合法
record；已超预算但 schema-valid record；inner corrupt；future schema；v1/v2 archive。

L1/L2 验证：

- v1 只读打开零写入，无 active dependency 时 prompt bytes 与 v1 完全一致；
- 首次业务 mutation 按第 10.5 节只执行一次 update，同时完成迁移、业务变化和 receipt；
- migration、planner、quota、put/update before-commit 失败保留原 v1 bytes；commit-then-error 进入 unknown，exact retry 返回
  相同 revision、ID mapping 和 result digest；
- legacy pending 只生成 `legacy-unknown`，不从 `origin: agent` 或正文伪造来源；
- v1/v2 archive export/restore、restart、fork remap 和 receipt replay 保持语义；
- 0.1 stable 打开 v2 时 future-schema fence 生效，edit/initialize/restore 不改写字节；重新升级 0.2 可继续读取；
- 每一个公开 0.2 prerelease fixture 按第 10.6 节迁移。

L5 必须从真实 0.1 stable artifact 写出 v1 record，再用同一 0.2 candidate tarball执行：只读打开 → 首次 Change Set →
restart → export/restore → fork → 0.1 stable 降级隔离 → 再升级。测试不能只在 0.2 测试代码中手工构造对象。

对每个公开且承诺保留用户数据的 0.2 prerelease，还必须用其真实发布 artifact 创建、修改、archive 并 restart，再由 stable
candidate 迁移，核对 canonical record、prompt、provenance、validity 和 receipts。受版本控制 fixture 的原始 bytes/digest 必须
与真实旧 artifact 输出对账，不能用人工近似 fixture 替代实际升级路径。

storage 外层 JSON 在 KvTable 之前不可读仍是上游限制。验收只能证明 Host 可见的 inner corrupt/future record 不被覆盖；发布
说明必须继续保留停 Host、备份和离线修复流程，不能声称已自动区分 absent 与 outer corrupt。

### 15.4 Proposal、provenance、evidence 与 validator

L1/L2 corpus 覆盖 manual、message、compaction-summary、agent-tool、fork、legacy-unknown，以及 objective proposal。每种来源
验证 Host-owned seq/role/digest、projection registry version、正确 Session lifecycle、source missing/mismatch/unsupported、正文
编辑后的 `content modified`、accept/reject/purge、dedupe、最小 tombstone 和 receipt 裁剪后的 review revision。

必须证明：

- 调用者伪造 actor、seq、role、digest、tool call identity 或跨 Session source 时 fail closed；
- 保存 transient draft 前 record bytes 不变；只保存明确选中的 candidate；筛选变化不扩大批量 ID 集合；
- objective proposal 不出现在 item query，接受时 initialize/redirect 规则和 reason 校验正确；
- source 丢失只改变 integrity，不改变 review、lifecycle、standing 或 validity；
- proposal 正文只有一个持有位置，purge 后同源同文可以创建新 proposal，旧 tombstone 不承担 dedupe；
- `charter_propose` 只能创建 pending invariant/deliverable/relation proposal，不能改变 objective、progress 或当前契约。

Evidence binding 另建 corpus，覆盖 accepted item 与 pending proposal 的 binding 创建、正文编辑、fork remap、purge、excerpt
bytes cap、projection version 升级/unsupported，以及 source digest 与 validity input digest 不混用。Evidence/source 消失不改变
standing；正文不得在 item、proposal、batch、receipt、tombstone 多处持有。

完整 0.2 stable 还必须对注册式 validator 执行 L1–L3：path exists、file digest、file contains、missing、unreadable、权限拒绝、
symlink escape、path traversal、timeout、cancel、read 前后变化、input digest stale、未注册 validator 和任意 executable 拒绝。
Evaluation 与 result commit 分开取证：前者未提交时可安全重跑，后者使用 operation ID、base revision、input digest、receipt 和
单一线性化点；commit 后 response loss 进入 unknown/exact retry。一批 validator result 只产生一个 revision，metadata 不进入
prompt。Validator 和 evidence integrity 的验收证据同样阻断 0.2 发布。

### 15.5 Dependency、prompt 与模型工具

L1/L2 必须覆盖：

- self edge、duplicate edge、cycle、dangling endpoint、非 deliverable endpoint、inactive endpoint；
- accept candidate references、archive/reject/supersede/purge 的入边和出边、restore 不恢复边、fork remap；
- 第 6.5 节所有 progress × prerequisite 组合，以及新增 conflict 的明确确认；任何状态都不自动改 progress；
- 无 active edge 时 v1/v2 prompt 逐字节一致；有 edge 时稳定拓扑排序、局部 `D<n>`、稳定 requires 顺序和 fork prompt 等价；
- 恶意正文中的 JSON、`{{...}}`、控制字符、lone surrogate、Unicode normalization 和 UTF-8 预算；
- relation 增长造成 prompt/record 超限时整批失败，已超限记录只能通过缩小修改收敛；
- `charter_read standing` 完整返回或显式 `LIMIT_EXCEEDED` / `RESULT_BYTES`，不能返回未标记的部分硬约束；`all` cursor 无重复遗漏；
- `charter_propose` 伪造 Session/actor/seq/digest/toolCallId、超过 item/text/relation/result cap、非 deliverable endpoint、cycle、
  未同时接受 batch prerequisite 和需要用户确认的 dependency conflict 均 fail closed；结果只能说明进入待审，不能声称生效；
- 目标 profile 的最终 assembled-message 顺序、user role 和 compaction 后 rematerialization。

L6 使用 candidate-bound transcript 证明 compaction 后最新 runtime-context 中的 Charter 与 storage renderer bytes 相同，并验证
`charter_read`/`charter_propose` 的 tool call identity、授权和结果配对。Fixture checker 通过但没有真实模型运行时，只能记为
checker PASS，不能记为 compaction PASS。

### 15.6 Remote、授权、query 与配额

L2 用 receiver/storage/workspace spy 证明 transport hard cap 后只解析 method/Session resource 路由字段，未授权请求在读取
record identity/正文、Session event 或文件前被拒绝；validator capability/workspace permission 拒绝也不能触发 storage read。L3 在每个支持 resource
enforcement 的目标 DSH 上验证 owner、authorized user、guest、missing principal、cross-session、wrong lifecycle、workspace
capability denied、malformed request、cancel-before-dispatch、cancel-after-dispatch 和 per-Session concurrency。

Query/cursor fixture 使用固定 512 items / 512 pending corpus，覆盖：

- 每个 kind/review/lifecycle/source/validity/prerequisite/execution facet 和组合 filter；
- Unicode search、稳定 sort、page size 1/边界/最大值、首中末 cursor；
- malformed、未知 codec、cross-kind、cross-filter、cross-session、cross-lifecycle 和旧 revision cursor；
- 插入、删除、supersede 后旧 cursor 显式 stale；相同 revision 分页无重复遗漏；
- response byte cap 的确定性页尾、单行过大显式失败、preview 截断标记；
- 取消、超时和 detach 后 concurrency slot 释放，迟到响应不污染新 Session/revision cache；
- `queryItems` 与 `queryProposals` 绑定同一 revision，任一 stale 时不拼接结果。

新旧 Remote 还要覆盖旧 client + 新 Host、新 client + 旧 Host、capability negotiation，以及 old/new endpoints 调用同一
core handler。旧 Host 不支持新能力时明确禁用，不静默降级写入。

### 15.7 Fault、unknown outcome 与客户端所有权

L2 fault matrix 至少覆盖 open/load/put/update 的 before-durable、after-durable、deferred completion、response loss、Host shutdown、
restart、connection detach、Session switch、source change 和 lifecycle rollover。Apply、Proposal Batch save、validator-result commit、initialize、restore 各自
遍历 `staged / in-flight / outcome-unknown / settled`，并验证：

- after-durable transport error 只允许 exact retry；Retry request bytes、ID、digest、base revision 和 relations 完全相同；
- deterministic conflict 结束 unknown 并允许 rebase；`UNAVAILABLE` 不结束 unknown；
- unknown 锁住所有写入口和普通 Discard，query/export 仍可用；Abandon 保留 staged payload 且不声称未提交；
- Session/区域/语言切换、Pane unmount/remount不清 unknown；旧 request token 的响应不能写入当前 store；
- dirty/unknown entry 不被 per-Session LRU 驱逐，store gate 与 UI/shortcut gate 一致；
- query、source-integrity 和尚未提交的 validator evaluation 失败可以安全重试，不错误进入 mutation unknown 状态；
  validator-result commit 则必须进入同一 receipt/unknown 协议。

若启用 persistent outbox，浏览器 reload、Desktop restart、commit-then-crash、outbox quota、settle cleanup 和 purge cleanup 是
P0 fixture。若 W0 判定无获准 outbox，则这些场景必须验证“不会自动重放或断言结果”、不会向新 lifecycle replay，UI 明确
要求核对 revision/Recent Changes，且产品文案不使用确定性的“恢复成功/失败”；同时记录 same-runtime 限制。

### 15.8 UI 与无障碍

DOM component tests 和真实 Browser/Desktop 共同验证：

- 默认 Workspace 无需切页即可识别当前目标、全局硬约束、当前可推进项、等待条件、未应用 Change Set 和首要阻塞原因；
- Review Center 按 Batch、来源、状态筛选，查看 provenance/integrity、replacement lineage，并只批量处理明确选中的 ID；
- 三个一级区域、Change Set region/dialog、错误摘要、live region、mixed checkbox、虚拟列表和 dependency jump 满足第 5.7 节
  role/name/state/focus 合同；
- Apply success、conflict/rebase、unknown Retry/Abandon、query stale、capability mismatch 和长错误详情都可用键盘完成；
- 320/560/880px、200% 文本缩放、forced colors、reduced motion、中英文、明暗主题、触屏和 512/512 压力样本；
- hover help 可由 focus 获得，焦点在 dialog/sheet 关闭、列表刷新、错误跳转和 dependency 跳转后落到明确目标；
- axe/等价自动检查无 serious/critical finding，关键流程再用真实 screen reader 人工复核。

`react-test-renderer` 中存在 aria 属性只算 L1 辅助证据。真实布局、computed accessibility tree、文件选择器和 focus order 必须由
L4 证明。D16 固定 OS、浏览器/Electron、screen reader/version、语言和 scenario IDs；场景至少包含 Apply、conflict/rebase、
unknown Retry/Abandon、query stale、dialog/sheet、dependency jump 和 file restore，并记录预期读出与焦点落点。

### 15.9 性能、流量与 cache

以下是进入 alpha 前的默认预算；M0 可以依据固定 corpus 探针修改，但必须在实现前更新本文和版本路线，beta 后不得无证据
放宽：

| 项目 | 默认门槛 |
| --- | --- |
| `watchSummary` 单帧 | 不含正文，最终 wire bytes ≤ 16 KiB |
| query page | 默认 50、最大 100 rows，最终 wire bytes ≤ 64 KiB |
| query concurrency | 每 Session 最多 4 个 active read；取消/超时立即释放 |
| client query cache | 每 Session 最多 8 页或 512 KiB，先到者触发 LRU |
| 512/512 Host query | 固定 CI runner、预热后 30 次的 p95 ≤ 100 ms |
| 512/512 Change Set planning | 同一 runner p95 ≤ 100 ms |
| 最大 v1→v2 migration plan | 同一 runner p95 ≤ 250 ms，不含 storage I/O |
| Browser 首个可用 summary | fresh profile p95 ≤ 1.5 s；筛选/翻页反馈 p95 ≤ 250 ms |

Query cache key 固定包含 Session lifecycle、query kind、revision、filter digest 和 cursor。Revision/lifecycle/capability 变化立即使
相关页 stale；cancel/late response 不能复活旧页。容量按保留响应的 canonical serialized wire bytes 计算，LRU 使用单调 access
counter 和稳定 key tie-break；query page 可以驱逐，但含 dirty/unknown operation 的 Session store entry 不能随之删除。Fixture
覆盖跨 Session、跨 filter、stale invalidation、容量边界、deterministic eviction 和 reload 分支。

Browser “首个可用 summary”从已认证 Remote 可用且 Pane factory mount 开始，到 revision、objective/counts 和一级导航可操作为止；
在固定 runner image 上做至少 20 次 cold fresh-profile run，timeout/启动失败计入失败，不从样本删除。筛选/翻页在首屏完成后做
30 次预热外操作并记录 p50/p95。Runner image、CPU/内存、浏览器版本、Host readiness、起止 performance marks 和失败处理写入
evidence schema。

性能 evidence 记录 corpus digest、runner、Node、浏览器、轮次、原始样本和 p50/p95，不能只写“感觉流畅”。Summary payload 从
最小 record 增长到 512/512 corpus 时仍受固定 cap 约束，不能随正文总字节线性增长。Validator/source-integrity 的并发和超时
与普通 query 分池，不能占满 read plane。

Traffic A/B 固定 provider、model、tools、输入和重复次数，分别记录 prompt、active/historical runtime snapshots、uncached
input、cache read/write、output 和 tool envelope。DSH runtime-context append 造成的历史重复单独归因；没有受控差分时不宣称
Charter 导致或改善 provider cache。Traffic 的 P0 oracle 是事件配对完整、计量口径固定、active/historical/failed attempt 分类
正确且不做错误因果归因；token/cache 降幅只有达到第 15.12 节预注册门槛后才可作为产品收益。

### 15.10 Web 与 Desktop 真实路径

L4/L5 必须使用同一 candidate tarball 和隔离 profile，不触碰维护者日常 Desktop/profile。

Web 路径：fresh profile 安装 → 三个一级区域和完整操作 → export → 保留 lifecycle 并移除 target → file picker/WebCrypto
restore → reload → Host restart → healthy-target refusal → capability mismatch → 浏览器 a11y/viewport。至少运行项目支持的
Chromium；布局和标准 Web API 再用 Firefox/WebKit 做兼容抽样。Evidence 保存 console error、network/Host log、screenshot、trace、
DOM/a11y report、resolved plugin/DSH version 和 artifact digest。

Desktop 路径：fresh Desktop profile、通过 Desktop Plugins 本地 tarball/import UI 安装 exact artifact、从 0.1 stable 更新、
tab/Remote/tool ABI、Session reopen、app restart、v1 migration、export/restore、theme/locale 和 Host/client 暂时错位。不得用
`dsh plugin --profile desktop` 代替 Desktop 拥有的 plugin lifecycle。目标 Electron app 的 DSH 必须是候选声明支持的当前版本；
旧 Desktop 上一次通过不能替代新目标版本。Restart 后的 unknown handling 按 D11 分支验收：有 outbox 时先查 receipt，无 outbox
时只允许人工核对，不能自动判断旧请求结果。

Registry 发布后分别验证：`dsh plugin --profile web add dsh-charter@<exact-version>`、精确本地 tarball fallback、Desktop catalog
无版本 `Install` 和从上一版本 `Update`。每条路径记录实际 resolved plugin/DSH version、compatibility gate 和 registry 下载
tarball SHA。pnpm maturity window 内，Desktop catalog 状态只能记为 `pending-maturity`，可以验证 local tarball fallback，但不能
用 exact install 冒充 catalog PASS；窗口结束后再提交独立 installability evidence。

### 15.11 兼容、精确产物与发布

Source matrix 对每个声明 DSH 版本和当前未跟踪的 npm `latest`/`next`/新版本建立隔离依赖图，使用 strict peers、frozen
lock，记录全部 `@deepseek-ai/dsh-*`、Cordis、Node/npm/pnpm 和 dependency graph digest，并运行 typecheck、build、full tests。
结果分类固定为：

- 已声明版本、当前运行基线或拟新增支持版本：缺包、peer drift、typecheck/build/test 任一失败即 P0 NO-GO；
- 未声明 probe：必须完成发现和 strict install 尝试；通过后同步加入全部声明和文档，失败则记录精确原因并明确 unsupported；
- 未探测、silent drop、版本自动漂移或未运行测试始终是门禁失败。

禁止 `--force` 或 `--legacy-peer-deps` 掩盖。D14 冻结后，旧 DSH 可以保留明确的旧能力兼容，但新 query/write/validator
endpoint 必须 capability-disabled，不能用 Host lifecycle check 冒充 Gateway resource enforcement。

Candidate 只 pack 一次。以下门禁消费同一 tarball 和 SHA-256，不从 checkout 重建产品字节：

- package structure/consumer smoke；
- isolated packed recovery 和完整 source fault matrix；
- artifact compatibility matrix；
- real Gateway；
- v1→v2 migration/downgrade；
- fresh Web/Desktop profile；
- candidate-bound real-model compaction。

Artifact compatibility matrix 对每个声明版本安装同一 candidate tarball，记录实际 resolved package list，并执行 packed
consumer、Host/Remote/client ABI 和适用的 Gateway/profile probes；不能复制源码再构建，也不能把 source matrix 日志改名为
artifact evidence。

Public CI 在规定的最低/当前 Node 上通过；candidate commit、checksum-only release commit、tag、GitHub artifact、registry tarball、
browser/model/Desktop evidence 和最终 release evidence 的 digest 必须一致。发布前还必须统一 npm provenance 策略：启用
OIDC/Trusted Publisher 并保留 provenance，或明确关闭 `publishConfig.provenance` 并使用受保护 token；配置、workflow 和文档不得
互相矛盾。

Promotion 验证首次发布及失败重入：tag 后中断、draft Release 后中断、npm publish 后中断、`next`/`latest` 部分移动、公开
prerelease 重跑和更高版本已推进 channel。每个 GitHub Actions job 按独立干净机器设计，不能依赖其他 job 未上传的工具或
文件。精确版本发布后不可重建、改 tag 或覆盖字节。

证据按时间拆成三个不可混用的 bundle：

- Candidate bundle（发布前）：release metadata、SHA256SUMS、source check、source/artifact compatibility matrices、dependency
  graphs、Gateway、migration/downgrade、packed recovery、local exact Web/Desktop、Web E2E/trace/a11y、Desktop ABI、real-model
  compaction、traffic A/B 和 performance；
- Promotion/release bundle（registry 写入后立即生成）：candidate/release commit 与 tag 拓扑、registry tarball 回读 SHA、
  exact-version Web CLI install、dist-tags、GitHub assets、provenance mode、失败重入状态和 release evidence；
- Installability addendum（maturity window 后）：Desktop catalog 无版本 Install/Update、resolved version、compatibility gate 和
  registry policy 状态。窗口未结束时发布状态必须写 `pending-maturity`，不能提前宣称 Desktop catalog 可安装。

Promotion 不等待 post-maturity addendum，也不能把它伪造成发布前证据；addendum 作为受保护的后续 evidence 保存，不改写已公开
版本的 tag 或 tarball。每份机器证据绑定 schema version、run ID、commit、artifact、SHA、版本、环境、开始/结束时间和
scenario ID。

### 15.12 模型行为 A/B

至少比较：

| 组别 | UI | Prompt |
| --- | --- | --- |
| A | 0.1 平铺 UI | 0.1 平铺 prompt |
| B | 0.2 三个一级区域 | 0.1 平铺 prompt |
| C | 0.2 三个一级区域 | dependency-aware prompt |

任务集至少包含 5–8 条硬约束、6–10 个有前置关系的 deliverable、一条 superseded invariant、一次中途依赖修改、多轮工具调用和
一次真实 compaction。固定 provider、model、模型参数、工具 schema 和任务输入；每个任务/组至少重复 5 次，保存完整去敏
transcript 和失败分类。

W0 预注册 task IDs/corpus digest、精确 model ID/revision、参数、tool schema digest、run 顺序随机化、失败分类、指标聚合、
不劣界、实质改善阈值、样本量/重跑规则、transcript 脱敏与排除标准，以及 compaction 触发点和前后比较窗口。运行后不得根据
结果改评分规则或只删除不利样本。

记录硬约束违反、前置条件未满足时提前执行、用户纠正、当前目标/下一步识别、compaction 前后差异、prompt bytes、uncached
input、cache read/write、Review Center 审阅耗时和误接受。B 对 A 评估信息架构，C 对 B 评估 dependency-aware prompt。

W0 pilot 后必须在路线图中冻结 C 进入 stable 的数值门槛。最低条件是硬约束违反不劣于 B，且提前执行或用户纠正至少一项有
预先约定的实质改善；如果未达到，三中心 UI 可以继续，但 `requires` prompt 投影不能凭主观判断宣称改善模型遵循率。

### 15.13 发布判定

| 验收域 | 必需层级 | 阻断级别 |
| --- | --- | --- |
| Core/Change Set/prompt | L1、L2 | P0 |
| migration/downgrade/recovery | L1、L2、L5 | P0 |
| proposal/provenance/validator | L1、L2、L3 | P0 |
| Remote/query/authorization | L2、L3、L5 | P0 |
| fault/unknown/client ownership | L2、L4 | P0 |
| Web/Desktop/a11y | L4、L5 | P0；screen reader 人工复核最迟 stable 前完成 |
| compatibility/exact artifact/install | L5 | P0 |
| Candidate/Promotion/release evidence | L5 + protected workflow | P0 |
| compaction/rematerialization correctness | L6 | P0 |
| dependency-aware prompt promotion | L6 A/B | 仅当该 prompt 进入 stable 或声明行为收益时 P0；未达门槛则撤下该投影 |
| performance budgets | L2、L4 | beta/RC P0 |
| query cache 与 traffic attribution correctness | L2、L6 | P0；token/cache 收益另受 A/B 门槛约束 |
| Desktop catalog installability addendum | L5 post-publish | 宣称 catalog 可安装前 P0；maturity 内保持 `pending-maturity` |

整体 GO/NO-GO 由最弱的必需层决定，但结论必须分别报告产品行为与数据安全、clean install/兼容/精确产物、
Candidate/Browser/Promotion 流水线，以及 PR reviewer/environment/registry 等外部治理。Outer JSON、runtime-context 历史重复、
严格 fork boundary、多 Host JSON 写入和旧 DSH resource enforcement 继续列为上游限制，不得伪装成 0.2 已修复能力。

## 16. 风险

| 风险 | 影响 | 控制方式 |
| --- | --- | --- |
| 依赖模型演变成项目管理器 | 产品范围失控 | 只支持 Session 内 deliverable prerequisite |
| 关系增加 prompt 字节 | 预算和 cache 压力 | 短局部标签、UTF-8 总字节准入、A/B |
| 自动状态传播误改用户意图 | 正本失真 | readiness 只派生，不自动改 progress/lifecycle |
| Proposal 时间线变成永久审计 | 记录增长和清除语义冲突 | 有界 receipts、正文单一持有、显式 retention |
| 图形 UI 在移动端不可用 | 无障碍和规模问题 | 列表为主，图形只作可选详情 |
| Focus 隐藏必要约束 | 模型违反约束 | 全局 invariant 常驻、用户确认、可解释投影 |
| v1/v2 混读 | 数据损坏 | 正式 schema v2、future-schema fence、原子迁移 |
| Query 和 write revision 漂移 | 错误审阅或误提交 | revision-bound cursor、Change Set base revision |
| Cursor/filter/search 算法漂移 | 分页重复、遗漏或错误拼接 | versioned codec、filter digest、exclusive sort key、golden corpus |
| Unknown attempt 被导航或重启清除 | 重复提交或无法判断结果 | coordinator、same-runtime 保留、outbox 决策和明确降级 |
| Persistent outbox 留存用户正文 | 隐私和 purge 失效 | 独立配额/retention、settle/purge cleanup、不得成为正本 |
| `charter_read standing` 配置放大 | tool result 过大或静默丢约束 | 独立 envelope cap、启动诊断、完整返回或显式失败 |
| Source projection version 被过早删除 | provenance 无法复算 | registry、fixture、读取期限和 `unsupported` 状态 |
| Summary/query 仍随正文线性增长 | 512 条时 UI 和网络退化 | 固定 wire cap、窗口化、性能 corpus 和 beta gate |
| runtime-context 历史 snapshot 重复 | 输入字节增长被误归因 | 保留最新完整权威投影，单独归因并推动 DSH 上游去重 |
| Source tests 代替真实环境 | 发布后才发现权限、Desktop 或 resolver 问题 | 分层证据、同一 exact artifact、最弱门禁决定 GO/NO-GO |
| 发布配置与治理文档冲突 | publish 失败或证据声明错误 | provenance 策略单一化、Promotion preflight、机器 evidence |

## 17. 待确认决策

| ID | 决策 | 最晚时间 | 必须产出 | 阻断范围 |
| --- | --- | --- | --- | --- |
| D01 | 全部候选 purge 后保留哪些最小 tombstone metadata | W0 | Core schema + privacy fixture | W2 |
| D02 | `queryChanges` receipt 数量、字节和查询上限 | W0 | Limits + wire schema | W1/W2 |
| D03 | `appliesTo` 是否进入 0.2 stable | W5/beta 前 | A/B 结果 + 路线图决策 | 仅该实验 |
| D04 | Focus 是否持久化及其投影参数 | W5/beta 前 | 实验协议 + 风险评审 | 仅该实验 |
| D05 | 是否提供可选 dependency graph 详情 | W5 | 可访问原型 | 仅该视图 |
| D06 | 同 domain record v2 是否通过大记录/update 探针 | M0/W0 | benchmark + storage 决策 | W2 全部写入 |
| D07 | W3 A/B 的数值 promotion threshold | W0 pilot 后 | 预注册指标、样本量和阈值 | dependency prompt stable |
| D08 | Message selection 使用 UTF-8 byte、code point 还是投影节点 | W0 | projection registry v1 | message proposal |
| D09 | `requires`、`queryProposals` 对路线里程碑和 feature freeze 的影响 | 实现前 | 修订后的权威路线 | W1/W3 |
| D10 | `charter_read standing` hard cap 及与 profile limit 的关系 | W0 | tool/wire limits + max fixture | tool 更新 |
| D11 | 是否有获准的 persistent outbox；没有时采用何种明确降级 | M0/W0 | API probe + client contract | restart recovery claim |
| D12 | 第 15.9 节默认 query/cache/latency 预算是否保留 | M0/W0 | 固定 corpus benchmark | W1 和 beta |
| D13 | Source projection 旧版本读取期限 | W0 | registry compatibility policy | W2 provenance |
| D14 | 0.2 新 Remote 的最低 DSH/resource-enforcement 基线 | M0/W0 | compatibility ADR + package declarations | 全部新 Remote |
| D15 | npm 使用 OIDC/provenance 还是 repository token/no-provenance | 下一次 publish 前 | workflow、package、发布文档一致 | 所有发布 |
| D16 | stable 人工 screen reader 组合 | beta 前 | OS/browser/Electron、reader version、scenario IDs、预期读出/焦点和 evidence schema | stable a11y |

## 18. 推荐实施边界

本文专题的建议最小闭环是：

1. 三个一级区域的信息架构；
2. Proposal Inbox、Proposal Batch 和 provenance；
3. Change Set 与查询面；
4. deliverable `requires`；
5. dependency-aware prompt；
6. record v2 迁移和降级围栏；
7. 受控模型行为 A/B 和真实 compaction 验证。

实现前必须先完成 D06、D09、D10、D11、D14，并修订相互冲突的权威文档。完整的 0.2 stable 仍须交付版本路线图中的
Evidence Integrity、Fact Validity、validator、授权、无障碍、兼容与第 15 节发布门禁。`appliesTo`、Focus 和图形依赖视图留在
W5，不能拖延核心版本。

按本次 rc.6 回归，本文在补入状态、迁移、cursor、故障、客户端所有权和分层验收后，已经覆盖 R01–R10、R12、R17 的
0.2 产品处理方案。R11、R13–R16、R18 仍依赖 DSH/storage 上游或明确运行边界；R19、R20 和当前 provenance/rc.5 发布文案
冲突属于版本发布治理。完善 0.2 设计不会自动关闭这些 rc.6 发布阻断项。
