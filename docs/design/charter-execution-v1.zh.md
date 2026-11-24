# `dsh-charter` 0.4.0 完整契约功能升级方案（执行契约 · 执行记忆 · 历史补全）

> **状态：** `Proposed` —— 范围已决策（用户决策 2026-11-24，路线图 §14.2.3/§16 已修订），
> **详细设计尚未产出**。本文是 0.4.0 的范围权威与设计约束；每个能力域进入实现前必须先产出
> 详细设计（E0）并通过评审，不得按本文直接开工。
> **版本范围：** `0.4.0`（完整契约功能升级）。与 0.3.4 草案校准补丁线
> （[charter-draft-calibration-v1.zh.md](charter-draft-calibration-v1.zh.md)）明确分层：
> 0.3.4 只提升草案质量与审阅效率；0.4.0 让契约**支撑执行**。
> **基准：** 2026-11-24，`main` @ `44a542d3`；`0.3.3` 已发布（SHA-256 `707043d3…`）。
> **权威边界：** 版本范围由[版本路线](version-roadmap.zh.md)决定；proposal/依赖/validity 语义由
> [charter-workspace-v2.zh.md](charter-workspace-v2.zh.md) 决定；prompt 投影规则由其 §8 决定；
> GUI 由 [charter-gui-v1.zh.md](charter-gui-v1.zh.md) §4.9 冻结稿决定。本方案将解除 0.2.0 的
> "不新增 decision/environment item kind" 非目标——该解除已通过路线图 §14.2.3 记录，属于
> 有意识的版本级决策，不是漂移。
> **替代/被替代：** 无 / 无。
> **专题范围：** readiness 执行契约、停滞检测、执行记忆（record schema v3）、relation proposal、
> 历史补全草案、可选 LLM assessor。跨会话模板复用明确推迟（§2.3）。

## 0. 定位

0.3.x 解决了"契约被正确记录、草案可读"；0.4.0 回答下一个问题：**契约是否正在被执行**。
核心转变是从"状态清单"到"执行面"：

1. 模型和用户随时能看到**现在该做什么**（ready queue），而不只是依赖拓扑；
2. 契约**停滞时会被发现**（确定性诊断），而不是靠人盯；
3. 执行过程中的**决策与环境事实可沉淀**（decision/environment + evidence），不再随压缩流失；
4. 模型可以**提案**进度与依赖变化（永远由用户接受）；
5. 压缩摘要遗漏的约束可以从**会话历史有界补全**，带来源与 `inferred` 标记。

这是模型可见能力 + record schema 的双重升级，因此是 minor 版本；0.3.4 的草案校准作为其
输入质量层继续存在，两者不混版。

## 1. 能力域与范围

### 1.1 执行契约 / readiness（模型可见）

- prompt 投影在现有 dependency-aware deliverable 结构上增加**派生执行状态**：
  `ready / waiting / blocked / done / conflict`（派生规则沿用 workspace-v2 §6.5 的
  prerequisite status × progress 分层，不新增持久字段）；`verified` 作为 validity 维度的
  投影标注（是否进入 prompt 由 E0 决策，见 §4-Q2）。
- **ready queue**：prompt 与 UI 提供"当前可推进项"的显式有序列表（确定性排序：拓扑层 ×
  canonical order），替代模型自行从拓扑推断。
- **用户可写收工标准（declarative，非强制）**：用户可在契约中声明完成标准（如"所有 ready
  项 done 或 blocked 才可收工"），它作为**约束文本进入 prompt** + 插件提供确定性
  "收工清单"诊断（哪些 ready 项未完成）。**插件不拦截、不强制宿主/模型行为**——执行策略
  强制仍属宿主边界（延续路线图非目标）。
- prompt 变更遵守 workspace-v2 §8 全部规则：canonical JSON、确定性、字节预算、fork 等价、
  超限拒绝增长；readiness 投影是**模型可见变更**，必须过 §3 的执行类 A/B 门槛才可默认开启。

### 1.2 停滞检测（确定性优先）

确定性信号（仅用 record 内已有数据，v1 范围）：

- 连续 N 个 revision 无 progress/evidence/validity/条目变化（N 可配，默认 E0 冻结）；
- ready queue 长期非空且无条目进入 done/blocked；
- evidence 绑定的输入 digest 全部 stale 且长期未重验；
- 用户声明的收工标准长期未满足但会话持续产生 revision。

产出为 **Diagnostics 诊断 + 单条 notice + （可选）pending proposal 提示**，不自动改任何状态。
基于工作区文件变更类别（"只改 test/docs 没改 source"）的信号**不在 v1**：它需要工作区 diff
能力，先以注册 validator 探针评估可行性（§4-Q4），成熟前不进检测器。LLM judge 不在 v1
（见 §1.6 assessor，明确后置）。

