# `dsh-charter` 0.3.3 契约草案抽取与语言归一方案

> **状态：** `Implemented — pending release acceptance` —— 0.3.3 源码实现完成，尚未发布。
> **版本范围：** `0.3.3`（本地候选），先于 0.4.0。确定性抽取 + **自动宿主模型语言归一**：
> 无 record schema 变更、无 prompt 投影变更、无模型工具面变更；wire 面新增
> `charter/bootstrapDraft` + 一个 additive objective op 字段。
> **修订：** v3（2026-11-23）——并入评审 P0-A/0-B/P1-1/P1-3，并将“按界面语言生成 zh/en 草案”
> 纳入 0.3.3（用户决策 2026-11-23）：`ctx.get('llm')` 可选调用；模型缺失/失败时回退源语言并显式提示。
> **基准：** 2026-11-23，`main` @ `53410cb`；`0.3.2` 已发布（SHA-256 `9dcb82ae…`）。
> **权威边界：** 版本范围由[版本路线](version-roadmap.zh.md)决定；proposal/来源语义由
> [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md) 决定；审阅 UI 视觉由
> [charter-gui-v1.zh.md](charter-gui-v1.zh.md) §4.9 冻结稿决定。
> **替代/被替代：** 无 / 无。[charter-draft-calibration-v1.zh.md](charter-draft-calibration-v1.zh.md)
> （0.4.0 校准层）**硬依赖**本文的结构化候选、ref 命名空间与 apply 合同。
> **专题范围：** 压缩摘要 → 契约草案的确定性抽取质量、结构化 wire 合同与 apply 模型。

## 0. 摘要与版本拆分

用户反馈（2026-11-23）：草案难用——语言不跟随、切分碎片化、冗余不聚合。拆分为两个版本：

| 版本 | 内容 | 模型调用 | wire |
| --- | --- | --- | --- |
| **0.3.3（本文，先发布）** | 语义保全切分、近重复折叠、语言标注、kind 打分、结构化候选（稳定 ref）、自动 zh/en 语言归一、完整 apply 合同 | 有（宿主 `ctx.llm` 单轮翻译，自动） | 新增 `charter/bootstrapDraft`；`objective.initialize` 增加可选 `clientRef`（additive） |
| **0.4.0（校准方案，后发布）** | 语义级聚合、专用校准 prompt、diff 审阅、质量 A/B | 有（`ctx.llm` one-shot，opt-in 高级校准） | 新增 `charter/calibrateBootstrap`、`charter/calibrationStatus`；`applyBootstrap` additive 扩展 |

**语言目标**：客户端以当前 DSH locale 的 `zh`/`en` 作为目标语言；结构化抽取后若草案语言不一致，
Host 通过会话当前模型做一次严格 JSON 批量翻译；模型不可用或失败时保留原文并显示降级提示。
0.3.3 仍不做语义级合并；那属于 0.4.0。

## 1. 现状证据（0.3.2 发布树）

| 环节 | 当前行为 | 证据 |
| --- | --- | --- |
| 超长切分 | 句 → 子句 → `hardSplit` 按码点硬切，无标记 | [bootstrap.ts:123-139](../../src/core/bootstrap.ts)、:147-183 |
| 去重 | `unique()` 小写全等，无近重复折叠 | bootstrap.ts:185-197 |
| 语言 | 无 locale 输入、无检测、无标注 | bootstrap.ts:205-208 签名 |
| kind 分类 | 关键词正则二分（CONSTRAINT），无置信度 | bootstrap.ts:43 |
| bootstrap wire | `charterBootstrapProposalSchema` **strict**，候选是裸 `string[]` | [wire.ts:489-499](../../src/remote/wire.ts) |
| apply 请求 | `charterBootstrapApplyRequestSchema = charterEditRequestSchema.extend({draftHandle}).strict()` | [schemas.ts:254-256](../../src/core/schemas.ts) |
| apply 校验（条目） | clientRef `bootstrap-(inv\|del)-<index>` 定位候选；`contentModified = text !== candidates[index]`（`withModified`） | [service.ts:1740-1790](../../src/host/service.ts) |
| apply 校验（objective） | `objective.initialize` 仅当 `op.text === extraction.proposal.objective` **逐字相等**；`objective.propose`/`redirect` 一律拒绝 | service.ts:1745-1756 |
| edit 内部通道 | `this.edit(request, actor, bootstrapSource?, opts?)` —— actor/source/opts 是**不经 wire 的宿主侧参数**；request 本体经 `normalizeEditRequest` strict 重解析 | service.ts:1797-1808、[normalize.ts:144-156](../../src/core/normalize.ts) |
| 条目创建 | `itemFromInput` 复制 contentModified/requires/proposedRequires 等，**不复制 evidence** | [commands.ts:39-69](../../src/core/commands.ts) |

