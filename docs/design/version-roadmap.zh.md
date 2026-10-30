# `dsh-charter` 版本路线：0.1 稳定化与 0.2 产品升级

[English](version-roadmap.md) | 中文

基准日期：2026-10-30。

## 1. 决策

版本路线确定为：

```text
0.1.0-rc.4（兼容性补丁，已发布）
  → 0.1.0-rc.5（已定版，npm 发布延迟）
  → 0.1.0-rc.6（当前源码，未发布）
  → 0.1.0 stable
  → 0.1.1（仅在 stable 后确有兼容补丁时）
  → 0.2.0-alpha.1 ... 0.2.0-rc.1 → 0.2.0
```

已定版候选是 **`0.1.0-rc.5`**；其 npm 发布和 GitHub prerelease 延迟。当前源码版本是 **`0.1.0-rc.6`**，
未发布、未打 tag。`0.1.1-rc.1` 仍是 stable 之后的补丁语义，不是 rc.6 的另一种写法。

rc.5 修复了与产品承诺冲突的审阅正确性问题：此前历史草案全部候选默认选中，界面一次只展示前 40 条，Apply 可能提交尚未展示的候选；README 同时声明“人工审阅是强制的”。rc.5 的审阅流程现在初始不选中，也不会提交隐藏行。

`0.1.1-rc.1` 只有在 `0.1.0` stable 已发布、并且出现一组需要候选验证的向后兼容补丁时才成立。它不是 `0.1.0-rc.5` 的另一种写法。

`0.2.0` 不作为零散功能的收纳版本。它是一轮完整的契约工作流升级，同时包含现有能力改进、新功能、信息架构与交互重构、数据模型演进以及查询/客户端架构调整。

## 2. 当前发布状态

### 2.1 已发布版本

- 最新已发布版本是 `0.1.0-rc.4`；其 tag、GitHub Release 资产和 npm 包均已公开且不可修改。npm `latest` 和
  `next` 当前指向 rc.4。
- rc.4 是 compatibility-only patch，增加 DSH `0.2.1-rc.3`/`rc.4` 精确兼容声明，不改变插件运行时行为。

### 2.2 rc.5 候选

- rc.5 已实现并冻结。源码已打 `v0.1.0-rc.5` tag；candidate workflow 全绿，精确产物 digest 记录在根
  `SHA256SUMS`；tag 指向 checksum-only C+1 commit。
- rc.5 **尚未发布**：npm 发布、GitHub prerelease、受保护 browser evidence 和 Promotion 仍待完成。不要把
  rc.5 描述为可从 npm 安装。
- rc.6 已在源码启用，但**未发布、未打 tag**。当前只承载文档、UI 帮助/预览和流量观测工作；任何 tag 或发布前都必须重新
  构建 candidate。
- `main` 已包含剩余 promotion 路径使用的 token 发布 workflow。已发布的 rc.4 历史永不改写。

## 3. 为什么是 rc.5

SemVer 顺序是：

```text
0.1.0-rc.4 < 0.1.0-rc.5 < 0.1.0 < 0.1.1-rc.1 < 0.1.1
```

`0.1.0-rc.5` 表示同一个 `0.1.0` 目标的第五个候选；`0.1.1-rc.1` 表示稳定版 `0.1.0` 之后的补丁候选。即便 major 仍为 0，也不应混用这两种含义。

当前确认的问题位于 `0.1.0` 已承诺的功能内：

- 草案候选初始全部 `selected: true`；
- UI 使用 `slice(0, visibleCandidates)`，初始只显示 40 条；
- bootstrap planner 遍历所有 selected candidate；
- Apply 没有“仍有已选但未展示候选”的门禁；
- README 声明人工审阅是强制的。

这是候选版本的产品正确性缺陷，不是 stable 后的补丁，也不是 0.2.0 新功能。

## 4. `0.1.0-rc.5` 范围

rc.5 定位为 **审阅正确性、交互安全与稳定版证据收敛**。不新增领域能力，不扩展持久化模型或 Remote 方法。**状态：已完成并冻结；实施计划为历史文档。** 见 [rc5-stabilization-plan.zh.md](rc5-stabilization-plan.zh.md) 与[验证记录](../verification.zh.md)。

