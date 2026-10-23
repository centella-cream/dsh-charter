# `dsh-charter` 设计规格

[English](charter-design.md) | 中文

> 定位：保存当前会话中用户明确确认的目标、硬约束和交付物，并在每次模型请求前从独立正本确定性重建。
> 压缩可以改写历史摘要，不能成为会话契约的写入者或恢复来源。

调研基准日：2026-10-19。目标契约基线：DSH `0.2.1-rc.2`。

相关文档：

- [v1 评审](charter-design-review.zh.md)
- [调研记录](../research/charter-research.zh.md)

实现状态：MVP Host、纯内核、JSON storage 组合、Remote contract 和主对话页标签页 Client 已完成实现并通过版本矩阵
验证。当前 `npm run typecheck`、`npm test`、`npm run build` 均通过（具体文件/测试数以验证记录为准）；同一源码在 DSH
`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-rc.1`、`0.2.1-rc.2` 上分别通过 typecheck、build 和 Vitest 套件（计数见验证记录）。
真实 profile 的 tarball 安装、配置组合、Web 启动、boot graph 和客户端 bundle HTTP 已通过；DSH `0.2.0-rc.2`
Web profile 上已用真实 Chrome 验证「对话」「轨迹」「会话契约」标签顺序、目标编辑、预览、Apply 和刷新持久化。
真实模型 compaction 端到端已于 **2026-10-22 在真实 Session 上记录 PASS**（见验证记录 8.4）；剩余发布前置项是
公开仓库与 dist-tag，重启 Desktop 后对当前 bundle/tool ABI 的核对仍是发布前的最后一项手工检查。兼容边界与
降级见[兼容矩阵](compatibility.zh.md)，证据和复现命令见[验证记录](../verification.zh.md)。

Client 入口依赖宿主提供的 DSH UI bundle，不把 `@deepseek-ai/dsh-client-ui-primitives` 的开发依赖当作插件
自身运行时依赖；浏览器入口构建为 DSH Web module loader 要求的单文件 factory bundle，CSS 在 factory 内联注入。

## 1. 产品定义

`dsh-charter` 是会话级会话契约，不是通用记忆、任务摘要、知识图谱或权限系统。

它回答三个问题：

1. 这次任务最终要完成什么；
2. 执行时哪些用户约束不能丢；
3. 哪些交付物还没有完成。

会话契约需要满足五项要求：

| 要求 | 可验证行为 |
| --- | --- |
| 保真 | 当前会话契约由独立正本重建，不依赖压缩摘要 |
| 有界 | 模型可见切片和持久记录都有硬字节上限，超限拒绝，不静默驱逐 |
| 用户主导 | 用户决定生效、替代、归档和永久清除；模型不能直接改有效条目 |
| 原子 | 一次 Apply 要么全部提交，要么全部不提交 |
| 可降级 | UI、模型或注入失败时，Session 仍能正常使用，正本不受影响 |

会话契约是声明，不是强制策略。需要机器保证的限制必须进入 Host 权限、hook 或工具执行守卫。

## 2. 范围

### 2.1 MVP

MVP 只包含：

- 原始目标与当前目标；
- `invariant`：用户确认的持续约束；
- `deliverable`：交付物及进度；
- 每会话持久化；
- 主对话页顶部「会话契约」标签页编辑面；
- 一个原子写 Remote；
- 一个按 Session 授权的 snapshot stream；
- 从已有 Session 最近一次可用压缩摘要（必要时回退到更旧的可用摘要）生成只读草案的 bootstrap 流程；
- 一个只读 `charter_read` 工具；
- user-role runtime context 注入；
- revision 冲突、幂等重试、配额和生命周期隔离。

### 2.2 后续能力

后续按顺序增加：

1. `decision` 和 `environment` 条目；
2. 用户从某条消息创建提议；
3. Agent 的 `charter_propose` 工具；
4. 来源绑定与专用 validator；
5. 最近修订历史面板；
6. 显式导入导出；
7. 缓存与 runtime-context 诊断。

### 2.3 明确不做

- 不替换 compaction backend；
- 不做跨会话长期记忆；
- 不让辅助模型维护整份会话契约；
- 不给用户条目设置 TTL；
- 不按 `lastUsed` 自动归档或删除；
- 不使用外部插件无权调用的 `appendPluginRecord()`；
- 不把用户可编辑正文放进 system prompt；
- 不做 storage 与 `CHARTER.md` 的双向实时同步；
- 不承诺永久、不可裁剪的完整审计历史。

## 3. 核心不变量

### 3.1 权限

1. 用户可编辑字节不得进入 system-role message。
2. Host policy、工具权限和执行守卫高于用户会话契约。
3. 模型不能执行使条目生效、归档、恢复、清除或修改进度的操作。
4. 每个远程端点必须声明 Session resource，不能退化成 global resource。

### 3.2 正本

1. `dsh-storage-domain` 中的 Session record 是唯一正本。
2. prompt 快照、工具结果、UI store、压缩摘要和近期修订记录都不是恢复正本。
3. 相同正本 revision 和 renderer version 必须产生逐字节相同的模型可见文本。
4. Session ID 相同但 lifecycle identity 不同的记录不得读取、覆盖或注入。

### 3.3 写入

1. 一次用户 Apply 只执行一次单记录原子 `update()`。
2. `baseRevision` 在 `update()` 的写链槽位内检查。
3. 同一 `mutationId + requestDigest` 在幂等保留窗口内返回原结果。
4. 任一 op 校验失败时，整批 op 不可见。
5. 配额准入以上一快照为基线：超出上限的增长被整批拒绝，但已经超预算的记录可以通过缩小编辑逐步收敛；
   从不自动删改现有条目。

### 3.4 模型上下文

