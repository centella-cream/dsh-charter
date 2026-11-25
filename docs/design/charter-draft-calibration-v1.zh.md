# `dsh-charter` 0.3.4 契约草案校准方案（语言跟随 · 精简聚合 · 语义完整切分）

> **状态：** `Implemented — pending release acceptance` —— v8 自适应分批并发校准方案。v8 校准内核（planner/runner/reduce）、partial/失败状态行与披露 v2 已实现，并通过真实 10 轮 Web case 的默认参数工程实测（§5.11）；A/B 盲评、L4 UI/AT、真实旧 profile 与人工验收仍未完成，因此不 tag/release/publish、不声称 0.3.4 已发布。v7 单次实现的默认 max-tokens 失败与候选截断证据保留为反例。
> **版本范围：** `0.3.4`（草案校准补丁线，模型校准层 L2+L3）。**定位约束：只提升草案聚合/可读性/
> 语言/审阅效率与契约保持，不声称提升模型长程任务完成率，不承诺草案完整性/通用性**（历史补全与执行
> 能力属 [0.4.0 完整契约升级](charter-execution-v1.zh.md)）。依赖**已发布**的 `0.3.3`
> [charter-draft-extraction-v1.zh.md](charter-draft-extraction-v1.zh.md) 冻结接口（ref 语法、
> draftHandle、apply 命名空间分派、objective `clientRef`、`extractorVersion`）与其已上线的
> 翻译基础设施（§4 复用映射）。
> **基准：** 2026-11-24，`main` @ `44a542d3`；`0.3.3` 已发布（SHA-256 `707043d3…`）；v7 单次
> 调用实现已用真实 Web 10 轮 case 实测（见 §5.11），默认参数失败，v8 是修订方案而非既有合同。
> **修订：** v10（2026-11-25）——发布审查修复：Remote 业务错误信封/客户端分类、objective 与 conflicts 收敛及渲染、contractness 硬约束豁免、degraded 跨批 parts 映射、user-guide 配置与未实现缓存/按批重试承诺的文档对齐（§5.13）。
> v9（2026-11-24）——真实 session `85809bdb…` 验证暴露 v8 的契约质量问题：objective 与 4 个 deliverable 被
> global-cap 排除，heading 碎片/进度状态/历史背景/optional 建议仍作为契约。新增 §5.12 **契约性门禁、objective
> 预留、deliverable 配额、prompt v2 和输出过滤**；v8 内核不变。
> v8（2026-11-24）——把单次全量校准改为**自适应分批 + 受限并发 + 单批拆分重试 + Host
> 跨批归并**；新增批次预算/覆盖账本/partial 结果与失败隔离；明确不复用 128K 单次大输出，
> 复用 0.3.3 翻译路径已验证的 `translationBatches`/`mapLimit`/`resilient split`/partial 合并模式；
> 披露文案因多批调用升版本；记录并用测试证据说明 v7 默认参数失败；§5.4–§5.10、§7.1、§8、§10–§13、
> 附录 B/C 同步。
> v7（2026-11-24）——移除未实现的 `calibration.trigger`/`calibration.cooldownMinutes`（auto/冷却保留到 A/B 后）；修正文档索引/§5.7 缓存/§5.8 取消/附录 C 记录；状态改为 pending release acceptance。
> v6（2026-11-24）——按实现审查收敛：0.3.3 翻译保留为独立回退、校准始终使用 L1 源 handle；consent 披露由 Pane + profile 配置承载；effort 直通与 signal 取消、按条目选择集列为后续门禁；§6.5 明确 MVP 为整体替换。
> v5（2026-11-24）——**版本定位调整（用户决策）**：本方案从 0.4.0 降级为 `0.3.4`
> 草案校准补丁线；0.4.0 重新定义为完整契约功能升级（另立
> [charter-execution-v1.zh.md](charter-execution-v1.zh.md)）。新增定位约束与四项发布保证
> （§0/§2.2/§9/§11）；downgrade round-trip 扩展为 0.3.2 与 0.3.3 双版本。
> v4（2026-11-24）——D1 决策落盘、状态转 Active；新增 §3.1 校准与 0.3.3 语言归一关系；
> §4 改为已交付基座复用映射；§7.1 增加 `awaitCalibration` 两段式；版本计数更新为 13；
> M0 探针按 0.3.3 线上验证裁剪为 3 项待执行。v3（2026-11-23）并入第二轮评审
> P0-A/P0-C 与 P1×5。映射见附录 C。
> **权威边界：** 版本范围由[版本路线](version-roadmap.zh.md)决定；proposal/来源语义由
> [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md) §4/§7 决定；审阅 UI 视觉由
> [charter-gui-v1.zh.md](charter-gui-v1.zh.md) §4.9 冻结稿决定。与权威文档冲突时先修订权威文档。
> **替代/被替代：** 无 / 无。
> **专题范围：** 模型校准服务、校准 provenance 与 apply 合同、校准审阅体验与诊断。
> 不改 record schema、不改 prompt 投影、不改 `charter_read`/`charter_propose` 工具面。

## 0. 摘要

0.3.3 已交付碎片消除、重复折叠、结构化 ref 与**自动 zh/en 语言归一**；仍不做语义级合并。
0.3.4 在其上增加高级模型校准层：

- **L2 校准服务（v8）**：宿主 `ctx.llm` 每批 hand-built one-shot；Host 先生成**确定性覆盖账本**并
  把 L1 草案规划为有界批次，再以受限并发执行；单批 `finish=length`/超时按对半拆批重试，批级失败
  隔离，最后 Host 做跨批归并；不做“全量草案一次调用”；
- **L2 预算（v8）**：单批 `maxOutputTokens` 4096、batch 8 条、concurrency 3、全局候选上限 32；
  `maxTotalOutputTokens` 是全局硬顶；所有预算/并发/失败都进 diagnostics 与 A/B 证据；
- **L3 校准审阅**：原文 ↔ 校准稿逐条 diff（基于 `mergedFrom` ref 映射）、一键"用原文"、
  聚合徽章、partial/truncated/degraded status line、校准诊断与计划批数（不伪造逐批进度）。

**产品底线（全部继承，不可协商）**：校准产物永远是 pending proposal，用户 accept 才生效；
默认关闭（opt-in + consentVersion 强校验）；校准永不替换结构化草案，完整原始草案始终可展开
（溢出可见）；**零 record schema 变更**——0.3.2/0.3.3 可直接读取 0.3.4 写出的记录，无
future-schema 围栏（§6）。

**为什么 v8 必须改（2026-11-24 真实 Web 实测）**：同一个真实 10 轮 Web Session + `/compact`
case，0.3.3 baseline 产出 22 条 invariant + 6 条 deliverable（完整但脏）；v7 单次校准在默认
`maxOutputTokens=2048` 下直接 `finish=max-tokens`，Remote 显示 `gateway/internal`；把输出上限
调到 8192 后成功，但只校准了 12/32 条 draft 并返回 `inputTruncated=true`，第 5–9 轮的迁移、
安全、性能、测试和 `favorited` 变更没有进入校准结果。结论：**调大单次预算不是解法，必须把
“覆盖完整 + 延迟/成本可控 + 失败可恢复”做成校准内核的一等约束**（§5.4–§5.11）。

**定位边界（v5，用户决策 2026-11-24）**：0.3.4 只提升草案聚合/可读性/语言/审阅效率与
**会话过程中关键契约的保持率**，**不声称提升模型长程任务完成率，不承诺草案完整性或通用性**。
校准只能基于 compaction summary，不能新增摘要外约束；"契约不完整"的解法是 0.4.0 的历史补全
能力，不在本方案。`relation proposal` 与 `record schema v3` 归入
[0.4.0 完整契约升级](charter-execution-v1.zh.md)；`charter.diagnostics` 维持路线图条件句，
本方案不立项。

**性能边界（v8）**：不为校准拉大模型上下文窗口，也不使用 128K 单次输出。校准输入是 compact
summary 的 L1 draft，不是 600–700K 的完整 session；真正的成本是输出生成和多次调用的并发/限流。
v8/v9 以“批级预算 + 并发 + 部分成功 + run 缓存”控制墙钟与成本，禁止把“单次大输出”当作质量方案。

## 1. 现状与代码事实（0.3.2 发布树，v3 修订补强）

| 事实 | 证据 | 对方案的约束 |
| --- | --- | --- |
| bootstrap/apply wire schema 全部 `.strict()`；`charterBootstrapApplyRequestSchema = charterEditRequestSchema.extend({draftHandle}).strict()` | [wire.ts:489-511](../../src/remote/wire.ts)、[schemas.ts:254-256](../../src/core/schemas.ts) | 扩展只能走新方法或 additive optional 请求字段；不能改既有响应 DTO |
| **`edit()` 已有不经 wire 的宿主侧参数通道**：`this.edit(request, actor, bootstrapSource?, opts?)`；request 本体经 `normalizeEditRequest` strict 重解析，ops 内私加字段会被拒绝 | [service.ts:1797-1808](../../src/host/service.ts)、[normalize.ts:144-156](../../src/core/normalize.ts) | 逐条 evidence 附着必须走同一类**宿主内部通道**，不能塞进 op（§6.1） |
| `itemFromInput` 复制 contentModified/requires/proposedRequires，**不复制 evidence**；record `itemBase.evidence` 字段已存在 | [commands.ts:39-69](../../src/core/commands.ts)、schemas.ts:80 | core 创建路径需要显式扩展 attachment 参数；record 零变更 |
| `applyBootstrap` 的 `contentModified` 基准 = 抽取候选文本；objective 仅接受与抽取文本**逐字相等**的 `objective.initialize`，`objective.propose/redirect` 拒绝 | service.ts:1740-1790 | 校准候选/校准 objective 的 apply 必须显式定义基准与路径（§6.3/§6.6），否则全部被拒或被误标 |
| Host service 依赖是强注入 `static inject = ['agents','sessions','storageDomain','systemPrompt','tools']` | service.ts:272 | **不得**加 `llm`；`ctx.get('llm')` 运行时可选解析（§5.1） |
| `charterViewCapabilitiesSchema` strict，仅 `recordMaintenance(+Reason)` | wire.ts:100-103 | 校准能力状态**不能**塞进 capabilities；用独立新方法（§7.2） |
| 宿主 `@deepseek-ai/dsh-llm`：`ctx.llm`、hand-built one-shot（`system` 槽）、`reasoningEffort`、`maxTokens`、`signal`、`BlockAssembler`、`reasoning` block 分离、`usage.reasoningTokens` | dsh-llm types.d.ts:357-372、:506-536 | L2 全部控制参数有原生 API；凭据由宿主 api-key seam 管理，插件零接触 |
| `dsh-llm` 目前仅在 devDependencies；0.3.3 用本地结构化类型访问 `ctx.llm` | package.json | **不强制新增 peer**：保持 11 版本可加载；需要运行时导入时再单独评估 peer 声明 |
| `ctx.agents` 已注入 | service.ts:272 | 模型解析链经 agent 当前选择（§5.3，M0-P7） |

## 2. 范围与非目标

### 2.1 范围（0.3.4）

1. L2 校准服务：可选注入、配置面（含 consent）、模型解析链、调用合同、动态预算、校验管线、
   缓存/限流/单飞、失败矩阵（§5）；
2. 校准 provenance 与 apply 合同：Host trusted-attachment 通道、`contentModified` 基准、
   `mergedFrom` 映射、objective 校准路径、选择集状态机（§6）；
3. wire：`charter/calibrateBootstrap` + `charter/calibrationStatus` 新增；
   `charter/applyBootstrap` additive 扩展（§7）；
4. L3 审阅体验与诊断（§8）；
5. 兼容：capability 矩阵（含服务缺失）、downgrade 硬承诺、peer 声明、四象限 skew（§9）。