### 4.1 P0：历史草案必须显式审阅

行为改为：

- 所有候选初始不选中，未展示候选绝不会被 Apply。
- “全选”只作用于当前已展示候选，文案改为“选择当前显示的 N 条”。
- “显示更多”每次增加 40 条；顶部始终显示总数、已显示数、已选数。
- 硬约束和交付物分别显示分组标题与数量。
- Apply 只提交明确选中的候选；成功后结束本次 review，未选候选不写入 Charter、不转成 pending，并随本次 review cleanup 丢弃。跨提交保留未选候选属于 0.2 Proposal Inbox。
- 如果未来恢复“选择全部”，必须先展开全部并进行二次确认，不能作用于隐藏候选。
- checkbox 与 textarea 使用独立 label/id，不再把 textarea 嵌套在 checkbox 的 `<label>` 中。

验收：

- 41、80、100 条候选的测试中，初始 Apply 不包含任何未选择项。
- 只选择第一页时，提交计划只含第一页已选择项。
- “选择当前显示”不会改变未展示项。
- 展开后选择的条目可提交，顺序和类型保持稳定。
- bootstrap budget、pending overflow、unknown-outcome replay 行为不回归。

### 4.2 P0：未来 schema 只读围栏

为了让稳定 0.1 能安全打开未来 0.2 record，rc.5 必须收紧 schema-invalid 的恢复判断：

- raw record 含整数 `recordSchemaVersion` 且大于当前支持版本时，归类为“由更新版本写入”，即使 loose identity 匹配也强制 `recoverable: false`。
- 未来版本记录允许诊断导出，但禁止普通 edit、显式初始化和 restore 覆盖。
- UI 明确提示“该记录由更新版本写入，请升级插件”，不把它描述成一般损坏。
- 只有无法识别为未来版本、且 identity 可证明匹配的 schema-invalid 记录，才沿用 rc.3 的受控恢复路径。
- 同 lifecycle 的未来 v2 记录不能被旧 v1 archive 覆盖；降级期间原始字节保持不变，重新升级后可读取。

这项围栏不增加 record 字段或 Remote 方法，只改变现有 schema-invalid 状态的安全判定。0.2 的同 domain schema v2 只能以包含该围栏的 `0.1.0` stable 作为降级基线；不承诺降级到 rc.3 后仍可安全执行恢复操作。

### 4.3 P0：丢弃与暂存不能误删输入

当前 `discard()` 会同时清空 staged ops、打开的 editor、editor text、两个未暂存 composer。rc.5 拆开操作：

- “取消当前编辑”只关闭当前 editor。
- “清空输入”分别作用于硬约束或交付物 composer。
- “丢弃暂存修改”只清除 ops 和 base revision。
- 如果用户选择“全部丢弃”，确认框列出将失去的 staged ops、editor 和未暂存文本数量。
- objective change 提供单独的“取消暂存”，不再要求丢弃整个批次。
- 成功丢弃后显示现有但未接入的 discarded feedback。

验收：

- 丢弃 staged ops 不清空 composer 或 editor。
- 关闭 editor 不影响其他 staged ops。
- objective op 可单独撤销。
- unknown-outcome attempt 仍只能 Retry 或显式 Abandon，普通丢弃不能清除重放依据。

### 4.4 P0：修正 committed 与 projected 状态表达

- 页头 revision 只表示已提交 revision，不再承担健康状态颜色。
- “已存储”使用 committed `view.items.length`；应用后的数量单独显示为 preview。
- 只要有 staged ops，显示“有未应用修改”。
- objective 暂存后显示明确 staged 标记。
- Apply 按钮旁始终显示首要禁用原因：editor 未关闭、revision conflict、预算、连接、结果未知或只读状态。
- 空 Charter 在 `no-summary`、`not-live` 或 bootstrap failure 后仍显示“设置目标 / 添加硬约束”的主要入口。