1. 每次请求看到一个完整快照，不发送 patch。
2. 联合 runtime context 文本未变化且 retained snapshot 仍在 surface 时，不追加新快照。
3. retained snapshot 被压缩或替换后，下一次请求从正本重新物化。
4. 时间、revision、hash、来源、已读状态和最后验证时间不得进入模型可见正文。
5. 只改变 UI 元数据不得改变 Charter contribution 的哈希。

## 4. 总体架构

```text
                        dsh-charter core
             types / validation / applyOps / render
                           ▲           ▲
                           │           │
UI edit Remote ── auth ── service ── storage-domain
                           │              │
                           │              ├── sessions[sessionId] 唯一正本
                           │              └── domain/changed
                           │                         │
                           ├── prompt context        └── watch Remote
                           │                              │
                           └── charter_read               ▼
                                                RemoteSnapshotStream
                                                         │
                                                         ▼
                                                    Charter panel
```

依赖方向固定为：

```text
client / host / tools / prompt  ->  core
```

`core` 不依赖 Cordis、DSH Session、storage、React 或 LLM。

## 5. 领域模型

### 5.1 目标

原始目标与当前目标分开：

```ts
interface CharterObjective {
  readonly original: {
    readonly text: string
    readonly setAtRevision: number
  }
  readonly current: {
    readonly text: string
    readonly setAtRevision: number
    readonly reason?: string
  }
}
```

规则：

- `original` 只初始化一次；
- 普通编辑不能覆盖 `original`；
- 只有显式 `objective.redirect` 能修改 `current`；
- redirect 必须带非空理由；
- MVP 只有用户可以初始化或重定向目标。

### 5.2 条目状态

状态分开保存，不生成综合 `status`：

```ts
type CharterItemKind =
  | 'invariant'
  | 'deliverable'
  | 'decision'
  | 'environment'

type CharterReview = 'pending' | 'accepted' | 'rejected'
type CharterLifecycle = 'current' | 'superseded' | 'archived'
type CharterVerification =
  | { readonly state: 'unchecked' }
  | { readonly state: 'verified'; readonly by: 'user' | 'validator' }
  | { readonly state: 'failed'; readonly reason: string }
  | { readonly state: 'unavailable'; readonly reason: string }

type DeliverableProgress =
  | 'not-started'
  | 'in-progress'
  | 'blocked'
  | 'done'
  | 'cancelled'
```

```ts
interface CharterItem {
  readonly id: string
  readonly kind: CharterItemKind
  readonly text: string
  readonly review: CharterReview
  readonly lifecycle: CharterLifecycle
  readonly verification: CharterVerification
  readonly progress?: DeliverableProgress
  readonly origin: 'user' | 'agent' | 'fork'
  readonly order: number
  readonly createdRevision: number
  readonly supersedes?: string
  readonly supersededBy?: string
  readonly evidence?: readonly EvidenceBinding[]
}
```

约束：

- user 新建条目直接为 `accepted`；历史草案溢出导入为 `pending`；模型提议入口暂未开放；
- `pending` 只能转 `accepted` 或 `rejected`；
- 只有 `accepted + current` 进入有效工作集；
- `superseded` 必须与替代条目建立双向链接；
- `progress` 当且仅当 `kind === 'deliverable'` 时存在；
- `done` 不推出 `verified`，`verification.failed` 也不自动归档；
- `archived` 可恢复，`superseded` 和 `rejected` 不复活；
- item id 永不复用。

### 5.3 证据

证据来源与当前有效性分开：

```ts
interface EvidenceBinding {
  readonly sessionId: string
  readonly sessionCreatedAt: number
  readonly seqs: readonly number[]
  readonly projectionVersion: number
  readonly digest: `sha256:${string}`
  readonly excerpt?: string
}
```

`EvidenceBinding` 只能证明“来源还能否按同一投影读取”，不能证明条目现在仍然成立。

- `sourceIntegrity` 是读时派生值，不写入 prompt；
- 用户约束即使来源暂时不可读，也不自动失效；
- 文件、环境或命令事实只有注册了专用 validator 才能自动改变 verification；
- MVP 只保留用户确认，不做后台自动对账。

## 6. 持久化

### 6.1 一 Session 一记录

Session dispose 会关闭所有打开的 watch 订阅（listener 收到 `null`，stream generator 退出），同 ID 重建的 Session
从新 stream 开始，而不是挂在已脱离的 listener 上。记录校验在 service 边界逐条进行，并且每次运行期读取/写入路径都重新做严格 schema 解析（`recordFor`、只读
view、parent/fork 读取、`table.update` transform）：domain 保留原始 per-record 文档，单条损坏或前向不兼容的
记录只让该 Session 不可用，不会阻止整个 domain 打开，也不会被重写覆盖。**该保证的范围**：仅适用于文档能加载、
但内部 record schema 或一致性检查失败的情况；不覆盖 JSON storage backend 无法读取（或外层 version stamp 被
拒绝）的外层 JSON 文档——该 backend 会把这种文件当作记录不存在，而插件侧 KvTable API 没有读取错误信号，无法与
"记录缺失"区分（已记录的残留风险，见验证记录 4.5）。外层不可读时的运营恢复：在 Host 初始化该 Session 前停止
Host，从备份恢复文件后再重启。初始化失败会先清除瞬时不可用状态再发布最终 ready view，
并支持后续重试。

Domain：

```text
name: dsh_charter_v1
version: 1
layout: per-record
table: sessions
key: SessionId
```

记录形状：

```ts
interface CharterRecord {
  readonly recordSchemaVersion: 1
  readonly identity: {
    readonly createdAt: number
    readonly cwd?: string
    readonly parentSession?: string
  }
  readonly forkedFrom?: {
    readonly sessionId: string
    readonly revision: number
  }
  readonly current: CharterSnapshot
  readonly history: readonly CharterReceipt[]
  readonly recentMutations: readonly MutationReceipt[]
}

interface CharterSnapshot {
  readonly revision: number
  readonly objective?: CharterObjective
  readonly items: readonly CharterItem[]
  readonly promptText: string
  readonly promptDigest: `sha256:${string}`
  readonly stateDigest: `sha256:${string}`
}
```