### 2.2 非目标

- 不改 record schema（不引入 v3，§6.1 论证）；不改 prompt 投影与模型工具面；
- 不自动生效、不翻译已 accepted 条目（校准只作用于**草案**）；
- 插件不管理 API key；不新增遥测/上传；诊断仅本地内存；
- 不承诺 zh/en 之外的目标语言（其余语言原文透传 + 标注）；
- 不做 0.4.0 完整契约升级的任何内容：readiness/ready queue、停滞检测、执行记忆
  （decision/environment/progress proposal）、relation proposal、历史补全草案、LLM assessor、
  跨会话模板（见 [charter-execution-v1.zh.md](charter-execution-v1.zh.md)）；
- `charter.diagnostics`、Focus/`appliesTo` 实验不在本方案。

## 3. 方案总览

```text
compaction 发生
   │
   ▼
charter/bootstrapDraft（0.3.3）──► L1 结构化草案：ref/lang/oversized/foldCount/kindConfidence
   │                                      │（永远可用、永远可展开、语言不跟随）
   │  Pane 进入草案区时并行调用 charter/calibrationStatus（§7.2）决定校准入口四态
   │  用户点击「智能校准」（available 才可见可点）
   ▼
charter/calibrateBootstrap(sessionId, draftHandle, locale, effort?, consentVersion)
   │
   │  Host planner（纯本地，§5.5）：
   │    归一化/近重复折叠 → 优先级与全局覆盖账本 → 批大小 B → 批集合 batches
   │
   │  mapLimit(batches, maxConcurrency)（§5.4/§5.8）：
   │    每批一次 ctx.llm one-shot（system=CALIBRATION_PROMPT_V{n}）
   │    finish=stop + 严格 JSON 校验；finish=length/timeout → 对半拆批重试（有界）
   │    单批失败只标记该批 failed，不拖垮其它批
   │
   │  Host reduce（纯本地，§5.6）：
   │    跨批 canonical 去重/merge → 冲突/uncertain → objective 互斥 → 全局候选上限
   │    → 覆盖账本（included/excluded/failed）→ 单条 partial/truncated/degraded 状态
   ▼
校准结果（transient，runId）+ 批级 usage/失败诊断
   │  → 客户端保持 L1 草案 + 单条 notice；成功候选进入 §6.5 选择集
   ▼
Review Center: 校准视图（diff/用原文/聚合徽章）⇄ 原始草案视图（完整 L1，始终可展开）
   │  单一选择集（ref 映射互斥，§6.5）；用户勾选/编辑
   ▼
charter/applyBootstrap(+calibrationRunId, c-*/d-* refs 不混用)
   │  Host: runId 校验 → 命名空间分派 → contentModified 基准 → trusted-attachment
   │  → 单次原子 update
   ▼
pending proposal（source=compaction-summary + evidence.excerpt=原文）→ 用户 accept 生效
```

### 3.1 与 0.3.3 语言归一的关系（v5 按实现修订）

0.3.3 已上线自动语言归一（`languageFollow`，后台两段式 `awaitTranslation`）。0.3.4 **保留**
该路径，不因校准可用而抑制翻译：

- 草案出现后，若 `language.status=pending`，客户端照常发起 0.3.3 的后台翻译二段请求；翻译
  完成后的视图仍可被校准结果替换。
- 校准始终使用 **L1 源草案 handle**（`bootstrapSourceDraftHandle`），不消费翻译结果，从而
  provenance/diff 的 ref 语义单一；`calibrationStatus` 可用不会关闭翻译入口。
- 校准失败、未触发或用户不使用时，翻译二段请求已经运行或回退到源文，不会出现“语言跟随被
  静默禁用”的回归。
- **已知成本（v8 修订）**：用户同时使用语言归一与校准时会有一次翻译调用 + **校准的 N 批并发
  调用**；这是 0.3.4 的 additive 行为，不声称“单一模型路径”。批数、并发、总输出预算与失败
  都在 diagnostics 可见；A/B 协议 1 同时记录 token/耗时，不把“调用次数少”当作质量目标。
- **配置语义**：`languageFollow=false` 只关翻译不关校准；`calibration.enabled=false` 只关校准
  不影响翻译；两者都开时两条路径都会执行，翻译作为自动回退，校准结果可覆盖视图。
- **缓存隔离**：0.3.3 `translatedItems` 与校准 run 缓存（§5.7）互不混用；校准缓存键含
  `promptVersion`、完整 limits 快照与 batch 内容 digest。

## 4. 0.3.3 已交付基座与复用映射（v4 修订：0.3.3 已于 2026-11-24 发布）

| 0.3.3 已交付（生产验证） | 位置 | 0.3.4 复用方式 |
| --- | --- | --- |
| `ctx.get('llm')` 可选注入 + 结构化 `DraftLlmRuntime` 类型（无 peer） | `host/draft-translation.ts`、`service.ts translationModel` | 校准服务同一模式；不加入 `static inject` |
| 模型解析链：专用路由覆盖（`languageFollowProvider/Model`）→ 会话 `agent.model.current()` → 拒绝 | `service.ts translationModel` | §5.3 同构实现（`calibration.provider/model` 独立键，解析函数复用） |
| hand-built one-shot：流式组装、只取 text block、`finish=stop` 强制、tool-call 拒绝、DeepSeek `reasoningEffort:'off'` | `draft-translation.ts translateBatch` | **单批**校准调用合同（§5.4）直接沿用；effort 策略见 §5.4 注 |
| 分批 + 并发上限 + 每批超时 + 对半拆分重试 + partial 合并 | `translationBatches`/`mapLimit`/`translateResilient` | **v8 校准直接复用**同一套纯函数（批参数独立配置）；v7 实现漏用了这一基座，是本次修订的直接动因 |
| 严格 JSON 响应校验（ref 完整性/唯一性、`inspectUserText`、计数） | `parseTranslation` | §5.6 校验管线在其上扩展 schema/预算/mergedFrom 校验 |
| 两段式非阻塞（`awaitTranslation` + `pending` 状态 + 客户端后台二段请求 + pristine 守卫替换） | wire、`draft-store.ts localizeBootstrapProposal` | `calibrateBootstrap` 的 `awaitCalibration` 同构（§7.1）；替换守卫扩展为选择集互斥（§6.5） |
| 缓存（sourceKey+target+provider+model，LRU 32）与 `localizedDrafts` handle 缓存 | `service.ts` | 校准缓存按 §5.7 扩展键维度；handle 机制原样复用 |
| `d-*` ref、draftHandle、apply 命名空间分派、objective `clientRef`、`contentModified` 基准 | extraction 方案附录 A（冻结） | `c-*` 命名空间接入同一分派；基准表扩展（§6.4） |

C 阶段启动前以 0.3.3 线上数据（C0 指标，§10）校准本方案默认参数。

## 5. L2 校准服务

### 5.1 可选注入与 capability 四态（评审 P0-5）

- **不修改 `static inject`**。校准服务调用时 `ctx.get('llm')` 惰性解析（Cordis 可选服务），
  解析失败 = `unavailable-host`，插件加载与其余功能零影响；
- 不新增 `@deepseek-ai/dsh-llm` peer 依赖：0.3.3/0.3.4 通过本地结构化类型与 `ctx.get` 访问宿主
  LLM 服务，避免把旧 DSH 版本拖入新的 peer 图；若未来需要直接导入运行时模块，再独立评估 peer。
- capability 四态由**独立新方法** `charter/calibrationStatus` 暴露（§7.2）——capabilities
  DTO 是 strict，不加字段（评审 P1-2）；`calibrateBootstrap` 的错误码只做调用时兜底：

| 状态 | 条件 | UI |
| --- | --- | --- |
| `available` | llm 服务在 + 模型可解析（§5.3）+ enabled + consentVersion 匹配 | 校准按钮可用 |
| `unavailable-host` | `ctx.get('llm')` 缺失或 adapter 未注册 | 入口隐藏（旧宿主零痕迹） |
| `unconfigured` | llm 在但模型解析链失败 | 置灰 + 首要原因"未配置模型" |
| `disabled` / `consent-required` | 未启用 / consentVersion 不匹配 | 置灰 + 引导设置 |

- **授权**：校准调用仅 Session owner；非 owner Remote actor 返回 `FORBIDDEN`（Remote 层
  `requireOwnerCalibration`）。即使 profile 已启用 calibration，guest/非 owner 也不能触发；
  该守卫是 v8 内核重做时必须保留的合同，不能因批处理重构而丢失。
- M0-P3 探针覆盖**服务未注册**（旧宿主）与 **adapter 未配置**两种缺失形态，13 版本逐一记录
  （0.3.3 的 `unavailable` 降级路径已上线，此处为校准入口的回归确认）；v8 还需在真实 Host
  capability 矩阵中追加**批并发/abort**行为（附录 A P9），不能只验单次调用。

### 5.2 配置面（Config 新增 `calibration` 节；profile 级，绝不进 record）

| 键 | 类型/默认 | 说明 |
| --- | --- | --- |
| `calibration.enabled` | boolean / **false** | opt-in 总开关；0.3.4 不提供 `trigger`/`cooldownMinutes`（auto 触发与冷却保留到 A/B 达标后的版本） |
| `calibration.consentVersion` | int / 0 | 用户已确认的披露版本；< 当前 `CALIBRATION_DISCLOSURE_VERSION`（v8 升为 **2**）时 Host 拒绝调用。确认动作在 profile 配置中完成（`Schema` description 与 Pane 披露对话框展示全文；Profile 设置面板呈现由 DSH 负责）；**Pane 不写配置** |
| `calibration.provider` / `calibration.model` | string / 空 | 空 = 走 §5.3 解析链 |
| `calibration.reasoningEffort` | string / 空 | 空 = adapter 默认；自由字符串；Host 在 adapter 暴露 efforts 时校验（§5.4），否则直通；`calibrationStatus.efforts` 仍为空（异步发现未接线） |
| `calibration.targetLanguage` | `auto` \| `zh` \| `en` / `auto` | auto = 跟随请求携带的客户端界面语言（白名单） |
| `calibration.maxInputBytes` | int / 24576 | planner 允许送入模型的**总** input 字节上限（本地截断/覆盖账本记录；不是单批上限） |
| `calibration.maxBatchInputBytes` | int / 8192 | 单批 user 输入上限；规划时按此收紧 batch |
| `calibration.maxOutputTokens` | int / 4096 | **单批** `maxTokens` 硬顶（v8 语义由全局改为每批；进缓存键） |
| `calibration.maxCandidates` | int / **32** | **全局**最终候选上限（v8 由 12 提高；规划阶段用于覆盖账本） |
| `calibration.batchCandidates` | int / **8** | 单批最多候选数，受 `maxOutputTokens` 与 `maxBatchInputBytes` 再收紧 |
| `calibration.maxTotalOutputTokens` | int / **16384** | 一次校准所有 batch 的**总输出预算硬顶**；超预算的候选进入 `excludedRefs`，不是静默丢弃 |
| `calibration.maxConcurrency` | int / **3** | 并发 batch 上限（至少 1；受 provider 限流与全局 abort 约束） |
| `calibration.retrySplitDepth` | int / **2** | 单批 `finish=length`/超时/可重试 provider 错误时的对半拆批次数 |
| `calibration.timeoutMs` | int / **45000** | **单批** AbortSignal 超时（v8；原 30000 为全局） |
| `calibration.runTimeoutMs` | int / **120000** | 一次校准的总墙钟上限；到点 abort 所有未完成 batch，保留已完成部分 |

配置快照语义：调用发起时读取快照，进行中不受配置变更影响。`maxCandidates`/`maxTotalOutputTokens`
是全局硬顶；`batchCandidates`/`maxOutputTokens`/`maxBatchInputBytes` 是单批硬顶。两者同时满足，
规划器不得用“把 batch 放大到全局上限”绕过单批限制。与 0.3.3 `languageFollow*` 键的配置关系
见 §3.1：**翻译与校准各自独立**；两者同开时翻译仍作为自动回退，校准不会抑制翻译调用（双调用
为已知成本，不是“统一路径”）。