### 4.5 P1：恢复预览和错误展示修正

- `previewArchive()` 使用 `TextEncoder` 的 UTF-8 字节数，不使用 JavaScript 字符数。
- File、client preview 和 Host request admission 统一使用 UTF-8 byte 单位，但检查的载荷不同，结果允许不同；Host request admission 是最终权威。
- 错误内容允许换行，并提供可展开详情；不再只依赖 `title`。
- 区分连接超时、连接中断、Host 未挂载、runtime 不支持和存储不可用。
- `aria-invalid`、`aria-describedby`、预算 meter 和两个 composer 的独立 accessible name 补齐。
- 触屏和窄屏下按钮、导航与 select 的目标尺寸提高到 40–44px；主操作使用显式 class 排版，不依赖 `:last-child`。

### 4.6 P1：真实安全与浏览器验收

- 在真实 DSH `0.2.1` Gateway 上验证 owner、user 和 malformed missing-principal Peer；正常现代 Peer 的 principal 是协议必填。
- export、initialize、restore 三个维护方法逐一验证 owner-only。
- 跨 Session resource 在业务方法和 storage probe 前被拒绝。
- 真实浏览器完成导出、文件选择、WebCrypto 校验、恢复、刷新、Host 重启和健康目标拒绝覆盖。
- 完成稳定版要求的 Desktop 重启后 tab/tool ABI 复核。

### 4.7 P1：更新 DSH 精确兼容矩阵

rc.4 已把 `0.2.1-rc.3` 和 `rc.4` 加入 `engines.dsh` 与 peer ranges。rc.5 补齐遗漏的 `dsh.compatibility.dshReleases`，提交可重复的版本矩阵 runner，并重新验证七版本证据。

最低版 `0.1.7-rc.2`、旧 resource 边界 `0.2.0-rc.2`、当前推荐版 `0.2.1-rc.4` 必须完成完整矩阵；其余已支持版本至少运行 typecheck、build、tests 和 smoke。

未经验证不再扩大范围。若上游新版本破坏公开契约，应记录未支持，而不是在 rc.5 维护第二套实现。

### 4.8 P1：最终产物 release workflow

新增一次构建、多 job 消费同一 artifact 的 release workflow：

1. source gate 运行 typecheck、build 和 tests，不运行会自行 pack 的普通模式 package smoke。
2. producer 只执行一次 `npm pack` 并生成 SHA-256。
3. 后续 job 下载同一文件，以 exact-artifact 模式运行 package smoke 和 recovery/fault smoke。
4. 最低/推荐 DSH profile 使用同一 tarball。
5. GitHub Release 与 npm publish 只消费这份文件，不重新 pack。

### 4.9 rc.5 明确不做

- 不增加 `CharterOp`。
- 不增加 record 字段或提高 `recordSchemaVersion`。
- 不增加 Remote 方法或模型工具。
- 不增加 proposal provenance、validator 或 evidence binding。
- 不重构整个信息架构。
- 不实现搜索、分页、虚拟列表或批量审阅。
- 不创建新 domain。

任何需要上述能力的需求进入 0.2.0，不继续扩张 rc.5。

## 5. 从 rc.5 到 `0.1.0` stable

rc.5 发布状态确定后进入 feature freeze。满足以下条件后发布 `0.1.0`：

- rc.5 没有未关闭的数据损坏、授权、审阅误提交或 unknown-outcome 缺陷。
- live Gateway、真实 recovery UI、Desktop 重启 ABI 检查完成并记录。
- 支持矩阵与当前声明一致。
- README、verification、design、release notes 不再包含 rc.2、未 tag、未公开 CI 等过期状态。
- 最终 stable tarball 重新构建，因为 manifest 必须是 `0.1.0`；不能重命名 rc.5 tarball。
- stable tarball 通过 exact-artifact、packed recovery、fresh-profile 和公开 CI。
- `latest` 指向 `0.1.0`；`next` 后续只用于真正的预发布。

如果 stable 准备期间需要修改运行时代码、wire、存储或恢复语义，不能直接发布 stable，应增加新的 `0.1.0-rc.N`。