`promptText` 和 digest 与 current 在同一记录中原子提交，但都是派生缓存。每次打开和写入时都可从结构化状态
重算；不一致时停止注入和写入，不能把缓存当第二权威。

### 6.2 为什么不拆 revision 表

`dsh-storage-domain` 没有跨记录事务。若使用 `heads + revisions`：

- 先写 revision 会留下孤儿；
- 先写 head 会出现悬空指针；
- 启动时扫描最大 revision 会让成本随历史增长；
- 需要额外 repair 协议。

会话契约编辑频率低、记录有硬上限，单记录重写比两阶段协议更小、更可靠。

### 6.3 History 的定位

`history` 是有界的近期变更回执，不参与恢复 current：

```ts
interface CharterReceipt {
  readonly revision: number
  readonly baseRevision: number
  readonly mutationId: string
  readonly requestDigest: `sha256:${string}`
  readonly resultDigest: `sha256:${string}`
  readonly actor: { readonly kind: 'owner' | 'user' | 'host'; readonly id?: string }
  readonly at: number
  readonly changes: readonly CharterChange[]
}

interface MutationReceipt {
  readonly mutationId: string
  readonly requestDigest: `sha256:${string}`
  readonly committedRevision: number
  readonly ids: Readonly<Record<string, string>>
}
```

规则：

- revision 0 的空记录允许 history 为空；其他记录的 `current.revision` 与 history 尾部 revision 一致；
- history 最多保留最近 N 次且受总字节上限约束；
- 自动裁掉旧 history 是允许的，因为它不是正本；
- 不承诺永久审计；需要永久审计时接非权威外部审计设施；
- 用户执行永久清除时，同一原子 update 还要清洗近期回执中的正文，避免“条目删了但历史仍泄漏”。

### 6.4 版本升级

兼容升级保留 `dsh_charter_v1`：

- 新字段先设为 optional；
- 同一 zod union 读取旧 `recordSchemaVersion`；
- 下次正常写入时转成当前 canonical shape；
- 不在启动时批量重写。

不兼容升级使用新 domain 名，例如 `dsh_charter_v2`，执行显式 side-by-side copy：

1. v1 只读；
2. 每 Session 转换并原子写入一条 v2 记录；
3. v2 存在后只读写 v2；
4. 失败 Session 保持 v1 只读并禁止编辑；
5. 不长期双写。

## 7. 原子写入协议

### 7.1 请求

```ts
interface CharterEditRequest {
  readonly sessionId: string
  readonly mutationId: string
  readonly baseRevision: number
  readonly ops: readonly CharterOp[]
}
```

lifecycle 变化在 Host 和 Client 两侧都是权威信号：Host 帧去重比较 `lifecycle`，Client 即使新 revision 从 0 开始也会
接受。Apply/bootstrap 请求在途时锁定会修改草稿的控件；已审阅历史草案算 dirty，跨标签切换不会丢失。

客户端新增条目使用临时 `clientRef`；Host 铸造正式 item id，并在成功结果中返回映射。actor、revision、
时间和 origin 都由 Host 填充，不能相信客户端字段。`objective.redirect` 的 reason 可选：缺省时 UI 显示
本地化默认文案，而不是把某一种 UI 语言的文案写进记录。客户端与 Host 共用同一个文本检查函数，控制字符和
孤立 surrogate 在编辑器阶段就会被拒绝，而不是等 Apply 才返回通用错误。

操作集合：`objective.initialize`、`objective.redirect`、`item.add`、`item.propose`、`item.edit`、
`item.accept` / `item.reject`、`item.supersede`、`item.archive` / `item.restore`、`item.purge`
（owner-only）、`item.verification.set`、`deliverable.progress`。其中 `item.propose` 由审阅后的历史草案导入产生，并通过同一个 `charter.edit` 请求提交，保证导入的原子性。
任何有 edit 权限的客户端都可以在普通编辑中发送它；actor 策略与 `item.add` 相同，pending 条目计入
`maxPendingItems`。它不是模型可见的写工具，也不是权限提升：pending 条目只有 accept 后才进入 prompt。

### 7.2 Actor 策略

- `owner`：所有操作，包括不可逆的 `item.purge`；
- `user`：普通目标/条目/进度/验证操作，但不能 `item.purge`；
- `host`：不会通过 Remote edit 路径被接受；初始化和 fork 使用专门内部代码；
- agent/model：不暴露 edit API 或写工具。

Service 在打开 storage transaction 前检查策略，`commitRecord()` 再检查一次，防止未来调用方绕过；`FORBIDDEN`
不改变 revision、storage 或已发布 view。

### 7.3 提交顺序

1. Gateway 校验参数并完成 Session resource 授权；
2. 确认 live Session 与 storage lifecycle identity 一致；
3. 规范化 ops，捕获本次 actor/clock，计算 `requestDigest`；
4. 调用 `sessions.update(sessionId, transform)`；
5. transform 先查近期 `mutationId`，再查 `baseRevision`；
6. 在内存草稿上应用全部 ops；
7. 校验状态转换、引用、配额、prompt 渲染和记录总大小；
8. 生成 revision、snapshot、receipt 和幂等回执；
9. 返回完整新记录；
10. storage backend durability 成功后，内存状态与 `domain/changed` 才更新；
11. Remote 返回提交后的 revision 和当前 view。

线性化点是 `KvTable.update()` 对该记录的 durable write。

### 7.4 幂等

- 同 `mutationId + requestDigest`：返回原 committed revision；
- 同 mutationId、不同 digest：`MUTATION_ID_REUSED`；
- mutationId 未命中且 baseRevision 过期：`REVISION_CONFLICT`；
- 回执有界，因此幂等保证也有窗口；窗口外的原请求仍会因旧 baseRevision 冲突，不会重复应用。