### 5.3 模型解析链（评审 P0-6）

```text
1. calibration.provider + calibration.model 均非空 → 直接使用（调用前经 llm 发现接口校验存在性）
2. 否则：取该 Session 的 agent（ctx.agents，已注入）→ agent.model.current() 的 provider/model
3. 否则（无 Session agent / 未选择模型）→ CALIBRATION_UNCONFIGURED（不猜测、不回退任意 provider）
```

解析结果（provider/model/effort 实际值）回显在 `calibrationStatus`、校准响应与诊断中——用户
始终知道钱花在哪个模型上。M0-P7 探针验证 `agent.model.current()` 形状与无 Session 行为。

### 5.4 单批调用合同（v8：每批一次 one-shot）

**不做“全量草案一次调用”。** Host 先把 L1 草案规划成 batch（§5.5），每个 batch 独立执行一次
hand-built one-shot；batch 之间只通过 Host 的跨批归并汇合，不共享模型调用、不跨批引用 ref。

```text
GenerateOptions（每批独立构造） {
  provider, model        ← §5.3 解析链（所有 batch 使用同一解析结果）
  reasoningEffort        ← 配置/请求非空时，若 llm 暴露 resolveModelInfo/reasoning.efforts，则先校验；
                           不在枚举内 → CALIBRATION_EFFORT_UNSUPPORTED（detail 带可用枚举）；
                           无发现接口的旧 adapter 原样直通。CALIBRATION_CANCELLED 仍为保留码。
  system                 ← CALIBRATION_PROMPT_V{n}（版本化常量；改动必须升版本 + 重跑 golden fixture）
  messages               ← [user: 本批受限输入包（§5.5），只含 batch 内 ref]
  temperature            ← 0.1（固定，不开放配置）
  maxTokens              ← calibration.maxOutputTokens（单批硬顶，默认 4096）
  signal                 ← 单批 timeoutMs + 全局 runTimeoutMs + 调用方中继（见 §5.8）
}
```

- 每批流式响应经 `BlockAssembler` 组装；`reasoning` block **全部丢弃**，只取可见 text block；
- 每批要求 `finish=stop`：`finish=length`/超时/可重试 provider 错误先按 §5.8 **对半拆批重试**，
  不再把单批失败直接升级成整次校准失败；
- 每批输出候选数 ≤ 本批输入条数、≤ `batchCandidates`、≤ `maxCandidates` 的剩余预算；
- `mergedFrom` 只允许引用**本批输入 ref**；跨批合并由 Host 负责（§5.6），模型不得跨批合并；
- effort 缺省策略保持不变；`usage`（本批 input/output/reasoningTokens、耗时、calls）聚合进
  最终 diagnostics，不进 record、不上报；
- 旧 adapter 无并发能力时 `maxConcurrency` 自动退化为 1；并发失败不改变单批合同。

### 5.5 自适应分批规划与预算（v8 核心，评审 P1-8 重写）

#### 5.5.1 目标与原则

目标不是“让一次调用尽量大”，而是同时满足：

1. **覆盖完整**：L1 草案中每一条最终都有去向（进入候选 / 合并 / 明确 excluded + 原因）；
2. **单批可控**：每批输入/输出都有硬顶，不依赖模型“自己控制长度”；
3. **墙钟可控**：并发有上限，总预算有上限，失败只影响局部；
4. **成本可见**：token/耗时/批数/失败数进入诊断与 A/B 证据；
5. **质量优先于省调用**：允许 N 批并发，不把“一次调用”当目标。

#### 5.5.2 纯本地预处理（零模型调用）

对 `bootstrapDraft` 的 L1 items 做确定性处理：

```text
normalize(items):
  1. 过滤空文本/控制字符；保留 ref 与原文；
  2. canonical key 折叠精确重复与近重复（沿用 0.3.3 规范化键）；
  3. 按优先级排序：invariant > deliverable > objective；同 kind 内保持 0.3.3 稳定顺序；
  4. 生成 coverage ledger：
     - included: 进入规划
     - foldedInto: {sourceRef → keptRef}
     - excluded: {ref, reason: duplicate|global-cap|input-budget}
  5. objective 单独成组，至多 1 条进入模型输入（§6.6）。
```

这一步不是“硬规则替代模型”：模型仍负责语义合并/改写/拆分；本地只做**不消耗 token 的
去重、排序、预算和覆盖记录**。这样既减少无意义重复调用，又能在最终结果说明每条原始候选
为什么没出现。

#### 5.5.3 动态批大小

```text
avgOut = median(estimateOutputTokens(text) for items in selected)   # 初始 200–300 tokens/条 + JSON 开销
budgetForOutput = maxOutputTokens × 0.9 − 256                       # 预留 JSON/收尾
B_by_output = floor(budgetForOutput / avgOut)
B = clamp(1, min(batchCandidates, maxCandidates, B_by_output))
```

- 然后用 `B` 按稳定顺序切 batch，并保证每批 `sum(utf8Bytes(ref)+utf8Bytes(text)) <= maxBatchInputBytes`；
- 同一 `canonical key` 的候选不跨批（便于模型合并）；
- batch 数 = `ceil(selected.length / B)`；
- 估算只是**初始值**：真实 `finish=length` 触发拆批；C0 用真实数据校准常数，而不是靠猜。

#### 5.5.4 全局覆盖与预算

```text
if selected.length > maxCandidates:
    keep priority order; excludedRefs += rest (reason: global-cap); inputTruncated = true

if batchCount × maxOutputTokens > maxTotalOutputTokens:
    reduce selected/global candidate count deterministically (priority first); excludedRefs += rest
    inputTruncated = true

if total input bytes > maxInputBytes:
    trim at item boundary; excludedRefs += trimmed; inputTruncated = true
```

- 全局上限只会让候选进入 `excludedRefs`，**不会静默丢弃**；
- `inputTruncated` 表示“模型输入前已被全局预算限制”；`truncated` 表示“最终结果存在未纳入/
  未完成的原始候选”；二者独立；
- 覆盖账本与候选一起返回，UI 可以解释“第 5–9 轮为什么未出现在校准结果”。

#### 5.5.5 并发与墙钟估算

```text
concurrency = min(maxConcurrency, batchCount)
waves = ceil(batchCount / concurrency)
wallClock ≈ waves × perBatchLatency + reduceTime
```

以 2026-11-24 的真实 10 轮 case 为例（v7 实测）：

- draft 32 条，v7 单次 12 条成功输出 3,437 output tokens、14.5s；
- 按 v8 默认：`avgOut≈286`，`B=8`，4 批，`concurrency=3` → 2 波；
- 预计校准输出约 8–10K tokens（完整覆盖的代价），墙钟约 10–20s；
- 比“一次输出 9K tokens”更稳：单批约 2–2.5K，远低于 4096 硬顶，单批失败可拆；
- 总成本增加约 2–3×（从 12 条到 32 条），但换来覆盖完整与可恢复性；A/B 必须同时记录这个代价。

**为什么不用 128K 上下文/128K 单次输出**：校准输入是 compact summary 的 L1 草案（本次实测
calibration 输入约 1 KiB 级），不是 600–700K 的完整 session；输入窗口不是瓶颈。128K **输出**
意味着更长的串行生成、更高成本、更严重的 provider 限流和尾部截断风险，且失败时全损。v8 的
“更小单批 + 更高总覆盖 + 受限并发”才是效果/延迟/成本的平衡点。

#### 5.5.6 Prompt 与预算约束

- system prompt 每条输出候选必须 ≤ 本批 `batchCandidates`、≤ 单条 `maxItemBytes`；
- prompt 显式声明本批 ref 集合、本批输出上限与 `mergedFrom` 只可引用本批 ref；
- 超预算优先保留 invariant；模型输出超过本批 N → `CALIBRATION_SCHEMA`，该批按拆批重试；
- 目标语言、保真规则、不得新增约束等沿用 v7 §5.5 的 prompt 合同；
- 轮次前缀、过程叙述、未决事项等“非契约文本”由 v9 Host 契约性门禁在 planner 前过滤，
  并在模型输出侧再次过滤；模型负责同主题折叠；coverage ledger 保留来源 ref。

### 5.6 单批校验 + 跨批归并（v8）

#### 5.6.1 单批校验（失败只影响该批）

每批响应独立执行：

1. text blocks 拼接 → `JSON.parse`；失败 = `CALIBRATION_MALFORMED(parse)`；
2. zod 严格校验（未知字段拒绝；`mergedFrom` ref 必须 ∈ **本批输入 ref 集合**且 ≤3 个；
   objective ≤1 且仅当输入包声明"无 objective"时允许）；失败 = `CALIBRATION_SCHEMA`；
3. 逐条 `normalizeUserText`/`inspectUserText`（控制字符、lone surrogate、NFC）；失败 =
   `CALIBRATION_TEXT`；
4. 条数 ≤ 本批 N；单条 ≤ maxItemBytes——超字节单条的 degraded split 仍按原合同：对该条执行
   0.3.3 语义保全切分，派生 ref 为 `<原ref>.s0/.s1/…`，**替换**原候选（不并存），继承
   `mergedFrom` 与 `uncertain`；响应 `degraded` 数组记录 `{ref, parts, reason:'split'}`；
5. 本批内与 accepted 条目/本批近重复折叠。

**批次失败处理**：`finish=length`、超时、可重试 provider 错误 → 按 §5.8 对半拆批重试；
JSON/schema/text 不可恢复错误 → 该批标记 failed，**不采纳该批任何部分输出**；其它批继续。
只有**所有批都 failed 且无成功批**时才抛整次错误；单批失败不再导致整体回退。

#### 5.6.2 跨批归并（Host 纯本地，零额外模型调用默认）

所有成功批的候选进入 reduce：

1. 逐条保留 `mergedFrom` 原始 ref/excerpt；`c-*` 全局 ref 在 reduce 后按稳定顺序分配；
2. canonical key 精确重复 → 合并为一条，`mergedFrom` 合并（每条 ≤3 个 ref；超限则保留
   高优先级候选并记录 overflow，不伪造 ref）；
3. 近重复/语义冲突不自动裁决：保留高优先级候选，另标记 `uncertain=true` 并写入
   `conflicts: [{refs, reason}]`，由用户审阅；Host 不得用模型二次调用强行裁决；
4. objective：至多 1 条；Host 只接受来自**含 objective 输入批**的输出，记录已有 objective 时
   全部拒绝；其它 objective 候选进入 `conflicts`（reason `objective`），不进入 `candidates`；
5. 全局候选上限：objective 先占位，deliverable 预留配额，再按 invariant 填充；被裁候选进入
   `excludedRefs`（reason `global-cap`）；
6. 输出覆盖账本：
   - `includedRefs`：出现在最终候选（含 mergedFrom）的 L1 ref；
   - `excludedRefs`：被全局预算/去重裁掉的 ref + reason；
   - `failedBatchRefs`：因批失败未处理的 ref；
   - `inputTruncated` / `truncated` / `partial` / `failedBatches` 独立标志。

`truncated` 与 `inputTruncated` 是独立标志；`partial` 表示至少一批失败但有其它成功批。
UI 在草案区合并为一条状态行（尊重单条 notice 合同），并允许展开覆盖账本。

### 5.7 缓存（v9：运行级）

- **runKey** = `sha256(sessionId, summarySeq, summaryDigest, extractorVersion, promptVersion,
  provider, model, effort, targetLanguage, planDigest, acceptedCharterDigest, limitsSnapshot)`；
  命中 runKey 直接返回最终结果；`cached`/`joined` 反映命中来源；