## 6. `0.1.1` 的使用规则

不预先规划 `0.1.1` 功能包。`0.1.0` stable 之后只有以下变更进入 `0.1.1`：

- 向后兼容的 bug fix；
- 安全依赖升级；
- 新 DSH 精确版本兼容；
- 不改变公共契约的性能、可访问性和文案修正；
- 发布和供应链修复。

低风险补丁可直接发布 `0.1.1`；涉及异步写入、恢复、权限或多环境验证时先发 `0.1.1-rc.1`。`latest` 在候选期间继续指向 `0.1.0`，`next` 指向补丁候选。

以下内容不进入 `0.1.1`：新 record 字段、新 Remote、新模型工具、新持久状态、新审阅工作流或大规模 UI 重构。这些属于 `0.2.0`。

如果 `0.1.0` stable 后没有补丁需求，可以跳过 `0.1.1`，直接开始 `0.2.0-alpha.1`。

## 7. `0.2.0` 产品定义

0.2.0 的主题是：

> 从“编辑一组会话契约条目”升级为“捕获来源、审阅提案、以 Change Set 提交、验证事实、诊断维护”的完整工作流。

它由四个支柱组成。

## 8. 支柱一：契约工作区与显式 Change Set

### 8.1 信息架构

七个平级技术 section 重组为三个一级区域：

| 一级区域 | 内容 |
| --- | --- |
| Workspace | 当前目标、有效硬约束、有效交付物和进度 |
| Review Center | pending proposal、历史草案、归档/拒绝/替代条目、近期变更 |
| Diagnostics & Maintenance | 上下文预算、来源完整性、validator、记录健康、导出恢复 |

桌面采用左侧一级导航、中间内容、右侧 Change Set 面板；窄屏采用顶部 tab、筛选 sheet 和 Change Set bottom sheet。

### 8.2 Change Set

现有 `mutationId + baseRevision + ops` 正式提升为用户可见的 Change Set：

- 按目标或 item 分组显示 before → after。
- 显示会影响 prompt 的变化与只影响 metadata 的变化。
- 显示 prompt bytes、record bytes、active/pending/stored 数量变化。
- 每项可撤销，purge/归档后仍保留在 Change Set 中供提交前检查。
- Apply 前有最终审阅，不再只展示投影后的列表。
- revision conflict 后重新计算 diff，但保留原 Change Set。
- unknown outcome 明确绑定到 Change Set id，并使用同一 id 重放。
- 提交后的 Recent Changes 显示 revision、actor、时间和结构化 change，不复制历史正文。

核心层新增统一 `planChangeSet()`；浏览器 preview 和 Host commit 共用同一 planner。Host 返回 canonical summary，客户端核对它与提交前 preview。

## 9. 支柱二：来源可追踪的 Proposal Inbox

### 9.1 统一提议入口

Review Center 统一承载：

- compaction summary 历史草案；
- 用户从消息创建的提议；
- agent 通过 `charter_propose` 创建的 pending proposal；
- 现有 pending 条目；
- stale/conflict 后需要重新审阅的 Change Set。

所有新 proposal 都必须记录不可变 provenance，区分 manual、message、compaction-summary、agent-tool 和 fork。

v1 既有 pending 条目无法可靠恢复原始消息或 compaction summary 引用。迁移后使用显式的 `legacy-unknown` provenance，只保留 v1 `origin` 作为提示，不伪造 event seq、digest 或 source kind。它们可以正常审阅，但来源 facet 归入“旧版来源未知”。“所有 proposal 有 provenance”的验收包含这一 legacy 分支，不要求凭空重建证据。

### 9.2 从消息创建提议

当前 DSH 没有公开的 message-row action slot，因此基线方案是在 Review Center 内提供分页消息选择器：

- 用户选择一条消息及文本范围；
- Host 绑定 Session lifecycle、event seq、role 和 content digest；
- UI 可跳回来源消息；
- 来源不可读时显示 unavailable，但 proposal 不自动失效。