重复 mutation 和 revision conflict 在 `update()` transform 内以内部 typed control error 退出，使该次调用不写
后端、不产生 `domain/changed`。成功结果中的 `clientRef -> itemId` 从 `MutationReceipt.ids` 返回；响应丢失后的
重试不能重新铸造另一组可见 id。

### 7.5 错误码

| Code | 含义 |
| --- | --- |
| `INVALID_ARGUMENT` | schema、文本、大小或 op 组合非法 |
| `FORBIDDEN` | 调用者无权执行该操作 |
| `NOT_FOUND` | Session 或 item 不存在 |
| `LIFECYCLE_MISMATCH` | 存储记录属于另一个 Session 生命周期 |
| `REVISION_CONFLICT` | baseRevision 过期，返回 currentRevision |
| `MUTATION_ID_REUSED` | 同 mutationId 对应不同请求 |
| `INVALID_REFERENCE` | item、替代链或 evidence 引用非法 |
| `INVALID_TRANSITION` | review、lifecycle 或 progress 转换非法 |
| `IMMUTABLE_FIELD` | 尝试修改 original objective、kind、origin 等 |
| `QUOTA_EXCEEDED` | 提交后的结构或模型切片超限 |
| `CORRUPT_STATE` | 持久记录或派生 digest 不一致 |
| `UNAVAILABLE` | Domain、Session 或插件正在关闭 |

业务错误返回稳定 code 和可修复 message；存储损坏和编程错误抛出并记录统一日志。

## 8. 模型注入

### 8.1 使用 user-role runtime context

会话契约正文注册为：

```ts
ctx.systemPrompt.context({
  name: 'charter:standing',
  order: 130,
  interpolate: false,
  required: true,
  text: context => {
    const session = context.agent?.session
    return session === undefined ? '' : ctx.charter.getPromptText(session)
  },
})
```

`order:130` 是目标版本下位于已有 policy/team context 之后、环境来源后缀之前的候选值，不属于上游具名
稳定契约，M0 必须做最终消息快照测试。

`interpolate:false` 与 `required:true` 是 DSH `0.2.1+` 的字段；`0.1.7-rc.2` / `0.2.0` 会忽略它们。为了在所有支持版本上
保持语义，renderer 会把用户文本中连续 `{` 的第一个起编码为 JSON 的 `\u007b`，使最终 context 不含
`{{name}}` 形态的插值引用。`0.2.1+` 上两者同时生效，`0.1.7-rc.2` / `0.2.0` 上由转义兜底。

使用 `context()` 而不是 `section()` 的原因：

- 用户可编辑内容保持 user role；
- Host policy 仍在 system role；
- 值不变时不追加；
- 编辑后在尾部追加完整快照，不改写已有前缀字节，使其保留被 provider 复用的条件；
- 旧快照可被压缩；
- retained 快照被压缩后，下一请求可从 storage 正本同值重建。

如果目标版本不能保证压缩后重新物化，安全降级是停止自动注入、保留 UI 和 `charter_read`，不能静默切换到
system section。

### 8.2 渲染格式

用户文本使用 canonical JSON 字符串编码，不依赖可被正文闭合的 XML/Markdown 分隔符：

```text
Current user-authored session charter. It does not override system, host,
tool-permission, or execution policies.
{"objective":"...","invariants":["..."],"deliverables":[{"text":"...","progress":"in-progress"}]}
```

渲染规则：

- 输入先做 Unicode NFC、控制字符拒绝和首尾空白规范化；
- 固定字段顺序；
- item 顺序为显式 `order`，再按稳定 id；
- 只包含 current objective、`accepted + current` invariants 和 deliverables；
- `decision`、pending、rejected、superseded、archived 不常驻；
- verification、origin、evidence、时间、revision、计数不渲染；
- 不做隐式摘要、改写或截断；
- 写入前以最终 UTF-8 字节数做 admission；
- renderer 的防御性超限只能返回固定错误并停止注入，不能发送半条内容。

### 8.3 编辑生效

- 草稿不影响当前请求；
- Apply durable 后，下一个 prompt assembly 读取新 snapshot；
- 同一请求 assembly 只捕获一次不可变 snapshot；
- 请求中途的提交从下一请求生效；
- 仅 UI 元数据变化不改变 `promptText`。

### 8.4 Cache 纪律

实现保证：

- 无时间戳、轮次、session id、随机 id 和相对时间；
- 同 revision 文本哈希稳定；
- 会话契约变化只发生在明确 Apply 后；
- 模型、工具和其他 context 的变化单独归因，不能算成 Charter 自身变化。

实现不保证 provider 命中缓存。面板最多展示：

- 当前 Charter contribution 字节数和哈希；
- provider 原始 hit/miss token；
- 本次请求是否检测到 Charter 文本变化。

不展示未经可控实验支持的“本次 Charter 编辑导致 N 个 miss token”。

## 9. UI 与 Remote

### 9.1 主对话页标签页

使用 Conversation View list slot：

```ts
ctx.slots.register({
  name: 'conversation.view',
  id: 'charter',
  order: nextViewOrder(ctx),
  locale: 'dsh-charter',
  label: () => t('tab'), // zh: 会话契约；en: Charter
  inject: sessionId => {
    const lease = controller.acquire(sessionId)
    return { source: lease.source, draft: lease.draft, release: lease.release }
  },
}, CharterPane)
```

- Chat 使用 order 0，Trajectory 10，其他插件常用 20/30；
- 本插件以稳定的高 order（`CHARTER_VIEW_ORDER = 1000`）只注册一次，因此自然排在这些 tab 之后；它不订阅
  slot roster、也不重新注册，所以两个都想“永远最后”的插件不会互相无限重排；使用更高 order（例如 2000）的
  插件只会排在会话契约之后；
- 标签名和面板全部文案走 `dsh-client-locale` 的同一 namespace：中文「会话契约」，英文「Charter」；计数、状态、
  按钮、占位符、错误码说明均随当前 DSH 语言切换；