- TTL 默认 30min；run 缓存 LRU 有界（32 条）；只缓存完整结果，`partial`/`truncated` 结果按要求
  标记，不伪装成完整缓存；
- 同 runKey 并发调用 join；不同参数独立执行；`acceptedCharterDigest`、limits、promptVersion
  任一变化即 miss；
- 只缓存本地结果，不落盘、不进 record、不进导出/archive；
- **batch 级缓存、失败批按批重试和批级缓存的复用入口尚未实现**；失败后重新发起整次校准，
  成功批不能按 batchKey 复用。它们是后续门禁，不在 0.3.4 本地候选的实现承诺内。

### 5.8 并发、单飞与取消（v8）

- 使用 0.3.3 翻译路径已验证的 `mapLimit` 模式：最多 `maxConcurrency` 个 batch 同时执行；
  每个 batch 独立 `AbortController`、独立 `timeoutMs`；
- 一次校准另设 `runTimeoutMs`：到点 abort 所有未完成 batch，保留已完成 batch，返回
  `partial=true` + `failedBatches`，不把已完成结果丢掉；
- 同 Session 同 runKey 整次运行 join（响应 `joined:true`）；v9 没有 batchKey 级 join；
  同 Session 不同参数按独立 key 并发，仍不引入 `CALIBRATION_PARAMS_CONFLICT`；
- provider 限流/`AUTH`/`NO_ADAPTER`：该 batch 重试一次（指数退避由 adapter 负责时只等待），
  仍失败则标 failed；若所有 batch 都因 provider 失败 → `CALIBRATION_PROVIDER`；
- 取消：v8 已实现**内部** abort 传播（全局 timeout + 单批 timeout + Pane detach 的
  AbortSignal 中继如果 transport 提供）；`CALIBRATION_CANCELLED` 仍为保留码，Remote 调用方
  取消中继未接线前不宣称已实现用户可见取消；
- 并发不改变结果语义：batch 顺序、reduce 顺序与稳定排序固定，结果可复现；并发只影响墙钟。

### 5.9 失败矩阵（v8：批级隔离）

| 场景 | 处理 | 客户端行为 |
| --- | --- | --- |
| llm 服务缺失 / adapter 未注册 | `CALIBRATION_UNAVAILABLE` | 入口隐藏或置灰（§5.1 四态） |
| 未启用 / consent 版本不匹配 | `CALIBRATION_DISABLED` / `CALIBRATION_CONSENT_REQUIRED` | 引导设置面板 |
| 模型解析链失败 | `CALIBRATION_UNCONFIGURED` | 置灰 + 首要原因 |
| effort 不在 adapter 枚举 | `CALIBRATION_EFFORT_UNSUPPORTED`（detail 带可用枚举） | 提示重选，不静默替换 |
| 单批 finish=length | 对半拆批重试（≤ retrySplitDepth）；仍失败则该批 failed | partial 状态行 + 原始草案可展开 |
| 单批超时 | 对半拆批重试；仍失败则该批 failed | partial 状态行 |
| 单批 JSON/schema/text 不合格 | 该批 failed，不部分采纳；不重试语义错误 | partial 状态行 + 诊断原因 |
| 单批 provider AUTH/RATE_LIMIT/NO_ADAPTER | 该批 failed（可重试一次）；其它批继续 | partial；诊断带 provider 错误 |
| 所有 batch 失败 | 整次错误：`CALIBRATION_PROVIDER` / `CALIBRATION_MALFORMED`（带子类） | 单条 notice，保留 L1 草案 |
| 单批 worker 数 > 0 的成功结果 | 返回成功候选 + `partial=true` + `failedBatches` | 可接受成功候选；当前需重新发起整次校准，按批重试为后续门禁 |
| draftHandle 失配 | `INVALID_ARGUMENT`（沿用 bootstrap 语义） | 刷新草案后重试 |
| apply 的 runId 过期 | `CALIBRATION_RUN_EXPIRED` | §6.3；重新校准后 apply |

**Remote 错误映射硬要求**：`CALIBRATION_MALFORMED`/`_SCHEMA`/`_TEXT`/`_TIMEOUT`/
`_PROVIDER` 等已知 `CharterError` 必须经 Remote 业务错误映射到达客户端；不得统一显示为
`gateway/internal`。v7 真实 Web 调用由 `finish=length` 触发 `gateway/internal`，是本次修订
必须补的测试与映射缺口。

降级永远回到 0.3.3 结构化草案；校准不可用不影响 bootstrap 审阅主流程。

### 5.10 安全与隐私（v8：多批披露）

- **披露全文**（设置面板 schema 描述 + Pane 首次入口 dialog 只读展示，中英）：
  "启用后，校准会把**压缩摘要中提取的草案候选与当前契约条目**按规模拆成多次独立模型调用；
  每次只发送该批候选和该批所需的既有条目，不发送完整会话上下文。调用计入你的模型用量
  （含思考 token）；结果仅作为待审提案，接受前不生效、不进入模型上下文；缓存仅存于内存。"
- `CALIBRATION_DISCLOSURE_VERSION` 由 1 升为 **2**（多批调用 + 数据范围澄清是实质变更）；
  已有 consentVersion=1 的用户必须重新确认；Host 强校验，Pane 不写配置；
- 每批输入仍只含本批 ref 和有界 accepted 条目；批之间不共享完整 prompt；无遥测；
- 注入防御、无自动 apply、`uncertain` 默认不选、凭据零接触、不写 session log 全部沿用；
- 多批调用意味着 provider 侧看到多个请求；transcript 隔离（M0-P5）需按“全部 batch 调用”
  复核，而不是只查一次。

### 5.11 v7 真实 Web 实测证据（2026-11-24）

用于证明 v8 的必要性，不构成 v8 已实现证据：

| 变体 | L1 invariant | L1 deliverable | 校准结果 |
| --- | ---: | ---: | --- |
| 0.3.3 baseline | 22 | 6 | 无校准能力；完整但含轮次前缀/过程叙述/重复 |
| 0.3.4 v7，默认 `maxOutputTokens=2048` | 16 | 11 | `finish=max-tokens`，Remote 显示 `gateway/internal` |
| 0.3.4 v7，`maxOutputTokens=8192` | 24 | 8 | 成功但仅 12 候选，`inputTruncated=true`，第 5–9 轮约束缺失 |

测试条件：DSH 0.2.2-rc.5 Web profile，真实 DeepSeek-V4.1-Flash High，10 轮真实用户消息 +
`/compact`，calibration route `deepseek-official/deepseek-flash`。完整证据保存在本地
`.tmp/ab-test/`（不提交）：`turns.json`、`run-033.json`、`run-034.json`、`run-034def.json`。

v8 验收用同一 case 重跑（2026-11-24，v8 实现）：

| 变体 | L1 invariant | L1 deliverable | 校准结果 |
| --- | ---: | ---: | --- |
| v8 默认 | 16 | 7 | 3 批/3 完成/0 失败，24 候选，`truncated=false`，`inputTruncated=false`，8,040 output tokens，15.2s |

v8 的 24 个候选覆盖 legacy/API、CLI、XDG/atomic、exit code、favorited、migration/backup、
security、200ms、tests；没有 max-tokens 整体失败，也没有候选截断。该结果和原始数据见
[docs/research/2026-11-24-calibration-ab](../research/2026-11-24-calibration-ab/report.md)。
仍需用同一 case 验证批级 UI、partial 展示、披露 v2 与 A/B 协议，而不是只依赖一次工程 smoke。

### 5.12 契约性门禁与候选配额（v9，2026-11-24）

真实 session `85809bdb…` 的 L1 有 23 invariant + 13 deliverable + 1 objective；v8 calibration 返回
32 候选，但 `truncated=true`、objective 和 4 个 deliverable 被 global-cap 排除，且 heading 碎片、
进度状态、历史背景、待确认事项、optional 建议仍作为契约。v9 在调用模型前增加确定性的契约性门禁，
并修正 planner 配额：

- **契约性门禁（`calibration-contractness`，Host 纯函数）**：对 L1 item 分类
  - `fragment`：以 `:`/`：` 结尾的 heading、无谓语配置片段；
  - `status`：current/implementing/done/completed/git status/HEAD/test/gate 计数等；
  - `history`：previously/decision authority/goal state/user rejected 等；
  - `optional`：suggested/optional/nice-to-have 等；
  - `pending`：need confirm/TBD/open question 等；
  - 命中的 ref 进入 `excludedRefs` 的 `non-contract`，原始 L1 仍可见，不静默丢弃。
- **动作重分类**：`T-n`/`D-n`/`F-n` 加 imperative 动词的条目从 invariant 改为 deliverable；
  deliverable 中的硬约束（forbidden/not allowed 等）可回收为 invariant。
- **planner 配额**：objective 先占位，永不被 global-cap 排除；deliverable 预留 30% 候选位（向上取整）；
  invariant 填剩余，再补 deliverable。只有契约项被 cap/预算裁掉时 `inputTruncated=true`；
  `non-contract` 过滤不算契约不完整，UI 的 incomplete 状态也不因它出现。
- **prompt v2**：system prompt 明确只输出 durable objective/invariant/deliverable；显式丢弃
  heading/status/history/optional/pending；允许少于输入；T-n 动作归 deliverable；不把状态改写为
  契约；合并相关 fragment，不无意义拆分。
- **输出门禁**：模型输出同样过契约性过滤；被过滤的源 ref 记 `non-contract`，不让模型把状态
  重新写回契约。`CALIBRATION_PROMPT_VERSION` 从 1 升到 2（缓存失效）。
- **v9 实测**：同一个 `85809bdb…` summary，v9 得到 19 候选（1 objective / 11 deliverable /
  7 invariant），3/3 批完成，3 次调用，5,216 output tokens，11.1s；`truncated=false`、
  `inputTruncated=false`；18 条 L1 噪声以 `non-contract` 排除。T-1/T-2/T-3 已是 deliverable，
  heading/进度/optional 不再作为契约。剩余 T-3 配置事实仍是原子 invariant，属于后续 reduce
  优化项，不影响本 case 的发布质量门禁。

### 5.13 v10 发布审查修复（2026-11-25）

v9 审查暴露的发布门禁问题已在 v10 修复：

- **错误映射**：Remote `calibrateBootstrap` 捕获 `CharterError` 并返回
  `CharterCalibrationFailure { ok:false, code, message }` 领域失败值；客户端 source 将失败转为
  `CharterCalibrationCallError`，`bootstrapCalibrationError` 显示业务码和消息；不再统一显示
  `gateway/internal` 或把 `{ok:false}` 吞成 `undefined`。
- **objective/conflicts**：Host 只接受含 objective 输入批的 objective 候选；已有 objective 或
  第二个 objective 进入 `conflicts`；客户端渲染 `bootstrapCalibrationConflicts` 状态行。
- **契约性豁免**：`Tests must ...` / `Coverage must ...` / `User decision authority remains ...`
  等含硬约束或 imperative 的行不再被 status/history 误杀；新增回归测试。
- **degraded 映射**：跨批全局重编号后按 `degraded.parts` 匹配派生候选；客户端徽章不再依赖
  `ref.startsWith` 的旧 `c-R.s<k>` 假设。
- **文档对齐**：user-guide 改为 consent v2 / v9 默认参数；§5.7/§5.8/§8/§9 删除未实现的
  batchKey 缓存、失败批按批重试和进度承诺，明确列为后续门禁。
- **v10 实测**：同一真实 summary，consent v1 返回领域失败 `CALIBRATION_CONSENT_REQUIRED`（非
  `gateway/internal`）；consent v2 得到 1 objective / 10 deliverable / 8 invariant，3/3 批、
  `truncated=false`、17 条 `non-contract`、5 次调用、6,499 output tokens、28.1s；T-1/T-2/T-3
  均为 deliverable。最终 artifact `e86909f…`（167 文件）；`npm run check` 566 测试。