如果目标 DSH 后续提供公开 message action slot，再增加消息旁快捷入口。禁止 DOM 注入或依赖 Conversation 私有 React 树。

### 9.3 `charter_propose`

新增严格收窄的模型工具：

- 只能创建 invariant/deliverable pending proposal；
- 不能修改 objective、active item、review、lifecycle、verification 或 progress；
- provenance 由 Host 从 tool-call context 生成，模型不能提供 seq、digest 或 actor；
- 单次条数和字节有硬上限；
- 同一来源、kind 和规范化文本重复时返回已有 proposal；
- 工具结果只说明“已进入审阅中心”，不能声称已生效；
- proposal 在用户 accept 前不进入 standing prompt。

## 10. 支柱三：Evidence Integrity 与 Fact Validity

当前 verification 状态拆成三个正交维度：

| 维度 | 问题 |
| --- | --- |
| Review | 用户是否接受条目进入契约 |
| Source Integrity | 来源还能否读取，内容是否与 digest 一致 |
| Fact Validity | 条目陈述的事实目前是否成立 |

### 10.1 Evidence binding

- evidence 保存 source ref、projection version、digest 和可选 excerpt。
- source integrity 是读取时派生状态，不作为第二份事实持久化。
- 来源丢失或 digest 不匹配不会自动归档、拒绝或移出 prompt。
- 用户编辑 proposal 文本后保留来源，但 UI 明确显示“内容已修改”。
- fork 重铸 item id，同时保存父 Session、revision 和 source item 引用。

### 10.2 Validator

0.2.0 只支持注册式、结构化、用户触发的 validator：

- `workspace.path-exists`
- `workspace.file-digest`
- `workspace.file-contains`

不允许把任意 shell command 存入 record 并执行。每个 validator 声明参数 schema、权限、超时、版本、input digest 和稳定 reason code。

- 超时、缺权限、依赖不可读返回 `unknown`，不能误报 `invalid`。
- item 文本、evidence 或 validator 参数变化后旧结果标记 stale。
- validity metadata 不进入模型 standing prompt。
- 批量 validator 结果通过一个 Change Set 原子提交。
- 用户手工“已验证”改名为“用户确认”，不再与自动 validator 混用。

## 11. 支柱四：长契约规模化与客户端重构

### 11.1 查询与分页

新增 v2 read plane：

```text
charter.watchSummary
charter.queryItems
charter.queryChanges
charter.applyChangeSet
charter.runValidators
```

`queryItems` 支持搜索、kind、review、lifecycle、source kind、validity、cursor 和 limit。cursor 绑定 revision 与 filter digest；revision 改变后返回 stale，不静默跳页。

批量操作提交明确 item id 列表，不允许把“当前筛选全部结果”作为写入谓词，避免并发变化导致误操作。

`charter_read all` 增加 cursor/limit 和 `nextCursor`，继续受最终 32 KiB envelope 限制；`standing` 仍返回完整有效工作集，不静默分页硬约束。

### 11.2 授权与执行边界

0.2 M0 必须冻结方法级授权矩阵：

| 入口 | 调用者 | 权限与顺序 |
| --- | --- | --- |
| `watchSummary` / `queryItems` / `queryChanges` | owner 或获准访问该 Session 的 user | Gateway 先做 Session resource 决策，再读取 storage |
| `applyChangeSet` | owner/user | 复用现有 op 级授权；不可逆 purge 仍为 owner-only |
| `runValidators` | owner-only | 先完成 principal、Session resource、validator capability 与 workspace 权限检查，再读取文件或 storage |
| `charter_propose` | 当前 live Session 的 agent tool call | 仅 pending-only 专用 handler；不能复用 owner edit 权限 |

0.2 的新接口要求具备 principal/resource enforcement 的现代 DSH；不再为 0.1.7/0.2.0 新增降级写路径。查询限制 page size、响应字节和每 Session 并发；validator 限制条目数、文件读取字节、超时和并发。未授权请求不得触发深层参数解析后的 workspace/storage 读取。

真实 Gateway 验收覆盖 owner、user、无 principal、跨 Session、权限不足、取消和结果未知；不能只做 service 直接调用测试。