- 空白 Session 隐藏 View tab bar；开始会话后显示；
- 若 Session 由另一个 DSH 进程持有、尚未在当前 Web 进程加载，`watch` 返回 stored record 的只读 view 与说明，
  并在 Session 变为 live 后通过 `publish()` 自动升级为可编辑；不把原始 "not live" 错误直接抛给 UI；
- 标签页正文使用主内容区滚动，底部操作栏不再固定在视口底部，而是位于内容末尾；
- 重挂载正文组件（切标签、view 重建）不会丢失草稿：草稿按 Session 所有权保存在 store 中，切换 Chat/Charter
  或重挂载不会丢失，只有
  lifecycle 变化才会重置。已释放草稿按有界 LRU 回收；客户端与 Host 共用文本检查函数，控制字符和孤立 surrogate
  在 Apply 前即被拒绝。

### 9.2 MVP 页面

界面采用与 `dsh-context` 等信息密集插件一致的 DSH 语义 token 视觉语言：

```text
会话会话契约                                        修订 7   1 生效   1 已存储
会话契约                                            240 B / 8.0 KiB 上下文
跨压缩保留的目标、约束与交付物。
[ 没有暂存的修改 ]                  [预览上下文] [丢弃] [应用]   <- sticky toolbar
模块                  概览
概览（当前）          目标    完成会话契约重设计……                    [打开]
目标                  硬约束 1          交付物 0
硬约束  1               不要破坏公共 API   暂无交付物
交付物  0             预算    240 B / 8.0 KiB；1 / 24；0 / 16
上下文
历史草案（始终可用；仅 draft 阶段可应用）
```

布局与交互原则：

- 左侧 section 导航（概览 / 目标 / 硬约束 / 交付物 / 历史草案 / 上下文）让每个模块保持聚焦；历史草案始终存在，
  仅 draft 阶段包含可应用草案；窄容器下变成横向 tab。
- 带品牌 mark 的页头包含标题、一句 slogan、修订/生效/存储 chip 和上下文预算条：
  “压缩会改写历史，但你的约定不会。”
- 吸顶操作栏在滚动时保持预览/丢弃/应用可见。
- 视图激活时独占阅读区域：通过插件作用域的 `:has()` 规则隐藏 composer seat，但草稿保持挂载，切回对话时
  原样恢复；审批/提问/计划审阅 seat 保持可见。
- 概览是 dashboard：目标摘要、约束/交付物卡片和预算明细。大块历史草案进入独立 tab，不再把工作模块挤到
  折叠线以下。
- 目标和条目 tab 是聚焦编辑页；添加输入位于各自 section 内，不再使用通用类型切换。Enter 添加，
  Shift+Enter 换行。
- 条目操作在指针设备上 hover/focus 出现，触屏常驻。
- 字体使用 DSH 文本/代码 token，间距采用 8px 节奏，边框、表面、brand/warn/danger/success 均为语义 token，
  自动适配明暗主题。
- 空 section 使用紧凑虚线占位，整体保持高密度、可扫描的节奏。

页面支持目标/条目编辑、归档/恢复/替代、进度、验证、待确认接受/拒绝、清除确认、精确 user-role
context 预览、冲突保留和显式降级状态。

### 9.3 读流

Host 提供按 Session 授权的 stream：

```ts
@Remote({
  mode: 'stream',
  resources: { session: sessionId => sessionId },
})
watch(sessionId: string, signal: AbortSignal): AsyncIterable<CharterFrame>
```

每个物理 generation：

1. 先注册 `domain/changed` listener；
2. opening snapshot 发出前，listener 只记录 dirty，不发送 change frame；
3. 同步读取当前 Session record，发送一个完整 snapshot；
4. 若基线窗口内变为 dirty，立即重读并发送最新完整 view；
5. 后续只处理同 domain、table、key 的变化；
6. 每次发送完整当前 view，可合并快速连续通知；
7. Abort 时注销 listener。

客户端用 `RemoteSnapshotStream` 处理 generation、opening snapshot、重连和 dispose。客户端按 revision 忽略
重复 replacement，不自行维护 durable baseline。

### 9.4 写 Remote

```ts
@Remote({ resources: { session: request => request.sessionId } })
edit(request: CharterEditRequest): Promise<CharterEditResult>
```

Remote 只做身份、授权和协议适配，全部领域校验走同一 core command handler。`charter.bootstrap` 另提供只读的
历史草案，不写 storage，也不进入 prompt。

### 9.5 从压缩历史生成草案

已有用户不应该从空面板开始。当「会话契约」标签页在一个 **live** Session 中打开，且会话契约为空时，客户端调用一次
`charter.bootstrap(sessionId)`。Host 从该 Session 日志中读取最近一次能产出候选的 `compaction/summary`（若最新摘要合法但为空，会继续向前回退），确定性抽取：

- **目标**：优先 latest correction，其次 original，最后取第一段；
- **硬约束**：Primary Request 中的 user-wants 条目，以及 Critical Context 中带约束语义的行；
- **交付物**：Pending Jobs / Next Step / Current Work 中的条目。

抽取器清理 markdown 标记，把超长候选按句子/分句/code point 边界拆成多个条目而不是截断，目标保持完整，
跳过损坏或空摘要，不设置隐藏的候选数量上限。它不调用模型，也不写入 storage。

结果是**仅供审阅的草案**，带摘要 seq、时间和 shadowed token 数。UI 在草稿面板中展示；用户可以编辑文本、
取消勾选，再点击应用。应用会把审阅后的字段合并为一次原子编辑：装得进上下文预算的候选成为 `item.add`（origin 为 user、
accepted），装不下的候选成为 `item.propose`（始终 pending、origin 为 agent）。两类候选都由 Host 铸造
id，不会被丢弃；pending 提案只有在 accept 后才进入 prompt。没有压缩摘要的新 Session 仍显示普通空状态；非 live
Session 不提供 bootstrap。