### 5.14 v11 目标完整性与交付物覆盖（2026-11-25）

新一轮真实 summary（seq `44692`）暴露：模型可能把 objective 截短成单一“out of scope”子句；planner
配额曾把真实 gate/commit deliverable 裁进 `global-cap`。v11 修复：

- **objective 完整性**：objective candidate 必须保留源 objective 的数字/版本/专有名词锚点，且长度
  不得明显短于源文本；不满足时 Host 直接回退源 objective 文本并保留来源 provenance。
- **planner 覆盖**：先选全部契约 deliverable，再用 invariant 填充（保留少量 invariant 地板），
  修正旧的 slice 末端索引错误；`must` 型交付要求不再被误判为 invariant，`Just changed ...` 这类
  状态说明被过滤。
- **实测（最终覆盖修复后）**：同一 summary，objective 恢复完整；4/4 批，5 次调用，7,555 output tokens，38.2s；
  1 objective / 18 deliverable / 12 invariant；模型遗漏的 `d-del-12` gate/commit 由源 deliverable 恢复；
  1 条 invariant global-cap、1 条 model-omitted；`truncated=true` 如实反映这两条未纳入。

## 6. Provenance 与 apply 合同（评审 P0-A/P0-2/P0-3/P0-C）

### 6.1 为什么"op 里带 evidence"走不通（问题定位）

- wire/core 的 `newItemInputSchema` 是 strict 且无 evidence 字段——客户端不能提交，也**不应**
  能提交（provenance 只能 Host 生成）；
- `applyBootstrap` 重写 ops 后调用 `this.edit(...)`，request 本体经 `normalizeEditRequest` →
  `charterEditRequestSchema.safeParse`（strict）——任何塞进 op 的新字段在重解析时被拒绝；
- `itemFromInput`（commands.ts:39-69）只复制白名单字段，不含 evidence。

### 6.2 Host trusted-attachment 通道（P0-A 修复，可实现合同）

复用 `edit()` 既有的宿主侧参数先例（`actor`、`bootstrapSource`、`opts{allowContentModified,
dedupeSourceDigest}` 均不经 wire，service.ts:1797-1808）：

```ts
// core/commands.ts —— ApplyOpsInput 增加可选宿主附件（不进任何 wire schema）
interface ApplyOpsInput {
  …现有字段…
  readonly hostAttachments?: {
    readonly evidenceByClientRef?: Readonly<Record<string, readonly CharterEvidence[]>>
  }
}
// itemFromInput 创建条目时：若 evidenceByClientRef 含该 clientRef，附着到 item.evidence
//（record itemBase.evidence 已存在 → 零 record schema 变更）

// host/service.ts —— edit() 内部 opts 增加同名透传；公开 Remote handler 一律不传；
// applyBootstrap 校准分支独占构造：
//   evidenceByClientRef[`c-<ref>`] = [{ kind:'compaction-summary', seq, digest,
//                                       projectionVersion, excerpt }]
//   excerpt = 该候选 mergedFrom 原文片段（每条 ≤ 512 B、≤ 3 条，句边界截断加 …）
```

**防伪造边界**：attachment 通道只能由 Host 内部代码构造；`newItemInputSchema` 与
`charterBootstrapApplyRequestSchema` 保持无 evidence 字段，strict parse 保证 wire 注入被拒。
附着前逐条过 `charterEvidenceSchema` 校验 + excerpt 边界强制。测试：wire 层 evidence 注入
尝试被拒（L2-6）；attachment 仅经 applyBootstrap 校准分支可达（代码审查项 + 类型层不可达
断言测试）。`digest` 是 `sha256(ref + excerpt)` 的内容哈希，`seq` 可回溯到摘要源；它不是摘要源
自身的 digest，语义按“可回溯 evidence”接受（后续版本可更换为源 digest）。

### 6.3 runId 生命周期

- runId 与校准缓存同生命周期（§5.7 键 + TTL）；apply 成功、缓存逐出或 TTL 到期即失效；
- `CALIBRATION_RUN_EXPIRED` 显式拒绝（**不做**无 evidence 的静默降级——apply 语义必须确定）；
  UI 清除校准选择集、回到 L1 视图、单条 notice"校准结果已过期，请重新校准"；零半提交。

### 6.4 `contentModified` 判定基准（P0-2）

| 候选类型 | clientRef | 比较基准（Host 端重算） | contentModified=true 条件 |
| --- | --- | --- | --- |
| legacy 抽取候选 | `bootstrap-(inv\|del)-<i>` | legacy 重抽取文本 | 提交文本 ≠ 基准（现状不变） |
| 结构化抽取候选 | `d-*` | 结构化重抽取文本 | 提交文本 ≠ 基准（0.3.3 §4.4） |
| 校准候选 | `c-*` | 缓存中该 ref 的**校准返回文本**（degraded split 派生候选 = 其派生段文本） | 提交文本 ≠ 校准文本 |

`contentModified` 语义收窄且不变：**"用户改过 TA 在审阅界面看到的那份文本"**。校准改写本身
不置位（由 evidence.excerpt ≠ text 派生表达，§6.7）。Host 永不信任客户端声明。

### 6.5 `mergedFrom` 映射与选择集状态机（P0-3 + P1-13）

```ts
readonly mergedFrom?: readonly { readonly ref: string; readonly excerpt: string }[]  // ≤3，ref ∈ 本次输入草案
```

- **当前实现（MVP）**：校准成功后以校准候选**整体替换**审阅列表，`mergedFrom` excerpt 通过逐条
  disclosure 展示；“用原文草案”为全量恢复，尚未实现按 ref 的单一选择集与 suppressed 互斥状态机。
  单行选择集/互斥是后续版本门禁，不在 0.3.4 本地候选范围内。
- degraded split 派生候选（`c-R.s<k>`）共享原 `c-R` 的 mergedFrom 映射：勾选任一派生段 ⇒
  同一组 `d-*` suppressed；全部派生段取消 ⇒ suppressed 释放；
- **"用原文"** = 取消该校准候选（及其派生段），选中其全部 mergedFrom refs；
- **`truncated: true` / `partial: true`**：草案区状态行"部分原始候选未纳入（覆盖受限/批失败）"，
  并展示覆盖账本；未纳入候选在原始视图正常可勾选；`partial` 时成功批候选仍可审阅，失败后重新发起整次校准；
  apply 不区分来源（同一请求、同一命名空间规则、一次原子 update）；不存在自动转 pending、
  不存在重复 apply（选择集互斥保证）；
- `uncertain: true`：徽章 + 默认**不勾选**。

### 6.6 objective 校准的 apply 路径（P0-C）

- 仅当**记录当前无 objective** 时，输入包才声明允许 objective 候选（§5.5）；记录已有
  objective 时校准不产出 objective 候选（Host 组装输入前过滤 + §5.6-2 校验双保险）。改目标
  属于 redirect 语义，走常规编辑/消息提案流程，不走 bootstrap；
- apply：`objective.initialize` 携带 `clientRef: 'c-obj-<id>'`（复用 0.3.3 的 additive optional
  字段）+ 请求带 `calibrationRunId`；Host 校验：runId 有效、ref 存在于缓存候选、`op.text`
  与缓存中的校准 objective 文本**逐字相等**（与现行 bootstrap objective 严格度一致；不接受
  修改版——用户要改写就初始化后走常规编辑）；
- 选择集互斥：校准 objective 与 L1 objective（`d-obj-0`）互斥；"用原文"= 换回 `d-obj-0` 的
  initialize；
- 记录已有 objective 时 core `INVALID_TRANSITION` 兜底不变；
- **已知边界（如实记录）**：objective 不是 item，record 的 objective 结构没有 evidence 槽位；
  校准 objective 应用后不留逐条原文痕迹（与现状一致——L1 objective initialize 同样不留）。
  审阅期的 diff 由 transient 校准缓存提供；apply 前的 UI 必须展示"原文 → 校准稿"对照并获得
  显式勾选。若未来需要 objective 级 provenance，属 schema 变更，随下一次 record 版本统一处理。

### 6.7 "已校准"标记（派生，零 schema）

持久记录中：`source.kind = 'compaction-summary'` ∧ 存在 `evidence[].excerpt` ∧
`excerpt ≠ item.text` ⇒ UI 显示"已校准"徽章与原文 disclosure。`contentModified` 保持专属
用户编辑语义，两维正交展示（校准改写 + 用户再编辑可同时为真）。

## 7. Remote / wire 面

### 7.1 `charter/calibrateBootstrap`（新增；旧 client 永不感知）

```ts
'charter/calibrateBootstrap': (request: {
  readonly sessionId: SessionId
  readonly draftHandle: string        // 与 bootstrapDraft 共享（0.3.3 §4.2）；Host 重校验
  readonly locale: 'zh' | 'en'         // 界面语言白名单；targetLanguage=auto 的目标语言
  readonly effort?: string             // 覆盖配置（可选）；adapter 枚举校验
  readonly consentVersion: number      // §5.10
  readonly awaitCalibration?: boolean  // 缺省 true；false = 两段式第一段，立即返回 pending
}) => Promise<RemoteResult<CharterCalibrationResult>>

interface CharterCalibrationResult {
  readonly runId: string
  readonly pending: boolean           // true = 校准在后台进行，candidates 为空（两段式第一段）
  readonly cached: boolean
  readonly joined: boolean
  readonly promptVersion: number
  readonly resolved: { readonly provider: string; readonly model: string; readonly effort?: string }
  readonly candidates: readonly {
    readonly ref: string                        // 客户端加 `c-` 前缀入选择集；含 `.s<k>` 派生段
    readonly kind: 'objective' | 'invariant' | 'deliverable'
    readonly text: string
    readonly uncertain: boolean
    readonly mergedFrom?: readonly { readonly ref: string; readonly excerpt: string }[]
  }[]
  // v8 additive：批次/覆盖/部分失败；旧 client 忽略即可
  readonly batchCount?: number
  readonly completedBatches?: number
  readonly failedBatches?: number
  readonly partial?: boolean
  readonly excludedRefs?: readonly { readonly ref: string; readonly reason: 'duplicate' | 'global-cap' | 'input-budget' | 'batch-failed' }[]
  readonly conflicts?: readonly { readonly refs: readonly string[]; readonly reason: 'near-duplicate' | 'objective' }[]
  readonly truncated: boolean
  readonly inputTruncated: boolean
  readonly degraded?: readonly { readonly ref: string; readonly parts: readonly string[]; readonly reason: 'split' }[]
  readonly usage?: { readonly inputBytes: number; readonly outputTokens?: number
                     readonly reasoningTokens?: number; readonly durationMs: number
                     /** v8: 实际模型调用数；用于成本/并发诊断 */ readonly calls?: number }
}
```

调用授权：仅 Session owner 可触发；Remote 层 `requireOwnerCalibration` 对非 owner 返回
`FORBIDDEN`（与 profile 是否启用无关）。`awaitCalibration` 两段式与 0.3.3 `awaitTranslation`
同构：第一段 `awaitCalibration:false` 立即返回 `pending:true`，客户端先渲染 L1 草案并显示校准 busy 态；第二段 `awaitCalibration:true` 后台
等待**所有 batch** 完成或 runTimeout，到达后经 §6.5 选择集守卫（pristine/无 staged ops/同
draftHandle）才替换视图；替换失败静默保留 L1 草案。旧 host 无此方法 → 入口隐藏（§7.4）。

v8 不新增 progress Remote 方法：一次调用返回最终结果 + 批级诊断；UI 的“校准中（N 批）”
只显示计划批数，不伪造逐批完成进度。若未来需要逐批流式进度，再以 additive 方法单独立项。