后果：超预算长句被硬切成语义碎片且用户无从知晓；近重复条目全量堆给用户；草案语言与界面
语言不一致时无提示；候选没有稳定身份；objective 与结构化候选没有 apply 通道。

## 2. 目标与非目标

### 2.1 目标

- G1 **语义完整**：切分只在句/子句边界发生；无法保全语义时保留完整原文并显式标记
  `oversized`，由用户编辑或拆分——碎片从"静默产生"变为"显式例外"。
- G2 **冗余可见**：近重复折叠为组，代表条目 + 折叠计数，组成员可展开、可单独勾选。
- G3 **语言感知**：每条候选与整体草案标注 `zh/en/mixed`；与界面语言不一致时客户端提示
  （翻译留给 0.4.0）。
- G4 **稳定身份**：每条候选获得确定性 `ref`；apply 合同覆盖 invariant/deliverable/objective
  全部三类（§4.4）。
- G5 **kind 提示**：归类从二分正则升级为打分 + 置信度，低置信显式标注。
- G6 **旧客户端字节等价**：`charter/bootstrap` 的输出对同一摘要与 0.3.2 **逐字节一致**
  （legacy 抽取器冻结 + golden fixture，§4.2）。

### 2.2 非目标

- 不做 0.4.0 的语义级聚合/高级校准；语言翻译是 0.3.3 的受控单轮调用；
- 不改 record schema、prompt 投影、`charter_read`/`charter_propose`；
- 不改 `charter/bootstrap` 响应形状与其抽取行为（冻结）；
- 不改变"plan 永不丢弃候选、超预算转 pending"的既有溢出可见语义。

## 3. 结构化抽取器（extractStructured，仅服务新方法）

以下改进**只进入结构化抽取器**；legacy 抽取器原样冻结（§4.2）。

### 3.1 语义保全切分

1. 句边界（`[.!?。！？]`）与子句边界（`[;；,，、:：]`）切分保留；
2. **无 `hardSplit` 静默碎片**：单句/单子句超过 `maxItemBytes` 时整段保留为一条候选并标记
   `oversized: true`；
3. 仅当单条超过 `maxItemBytes × 4` 时才截断，必须在句边界并追加显式标记
   `…[已截断，完整原文见来源]`（标记文本走 locales），同时记录 `truncatedFrom`（原始 UTF-8
   字节数）；
4. `oversized`/截断候选**不可原样 apply**：Host 强制（§4.4），UI 提前禁用并给出首要原因，
   引导「编辑拆分」（编辑器预填句边界建议拆分点，D-A3）。

### 3.2 近重复折叠

- 规范化键：NFC → 小写 → 去首尾/折叠连续空白 → 去尾部标点；键全等折叠；
- 前缀包含（规范化后 A 是 B 前缀且 len(A) ≥ 12 字符）折叠进更长者；
- 产出折叠组：代表条目 + 成员列表（成员各自有 ref，可单独勾选）；折叠不是丢弃，组内成员
  一步可达；
- 语义级近重复（同义改写）明确不做，留给 0.4.0。

### 3.3 语言检测与标注

- Unicode script 码点占比：Latin ≥ 70% → `en`；CJK ≥ 70% → `zh`；其余 → `mixed`
  （阈值集中定义、进 fixture，D-A4 用真实摘要语料校准一次）；
- 每条候选 + 草案整体（`draftLang`，按字节加权多数）各有一个 `lang`；
- **Host 不读取 ambient client locale**：DTO 不含 mismatch 判断字段（v1 的 `localeMismatch` 已删除）；
  客户端拿 `draftLang`/`lang` 与自身界面语言比对并提示。需要语言归一时，客户端在
  `bootstrapDraft` 请求中显式传 `targetLanguage: zh|en`；Host 只接受白名单，不猜语言。

### 3.4 kind 分类打分

- 加权打分：约束词密度（must/禁止/不得/…）、祈使句式、交付物名词模式（完成/实现/交付/…）、
  来源章节先验（critical → invariant，pending → deliverable）；