该确定性解析器优先考虑成本与隐私，不承诺语义完美。摘要中的陈旧或噪声条目可能进入草案，因此必须人工审阅。
模型辅助的二次提炼属于后续工作。

## 10. Agent 工具

MVP 只注册 `charter_read`：

```ts
interface CharterReadInput {
  readonly view?: 'standing' | 'all'
}
```

规则：

- 默认返回 standing view；
- archived/rejected/superseded 只在 `all` 调试视图中返回，且每条结果带状态；
- standing 以紧凑形式返回完整的当前工作集（目标 + 全部 accepted/current 条目），受 record 配额约束，不截断；
  调试用 id/review/lifecycle 不进入 standing，避免元数据撑大工具结果；
- `all` 返回完整调试字段（id/origin/order/createdRevision/review/lifecycle/替代链/验证来源），最多 64 条，并按
  最终 tool envelope 限制 32 KiB，同时报告 `truncated` 数量；
- 默认只返回 standing；
- 返回 canonical JSON，模型文本单独渲染；
- 不读取其他 Session；
- 不提供任何写能力。

后续 `charter_propose` 只能创建 `review:'pending'` 的候选：

- Agent 不能接受、拒绝、归档或恢复；
- 不能改目标和交付进度；
- 不能删除；
- tool call id 派生 mutationId；
- 失败时返回稳定领域错误，不做部分成功。

## 11. 生命周期

### 11.1 新 Session

`agent/created` 是串行、可等待的初始化边界。插件在该监听器完成：

- 创建 revision 0 的空 record；
- 初始化前检查父链自引用、多节点环和最大深度；环标记 `CORRUPT_STATE`，不会让初始化 Promise 互相等待；
- 若记录已存在，校验 lifecycle identity；
- 初始化失败时禁用该 Session 的 Charter 并记录错误。监听器内部捕获故障，不向外抛出，避免回滚 Session 创建。

### 11.2 Resume

- 读取相同 Session record；
- 校验 `createdAt`、`cwd` 和 parent identity；
- 不调用模型，不生成 revision；
- 直接向 prompt 和 UI 暴露 committed snapshot。

### 11.3 Fork

公开 API 不能把 Charter revision 与 Session fork 放进同一事务。首版采用明确的弱保证：

1. child `agent/created` 发现 `header.parentSession`；
2. 读取父 Session 最新已提交 Charter；
3. 重铸 child item id、重映射替代链接，以一个 host-authored `fork` receipt 原子写成 child revision 1；
4. 目标的 `setAtRevision` 与复制条目的 `createdRevision` 设为 1，origin 设为 `fork`；
5. child 与 parent 此后独立；
6. 初始化期间 UI 显示 initializing，写入等待初始化结束；
7. 复制失败时 child 不注入父级“实时指针”，而是显示 fork import unavailable。

这保证 child 首次模型请求前能拿到一份稳定副本，但不声称它精确对应 Session fork boundary。若产品以后要求
严格边界，需要上游提供 awaited fork participant 或在 fork metadata 中持久化 Charter revision。

### 11.4 子 Agent

只依据明确的 `parentSession` 继承，不按 cwd、时间或 agent 名推断。没有 Session lineage 的运行时子 Agent
不自动继承；调用方应在委派输入中传递必要约束。后续若 DSH 提供公开父子会话契约，再统一处理。

### 11.5 Dispose 与卸载

Session dispose：

- 停止该 Session 的初始化任务和流；
- 清除 runtime 引用；
- 不删除持久记录。

插件卸载：

1. 关闭新写入 admission；
2. 终止 watch streams；
3. 等待已接纳 update 完成；
4. 注销 context、工具和 UI；
5. `await domain.close()`。

插件不声明自定义 Session event，因此卸载后 Session 日志仍可由原系统恢复。

## 12. 配额与准入

以下数值是首版候选值，M0 必须用真实样本校准；不变量比具体值更重要。

| 对象 | 候选上限 | 超限行为 |
| --- | ---: | --- |
| 会话契约 contribution | 8 KiB UTF-8 | 拒绝整次 Apply |
| 目标 | 4 KiB UTF-8 | 拒绝该批次 |
| 单条模型可见条目文本 | 1 KiB UTF-8 | 拒绝该批次 |
| 全部 item | 512 | 要求用户合并或永久清除；归档不释放持久条目配额 |
| pending proposal | 512 | 拒绝新提议，不驱逐旧提议 |
| 单次 ops | 1024 | 拒绝批次 |
| 单条 Session record | 1 MiB | 拒绝批次 |
| recent history | 64 revisions 或 128 KiB | 自动裁最旧回执，不影响 current |
| recent mutation receipts | 128 | 自动裁最旧幂等回执 |

已超预算的 objective/item 允许继续缩短，即使仍高于上限；准入按同一 id 的旧文本比较，使收紧预算后可以分步收敛。
`all` 视图遇到单独无法放入 32 KiB envelope 的 objective 时会省略它并返回 `objectiveTruncated: true`。

模型可见容量只有最终 prompt 字节预算；active 条目不单独设上限。`maxItems`、`maxPendingItems`、
`maxOps`、`maxRecordBytes` 仍是存储/单批边界。超限增长整批拒绝；`overBudget` 同时覆盖字节预算、条目数以及
history/mutation 数量上限。

**预算收紧与降级。** 结构校验与准入策略彼此独立：记录已存在后调低上限，view 标记 `overBudget` 而不是
损坏，停止注入，UI 解释状态，并允许归档、清除、缩短等缩小的编辑逐步收敛；不可用的配置值会被抬到
文档化的最小值并记录 warning，避免出现 ready 但永久不可编辑的 Session。view 暴露 `maxRecordBytes`。

**溢出策略。** 任何路径都不静默截断用户可见内容：