### 7.2 `charter/calibrationStatus`（新增；评审 P1-2 的读取路径）

```ts
'charter/calibrationStatus': (request: {
  readonly sessionId: SessionId
}) => Promise<RemoteResult<{
  readonly status: 'available' | 'unavailable-host' | 'unconfigured' | 'disabled' | 'consent-required'
  readonly resolved?: { readonly provider: string; readonly model: string }   // available/unconfigured 时尽力给出
  readonly efforts?: readonly { readonly id: string; readonly label?: string }[]  // adapter 枚举，可空
  readonly consent: { readonly required: number; readonly acknowledged: number }
}>>
```

Pane 进入草案区时调用（与 `bootstrapDraft` 并行）；方法缺失（0.3.x host）→ 稳定传输错误 →
入口隐藏。`watchSummary`/capabilities strict DTO **零变化**。

### 7.3 `applyBootstrap` additive 扩展

- 请求增加可选 `calibrationRunId?: string`（strict schema 的 extend，旧 host 收到会拒绝——
  但新 client 只在 `calibrationStatus=available` 时才可能构造它，skew 安全）；
- clientRef 命名空间新增 `c-*`（与 0.3.3 `d-*`、legacy `bootstrap-*` 并存；**同一请求禁止
  混用 `c-*` 与其他命名空间**——校准批次与非校准批次分开 apply，校验路径单一化）；
- 不带 `calibrationRunId` 时行为与 0.3.3 完全一致；带 runId 且任一 `c-*` ref 缺失/过期 →
  整批 `CALIBRATION_RUN_EXPIRED`（原子性：不部分应用）；
- 授权：与 `bootstrap` 同级（owner / 获准 user）；agent 无入口（不进工具面）。

### 7.4 skew 矩阵

| 组合 | 行为 |
| --- | --- |
| 0.3.x client + 0.3.4 host | 只调旧方法；所有既有 DTO 零变化 |
| 0.3.4 client + 0.3.3 host | `calibrationStatus`/`calibrateBootstrap` 缺失 → 稳定错误 → 入口隐藏；`bootstrapDraft`/apply 照常 |
| 0.3.4 client + 0.3.2 host | 连 `bootstrapDraft` 也缺失 → 双层回退到 legacy 草案视图 |

## 8. UI 与诊断（遵循 gui-v1 §4.9 冻结视觉语言）

- 草案区头部：语言 chip + 不一致提示（客户端比对 draftLang）+ 「智能校准」按钮
  （`calibrationStatus` 四态决定 显示/置灰/隐藏，置灰必须显示首要原因）；consent 缺失时
  dialog 只读展示披露全文 + profile 配置说明；
- 校准中：按钮 busy + 单条 notice；v8 不在 pending 响应中返回批计划，因此不显示伪造的批数/进度；
  全局 runTimeout 到点显示 partial；
- 校准视图：每条 = 校准文本 + `已校准` 徽章 + `合并 N 条`/`不确定`/`已拆分（k 段）` outline
  chip；行内 quietlink「原文」展开 原文 ↔ 校准稿 对照（发丝分隔，无花哨高亮）与「用原文」；
  degraded split 的派生段成组展示（组头标注原候选）；
- 原始草案 disclosure 永远可展开（含被合并/未纳入/失败批候选）；`truncated`/`partial`/
  `degraded`/`failedBatches` 状态行按 §5.6/§5.9 合并展示；状态行可展开覆盖账本，显示每条
  未纳入原因是 global-cap / input-budget / batch-failed / duplicate；
- 部分成功：成功候选仍可审阅/apply；**没有按批重试入口**，失败后重新发起整次校准
  （batch 级缓存/按批重试为后续门禁，见 §5.7）；
- objective 校准候选：apply 前强制展示"原文 → 校准稿"对照 + 明示"应用后直接成为当前目标
  （无待审中间态）"（§6.6）；
- Diagnostics 校准区：capability 状态、解析出的 provider/model/effort（含 adapter 可用档位
  只读列表）、最近一次 usage（input/output/reasoning tokens、耗时、calls、cached/joined、
  batchCount/completed/failed）、覆盖账本计数、失败码计数（每 Session ≤ 32 条，内存有界，可清空）；
- 全部文案进 locales 中英同步；无原始枚举串（沿用 0.3.x 门禁）。

## 9. 兼容与降级

- **capability 矩阵**：13 个声明 DSH 版本 × {llm 服务存在性、adapter 配置、effort 枚举、
  `agent.model.current()` 行为}，结果写入 compatibility 文档；任何缺失形态都必须落到 §5.1
  四态之一，插件加载与 bootstrap 主流程零影响（0.3.3 翻译路径的降级已在生产验证，校准入口
  做**服务未注册场景**回归即可）；
- **downgrade 证据（v6 按实现修订）**：零 record schema/字段变更 ⇒ 0.3.4 记录不新增任何
  record 字段；已用**实际 0.3.2/0.3.3 构建产出的 record fixture**证明 0.3.4 strict schema 可无损
  读取旧记录。反方向（用 0.3.2/0.3.3 代码读取 0.3.4 记录）未在当前测试环境直接执行，依赖零 schema/
  字段变更论证；这是 L2-8 的记录方向偏差，发布前由真实旧版本 profile 人工复核。
- **既有行为零变化**：`charter/bootstrap`、legacy apply、`bootstrapDraft`（不带校准参数时）
  与 0.3.3 行为完全一致；legacy golden fixture 与既有 apply 测试零回归重跑；旧客户端无感
  （§7.4 skew 矩阵）；
- **无新增 peer**：`ctx.get('llm')` 可选服务访问；兼容矩阵验证 13 版本加载不受影响；
- 升级：`calibration` 配置节在旧宿主的宽容性由 M0-P6 验证（未知键不崩）；
- wire skew 四象限（§7.4）自动化。

## 10. 实施阶段（余量 10–15 工程日；C1 已随 0.3.3 发布完成）

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| M0 探针（0.5d） | 附录 A 剩余 3 项（P2 effort 枚举发现、P5 多批 transcript 隔离、P8 披露呈现）+ 2 项缩减回归（P3 服务缺失、P6 新配置键宽容）+ P9 批并发/abort 探针；D1 路线已决策，但本文因 v8 重做转回 Proposed | 探针结论落盘 |
| C0 观察（滚动） | 回收 0.3.3 线上真实数据：翻译 partial/failed 率与错误码分布、批数分布、后台等待时长、折叠率、oversized 率、草案编辑率；v7 真实 10 轮 case 证据（§5.11）作为首批 | 用实测数据确认/修正 §5.5 默认参数、batch/concurrency 常数与 effort 缺省策略（D8/D11） |
| C2 校准内核重做（4–5d） | §5 + §6 Host 侧：planner/覆盖账本、batch runner、mapLimit、拆批重试、跨批 reduce、run cache、partial 结果；trusted-attachment、objective 路径；§7 wire + capability | L2 分批故障矩阵绿；真实 host 10 轮 case 默认参数成功且覆盖账本完整（L3 首证） |
| C3 审阅体验（3–4d） | §8 + 选择集状态机 + locales + batch/partial 状态行 | DOM/浏览器证据；diff/用原文/split/partial/覆盖账本/降级全覆盖 |
| C4 A/B 与验收发布（3–4d） | §11 两协议 + 兼容/capability 矩阵 + exact artifact + 文档批次 | 附录 B 全勾；发布按 docs/releasing.md |

阶段独立验收、独立提交；A/B 与 GUI 门禁不压在同一 release 决策（§11 定位）。

## 11. 测试与验收

### L1 Core fixture（确定性）

prompt builder golden bytes（版本化、按 batch）；planner 纯函数 fixture：优先级、canonical
折叠、global-cap/input-budget 覆盖账本、batch 大小/输入字节/近重复不跨批、batch 数与
concurrency、`inputTruncated`/`truncated`/`partial` 组合；动态估算函数（CJK/Latin/混合、边界）：
`B_by_output`、`batchCount`、`waves`、`maxTotalOutputTokens` 硬顶；校验管线每批五步各分支
（含 degraded split 派生 ref 与继承、跨批 mergedFrom 只引用本批、冲突/objective 归并）；
缓存 runKey 全维度（含 maxOutputTokens/planDigest/TTL/LRU）；选择集状态机
纯函数（互斥/派生段共享/用原文/partial/truncated/uncertain 默认不选/objective 互斥）；
`contentModified` 基准表（§6.4）驱动测试。

### L2 Host integration（mock llm adapter + 扩展故障矩阵，评审 P2-4）

1. 成功路径：runId 绑定、usage 记录、**trusted-attachment 附着 evidence**（excerpt 有界、
   仅 `c-*` 分支可达）、record 其余字节不变；
2. provider 异常形态：`finish=length`、`content_filter`、空 text、reasoning-only、意外
   tool-call 块、流中断、超时、取消（单 joiner / 全 joiner）；
3. 并发：同参 join（`joined:true`）、异参 `PARAMS_CONFLICT`、校准中 apply L1 草案互不阻塞；
4. 缓存：命中/过期后 apply → `RUN_EXPIRED` 显式拒绝且零写入、acceptedCharterDigest 变更失效、
   maxOutputTokens 变更不命中旧结果；
5. 授权/输入：owner/user 允许、agent 无入口、跨 Session runId/ref 拒绝、locale 白名单、
   effort 枚举外拒绝、consentVersion 不匹配拒绝、draftHandle 失配拒绝；
6. 恶意输入：**wire 层 evidence 注入尝试被 strict schema 拒绝**、注入摘要语料（"忽略以上
   指令"类）、超 24 KiB 输入、超 N、单条超 maxItemBytes（触发 split 而非失败）、
   `mergedFrom` ref 伪造/超限（>3）、记录已有 objective 时模型仍返回 objective 候选（拒绝）；
7. apply 原子性：`c-*` 批次单次 update；`c-*` 与 `d-*` 混用拒绝；runId 过期整批拒绝；
   objective 校准 initialize 逐字校验 + 已有 objective 时 `INVALID_TRANSITION`；
8. **downgrade 专项（v6 记录偏差）**：已用实际 0.3.2/0.3.3 构建产出的 record fixture 验证
   0.3.4 strict schema 无损解析；反向（0.3.2/0.3.3 源码读取 0.3.4 记录，含 evidence.excerpt）
   由发布前真实旧版本 profile 人工复核，当前自动化未执行，因此 L2-8 只宣称“旧记录→新代码”方向；
9. wire skew 四象限（§7.4）自动化。

### L2b 分批/覆盖/失败隔离矩阵（v8 必测）

1. **planner**：1/8/9/32/100 条 draft → batch 数、单批上限、近重复不跨批、全局 cap 的
   `excludedRefs` 完整；`maxTotalOutputTokens` 触发时只裁候选，不裁成空结果；
2. **成功覆盖**：mock llm 每批返回不同候选；32 条 case 的每个 ref 至少出现在
   `includedRefs`/`excludedRefs`/`failedBatchRefs` 之一；不得静默丢 ref；
3. **单批 finish=length**：第一批触顶 → 对半拆批后成功；其他批不受影响；`calls` > batchCount；
4. **单批不可恢复错误**：JSON/schema/text 失败批被标 failed，其它批候选仍返回，
   `partial=true`，错误码不变成 `gateway/internal`；
5. **全部批失败**：返回明确的 `CALIBRATION_MALFORMED`/`CALIBRATION_PROVIDER`，不是内部错误；
6. **并发上限**：mock llm 记录瞬时并发，任何时刻 ≤ maxConcurrency；结果顺序稳定可复现；
7. **runTimeout**：部分批完成时返回 partial + 已完成候选，未完成批可重试；
8. **缓存/单飞**：同 runKey 只调用一次；失败/partial 不伪装成完整缓存；
   `cached`/`joined`/`calls` 诊断正确；batch 级缓存/按批重试不在 v9 范围；