### 11.3 Watch 兼容

- 0.2 UI 使用 summary watch，不再在每次变化中传输完整 512 条 items。
- 当前 `charter.watch/edit` 在 0.2.x 保留为兼容适配面，避免 Host/client bundle 暂时错位导致白屏。
- 新旧端点最终调用同一 core command/query handler，不维护两套领域逻辑。

### 11.4 UI 与 store 重构

`CharterPane.tsx` 只保留 shell、一级路由和全局状态装配。建议拆分：

```text
WorkspacePage
ReviewCenterPage
DiagnosticsPage
ChangeSetPanel
RecoveryPanel
```

当前混合 draft store 拆成：

```text
change-set-store
review-store
bootstrap-store
maintenance-store
operation-coordinator
```

`operation-coordinator` 是唯一 durable request 状态机，统一 in-flight、known failure、outcome unknown、retry 和 abandon。拆 store 不能复制四套重放逻辑。

### 11.5 长列表与无障碍

- 512 条契约支持搜索、facet、分页或窗口化渲染。
- pending 支持批量接受/拒绝，历史支持类型和状态筛选。
- active section 自动滚入可视区域，移动端触控目标不小于 40–44px。
- 建立共享 Field、StatusBanner、ActionToolbar、ConfirmationDialog、Meter 和 ReviewList 组件。
- 增加 DOM 级无障碍检查，不再只依赖 `react-test-renderer`。
- viewport 覆盖 320/560/880px、200% 文本缩放、forced colors、reduced motion、中英文和 512 条压力样本。

## 12. 数据模型与迁移

### 12.1 默认方案

0.2.0 使用 `recordSchemaVersion: 2`，但默认仍使用现有 `dsh_charter_v1` domain。原因是权威边界、per-Session 单记录和 storage layout 没有改变；provenance、evidence 和 validity 属于同一记录内的模型演进。

这会修订当前设计中“所有不兼容升级都换 domain”的笼统规则。实施前必须写 ADR 并满足以下门槛：

- v1 → v2 转换是纯函数、确定性、可重复；
- 只读打开 v1 不产生写入；
- 没有业务变化时，v1 在内存投影后的 standing prompt 字节不变；
- 第一次成功 Change Set 在同一个 `table.update()` 中完成业务修改和 v2 写入；
- 含未来 schema 围栏的 `0.1.0` stable 及后续 0.1.x 打开 v2 时会 strict 隔离、保留并禁止恢复覆盖；rc.3 不是安全降级目标；
- v1 archive 原样恢复为 v1，下一次正常 mutation 再迁移；
- fork 正确重铸 item id，并迁移 provenance/evidence 引用。

如果 M0 探针证明需要拆分 items/evidence/validation runs 为多表、需要独立索引，或单记录查询无法满足性能目标，则改用新 domain 与 side-by-side copy。未达到这些条件前不引入第二正本或长期双写。

### 12.2 v1 verification 映射

| v1 状态 | v2 映射 |
| --- | --- |
| unchecked | validity.unassessed |
| verified by user | validity.attested |
| verified by validator | validity.valid + legacy validator marker |
| failed | validity.invalid + legacy validator marker |
| unavailable | validity.unknown + legacy validator marker |

v1 item/proposal 的来源映射：可证明的 fork 保留 fork 引用；其余既有条目统一迁移为 `legacy-unknown` provenance，并附原 `origin` 提示。不得把 v1 的 `origin: agent` 推断为 compaction-summary 或 agent-tool。

迁移不把 evidence digest 当成 fact validity，也不因为来源缺失改变 review/lifecycle。