- UI 显示上下文预算条和每个字段的字节计数；超限字段高亮，Apply 禁用，直到用户缩短文本或取消勾选。
- 手工编辑由 Host 校验；超限批次返回 `QUOTA_EXCEEDED`，记录保持不变。
- 历史草案的条目按句子、分句、最后按 code point 边界拆成多个候选，保留全部文本，不用省略号硬截断。
  仍然超过单条上限的候选会完整显示并标记，用户必须缩短后才能应用。
- 目标保持完整。若超过目标预算，草案显示全文和超限提示，Apply 禁用，直到用户主动编辑。这是明确的
  用户决策点，不是静默裁剪。
- 历史草案放不进总上下文预算时，能放下的候选直接生效，其余候选在同一次原子 Apply 中保存为**待审提案**。
  不会自动丢弃、重排或再次摘要，也不会被任意 per-kind 条数上限挡住。
- 只有真实限制（目标/单条字节、`maxPromptBytes`、`maxItems`、`maxPendingItems`、`maxOps`、record bytes）
  能阻止 Apply；UI 会指出具体限制并高亮对应字段。
- 解析器返回所选章节的全部候选，不设置隐藏的候选数量上限。

**默认值取舍。** 8 KiB 模型可见上下文约 2k tokens；目标可到 4 KiB，单条条目 1 KiB。这是比原 MVP
更宽裕但仍有界的默认值，不是普适最优。团队会话契约更长时可以在 profile 中调高，代价是每次请求增加 prompt
字节。

用户条目没有自动 TTL。允许两种显式减少：

- 归档：退出 active 工作集，仍在 current record 中；
- 永久清除：用户二次确认后删除，并清洗近期回执中的正文。

归档只释放模型可见工作集，不释放“全部 item”或 record bytes 配额。界面必须分别显示两种
用量，不能把归档描述成存储清理。

## 13. 模块结构

```text
src/
  core/
    errors.ts         稳定错误码
    limits.ts         配额与 UTF-8 计数
    digest.ts         sha256
    schemas.ts        zod 领域/schema
    normalize.ts      文本规范化与请求校验
    items.ts          条目排序/standing 判定（无 Node 依赖）
    prompt.ts         纯渲染器 + {{ 转义（Host 与 UI 共用）
    state.ts          状态不变量与配额
    commands.ts       applyOps
    record.ts         单记录提交、幂等、history 裁剪
    fork.ts           fork 重拷贝
  host/
    domain.ts         dsh_charter_v1 domain
    service.ts        Cordis Service、生命周期、edit/read/view
    tool.ts           charter_read
    types.ts          view/tool/result 类型
  remote/
    compat.ts         @Remote 装饰器 0.2.0/0.2.1 双形态
    watch.ts          按 Session 的 snapshot stream
    service.ts        charterRemote
    wire.ts           客户端 wire schema 与类型扩展
    contribution.ts   客户端 Remote 描述符
  client/
    store.ts          RemoteSnapshotStream 客户端状态、连接重试、source lease
    draft.ts          草稿请求构造
    draft-store.ts    per-Session 草稿所有权（暂存/编辑器/历史草案/反馈）
    bootstrap-plan.ts 历史草案 O(1) 增量字节核算与结果分类（精确渲染仅作校验/回退）
    preview.ts        投影草稿视图 + 共享渲染器
    CharterPane.tsx   主对话页标签页面板
    locales.ts        中英文 UI 字典
    charter.css       面板样式
tests/
  core/                纯内核与 UI 预览
  host/                真实 Cordis 组合、Remote 流、actor
scripts/
  build/               产物拷贝与 CSS 内联
  verify/              remote/client smoke
```

构建纪律：

- Host 入口是 ESM，可共享 `lib/` 下的 chunk；
- 浏览器入口单独构建为 CJS factory bundle，再包装成
  `window.__ModuleLoader__.load({ id, factory })`，CSS 内联，zod 打包，不能有相对 chunk；
- 声明文件由 `tsc` 生成后统一拷贝，tsdown 不重复生成。

实现纪律：

- core 只接受 plain JSON；
- 所有时间、UUID、actor 和 Session 查询从边界注入；
- CSS class 使用 `charter-` 前缀；
- 复用 DSH primitives 和语义 token；
- 标签页挂载失败不得影响 Host service、prompt 或 Session；
- 工具与 UI 共享同一个 command handler，不能各写一套校验。

## 14. 实施阶段

当前状态：M0–M3 已实现并有自动化证据；M4 未实现；M5 已完成 tarball 安装、真实 profile 两次启动、卸载后
启动和 boot graph 校验，故障注入和旧 record side-by-side copy 工具仍待补齐。详见
[验证记录](../verification.zh.md)。

### M0：契约探针

先做可删除的最小 harness，不实现产品 UI：

- storage `update()` 并发与 durability；
- domain 关闭/重开；
- `systemPrompt.context()` 的最终 message role/source；
- context 不变零追加、编辑一次追加一次；
- retained 快照被 compaction replacement 遮蔽后同值重建；
- Gateway Session resource 授权；
- RemoteSnapshotStream 每代 opening snapshot；
- Conversation View tab 注册（稳定高 order，只注册一次）、locale 文案；
- resume、fork、unload。

任一关键契约不成立时先改设计，不进入 M1。

### M1：纯内核与持久化

- 数据模型、schema、状态转换；
- deterministic render/digest；
- domain spec、初始化、lifecycle fence；
- 单记录原子 edit、revision、幂等和配额；
- 单元与属性测试。

### M2：Prompt 与工具

- user-role context；
- `charter_read`；
- 100 轮稳定渲染；
- 压缩后重物化；
- 无自动写入。

### M3：MVP UI

- 主对话页标签页注册；
- snapshot stream；
- 草稿、预览、Apply；
- conflict 保留草稿；
- 明暗主题、窄屏和键盘操作。

### M4：提议与证据

- 用户从消息创建提议；
- `charter_propose`；
- evidence binding；
- 专用 validator；
- 最近修订历史。