9. **默认真实 case（L3 前置）**：同一 10 轮 case，默认 2048 不再整体失败；默认 v8 参数产出
   ≥ 关键约束覆盖阈值，记录 batchCount/并发/总 output tokens/墙钟。

### L3 真实 host + 真实模型（人工门禁）

当前 DSH + 真实凭据：每个可用 effort 档一次端到端；zh 与 en 界面语言各一次；**默认参数**与
调优参数各跑同一 10 轮真实 case（§5.11）；记录 tokens/耗时/批数/并发/覆盖账本/质量样本；
验证**全部 batch** 调用不进 session transcript、宿主用量面可见调用（M0-P5 线上复核）。
v7 单次实现已实测默认失败，v8 必须复跑并通过；不通过不得进入 A/B。

### L4 UI / 浏览器 / AT

diff 展开、用原文、聚合/uncertain/split 徽章、truncated 状态行、consent dialog、objective
对照确认、诊断区、busy/取消；gui-v1 §8 全套（明暗 × 中英 × 320–1440、键盘全路径、AX tree、
冻结稿对照）。

### 跨版本（评审 P2-5）

13 版本 `ctx.get('llm')` 可用性 + `BlockAssembler`/`GenerateOptions` 最早声明版本兼容性 +
strict peers/frozen lock 安装图校验 + L2-8/L2-9。不新增 dsh-llm peer（§5.1），依赖图校验
维持 0.3.3 的形状。

### A/B：两个独立协议（v3 拆分，评审 P1-6）

**协议 1 —— 离线质量盲评**（门槛：默认参数与宣传口径）：

- 语料：≥20 条固定摘要，来源 = 本项目历史 Session 的 compaction 摘要；脱敏流程书面化
  （去除路径/标识符/人名，脱敏 diff 存档）；留存 `.tmp/`（本地，不提交、不外传），评审结束
  保留脱敏版、销毁原始版；访问仅限项目维护者与署名评审者；其中至少 3 条必须触发多批（≥3 批），
  至少 1 条触发拆批重试，至少 1 条触发 global-cap/覆盖账本；
- 评审者：≥2 名独立盲评（不知臂别），分歧 >1 分时第三人仲裁；
- rubric（1–5）：可读性 / 语义保真 / 语言正确性；每摘要 × 2 臂（L1/L2）× ≥3 次独立校准运行；
- 统计：每维均值 + 95% CI；预注册门槛（C2 前冻结，D8）：L2 对 L1 非劣（非劣界写死）且至少
  一维显著改善；**同时记录覆盖率/批数/总 tokens/墙钟/失败批**，性能不达标不得用质量分掩盖；
  反例集（注入/超预算/混合语言/多批冲突）单独判定，出现语义扭曲或注入穿透即 fail；
- 结果用途：达标 → release notes 可陈述收益 + 开放 `auto` trigger 选项；不达标 → 功能仍发布
  但默认关闭、文档不宣称效果、`auto` 不开放。

**协议 2 —— 行为自观察**（门槛：默认值调优，不用于效果宣称）：

- 结构化自观察记录表（本地）：会话、臂别、accept-without-edit 计数、编辑距离（工具输出）、
  审阅耗时；每臂 ≥10 个真实会话；
- 无遥测：全部人工/本地脚本记录；
- 输出仅用于调整 maxCandidates/N 估算/折叠策略默认值与 UI 文案。

### A/B 协议 1 与协议 2 的共同边界（v5）

两个协议只评估**草案文本质量与审阅效率**（可读性/语义保真/语言正确性、accept-without-edit、
编辑距离、审阅耗时），**不用于也不得引用为**"提升模型长程任务完成率/执行表现"的证据——
执行类指标（ready queue drain、evidence coverage、提前收工率、返工率）属于
[0.4.0 完整契约升级](charter-execution-v1.zh.md) 的 A/B 范畴。

**v8 性能门禁（A/B 前置）**：同一 10 轮 case，默认参数下必须满足：

- 不出现 `finish=max-tokens` 导致的整次失败；
- 批数/并发/总 output tokens 在 `maxTotalOutputTokens` 内；
- 每个 L1 ref 有覆盖账本去向；关键约束不得因 batch 上限被静默丢弃；
- 墙钟与单次 v7 成功路径相比有明确上限（C0 冻结，暂定同机 ≤ 30s）；
- 单批失败可重试/部分结果可审阅；错误码不得是 `gateway/internal`。

### 发布门禁映射

沿用 0.3.x 全套（candidate 单次打包、exact-artifact、矩阵 + untracked probe、fresh profile、
Promotion、SHA256SUMS/C+1）；0.3.4 特有 P0 = capability 矩阵（含服务缺失）、downgrade
round-trip、peer 图校验、trusted-attachment 防伪造测试、**v8 分批/覆盖/失败隔离矩阵**、
真实 10 轮默认参数实测、A/B 协议 1 预注册执行记录。

## 12. 风险

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 校准改写扭曲语义 | 契约失真 | 保真规则 + diff + 用原文 + uncertain 默认不选 + 永不自动生效 + A/B 反例集 |
| 摘要含注入文本 | 校准器被操纵 | 输入视为数据、schema 校验、无自动 apply、注入语料进 L2/A-B 测试 |
| 成本/延迟超预期 | 用户负担 | 默认关、批级+全局 output 硬顶、并发上限、run 缓存、usage/批数诊断、手动触发；A/B 记录 tokens/墙钟；不采用 128K 单次大输出 |
| 并发触发 provider 限流 | 部分批失败/延迟抖动 | `maxConcurrency` 默认 3、单批拆批重试、partial 结果、runTimeout 保留已完成批；不把全部失败显示成内部错误 |
| 跨批重复/冲突 | 候选重复或语义分叉 | 本地 canonical 折叠 + `conflicts` 可见 + 不自动裁决；A/B 反例集纳入跨批冲突 |
| 批级部分失败被误认为完整 | 用户信任受损 | `partial`/`failedBatches`/覆盖账本强制展示；覆盖账本每个 ref 有去向；不得静默把 partial 当 complete |
| `ctx.llm`/adapter 跨版本漂移 | 旧宿主崩溃或误报可用 | 可选注入 + 结构化类型（无 peer）+ capability 矩阵含服务缺失 + 四态降级（0.3.3 翻译路径已生产验证同一模式） |
| token 估算失准 | 批过大/拆批频繁/墙钟抖动 | 批级 `finish=length` 自动拆批兜底 + C0 用真实多批 case 校准常数 + planner 测试；默认值由 A/B 冻结 |
| 多批披露不充分 | 用户误解发送范围/成本 | `CALIBRATION_DISCLOSURE_VERSION=2` 明确多批与每批范围；consent 重新确认；diagnostics 显示 calls |
| prompt 版本漂移 | 结果不可复现 | promptVersion 入缓存键/诊断/golden fixture，改动强制升版本 |
| consent/披露不到位 | 信任与合规 | consentVersion 随披露文本版本化，Host 强校验，Pane 不写配置 |
| trusted-attachment 通道被误用 | provenance 伪造 | 通道仅 applyBootstrap 校准分支构造；wire strict 拒绝注入；类型不可达断言测试 |

## 13. 待确认决策

| 编号 | 决策 | 建议 |
| --- | --- | --- |
| D1 | 路线修订：版本归属 | **已决策（2026-11-24，v5 修订）**：校准定位为 **0.3.4 草案质量补丁线**（additive Remote、opt-in、零 record schema、零 prompt/tool 变更）；0.4.0 重新定义为**完整契约功能升级**（readiness/停滞检测/执行记忆 + schema v3/relation proposal/历史补全/可选 assessor，另立 charter-execution-v1.zh.md）；roadmap §1/§2/§14.2.2/§14.2.3/§16 已修订 |
| D2 | `trigger` 默认值 | `manual`；`auto` 仅 A/B 协议 1 达标后开放 |
| D3 | provenance Option A（trusted-attachment，零 schema） | 采纳（§6.2 已按 edit() 既有侧通道先例落合同） |
| D4 | 模型解析链（显式配置 → agent 当前选择 → 拒绝） | 采纳；不做隐式 provider 回退 |
| D5 | 缓存持久化 | 首版内存态；跨重启持久待需求证据 |
| D6 | system prompt 语言 | 固定英文 + 目标语言指令 |
| D7 | 单条合并上限 | 3 个 ref；超出校验失败 |
| D8 | A/B 协议 1 预注册数值门槛 | C2 结束前冻结（非劣界 + 改善幅度 + 样本量），同时冻结 v8 性能门禁（§11） |
| D9 | `c-*` 与 `d-*` 混合批次 | 禁止混用（§7.3）；如实际需求出现再评估 |
| D10 | v8 校准策略 | **采用**“本地归一化 + 自适应分批 + 受限并发 + 拆批重试 + 跨批本地归并”；不做全量单次调用，不拉 128K 输出窗口 |
| D11 | 默认批参数 | `batchCandidates=8`、`maxOutputTokens=4096/批`、`maxCandidates=32`、`maxConcurrency=3`、`maxTotalOutputTokens=16384`、`retrySplitDepth=2`；由 C0/A-B 真实数据冻结 |
| D12 | 批级失败策略 | **partial 优先**：失败批隔离；当前失败后整次重试，按批重试是后续门禁；仅全部批失败才抛整次错误；不使用 `gateway/internal` 表示业务失败 |
| D13 | 多批披露版本 | `CALIBRATION_DISCLOSURE_VERSION=2`，明确多批调用与每批数据范围；已有 consent 重新确认 |
| D14 | 批级流式进度 | v8 不新增 progress Remote；先返回计划批数，最终一次性结果；逐批流式留待有证据的后续版本 |

## 附录 A：M0 运行时探针清单

| # | 探针 | 判定 | v4 状态 |
| --- | --- | --- | --- |
| P1 | `ctx.get('llm')` 可选解析 + hand-built one-shot（system/user、maxTokens、signal、BlockAssembler、reasoning 分离）；**v8 按批复用** | 能收流、能取消、能并发多批；**不加入 static inject** 时插件正常加载 | **已由 0.3.3 生产验证**（翻译路径上线 + 39 条真实摘要人工验收）；v8 并发批待实测 |
| P2 | 当前 adapter 的 `reasoningEffort` 枚举 | 非空则记录档位；为空则验证配置隐藏路径 | 部分验证（DeepSeek `'off'` 已上线）；**枚举发现待执行** |
| P3 | 13 版本 capability 矩阵：llm **服务未注册** / adapter 未配置 / 正常 三形态；v8 追加批并发/abort | 冻结 capability gate 最低版本与四态映射；批并发不越权、abort 能清理 | 缩减为回归确认（0.3.3 降级已上线）；C2 执行，必须覆盖 P9 |
| P4 | 宿主界面语言获取路径（client PropsLocale 值域；Host 侧是否可得） | locale 参数白名单与来源 | **已由 0.3.3 生产验证**（`ctx.locale.getLocale().active` 上线） |
| P5 | hand-built 调用（**全部 batch**）不进 session transcript / 会话事件流；宿主用量面可见 | 隐私与计费披露准确；多批调用逐条可见 | **待执行**（v7 单次已验证路径，v8 多批需复核） |
| P6 | 旧宿主对新增 `calibration` 配置节的宽容性（未知键不崩） | 升级/降级安全 | 缩减为回归确认（`languageFollow*` 键已验证同模式）；C2 执行 |
| P7 | `ctx.agents` → agent `model.current()` 形状；无 Session/未选择模型行为 | 冻结 §5.3 解析链 | **已由 0.3.3 生产验证**（translationModel + 专用路由覆盖上线） |
| P8 | 宿主设置面板对 schema description 长文本（披露全文）的呈现能力 | 决定 consent 披露落点与措辞长度 | **待执行** |
| P9 | v8 多批并发 + 全局 abort + 单批 timeout + provider 限流 | 并发不超过配置、失败只影响批、runTimeout 保留已完成批 | **待执行**（C2） |