- 输出 `suggestedKind` + `kindConfidence: 'high' | 'low'`；low 置信 UI 标注"建议归类，请确认"；
- 打分是纯函数，中英正反例表驱动 fixture。

### 3.5 objective 候选改进

显式标签（latest/original/原始/最新修正/目标）缺失时，用"首段落优先 + 请求句式打分"
（希望/要求/需要/目标是/wants/needs）替代裸首 bullet；打分并列取更靠前者，保证确定性。
结构化抽取器产出的 objective 是**候选**（ref `d-obj-0`），apply 规则见 §4.4。

## 4. Wire 与 apply 合同

### 4.1 为什么是新方法而不是扩展现有响应

`charterBootstrapProposalSchema`、`charterViewCapabilitiesSchema` 均为 `.strict()`：向现有
响应 DTO 加字段会让旧客户端 bundle 的 strict 解析拒绝新 Host 响应（Host/client bundle 允许
短暂错位是既有事实）。项目先例全部是"新能力 = 新方法 + 探测回退"（`watchSummary`/
`queryItems`/`previewChangeSet`）。因此：

- `charter/bootstrap` 请求/响应/抽取行为**零变化**（§4.2 冻结）；
- 新增 `charter/bootstrapDraft`；旧客户端永不感知；
- 新客户端对旧 Host：方法缺失的稳定传输错误 → 回退 `charter/bootstrap`，UI 退化为现行
  纯文本列表；回退路径进测试矩阵。

### 4.2 双抽取器模型（修复评审 P1-1）

v1 声称"两方法文本集合等价"不成立（折叠/oversized/objective 打分必然改变文本集合）。
v2 采用**双抽取器、单摘要源、共享 handle、ref 命名空间路由**：

| | legacy 抽取器 | 结构化抽取器（v2） |
| --- | --- | --- |
| 实现 | 现 `bootstrapFromSummary` **原样冻结**，重命名为 `extractLegacy`，配 golden fixture（真实摘要语料 → 输出 JSON 快照，逐字节锁定） | §3 全部改进，`extractorVersion: 2` |
| 服务方法 | `charter/bootstrap`（响应 DTO 不变） | `charter/bootstrapDraft` |
| 服务 ref 命名空间 | `bootstrap-(inv\|del)-<i>`（现状不变） | `d-*`（§4.3） |
| 演进 | 0.3.x 内冻结不改；弃用时机另议（D-A5） | 0.4.0 校准层的输入 |

- 两个抽取器读取**同一最新 compaction summary 事件**（同 `summarySeq`/内容）；
- **legacy `draftHandle` 保持 0.3.2 的 draft-bound 算法不变**，保证旧 client 响应字节等价；
- **结构化 `draftHandle` = f(source, structured items, draftLang)**，由 `bootstrapDraft` 返回；apply 时
  按 clientRef 命名空间选择校验器：legacy ref 用 legacy handle，`d-*` ref 用结构化 handle 缓存；
  同一 apply 请求禁止混用两个命名空间（`INVALID_ARGUMENT`）；
- 一致性要求：legacy 输出 = golden 快照（字节等价 0.3.2）；结构化输出 = 自身 golden；两命名空间
  apply 校验互不串扰（专项测试）。

### 4.3 `charter/bootstrapDraft` DTO

```ts
'charter/bootstrapDraft': (request: {
  readonly sessionId: SessionId
}) => Promise<RemoteResult<CharterBootstrapDraftResult>>

interface CharterBootstrapDraftItem {
  readonly ref: string                 // 确定性：objective=`d-obj-0`；条目=`d-<inv|del>-<g>[.<m>]`
                                       //   <g>=折叠组序，<m>=组内成员序（代表条目无 .m 后缀）
  readonly kind: 'objective' | 'invariant' | 'deliverable'
  readonly text: string
  readonly lang: 'zh' | 'en' | 'mixed'
  readonly oversized: boolean
  readonly truncatedFrom?: number      // §3.1-3 截断时的原始 UTF-8 字节数
  readonly kindConfidence?: 'high' | 'low'   // kind ≠ objective 时给出
  readonly foldCount?: number          // >1 表示折叠组代表
  readonly foldMembers?: readonly { readonly ref: string; readonly text: string }[]  // 有界
}

interface CharterBootstrapDraftResult {
  readonly available: boolean
  readonly reason?: 'not-live' | 'no-summary' | 'unavailable'
  readonly draftHandle?: string        // 结构化 handle：source + items + draftLang（§4.2）；legacy handle 不变
  readonly source?: { readonly summarySeq: number; readonly at: number; readonly shadowedTokens?: number }
  readonly items?: readonly CharterBootstrapDraftItem[]   // objective 至多 1 条，排最前
  readonly draftLang?: 'zh' | 'en' | 'mixed'
  readonly language?: {
    readonly requested: 'zh' | 'en' | null
    readonly status: 'source' | 'translated' | 'unavailable' | 'failed'
    readonly reason?: string
    readonly provider?: string
    readonly model?: string
  }
  readonly extractorVersion: 2
}
```