### 1.3 执行记忆（record schema v3）

- 新 item kind：`decision`（已定决策 + 理由 + 时间/revision 锚点）与 `environment`
  （环境事实：版本、路径、账号约束等，绑定 evidence 与 validity/stale 规则）；
- **evidence 绑定**扩展到全部新 kind（复用 v2 `charterEvidenceSchema`：source ref +
  projectionVersion + digest + 有界 excerpt）；
- **progress proposal**：模型可对既有 deliverable 提案 progress 变化（`charter_propose`
  扩展或新 op，E0 决策），落为 pending proposal，用户接受才写入；模型仍无直接写权限；
- **record schema v3**：新增 kind/字段对 v2 strict parser 不可读 ⇒ 正式
  `recordSchemaVersion: 3` + 迁移与围栏：
  - v2 → v3 惰性迁移：首次 0.4.0 业务 mutation 单 CAS 完成（沿用 v1→v2 模式）；
  - 0.3.x 打开 v3 记录触发既有 future-schema 只读围栏（可诊断导出，禁止覆盖写）；
  - 迁移 fixture 语料、prompt 渲染扩展、fork remap、archive/restore、exact-replay 全矩阵
    按 workspace-v2 §10.5/§10.6 同等规格执行；
  - **prompt 预算影响**：decision/environment 是否进入 standing prompt、以何优先级挤占
    预算，是 E0 的核心决策（§4-Q1），不允许"全部塞入"。

### 1.4 relation proposal（从 0.4.x 收回 0.4.0）

- 模型/用户对**既有 accepted deliverable** 提案 `requires` 变化：pending relation proposal
  （v3 持久形状 E0 决策：优先评估挂在 item 的 `proposedRequires` 既有字段 +
  proposal 元数据，避免新集合）；
- 用户接受时与依赖图校验（环/悬空/端点状态）在**同一 Change Set** 原子生效，沿用
  workspace-v2 §6.4 全部规则；
- `charter_propose` 工具面扩展为可携带 relation proposal（模型可见变更，进 §3 A/B 与
  capability 门禁）。

### 1.5 历史补全草案（与 0.3.4 校准严格分离）

- 0.3.4 校准只能基于 compaction summary，**不能新增摘要外约束**；0.4.0 提供独立的
  "历史补全"能力：有界读取当前会话历史（复用 `queryMessages`/message evidence 基建），
  产出带 **source span（seq/角色/引用片段）+ `inferred` 标记**的候选约束/交付物；
- 候选进入 Review Center 独立分组（"来自历史推断"），默认不勾选；接受后 provenance 记
  `message` 来源 + `inferred` 标记（v3 schema 承载）；
- 预算与隐私：单次扫描的 seq 数/字节上限、只读当前 Session、扫描不进入 prompt、
  结果不自动生效——全部沿用 0.3.4 校准的调用合同模式（§5.4-§5.6 同款校验管线）。

### 1.6 可选 LLM assessor（后置，非优先项）

- 只读评估"语义上是否完成/停滞"，输出 proposal/diagnostic，**永不写入契约**；
- 仅在 §1.2 确定性检测上线并证明不足后立项（与 `charter.diagnostics` 同样的条件式立项）；
- 复用 0.3.4 的 opt-in/consent/预算/降级全套合同。

## 2. 非目标与推迟项

### 2.1 非目标（继承 + 新增）

- 不做通用记忆/知识库/跨项目画像；不做任意关系图（关系类型仍封闭枚举）；
- 插件不强制执行策略、不拦截宿主/模型行为（收工标准是声明性的）；
- 模型永不直接写契约（progress/relation proposal 均需用户接受）；
- 不做遥测/上传；停滞与执行诊断全部本地派生。

### 2.2 与 0.3.4 的分界（防混版）

| 主题 | 0.3.4 | 0.4.0 |
| --- | --- | --- |
| 草案语言/聚合/可读性 | ✓（校准） | 不重复建设，直接复用 |
| readiness/ready queue | ✗ | ✓ |
| 停滞检测 | ✗ | ✓（确定性 v1） |
| decision/environment/evidence | ✗ | ✓（schema v3） |
| relation proposal | ✗ | ✓ |
| 历史补全草案 | ✗（明确非目标） | ✓ |
| assessor | ✗ | 条件立项，后置 |

### 2.3 明确推迟

- **跨会话复用**：若做，形态是"模板导出/导入 + 来源绑定"（导出为显式用户动作、导入产生
  带 provenance 的 pending 候选），**不是记忆存储**；排 0.4.x 或更后，不进 0.4.0。
- 工作区变更类别信号（§1.2）待 validator 探针结论。

## 3. 验收与 A/B（执行类指标）