## 13. 0.2.0 里程碑

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| M0 合同探针与 ADR | message source、tool context、cursor、record v2、降级、授权矩阵与 UI slot | 冻结 schema、兼容、授权和迁移决策 |
| `0.2.0-alpha.1` | Core v2、Change Set planner、v1/v2 parser、迁移测试 | v1 prompt 等价；首次 mutation 原子迁移 |
| `0.2.0-alpha.2` | Review Center、query API、搜索筛选分页、消息 proposal、`charter_propose` | 所有新 proposal 有 provenance；512 条可用 |
| `0.2.0-beta.1` | validator、integrity/validity、三中心 UI、Pane/store 重构 | 功能完整；开始 feature freeze |
| `0.2.0-rc.1` | 迁移、降级、无障碍、性能、真实 profile、packed artifact | 仅接受发布阻断修复 |
| `0.2.0` | stable artifact | 全部验收和文档完成 |

alpha 阶段允许 schema 调整，但每次都要提供测试 fixture 迁移；beta 起冻结持久化与 Remote 主契约；rc 起冻结功能。

## 14. 0.2.0 非目标

- 不增加 decision/environment 等新 item kind。
- 不做跨 Session 长期记忆或全局 proposal inbox。
- 不让模型 accept、reject、edit、archive 或运行 validator。
- 不做后台持续轮询 validator。
- 不执行任意 shell command。
- 不承诺永久审计。
- 不支持 predicate-based 批量写入。
- 不通过 DOM 注入实现消息旁按钮。
- 不解决多 Host 进程共享 JSON storage。
- 不解决上游 outer JSON 无法区分 missing/unreadable 的限制。
- 不为了“看起来是大版本”创建无实际需要的新 domain。

## 15. 0.2.0 发布验收

### 数据与迁移

- v1 打开零写入；首次 mutation 单次 CAS 迁移到 v2。
- v1/v2 prompt 等价样本逐字节一致。
- 0.1.x 对 v2 安全隔离、不覆盖；重新升级恢复。
- v1/v2 archive、fork、history、maintenance receipt 保持语义。

### Change Set

- before/after 与 Host canonical result 一致。
- 多项修改只产生一个 revision，任一 op 失败整组不生效。
- conflict 保留完整 Change Set；unknown outcome 精确重放。
- recent changes 不复制用户正文。

### Proposal 与 evidence

- 每个新 pending proposal 都有合法 provenance。
- message seq/lifecycle/digest 由 Host 验证。
- compaction、message、agent-tool、fork 来源可区分。
- 来源丢失只影响 integrity，不自动改变 review 或 standing。
- `charter_propose` 不能绕过 pending、配额和权限边界。
- v1 pending 条目使用 `legacy-unknown`，不会伪造来源。

### Validator

- integrity 与 validity 独立组合。
- timeout/权限/不可读依赖返回 unknown。
- 输入变化后旧结果 stale。
- validator metadata 不进入 standing prompt。
- 未注册 validator 和任意 executable 被拒绝。
- query/apply/validator 的 principal、Session resource、workspace 权限与配额矩阵通过真实 Gateway 验收。

### 长契约与 UI

- 512 items / 512 pending 压力下 summary watch 不随条目正文线性增长。
- 分页无重复遗漏，旧 cursor 明确 stale。
- 桌面和窄屏完成搜索、筛选、批量审阅和 Change Set Apply。
- 中英文、明暗、键盘、screen reader、触屏和焦点恢复通过。
- rc.3 的恢复、write-uncertain 和 unknown replay 无回归。
- 完整 check、迁移 smoke、packed recovery smoke 和目标 DSH 矩阵通过。

## 16. 版本边界总表

| 版本 | 允许内容 | 禁止内容 |
| --- | --- | --- |
| `0.1.0-rc.4` | 已发布的 DSH rc.3/rc.4 compatibility-only patch | 追加任何新内容 |
| `0.1.0-rc.5` | 审阅正确性、未来 schema 围栏、交互安全、UTF-8 准入、真实 Gateway/UI、发布门禁 | 新 schema、Remote、工具、proposal/evidence/validator、信息架构重构 |
| `0.1.0` | rc.5 稳定化与发布状态收敛 | 新功能 |
| `0.1.1` | stable 后兼容 bug/security/DSH/a11y patch | 新持久状态、新 API、新工作流 |
| `0.2.0` | 四个产品支柱、record v2、查询面、三中心 UI、架构重构 | 通用记忆、执行策略、任意 validator、无必要的新 domain |