## 附录 B：发布前验收清单

- [ ] D1 路线修订完成（0.3.4 校准补丁线 + 0.4.0 完整契约升级重定义）；v8 因校准内核重做保持
      `Proposed`，实现完成后再转 `Implemented — pending release acceptance`。
- [ ] M0 剩余探针（P2 枚举发现、P5 **多批** transcript 隔离、P8 披露呈现、P9 批并发/abort）
      与缩减回归（P3/P6）结论落盘；C0 已用 0.3.3 线上数据 + v7 真实 10 轮 case 校准默认参数。
- [ ] L1/L2 矩阵全绿（含扩展故障、注入语料、evidence 伪造拒绝、旧记录 fixture 解析、downgrade 反向人工复核、skew 四象限）。
- [ ] **v8 分批矩阵**全绿：planner/覆盖账本、单批拆批重试、partial、全部失败、并发上限、
      runTimeout、run 缓存与 calls 诊断；错误码不出现 `gateway/internal`。
- [ ] 同一真实 10 轮 Web case 在**默认参数**下成功（无 max-tokens 整次失败），关键约束覆盖账本完整，
      记录 batchCount/并发/tokens/墙钟；v7 失败案例作为回归 fixture。
- [ ] 13 版本在无 `dsh-llm` peer 声明下正常加载并使用可选 `ctx.get('llm')`。
- [ ] capability 矩阵写入 compatibility 文档；服务缺失形态实测。
- [ ] L3 真实模型人工门禁（zh/en × effort 档位）完成并记录 tokens/耗时/transcript 洁净。
- [ ] L4 浏览器/AT/冻结稿对照按 gui-v1 §8 执行。
- [ ] A/B 协议 1 按预注册执行并如实记录（含不达标时的默认关闭处置）；协议 2 记录归档。
- [ ] 隐私披露文案（中英）评审；`consentVersion` 强校验路径测试；默认关闭验证。
- [ ] `npm run check`、exact artifact、fresh profile、Promotion 全套按 docs/releasing.md。

## 附录 C：变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-23 | 创建提案 v1（Proposed）。 |
| 2026-11-23 | 评审修订 v2：拆分 0.3.3；P0-1→§6（Host 附着 evidence）、P0-2→§6.4、P0-3→§6.5、P0-4→依赖 0.3.3、P0-5→§5.1、P0-6→§5.3；P1 缓存键/动态预算/披露/consent/effort/join/truncated；P2 估算 15–20 日、A/B 重写、扩展测试清单、peer 声明。 |
| 2026-11-23 | **评审修订 v3**：P0-A → §6.1/§6.2（撤回"withEvidence 直接可用"假设；改为 edit() 既有宿主侧参数先例上的 `hostAttachments.evidenceByClientRef` trusted-attachment 通道，core `ApplyOpsInput`/`itemFromInput` 显式扩展，wire 双 schema 保持 strict 无 evidence，附防伪造测试）；P0-C → §6.6（objective 校准 apply = `objective.initialize + clientRef:'c-obj-*' + runId`，逐字相等，仅当记录无 objective；objective 无 evidence 槽位如实记为已知边界）；P1-2 → §7.2 新增 `charter/calibrationStatus` 方法（capabilities strict DTO 零变化）；P1-4 → §5.6-4 degraded split 派生 ref/替换语义/选择集继承 + §7.1 degraded 结构；P1-5 → §5.7 缓存键补 `maxOutputTokens`；P1-6 → §11 A/B 拆分为离线盲评与行为自观察两个独立协议（评审者/语料留存/统计/用途分离）；新增 §4 对 0.3.3 附录 A 冻结合同的依赖声明、§10 C0 观察阶段、D9 混用禁令。 |
| 2026-11-24 | **v4（D1 落盘 + 0.3.3 发布对齐）**：状态 Proposed → `Active`（路线图 §1/§2/§14.2.2/§16 已修订：0.4.0 = 校准主线，relation proposal 移 0.4.x，schema v3 移出范围）；基准更新为 `main` @ `44a542d3`、0.3.3 已发布（`707043d3…`）。新增 §3.1 校准与 0.3.3 语言归一统一路径（v4 当时假设每草案至多一次模型调用；v8 已改为分批并发，语义与缓存隔离由 §3.1/§5.7 修订）；§4 改为已交付基座复用映射表（ctx.get/解析链/one-shot/分批/校验/两段式/缓存/handle 八项）；§7.1 增加 `awaitCalibration` 两段式与 `pending` 字段（沿用 0.3.3 已验证模式）+ 客户端守卫说明；§5.4 补 effort 缺省策略（DeepSeek `'off'` 生产先例，档位由 C0/D8 冻结）；M0 探针按生产验证裁剪（P1/P4/P7 已验证，P3/P6 缩减回归，余 P2/P5/P8）；C0 指标具体化（partial/failed 率、批数、等待时长、折叠/oversized/编辑率）；版本计数 11 → 13；§12 风险行同步无 peer 决策；附录 B D1 勾选。 |
| 2026-11-24 | **v5（版本定位调整，用户决策）**：本方案从 0.4.0 降级为 **0.3.4 草案校准补丁线**——校准本质是 0.3.x 草案质量增强（additive Remote、opt-in、零 record schema、零 prompt/tool 变更），不应占据 minor 版本；`0.4.0` 重新定义为**完整契约功能升级**（readiness/ready queue、停滞检测、执行记忆 + record schema v3、relation proposal、历史补全草案、可选 LLM assessor），设计权威另立 [charter-execution-v1.zh.md](charter-execution-v1.zh.md)。本文新增定位边界（§0：只提升草案质量与审阅效率，不声称提升模型长程任务完成率、不承诺完整性/通用性）、§2.2 排除 0.4.0 全部能力、§9 既有行为零变化保证、downgrade round-trip 扩展为 0.3.2+0.3.3 双版本、§11 A/B 共同边界（文本质量指标不得挪用为执行表现证据）；D1/附录 B 同步。 |
| 2026-11-24 | **v6（实现审查收敛）**：0.3.3 翻译保留为独立回退（校准使用 L1 源 handle，双调用为已知成本）；校准隐藏非 zh/en；runId 绑定 draftHandle；mergedFrom 接入逐条 diff；effort 在 adapter 暴露 efforts 时校验；consent 披露改由 Schema description + Pane dialog + profile 配置承载；L2-8 记录为“旧 0.3.2/0.3.3 record fixture → 0.3.4 strict schema”方向，反向留人工；按 ref suppressed 选择集仍为 MVP 整体替换。 |
| 2026-11-24 | **v7（死配置/证据收口）**：从 0.3.4 Config 删除未实现的 `calibration.trigger`/`calibration.cooldownMinutes`，状态对象与诊断 UI 同步移除；修正 docs/README 索引的“单一模型路径”旧表述；§5.7 缓存改为实际 32+32 全局上限；§5.8 明确取消中继未实现；附录 C 补齐 v6/v7；`CALIBRATION_PARAMS_CONFLICT` 已从错误码移除。 |
| 2026-11-24 | **v8（自适应分批并发校准，用户决策/真实实测驱动）**：真实 Web 10 轮 case 证明 v7 默认 2048 max-tokens 整次失败（Remote `gateway/internal`），调高到 8192 也仅 12/32 候选并 `inputTruncated`；因此改为本地覆盖账本 + 自适应 batch + `mapLimit` 并发 + 单批对半拆批重试 + 跨批本地归并 + partial/失败批隔离；新增 batch/run 缓存、`maxTotalOutputTokens`/`maxConcurrency`/`runTimeoutMs` 等配置；明确不使用 128K 单次输出；披露版本升 2；状态转回 `Proposed`；§5.4–§5.11、§7.1、§8、§10–§13、附录 A/B/C 同步。 |
| 2026-11-25 | **v10（发布审查修复）**：Remote 业务错误信封与客户端分类、objective/conflicts 收敛与渲染、contractness 硬约束豁免、degraded 跨批 parts 映射、user-guide 配置表与 §5.7/§5.8/§8/§9 文档承诺对齐；`npm run check` 与矩阵/候选复验后重跑。 |

## 附录 D：v8 planner / runner / reduce 伪代码

```ts
// 纯本地，无模型调用
function planCalibration(draft, cfg, acceptedDigest): Plan {
  const normalized = foldAndSort(draft)                 // canonical key / priority / coverage ledger
  const selected = normalized.items.slice(0, cfg.maxCandidates)
  const excluded = normalized.items.slice(cfg.maxCandidates).map(x => ({ ref: x.ref, reason: 'global-cap' }))
  const avgOut = median(selected.map(x => estimateOutputTokens(x.text)))  // CJK 保守
  const outputBudget = cfg.maxOutputTokens * 0.9 - 256
  const byOutput = Math.floor(outputBudget / Math.max(1, avgOut))
  let batchSize = Math.max(1, Math.min(cfg.batchCandidates, byOutput))
  const batches = splitBalanced(selected, batchSize, cfg.maxBatchInputBytes) // 近重复不跨批
  const plannedOutput = batches.length * cfg.maxOutputTokens
  if (plannedOutput > cfg.maxTotalOutputTokens) {
    // 按优先级削减 selected，不改变已选批的单批上限；被削项进 excluded（reason: global-cap）
    return capToTotalOutput(selected, batches, cfg, excluded)
  }
  return { batches, excluded, inputTruncated: excluded.length > 0, avgOut }
}

async function runPlan(plan, cfg, llm, signal): Promise<RunResult> {
  const outcomes = await mapLimit(plan.batches, cfg.maxConcurrency,
    batch => calibrateBatchResilient(llm, batch, cfg, signal, cfg.retrySplitDepth))
  const merged = localReduce(outcomes)                   // cross-batch canonical merge; conflicts visible
  return {
    candidates: merged.candidates,
    partial: merged.failedBatches > 0 && merged.completedBatches > 0,
    batchCount: plan.batches.length,
    completedBatches: merged.completedBatches,
    failedBatches: merged.failedBatches,
    excludedRefs: [...plan.excluded, ...merged.failedRefs.map(ref => ({ref, reason:'batch-failed'}))],
    truncated: plan.excluded.length > 0 || merged.failedRefs.length > 0,
    inputTruncated: plan.inputTruncated,
    usage: aggregateUsage(outcomes),
  }
}

async function calibrateBatchResilient(llm, batch, cfg, signal, splitsLeft): Promise<BatchOutcome> {
  try { return { candidates: await calibrateBatch(llm, batch, cfg, signal), failedRefs: [] } }
  catch (error) {
    if (splitsLeft <= 0 || batch.length <= 1) return { candidates: [], failedRefs: batch.map(x => x.ref), error }
    const half = Math.ceil(batch.length / 2)
    const [a, b] = await Promise.all([
      calibrateBatchResilient(llm, batch.slice(0, half), cfg, signal, splitsLeft - 1),
      calibrateBatchResilient(llm, batch.slice(half), cfg, signal, splitsLeft - 1),
    ])
    return mergeBatchOutcomes(a, b)
  }
}
```

**不变量**：

- `sum(batch.length) + excluded.length === normalized.items.length`（覆盖账本闭合）；
- 任何时刻同时运行 batch 数 ≤ `maxConcurrency`；
- `calls <= batchCount + retrySplits`（可观测上限）；
- `partial` 为真时 `completedBatches > 0` 且 `failedBatches > 0`；
- `truncated` / `inputTruncated` / `degraded` / `partial` 互不替代；
- 失败批不得产生部分候选；成功批候选必须逐条能回溯到本批 ref；
- 默认路径不产生 `gateway/internal`；业务失败映射为明确 `CALIBRATION_*`。