- `ref` 是**同一次摘要 + 同一 extractorVersion 内**的稳定身份（由摘要内容与抽取器版本决定），
  跨 compaction、跨 extractorVersion 不保证；apply 校验始终以 Host 当前重抽取为准；
- DTO 不含 locale mismatch 字段（§3.3）；不含 capability 字段（校准能力状态在 0.4.0 用独立
  方法 `charter/calibrationStatus` 暴露，避免向本 strict DTO 追加字段造成 0.3.3 client ×
  0.4.0 host 的解析破坏）。

### 4.4 apply 模型（修复评审 P0-B；0.4.0 的 objective 校准复用本节合同）

`charter/applyBootstrap` 请求/响应形状在 0.3.3 **不变**（`draftHandle` + ops）。校验规则按
clientRef 命名空间分派：

**通用**

1. draftHandle 必须匹配对应抽取器的缓存/重抽取结果；legacy 沿用 0.3.2 校验，结构化用 bootstrapDraft 返回的 handle；
2. 一个请求内所有 bootstrap clientRef 必须同命名空间；混用 → `INVALID_ARGUMENT`；
3. Host 以对应抽取器**当前重抽取**结果为准校验（不信任客户端提交的任何元数据）；
4. `contentModified` 判定不变：提交文本 ≠ 对应候选文本 → true（Host 端计算）。

**legacy 命名空间（`bootstrap-(inv|del)-<i>`）**：与 0.3.2 逐规则等价（golden 测试锁定）。

**结构化命名空间（`d-*`）**：

| op | 规则 |
| --- | --- |
| `item.add` / `item.propose`，ref=`d-inv-*` / `d-del-*` | ref 必须解析到当前重抽取的对应候选（含折叠组成员 ref）；kind 必须匹配；文本与候选不等 → `contentModified=true`（既有语义）；**ref 指向 `oversized` 或截断候选且文本未经编辑 → `INVALID_ARGUMENT`（message 注明 oversized-unedited）**，编辑后按不等文本规则通过 |
| `objective.initialize`，携带可选 `clientRef: 'd-obj-0'` | `clientRef` 为 **op schema 的 additive optional 字段**（仅结构化命名空间使用；旧 host 收到含该字段的请求会 strict 拒绝，但新 client 只在 `bootstrapDraft` 成功后才可能构造它——skew 安全）。校验：结构化抽取存在 objective 候选，且 `op.text` 与其**逐字相等**（维持现行严格度：bootstrap 阶段不接受修改版 objective；用户改写走初始化后的常规编辑/redirect 流程）。记录已有 objective → 既有 core `INVALID_TRANSITION` 拒绝（不变） |
| `objective.propose` / `objective.redirect` | 维持拒绝（与现状一致；objective 提案属消息提案流程） |

**objective 的 `clientRef` 缺省行为**：不带 `clientRef` 的 `objective.initialize` 继续按现行
legacy 规则校验（= legacy 抽取 objective 逐字相等），保证旧客户端路径不变。

### 4.5 与 0.4.0 的衔接

0.4.0 在此合同上追加：`c-*` ref 命名空间（校准候选）、`calibrationRunId` 请求字段、
objective 校准候选经同一 `objective.initialize + clientRef` 路径（基准文本换为缓存中的校准
objective，逐字相等规则不变）。详见校准方案 §6/§7；本文的命名空间分派与 handle 语义是其
地基，0.4.0 不得另行发明。

### 4.6 自动语言归一（0.3.3）

- 客户端 `CharterSessionSource.bootstrap()` 读取 `ctx.locale.getLocale().active`；无论 locale 是否 zh/en，
  只要方法存在就调用 `charter/bootstrapDraft`（折叠/oversized/ref 不因语言退化）；仅 zh/en 时传
  `targetLanguage`，其他 locale 传 undefined 并保留源语言草案。