### M5：迁移与发布验证

- 旧 record 兼容读取；
- side-by-side domain copy 工具；
- 打包 tarball；
- 最低支持版与 next 版本真实 Profile smoke；
- 两次启动、卸载恢复和故障注入。

## 15. 测试与验收

### 15.1 纯内核

1. 同一输入渲染 100 次，字节与 digest 全部相同。
2. original objective 初始化后不能被普通 edit 修改。
3. `done` 不改变 verification，verification failure 不改变 lifecycle。
4. supersede 在同一 batch 内建立双向链接；任一端非法则整批失败。
5. 非 deliverable 出现 progress 必须拒绝。
6. Unicode 上限按 UTF-8 字节计算，不截断 code point。
7. 任意失败 op 不产生部分状态。

### 15.2 持久化与并发

1. 两个相同 baseRevision 的并发 edit 只有一个成功。
2. storage 成功但响应丢失后，以相同 mutationId 重试返回原 revision。
3. 同 mutationId 不同 digest 被拒绝。
4. backend write 失败时内存、stream 和 prompt 都保持旧 revision。
5. lifecycle identity 不匹配时不读取、不覆盖、不注入。
6. record schema 损坏时 domain 打开失败，不静默返回空会话契约。
7. history 裁剪不改变 current state 或 prompt digest。

### 15.3 Prompt 与压缩

1. 最终模型消息中 Charter 正文只出现在 user role。
2. Host system prompt 字节不包含任何 storage-derived Charter 正文。
3. 无正文变化的 100 个请求，Charter contribution 哈希不变。
4. 一次正文 Apply 最多产生一次自身文本变化。
5. 仅修改 verification、来源或 UI 状态不改变 contribution。
6. retained runtime snapshot 被 replace、区间 shadow、compaction 三种路径遮蔽后，下一请求重新物化同值。
7. 压缩摘要是否包含会话契约，不影响恢复后的正文哈希。
8. 恶意文本包含 `{{...}}`、JSON 引号、换行和伪标签时，仍保持 user role，且 canonical JSON 可解析。

### 15.4 Remote 与 UI

1. 非 owner 对未授权 Session 的 watch/edit 在业务方法执行前被拒绝。
2. 每个 stream generation 第一帧是完整 snapshot，之后才允许 change。
3. baseline 读取窗口内发生写入时，不丢最新 revision；重复 revision 可去重。
4. conflict 后草稿不丢，UI 展示服务端最新 revision。
5. 标签页组件抛错或挂载失败时，Host service、Session 和设置仍可用。
6. view binding 持有实例绑定的 source lease；多个 binding 共享同一 source，只有最后一个 lease 释放时才
   dispose；旧的 detach 不能覆盖新的 attach 状态。
7. 360px 容器与移动全屏可完成新增、编辑和 Apply。
8. 键盘可达、焦点恢复、状态不只靠颜色表达。

### 15.5 生命周期与兼容

1. resume 不产生新 revision，不调用模型。
2. fork 复制一次父 snapshot，并记录父 revision；父后续修改不穿透 child。
3. 无 parentSession 的子 Agent 不按 cwd 猜测继承。
4. 禁用/卸载插件后，已有 Session 能正常恢复和继续对话。
5. 重启后 prompt、UI 和 `charter_read` 读取同一 revision。
6. 真实 tarball 在最低支持版和 next 版本各完成两次启动 smoke。

## 16. 可观测性与隐私

记录以下指标，不记录用户正文：

- commit success/conflict/rejected/error；
- 当前 record bytes、prompt bytes、active item 数；
- stream reconnect 和 baseline failure；
- prompt digest changed/unchanged；
- runtime snapshot rematerialized after shadow；
- lifecycle mismatch、corrupt record、migration failure；
- provider 原始 cache hit/miss tokens。

日志中的 item 只写稳定 id、kind、revision 和错误码。证据摘录、目标、约束、路径、URL 和命令参数默认视为
敏感内容，不进入普通日志或埋点。

## 17. 待确认项

这些项目尚未写成已保证能力：

1. `order:130` 与目标 Profile 其他 runtime context 的最终顺序（需要最终消息快照测试）；
2. compaction replacement 是否覆盖所有 retained runtime snapshot 的清空路径（已在 0.2.0-rc.2 源码中核对
   `RuntimeContextProjection`，真实模型 compaction E2E PASS 已记录于验证记录 8.4）；
3. fork 初始化监听器在所有目标入口中是否都早于首次 prompt assembly（`agent/created` 是可等待边界，但
   仍需在真实 fork 入口验证）；
4. 8 KiB prompt 上限与 512 KiB record 上限的真实样本分布；
5. ~~最低支持 DSH 版本~~：已定为 `0.1.7-rc.2`；`0.1.5-rc.1` 及更早版本不兼容，理由见
   [兼容矩阵](compatibility.zh.md)；
6. 不兼容 domain 升级的运维入口；
7. 是否需要法律级永久审计；若需要，应独立立项，不能把有界 history 冒充永久审计；
8. DSH `0.1.7-rc.2` / `0.2.0` 无 `@Remote.resources`，per-Peer 资源授权只能从 0.2.1 起提供；这些版本仅适用于可信单操作者环境；
9. `charter_read` 的 `standing` 是完整工作集、没有固定字节上限；最大规模契约可能产生较大的 tool result，
   分页或显式响应 cap 是后续工作。

## 18. 决策状态

> **已定**：storage-domain 正本、user-role context、单记录原子更新、状态维度拆分、MVP 模型只读；最低支持
> DSH `0.1.7-rc.2`；0.2.1+ 使用 `@Remote.resources`，0.1.7/0.2.0 降级为 live-Session + lifecycle 校验。
>
> **M0 后确认**：具体配额、context order、fork 的产品文案。它们需要真实 Profile 和样本数据，当前没有足够
> 证据固定。