0.4.0 的 A/B 与 0.3.4 的文本质量 A/B **严格分离**，新增执行类指标（全部本地采集、
预注册门槛、盲评/对照会话设计在 E0 冻结）：

- **ready queue drain**：ready 项从出现到完成/阻塞的中位轮次与修订数；
- **evidence coverage**：accepted 条目中带有效（非 stale）evidence 的比例；
- **提前收工率**：会话结束时仍存在未处理 ready 项的比例（对照声明的收工标准）；
- **返工率**：supersede/redirect/重新打开的条目比例；
- 停滞检测的查准/查全（对人工标注的停滞会话样本）。

模型可见变更（readiness 投影、relation proposal 工具）默认**灰度/可关**，A/B 不达标时
不宣称执行表现改善并保持关闭——沿用 0.3.4 的"不达标 ⇒ 默认关 + 不宣称"纪律。

发布门禁：**E1–E4 全部完成并通过各自退出条件（完整 0.4.0，不拆版）**、v2→v3 迁移语料 +
downgrade 围栏 round-trip（0.3.x 读 v3 只读隔离、字节不变）、
13+ 版本兼容矩阵、exact artifact 全套、prompt 确定性/fork 等价/字节预算 fixture、
执行类 A/B 预注册执行记录。

## 4. 开放问题（E0 详细设计必须逐项冻结）

| # | 问题 | 约束/倾向 |
| --- | --- | --- |
| Q1 | decision/environment 是否进入 standing prompt、预算优先级 | 默认倾向：decision 进（有界条数），environment 仅 stale 警告进；预算超限拒绝增长 |
| Q2 | `verified`/validity 是否投影进 prompt | 倾向不投影（v2 既定：validity metadata 不进 standing prompt），除非 A/B 证明收益 |
| Q3 | progress proposal 的 op 形状与工具面 | 复用 `charter_propose` 扩展 vs 新 op；防伪造（Host-only provenance）不变 |
| Q4 | 工作区变更类别信号的 validator 探针 | 先探针后决策；v1 停滞检测不依赖它 |
| Q5 | 停滞阈值 N 与冷却 | 可配置；默认值由真实会话语料校准 |
| Q6 | v3 迁移窗口与 0.3.x 围栏文案 | 沿用 v1→v2 惰性迁移 + future-schema fence 模式 |
| Q7 | 历史补全的扫描预算与触发方式 | 手动触发优先；seq/字节上限进配置 |
| Q8 | readiness 投影的 prompt 格式变更版本化 | renderer version 升级 + 无依赖时字节回退等价策略是否保留 |

## 5. 实施阶段（提案，E0 后细化）

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| E0 详细设计（先行） | schema v3 ADR、prompt 投影规格、迁移/围栏 fixture 计划、Q1–Q8 决策、A/B 协议预注册 | 设计评审通过；路线图/权威文档同步修订 |
| E1 readiness + 停滞检测 v1 | 派生状态、ready queue、收工标准声明与清单诊断、停滞检测（record 内信号） | 派生规则表驱动测试；prompt 预算/确定性门禁；UI 落地 |
| E2 执行记忆 | schema v3、迁移/围栏、decision/environment CRUD 与 evidence 绑定、progress proposal | v2↔v3 round-trip 全矩阵；downgrade 围栏验证 |
| E3 relation proposal | pending relation 形状、工具面扩展、图校验原子生效 | 依赖图/Change Set 既有全量测试零回归 + 新增矩阵 |
| E4 历史补全 | 有界扫描、source span、inferred 候选流 | 隐私/预算门禁；Review Center 独立分组验收 |
| E5（条件） | assessor 立项评估 | 仅当 §1.2 证明不足 |

单分支或按阶段分分支由 E0 决定；每阶段独立验收、`npm run check` 全绿才推进。

**完整 0.4.0（用户决策 2026-11-24）：E1–E4 全部是 0.4.0 发布门禁，不设 E1-only 或任何拆版
回退**——任一阶段未达标即推迟整个 0.4.0，不允许以部分能力先行发布。E5（assessor）为条件
立项，不属于发布门禁。

## 附录：变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-24 | 创建（Proposed）：0.4.0 由"草案校准主线"重新定位为"完整契约功能升级"（用户决策）；校准降级为 0.3.4 补丁线；本文收录 readiness/停滞检测/执行记忆(schema v3)/relation proposal/历史补全/条件式 assessor 六域，推迟跨会话模板；E0 详细设计与 Q1–Q8 为开工前置。 |
| 2026-11-24 | **完整 0.4.0（用户决策）**：删除 E1-only 拆版回退——E1–E4 全部为 0.4.0 发布门禁，任一阶段未达标即推迟整个版本；E5 维持条件立项。§3 发布门禁与 §5 阶段说明同步。 |