- Host 在确定性结构化抽取后计算 `draftLang`；若与目标一致则不调用模型。不一致时：
  - `ctx.get('llm')` 可选解析；模型选择取当前 Session 的 `agent.model.current()`；
  - 通过 `ctx.llm` 做一次 hand-built one-shot（本地流式文本组装）；只取 text block，丢弃 reasoning；
  - 只发送当前活动代表候选 + objective（不发送折组成员），要求严格 JSON `{items:[{ref,text}]}`；
    ref 集合必须完整、不可增删、不可重复；preserve numbers/paths/identifiers；
  - 输出逐条过 `inspectUserText`/长度检查；单条超限重新标 `oversized`；`finish` 非 stop 整批失败；
  - 成功：`language.status='translated'`，`draftLang=target`，并把翻译结果按 draftHandle 缓存；
  - 失败/无模型：保留结构化原文，`language.status='unavailable'|'failed'`，UI 显示降级提示；不阻断审阅。
- 翻译缓存是本 Host 进程内的有界 transient 数据（key 含摘要 digest、extractorVersion、target、provider/model），
  `applyBootstrap` 用同一个 `draftHandle` 取回译文作为 `contentModified` 基准；缓存失效时拒绝过期 apply，
  客户端重新取草案。
- 自动调用会向用户配置的模型发送压缩摘要/契约草案文本；profile 配置 `languageFollow: false` 可关闭自动
  翻译（结构化抽取仍生效）；README/user-guide/release notes 必须披露；record/Remote/模型工具面不变。

## 5. UI（遵循 gui-v1 §4.9 冻结视觉语言）

- Review Center 草案区：语言 chip（`zh/en/mixed`，outline chip 规格）；`draftLang` ≠ 界面语言
  时单行提示（客户端比对）；
- 候选行沿用行解剖（§4.9 规则 6）：`oversized` 行显示 warn chip「超预算」+ 完整文本 +
  「编辑拆分」quietlink，勾选框禁用并显示首要原因；截断行显示「已截断（原始 N B）」元信息；
- 折叠组：代表行 + `+N 条重复` outline chip；0.3.3 展示计数并保留成员 ref/text，成员展开交互留给
  0.4.0 校准/审阅增强（不丢失原文，见原始草案 disclosure）；
- kind 低置信：`建议归类` outline chip；
- objective 候选区：单条展示 + 勾选；说明文案明确"应用后将直接成为当前目标（无待审中间态）"
  （与现状 bootstrap objective 行为一致）；
- 原始草案全文（未折叠、未标记的抽取原文）保留在既有 disclosure，任何新展示不替代它。

## 6. 兼容与降级

| 组合 | 行为 | 验证 |
| --- | --- | --- |
| 0.3.2 client + 0.3.3 host | 只调用 `charter/bootstrap`；legacy 抽取器冻结 → 响应**逐字节等价** 0.3.2 | legacy golden fixture（P0 测试） |
| 0.3.3 client + 0.3.2 host | `bootstrapDraft` 方法缺失 → 稳定传输错误 → 回退旧方法；UI 无结构化元数据 | 模拟旧 Host 回退测试 |
| 0.3.3 client + 0.3.3 host | 结构化路径 + `d-*` apply | 全矩阵 |
| record 数据 | 与 0.3.2 完全同构（零 schema 变更）；双向升降级无围栏 | round-trip 测试 |

路线边界：0.3.x 线此前承诺"零 Remote 变化"；D-A1 需将 0.3.3 边界修订为"允许 additive
Remote 方法与 additive optional op 字段；禁止 record schema、prompt、模型工具面变更"。

## 7. 测试与验收

### L1 Core fixture

- 结构化抽取：句/子句切分、oversized 标记、4× 截断边界与标记文本、折叠键/前缀包含/成员完整、
  语言阈值边界语料、kind 打分中英正反例、objective 打分并列规则、确定性（同输入同输出同 ref）；
- **legacy golden**：真实摘要语料（≥10 条脱敏样本）在 `extractLegacy` 上的输出 JSON 与 0.3.2
  实现快照逐字节一致；
- `extractorVersion` 变更时 ref 不稳定的显式测试；
- **自动语言归一**：目标同语不调用、跨语调用成功、模型缺失回退、finish=max-tokens/malformed/缺 ref 整批失败、译文超限重标 oversized、缓存命中/失效、`applyBootstrap` 以译文为基准。

### L2 Host / wire

- `bootstrapDraft` 与 `bootstrap`：同一摘要同一 draftHandle；两命名空间 apply 校验互不串扰；
- ref 解析：`d-inv-<g>.<m>` 成员、伪造 ref、跨 Session ref、过期 handle、**混用命名空间拒绝**；
- oversized 未编辑 apply 拒绝；编辑后 `contentModified=true` 通过；
- `objective.initialize`：带 `clientRef` 逐字校验、不带 `clientRef` 走 legacy 规则、记录已有
  objective 时 `INVALID_TRANSITION`、`objective.propose/redirect` 拒绝不变；
- method 缺失回退路径（模拟旧 Host）；旧 clientRef 语法回归不变。

### L3 浏览器 / UI

语言 chip、折叠展开、oversized 禁用与原因、截断元信息、低置信标注、objective 候选说明：
明暗 × 中英 × 320–1440；冻结稿风格对照（gui-v1 §8.3 方法沿用）。

### 发布门禁

沿用 0.3.x 全套（candidate 单次打包、exact-artifact smoke/recovery、11 版本矩阵 + untracked
probe、fresh profile、Promotion、SHA256SUMS/C+1）。0.3.3 特有 P0：**legacy golden 字节等价**
与**新旧 client/host 四象限 skew**。

## 8. 实施阶段

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| E1 core（1.5–2d） | §3 结构化抽取器 + legacy 冻结/golden + L1 | 抽取确定性测试绿；legacy golden 字节等价；现有 bootstrap 测试无回归 |
| E2 wire/host（1.5–2d） | §4 方法 + ref 命名空间 + apply 合同（含 objective clientRef）+ L2 | 四象限 skew 矩阵绿；混用命名空间拒绝 |
| E3 UI/发布（1.5–2d） | §5 + L3 + 文档批次 + 发布门禁 | 冻结稿对照通过；`npm run check` 全绿 |

估计 4.5–6 工程日（不含人工验收；较 v1 上调，因 apply 合同与 golden 体系）。单分支、每阶段
独立提交、门禁全绿才推进。

## 9. 待确认决策

| 编号 | 决策 | 建议 |
| --- | --- | --- |
| D-A1 | 路线修订：0.3.3 边界允许 additive Remote 方法 + additive optional op 字段 | **已采纳并实现**：新增 bootstrapDraft + objective clientRef；0.3.3 本地候选。 |
| D-A2 | 折叠组默认展开还是折叠 | 0.3.3 默认折叠、只显示计数与成员 ref；成员展开交互后续实现。 |
| D-A3 | oversized 编辑拆分是否提供句边界建议拆分点 | 0.3.3 只显示 oversized/编辑提示；自动建议拆分点后续实现。 |
| D-A4 | 语言阈值 | 实现为 Latin ≥70% / CJK ≥70% / 其余 mixed；进 fixture，真实语料校准留待发布验收。 |
| D-A5 | legacy `charter/bootstrap` 弃用时机 | 0.3.x 全程保留；0.5.0 线评估移除（需先确认无旧 client 存量） |

## 附录 A：与 0.4.0 的接口承诺（冻结项）

0.4.0 依赖且本文冻结后不再变更的合同点：

1. `d-*` ref 语法与确定性规则（§4.3）；
2. legacy/structured 各自 draftHandle 与命名空间分派（§4.2）；
3. apply 命名空间分派 + 禁止混用 + Host 重抽取校验 + `contentModified` 基准规则（§4.4）；
4. `objective.initialize` 可选 `clientRef` 字段与逐字相等规则（§4.4）；
5. `extractorVersion` 字段（缓存键与 0.4.0 校准输入的一部分）。

## 附录 B：变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-23 | 创建提案 v1（Proposed）：从校准方案拆出确定性层。 |
| 2026-11-23 | **评审修订 v2**：P0-B → §4.4 完整 apply 模型；P1-1 → §4.2 双抽取器模型；P1-3 → 删除 `localeMismatch`；新增 §4.5。 |
| 2026-11-23 | **实现修订 v3（用户决策）**：0.3.3 加入自动 zh/en 语言归一（§4.6，`ctx.get('llm')` 单轮翻译，模型缺失降级）；状态转 Implemented；新增语言/翻译测试门禁。 |
