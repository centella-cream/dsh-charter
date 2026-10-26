# `dsh-charter` 0.1.0-rc.3 升级方案

[English](rc3-recovery-plan.md) | 中文

方案日期：2026-10-26。

目标版本：`0.1.0-rc.3`。

## 0. 实现状态（2026-10-26）

§3.1 全部必需功能与 §4–§11 契约已在未提交的 rc.3 worktree 中实现，包括六个 Remote 方法、结构化记录状态、来源感知
初始化、每 Session mutation 队列、write-uncertain 围栏、有界 maintenance 回执、存储与恢复 UI、脚本化故障后端以及
打包产物 recovery smoke。按 Phase A（纯契约）→ Phase B（Host 边界）→ Phase C（Remote/client/UI）→ Phase D（文档、
版本、最终产物验证）顺序实现。§3.3 延迟项保持不实现。RC3-01…13 验收矩阵与确切证据见
[验证记录 §8.6](../verification.zh.md)。手动发布动作（tag、push、publish、fresh-profile UI 检查、CI）仍由发布
操作者执行；rc.3 使用单一本地 tarball+SHA，并以 `scripts/verify/recovery-smoke.mjs` 作为打包产物证据。

## 1. 结论

rc.3 只处理一件事：**避免 Charter 正本在恢复会话或存储异常后被静默替换，并给用户一条可校验的备份与恢复路径。**

当前版本已经证明 Charter 能跨会话压缩保留。下一步不需要继续增强压缩摘要，而要补齐正本的故障处理：

1. 恢复已有 Session 时，如果 storage 返回“记录不存在”，Host 不再自动创建空记录，也不重新从父 Session fork。
2. View 和 Remote 协议返回结构化记录状态，客户端不再根据英文错误消息猜测原因。
3. 用户可以导出完整记录，包括 identity、当前快照、近期 history 和幂等回执。
4. 用户可以把有效备份恢复到同一个 Session 生命周期；产品不提供覆盖健康记录、跨 Session rebind 或忽略 lifecycle 的入口。
5. 初始化、普通编辑和恢复进入同一个 per-Session 写入队列，恢复前在队列内重读目标状态。
6. 增加可控的 storage 故障测试，并让最终 tarball 通过备份、恢复和写入失败测试。

rc.3 不新增自动影子正本，不创建 `dsh_charter_v2`，也不开放模型写权限。`CharterRecord` 仍为 version 1，只增加可选的有界维护操作回执；已有合法记录不需要迁移或启动时重写。

## 2. 现状与约束

### 2.1 已经可靠的部分

当前实现已经具备以下基础：

- `dsh_charter_v1/sessions/<sessionId>` 是唯一正本；
- 每次 Apply 使用 storage-domain 的 `update()` 原子提交；
- snapshot、prompt 和 digest 可以确定性重建；
- 内部 schema 或一致性不合法的记录按 Session 隔离；
- lifecycle identity 不匹配时拒绝读取和覆盖；
- Apply 结果未知时，客户端保留原 mutation id 和请求并允许精确重试；
- 压缩后下一次请求从 storage 正本重新物化 `charter:standing`。

这些机制保持不变。

### 2.2 必须解决的缺口

`@deepseek-ai/dsh-storage-json` 的 per-record 读取会把以下情况都折叠成 absent：

- 文件确实不存在；
- JSON 截断或无法解析；
- wrapper 结构不合法；
- wrapper version 不被接受；
- 文件读取失败。

`dsh-storage-domain` 随后只向插件提供 `table.get(key) === undefined`。公开 API 没有原始文件、路径、读取错误或 presence probe，因此插件无法精确区分“真的不存在”和“文件存在但不可读”。

当前 `CharterService` 会把这个 `undefined` 当作首次初始化，然后写入空记录或新的 fork 记录。JSON backend 使用原子 rename 发布，新记录会完整替换原文件。这是 rc.3 要阻止的事故路径。

### 2.3 rc.3 能保证什么

rc.3 可以保证：

- `resume`、`clear`、`compact` 或插件重新挂载时，ambiguous absent 不触发自动写入；
- 用户执行恢复或显式初始化前，插件不会覆盖该 key；
- 有健康导出文件时，可以在同一 Session lifecycle 下校验并恢复；
- 内部 schema/一致性损坏仍然隔离，并可导出当前可见的原始 JSON 值用于诊断；
- 写入 reject 时，不把待写入的新内容发布给 view、prompt 或 tool；该 Session 进入 `write-uncertain` 并停止后续读写，直到 Host 重启并从介质重新加载。

rc.3 不能保证：

- 从公开 API 识别外层 JSON 到底是缺失、损坏、版本不兼容还是权限错误；
- 读取 backend 已经丢弃的原始字节；
- 在没有备份时自动修复已经损坏的数据；
- 处理多个 Host 进程同时写同一个 JSON storage；
- 抵御 storage 根目录整体丢失或 primary 与用户备份同时损坏。

底层写入 Promise reject 不等于介质一定没变。JSON backend 先 rename，再 fsync 父目录；如果 rename 成功而后续 fsync 失败，调用会 reject，但目标文件可能已经是新值。rc.3 因此把所有 storage write reject 都视为结果未知，不承诺磁盘仍是旧字节。

UI 和文档必须使用“记录缺失或不可读，无法自动判断”，不能声称已经识别出外层损坏。

## 3. 版本范围

### 3.1 rc.3 必须交付

| 功能 | 结果 |
| --- | --- |
| source-aware 初始化 | `startup` 可以创建新记录；恢复类 source 遇到 absent 时停止写入 |
| 结构化记录状态 | Host、wire、watch 和 Pane 使用同一判别联合 |
| 显式初始化 | 用户确认后为 ambiguous absent 创建空记录 |
| 完整记录导出 | 健康记录可备份；内部非法记录可生成诊断导出 |
| 受控恢复 | 只恢复到同 Session、同 lifecycle、非健康目标 |
| per-Session 写入队列 | 初始化、编辑、恢复不能交错覆盖 |
| 有界维护回执 | initialize/restore 与 edit 一样保存 request digest，支持结果未知后的精确重试 |
| 写入不确定隔离 | storage reject 后停止该 Session 的注入、工具读取和后续写入 |
| 结果未知重试 | initialize/restore 与 edit/bootstrap 共用一套 attempt 规则和 Remote 错误分类 |
| 故障注入 | 自动覆盖 backend open/load/write/pending/close 失败 |
| 最终产物验证 | 同一份 `.tgz` 执行 export/restore 和 storage fault smoke |

### 3.2 有余量再做

- 在发布 workflow 中自动运行最低和最高支持 DSH 版本的真实 profile smoke；
- 生成机器可读的 release acceptance report；
- 为上游 storage 提交 issue-aware per-record 读取接口提案；
- 为诊断导出增加更友好的字段差异展示。

### 3.3 本版本不做

- 自动 recovery domain 或每次 Apply 双写备份；
- 健康记录的任意历史回滚；
- 跨 Session、跨 lifecycle 的 rebind/import；
- `dsh_charter_v2` 和没有实际目标 schema 的迁移工具；
- 永久审计日志；
- `charter_propose`、validator 或新的卡片类型；
- 模型写入、自动接受或自动归档；
- 直接读取 `$DSH_HOME` 下的 JSON 路径；
- 依赖 `DomainImpl`、JSON backend 私有字段或未导出的内部类。
- archive 签名或跨设备密钥管理；rc.3 的 digest 只校验完整性，不认证来源。

自动影子备份会产生跨 domain 的两次写入，没有事务保证。它需要 prepared/committed 恢复协议和新的权威选择规则，不适合与 rc.3 的故障修复一起引入。side-by-side copy 只在出现不兼容的 record v2 时实现，不为不存在的目标格式预先增加代码。

## 4. 用户可见行为

### 4.1 新 Session

收到 `agent/created(source: "startup")` 后：

- root Session 沿用当前行为，创建 revision 0 的空记录；
- 新 fork Session 只在 parent 记录健康时从 parent 创建一次 fork 记录；
- 写入失败时显示 storage unavailable，不提前发布 ready；
- 写入 reject 时进入 `write-uncertain`，不猜测空记录是否已经落盘；
- `session/created` 事件本身不再写 storage，它只记录待初始化 Session，真正的 source 由 `agent/created` 提供。

### 4.2 恢复 Session

收到 `resume`、`clear` 或 `compact` 后：

- 记录健康且 identity 匹配：正常进入 ready；
- 记录内部非法：停止注入和写入，显示具体状态；
- 记录 identity 不匹配：保持 lifecycle mismatch，不覆盖；
- table 中没有 key：进入 `absent-unconfirmed`，不创建空记录；
- fork child 缺记录时，绝不根据 parent 当前状态重新 fork。

插件挂载时已经存在的 Agent 没有可重放的 start source。此类 Session 按 `reattach` 处理：可以打开已有记录，但 absent 时不自动创建。

同一个 Agent lifecycle 的 inferred source 和权威 source 必须合并。`reattach`/`unknown` 是弱意图，`agent/created` 携带的 source 是权威意图；后到的权威 `startup` 必须触发重新检查，不能复用一个先完成的 `reattach` 结果。

### 4.3 absent-unconfirmed

Pane 显示：

> 没有读到 Charter 记录。它可能从未创建，也可能存在但当前 storage 无法读取。插件尚未写入该位置。

用户可以：

1. 选择一个导出文件并验证；
2. 恢复到当前 Session；
3. 停止 Host，先按运维说明备份或修复原始文件；
4. 明确确认“创建空 Charter”。

“创建空 Charter”是可能覆盖 unreadable 文件的破坏性操作，需要二次确认。对恢复出来的 fork Session，该操作创建空记录，不从当前 parent 重新复制，避免伪造原来的分叉点。

### 4.4 内部非法记录

如果 table 中存在值，但 strict schema 或一致性检查失败：

- 保留原值；
- 不注入 prompt；
- 不允许普通 edit；
- 允许 owner 下载诊断导出；
- 允许 owner 用同 lifecycle 的健康导出替换；
- 恢复请求必须带当前 raw record digest，防止覆盖诊断后发生的新变化。

### 4.5 健康记录

健康记录可以导出，但不能通过 restore API 覆盖。需要修改内容时继续使用普通 Charter 操作和 revision 冲突规则。

这个限制有三个目的：

- 避免把恢复入口变成绕过 history 和权限检查的全量写接口；
- 避免 revision 回退破坏客户端单调视图；
- 避免 unknown Apply 实际已提交后，被旧备份覆盖。

### 4.6 写入结果不确定

`put()` 通过写前检查后发生 backend reject，或 `update()` callback 已成功产生 next 后发生 backend reject，目标 Session 立即进入 `write-uncertain`。callback 内的确定性业务错误不触发隔离：

- 不发布本次待写入内容；
- 停止 prompt 注入和 `charter_read`；
- 拒绝 edit、initialize、restore 和 export；
- watch 发布一次结构化降级状态，而不是继续显示可编辑的旧记录；
- 同一 Host 生命周期内不再尝试修复或覆盖该 key；
- 用户重启 Host 后，domain 从介质重新加载，已落盘的操作由幂等回执识别，未落盘的操作可以安全重试。

其他 Session 可以继续工作。若 backend 持续失败，它们各自在第一次失败后进入同样的隔离状态。rc.3 不做运行期 close/reopen domain，因为这会同时打断所有 Session，并扩大 service lifecycle 的复杂度。

## 5. 状态模型

### 5.1 `CharterRecordState`

在 `CharterView` 中新增结构化状态：

```ts
type CharterRecordState =
  | {
      readonly kind: 'healthy'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'absent-unconfirmed'
      readonly source: 'resume' | 'clear' | 'compact' | 'reattach' | 'unknown'
    }
  | {
      readonly kind: 'invalid'
      readonly reason: 'schema' | 'consistency'
      readonly recordDigest: `sha256:${string}`
      readonly observedRevision?: number
      readonly recoverable: boolean
    }
  | {
      readonly kind: 'lifecycle-mismatch'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'unknown'
      readonly reason: 'initializing' | 'storage-unavailable' | 'legacy-host'
    }
  | {
      readonly kind: 'write-uncertain'
      readonly operation: 'startup' | 'edit' | 'initialize' | 'restore'
      readonly lastKnownRecordDigest?: `sha256:${string}`
    }
```

规则：

- `recordDigest = sha256Json(rawStoredValue)`，覆盖完整 raw record，包括 identity、current、history、recentMutations 和可选 recentMaintenance；
- `stateDigest` 仍只表示 current snapshot，两者不能互换；
- `overBudget` 保持独立，它不是损坏状态；
- `recordState` 是 Host 从当前 storage 和 Session 派生的状态，不写回 `CharterRecord`；
- `message` 只保留诊断详情，不再作为 UI 状态协议。

### 5.2 View 状态

现有顶层 `status` 保持 `ready | initializing | unavailable`，避免扩大所有客户端分支：

| `recordState.kind` | View status | 模型注入 | 普通编辑 |
| --- | --- | --- | --- |
| `healthy` 且 live | `ready` | 预算内注入 | 允许 |
| `healthy` 但 non-live | `unavailable` | 不注入 | 不允许 |
| `absent-unconfirmed` | `unavailable` | 不注入 | 不允许 |
| `invalid` | `unavailable` | 不注入 | 不允许 |
| `lifecycle-mismatch` | `unavailable` | 不注入 | 不允许 |
| `unknown/initializing` | `initializing` | 不注入 | 不允许 |
| `unknown/storage-unavailable` | `unavailable` | 不注入 | 不允许 |
| `write-uncertain` | `unavailable` | 不注入 | 不允许，需重启 Host |

新 client 读取旧 Host 帧时，wire schema 给 `recordState` 填入 `{ kind: 'unknown', reason: 'legacy-host' }`。旧 client 与新 Host 的短暂版本偏差继续依赖现有 bundle/Host 同版本发布方式，不新增第二套协议。

### 5.3 集中检查

Host 新增一个内部 `inspectStoredRecord(raw, session?)`，一次完成：

1. 计算 raw record digest；
2. strict `charterRecordSchema.safeParse()`；
3. `assertRecordConsistency()`；
4. 可选 lifecycle identity 检查；
5. 返回判别联合和已解析 record。

schema-invalid 时额外尝试宽松读取 `identity`：只有能证明它与 live Session 匹配时才设置 `recoverable: true`。identity 缺失、结构非法或无法证明时仍可诊断导出，但禁止在线覆盖；宽松读取到明确不匹配的 identity 时归为 `lifecycle-mismatch`。consistency-invalid 记录已有 strict identity，同样必须匹配才可恢复。

现有 `unavailable: Map<string, string>` 和 `invalidRecords: Set<string>` 不再承担业务判别。它们可以删除，或只作为短期日志缓存，但 View、edit、export 和 restore 必须共享同一个检查函数。

## 6. 初始化与写入顺序

### 6.1 source-aware 初始化

`ensureSession()` 必须真正使用 `SessionStartSource`：

```text
stored healthy                    -> load
stored invalid/mismatch           -> fail closed
absent + startup                  -> create root/fork
absent + resume/clear/compact     -> absent-unconfirmed
absent + reattach/unknown         -> absent-unconfirmed
```

需要修改现有事件顺序：

- `session/created` 不调用 `initializeSessionSafely(..., 'startup')`；
- `agent/created` 是新 Agent 的 source 权威；
- 启动时 `ctx.agents.list()` 中的既有 Agent 使用 `reattach`，不能伪装成 startup；
- `domain/changed` 重试 child 时沿用 child 已知 source；没有 source 时按 unknown；
- `edit()` 删除“缺记录时按 startup 自动 ensure”的分支，改为返回 `INITIALIZATION_REQUIRED`。

初始化意图按 Session 对象和 Agent generation 管理，不能只缓存一个 `Promise<void>`：

- `session/created` 加入 pending set，domain 打开后的 `agents.list()` 扫描跳过该 set，等待随后串行到达的 `agent/created`；
- mount 前已经存在、且不在 pending set 的 Agent 才标为 `reattach`；
- inferred intent 正在执行时，权威 `agent/created` 到达会更新 intent generation；当前检查结束后必须按最新权威 source 再跑一次；
- 权威 source 不会被之后的 reattach/unknown 降级；
- Session 对象被同 id 新 lifecycle 替换时，旧 intent 和初始化 controller 一并失效。

### 6.2 per-Session mutation queue

新增一个 Host 内部队列，所有会写 `sessions[sessionId]` 的路径都必须进入：

- startup 初始化；
- 显式空初始化；
- 普通 edit；
- restore。

队列槽位内重读 table，完成检查后才调用 `put()` 或 `update()`。这样可以安全实现“检查 absent 后 put”，而不会与同进程内另一个初始化或恢复交错。

实现约束：

- parent 初始化在进入 child 队列前完成，禁止 child 持锁等待 parent，避免死锁；
- 同一 Session 不允许嵌套进入自己的队列；
- 业务校验失败不能毒化后续队列；storage write reject 会按设计隔离该 Session，后续队列项直接返回 `UNAVAILABLE`；
- shutdown 先停止新准入，再等待 initialization 和 mutation queue 排空，最后关闭 domain；
- `table.update()` 仍是普通 edit 的最终 storage 线性化点；
- 项目继续只支持单 Host 进程，共享 JSON storage 的跨进程竞争不在保证内。

## 7. 导出格式

### 7.1 Archive envelope

新增严格、版本化的 JSON 格式：

```ts
interface CharterRecordArchiveV1 {
  readonly format: 'dsh-charter-record'
  readonly formatVersion: 1
  readonly exportedAt: number
  readonly source: {
    readonly domain: 'dsh_charter_v1'
    readonly domainVersion: 1
    readonly sessionId: string
    readonly lifecycle: string | null
    readonly health:
      | 'healthy'
      | 'schema-invalid'
      | 'consistency-invalid'
      | 'lifecycle-mismatch'
    readonly revision: number | null
    readonly recordDigest: `sha256:${string}`
  }
  readonly record: unknown
  readonly payloadDigest: `sha256:${string}`
}
```

`payloadDigest` 覆盖除自身之外的完整 envelope。它用于发现传输、手工编辑或文件截断，不是签名，也不能证明文件来自可信 Host。

Host 校验时必须从 `record` 重算 `source.recordDigest`、`source.revision` 和 `source.lifecycle`，并检查 restorable archive 的 `source.health === 'healthy'`。envelope 中的这些字段是冗余校验信息，不是独立事实。

Archive 的威胁模型是防误选、传输损坏和无意修改，不抵御拥有 owner 权限的人主动重写 record 后重算公开 SHA-256。owner 被视为可信维护者；若以后需要跨不可信边界传输，再单独设计签名、密钥轮换和灾备规则。

### 7.2 导出规则

- endpoint 只接受单个 `sessionId`，不提供跨 Session 批量下载；
- 只允许具备现代 principal/resource enforcement 的 owner；
- healthy、schema-invalid、consistency-invalid 和 lifecycle-mismatch 的可见 raw value 都可以导出；
- 只有重新通过 strict schema、一致性和 lifecycle 检查的 archive 才能恢复；
- absent-unconfirmed 无 raw value可导出，UI 引导用户停止 Host 后备份 storage 文件；
- 导出不得写 Host 文件系统，由浏览器接收 JSON 并触发本地下载；
- 文件名采用 `dsh-charter-<safe-session>-r<revision>-<timestamp>.json`；
- archive 含用户正文和近期回执，UI 必须提示其敏感性；
- Host 日志只记录 session id、revision、digest 前缀和结果，不记录 archive 或正文。

### 7.3 大小限制

新增 `maxRecoveryBytes` 配置，默认 4 MiB，最小为 `maxRecordBytes + 64 KiB`，产品硬上限为 16 MiB。4 MiB 是基于默认 1 MiB record 预算选择的产品初值，不是 DSH transport 契约。`CharterViewLimits` 返回 Host 的有效值，Client 在读取文件前检查大小，Host 对完整 archive 和完整 wire 请求再次检查。

如果 profile 把 `maxRecordBytes` 配到无法在 16 MiB recovery envelope 内完整传输，普通 Charter 功能继续运行，但 `capabilities.recordMaintenance` 为 false，reason 为 `record-limit`，用户只能停止 Host 后做离线备份。不能静默调低现有 record 配额。

恢复使用独立 `assertRestoreAdmission()`，不调用 `assertRecordAdmission(undefined, ...)`，因此可以接受大于当前 `maxRecordBytes` 的旧记录。Host 先校验 archive，再裁剪旧 maintenance receipts、追加当前 receipt，最后要求**最终序列化 record**不超过 `maxRecoveryBytes`。恢复后 View 标记 `overBudget`，停止 prompt 注入；用户需要删减内容或提高配置后才能继续普通编辑。恢复功能不能因为后来调低普通写入配额而让已有备份永久无法读取。

一元 Remote 在方法执行前已经缓冲并解码完整请求，所以 `maxRecoveryBytes` 是业务准入和内存预算，不是 transport DoS 防线。0.2.1-rc.2 Web carrier 的默认完整 HTTP 请求上限是 300 MiB；部署者仍可配置更低值。恢复功能的 profile 验收必须确认 Gateway 请求上限大于实际 recovery envelope，超出时由 carrier 先拒绝。导出响应没有公开上游字节上限，最终 tarball 测试必须覆盖最大允许 archive。

## 8. 显式初始化与恢复协议

### 8.1 新 Remote 方法

Remote namespace 从三个方法扩展到六个：

```ts
charter.watch(sessionId, signal)
charter.bootstrap(sessionId)
charter.edit(request)
charter.exportRecord(sessionId)
charter.initializeRecord(request)
charter.restoreRecord(request)
```

三个新方法都声明 Session resource。`exportRecord`、`initializeRecord` 和 `restoreRecord` 只在 DSH 0.2.1+ 的 resource scope 与 Peer principal 都可用时启用，并要求 principal 为 owner。

DSH 0.1.7/0.2.0 没有 per-Peer resource authorization，现有普通 Charter 功能仍按可信单操作者模式运行，但这三个维护端点 fail closed，返回 `RECOVERY_UNSUPPORTED`，且不得深度解析 archive 或访问 storage。`CharterView` 增加 `capabilities.recordMaintenance`，让旧版本 UI 显示“升级到 DSH 0.2.1+ 后使用备份与恢复”，而不是展示可点击按钮。

Wire 兼容规则：

- `capabilities.recordMaintenance` 对旧 Host 帧默认 `false`，不能是缺失即拒绝的 required 字段；
- `restoreRecord` descriptor 只 strict 校验小型外层字段以及 `archive` 字段存在，`archive` 在 Gateway 边界暂按 `unknown`；
- 方法进入后先检查 runtime capability 和 owner，再做 archive strict parse、大小检查和 storage 访问；
- 旧 DSH 仍会先接收并 JSON 解码完整 HTTP body，格式错误的最外层也可能先收到 `gateway/input-invalid`；本方案不声称能在 transport 分配前返回 `RECOVERY_UNSUPPORTED`。

### 8.2 有界维护回执

为 `CharterRecord` 增加 optional `recentMaintenance`，仍使用 `recordSchemaVersion: 1`：

```ts
interface CharterMaintenanceReceipt {
  readonly operationId: string
  readonly kind: 'initialize' | 'restore'
  readonly requestDigest: `sha256:${string}`
  readonly resultRevision: number
  readonly resultStateDigest: `sha256:${string}`
  readonly sourceRecordDigest?: `sha256:${string}`
  readonly at: number
}
```

- 旧记录没有该字段仍合法，不在启动时补写；
- `maintenanceLimit` 属于 `CharterLimits`，默认 16，最小 1；initialize/restore 在同一次 record 写入中保留最近 `maintenanceLimit - 1` 条旧回执并追加当前回执，默认保证当前操作保留到后续第 16 次维护操作；
- request digest 绑定 operation kind、Session、lifecycle、actor、expected target 和 archive record digest，但不把 operation id 自身算入 digest；
- 同 operation id、同 request digest 返回原结果并标记 replay；
- 同 operation id、不同 digest 返回 `OPERATION_ID_REUSED`；
- 普通 edit 保留该字段；即使 restore 后又发生 edit，原 restore 仍能在回执窗口内精确确认；
- `assertRecordConsistency()` 校验 operation id 唯一、revision 范围、digest 格式和可局部验证的语义：initialize 的 result revision 必须为 0、state digest 必须等于确定性空快照且不能带 sourceRecordDigest；restore 必须带 sourceRecordDigest；若 current 或有界 history 仍保存 result revision，其 digest 必须与 receipt 一致；
- 回执窗口有界，保证与现有 `recentMutations` 相同：超出窗口后不再承诺按旧 operation id 识别。

当前维护请求还有更强校验：initialize receipt 必须与本次生成的空记录一致；restore receipt 的 sourceRecordDigest、resultRevision 和 resultStateDigest 必须分别等于本次已验证 archive 的 record digest、current revision 和 state digest。若 archive 自带的 recentMaintenance 已出现当前 operation id，而目标 record 没有对应 replay receipt，直接返回 `OPERATION_ID_REUSED`，不能把来源 archive 中的旧 receipt 当成本次操作证据。

恢复写入的是 archive record 加当前 maintenance receipt，因此恢复后的完整 `recordDigest` 不会等于 archive 的 `source.recordDigest`。恢复正确性的证据是 receipt 中的 `sourceRecordDigest`、恢复后的 current/history/recentMutations 内容，以及匹配的 state/prompt digest。

### 8.3 显式初始化

```ts
interface CharterInitializeRequest {
  readonly sessionId: string
  readonly operationId: string
  readonly expectedLifecycle: string
}
```

Host 在 per-Session queue 内执行：

1. 确认当前 live Session 和 expected lifecycle；
2. 重读 table；
3. 仍为 absent 时创建 revision 0 空记录；
4. record 中存在同 operation id、同 request digest 的维护回执时返回 `replayed: true`；
5. 没有对应回执的健康空记录也视为其他记录，返回 `RECORD_CONFLICT`；
6. storage 成功后才发布 ready。

这不是 purge 或 reset。它不能覆盖健康、内部非法或 lifecycle mismatch 的记录。对于 backend 隐藏的外层文件，table 仍显示 absent，因此 UI 必须在发送请求前进行破坏性确认。

### 8.4 恢复请求

```ts
interface CharterRestoreRequest {
  readonly sessionId: string
  readonly operationId: string
  readonly expectedLifecycle: string
  readonly expectedTarget:
    | { readonly kind: 'absent-unconfirmed' }
    | {
        readonly kind: 'invalid'
        readonly reason: 'schema' | 'consistency'
        readonly recordDigest: `sha256:${string}`
      }
  readonly archive: CharterRecordArchiveV1
}
```

### 8.5 Archive 校验

Host 必须重新执行全部检查，不能相信浏览器预览：

1. archive strict schema 和 format version；
2. `payloadDigest`；
3. `source.sessionId === request.sessionId`；
4. 从 record 重算的 record digest、revision、lifecycle 与 `source` 一致，且 source health 为 healthy；
5. `charterRecordSchema`；
6. `assertRecordConsistency()`；
7. record identity 与 live Session 完全相同；
8. archive 和请求不超过 `maxRecoveryBytes`；
9. record 内 revision、history、recentMutations、recentMaintenance 和两个 snapshot digest 自洽。

不提供“忽略 lifecycle”“导入到当前 Session”“强制覆盖”选项。

### 8.6 目标 CAS 与写入

进入 per-Session queue 后重新检查目标：

- 目标仍 absent，且请求预期 absent：允许 `put()`；
- 目标仍是同 digest、同原因且 `recoverable: true` 的 invalid：允许替换；
- 当前 record 已有同 operation id、同 request digest 的维护回执：返回 `ok: true, replayed: true`，即使之后已有普通 edit；
- 目标变成健康记录、digest 改变、lifecycle 改变或状态与预期不同：返回 `RECORD_CONFLICT`；
- schema-invalid 目标使用完整 raw digest 做 CAS，不能只比较 revision；
- 保留 archive 中的 current revision、history 和 mutation receipts，不额外加 revision，也不伪造 Charter history；只追加独立的 maintenance receipt；
- durability 成功后才更新内存并发布 view。

恢复不支持健康记录，因此不会把 ready revision 从高值回退到低值。现有 client revision 单调过滤可以保留，只需把 `recordState` 纳入 view 去重。

### 8.7 错误码

新增五个确定性业务码：

```text
INITIALIZATION_REQUIRED
INVALID_ARCHIVE
RECORD_CONFLICT
OPERATION_ID_REUSED
RECOVERY_UNSUPPORTED
```

- `INITIALIZATION_REQUIRED`：普通 edit 遇到 absent-unconfirmed；
- `INVALID_ARCHIVE`：格式、digest、record consistency 或 identity 校验失败；
- `RECORD_CONFLICT`：用户预览后目标记录发生变化，或目标已健康。
- `OPERATION_ID_REUSED`：同 operation id 被用于不同维护请求；
- `RECOVERY_UNSUPPORTED`：当前 DSH 没有安全执行维护 Remote 所需的 principal/resource enforcement。

这些业务码都是确定性结果，客户端收到后结束当前 attempt。storage reject 返回 `UNAVAILABLE` 并携带 `write-uncertain` view，结果按未知处理。replay success 返回 receipt 中原来的 result revision/state digest 和当前权威 view，与普通 edit replay 的“原结果 + 当前 view”语义一致。

## 9. 客户端状态与 UI

### 9.1 共用 attempt 状态机

现有 `DraftAttempt` 扩展为判别联合：

```ts
type DraftAttempt =
  | EditAttempt
  | BootstrapAttempt
  | InitializeAttempt
  | RestoreAttempt
```

规则不变：

- 同一 Session 同时最多一个持久请求；
- edit/bootstrap outcome unknown 时，initialize/restore 禁用；
- initialize/restore outcome unknown 时，所有会改变请求内容的操作锁定；
- Retry 原样重发 operation id、lifecycle、target digest 和 archive；
- watch 先到达成功 view，不能自行清除 unknown attempt；
- Host 通过 record 内的 maintenance receipt 识别 replay；
- 只有成功、确定性业务错误或用户显式 Abandon 才清除；
- lifecycle 变化不改写旧请求，重试由 Host 返回确定性的 `LIFECYCLE_MISMATCH` 并结束 attempt。

Client 不能再用“业务方法抛错”统一判断 unknown。它通过 `remoteErrorOf()` 按 RemoteError code 分类：

- Charter 成功或确定性业务码：结果已知；
- `remote-access/denied`、`gateway/arguments-invalid`、`gateway/input-invalid`、method/service/definition unavailable 等明确发生在业务方法前的错误：确定未执行，结束 attempt；
- `gateway/internal`、`gateway/cancelled`、`gateway/result-invalid`、carrier failure、连接代次变化以及无法识别的装配异常：可能已执行，保留 exact request；
- `UNAVAILABLE`：保守按可能已执行处理。

具体 allowlist 以各支持 DSH 版本的公开错误契约为准，并由版本矩阵测试锁定；不能按 message 或 `instanceof` 分类。

### 9.2 新 section

Pane 增加“存储与恢复”section，放在“上下文”之后。内容分为三块：

1. **记录状态**：health、revision、lifecycle、record digest 短前缀、over-budget 状态。
2. **导出**：下载当前 raw record 的 archive，并显示敏感数据提示。
3. **恢复**：选择 JSON、显示本地预检、确认目标状态、执行恢复或空初始化。

`statusMessage()` 改为对 `recordState` 做 exhaustive switch，不再搜索 `view.message` 中的 `read-only`、`corrupt` 或 `storage` 字样。

### 9.3 恢复预览

选择文件后，客户端只做早期反馈：

- JSON 和 archive schema 是否可解析；
- source Session、revision、export time、health 和 digest；
- source Session/lifecycle 是否明显不匹配；
- 文件是否超过 `maxRecoveryBytes`。

这些检查不能替代 Host 校验。文件内容、文件名、展开状态和第一次确认只属于 Pane UI，不写入 Charter draft；用户第二次确认并发出请求后，完整 request 才进入持久 attempt。

### 9.4 操作准入

initialize/restore 只有在以下条件同时成立时启用：

- source 已连接；
- 当前 Session live；
- 没有 in-flight 或 unknown attempt；
- 没有 staged ops、打开的 editor 或已审阅 history draft；
- view lifecycle 与请求一致；
- target state 与操作类型匹配；
- archive 本地预检通过。

Store 和 Pane 必须共用一个纯准入函数，不能各自维护条件。

## 10. 兼容与升级

### 10.1 持久记录

- `recordSchemaVersion` 保持 1，新增 optional `recentMaintenance`；
- domain 仍是 `dsh_charter_v1`；
- 现有健康记录不重写；
- 不在启动时批量 canonicalize；
- 不创建 v2，不长期双写。

这是升级可读兼容，不是 rc.2 回退兼容。rc.2 的顶层 record schema 是 strict；某个 Session 一旦由 rc.3 写入 `recentMaintenance`，降级到 rc.2 后会把它隔离为 schema-invalid，停止注入和编辑，但保留原始记录。重新升级 rc.3 即可读取。未执行维护操作、没有该字段的记录仍可由 rc.2 使用。发布说明和第一次 initialize/restore 确认必须提示这一点；若未来把“降级后继续可用”设为要求，需要新 domain 和 side-by-side copy，而不是提高同名 record/domain version。

### 10.2 从 rc.2 升级

| rc.2 状态 | rc.3 行为 |
| --- | --- |
| 有健康 record | 原样读取，自动获得 record digest；下次维护操作才写 optional receipt |
| 有内部 schema-invalid record | 保持隔离，可做诊断导出或受控恢复 |
| 有 consistency-invalid record | 保持隔离，可做诊断导出或受控恢复 |
| resume Session 无 record | 显示 absent-unconfirmed，不再自动创建 |
| 新 startup Session 无 record | 按 source contract 创建空 root 或 fork |
| fork child resume 时无 record | 不重新 fork，要求恢复或显式空初始化 |
| 外层文件不可读 | backend 仍显示 absent，但 rc.3 不在恢复路径自动覆盖 |

升级不需要 migration CLI。导出格式是备份协议，不是第二种持久化正本。

### 10.3 DSH 版本

rc.3 先保持当前五个精确 peer 版本。普通 Charter 功能继续按现有矩阵运行；record maintenance 只在 `0.2.1-rc.1`/`rc.2` 启用。旧版本必须自动显示 capability unavailable，并证明维护调用在深度解析 archive 或访问 storage 前 fail closed。若 source 事件或 wire codec 在某个版本无法满足基础协议，应删除该版本支持，而不是加入第二套实现。

## 11. 安全与隐私

- export/initialize/restore 不暴露为模型 tool；
- 三个操作在 DSH 0.2.1+ 只允许 owner；旧 DSH 上完全禁用；
- 所有 Remote 方法声明 Session resource；
- archive 含用户正文，默认文件权限和保存位置由浏览器/操作系统负责，文档要求用户按敏感文件管理；
- Host 和 client 日志不得输出 archive、objective、item text 或 history 正文；
- payload digest 只检查完整性，不提供来源认证；
- owner 是本功能的信任边界：能手工构造 record 并重算公开 digest 的 owner 可以制作可通过校验的 archive；rc.3 不把 archive 当成签名凭证；
- restore 不接受 URL、Host 文件路径或远程下载，只接受用户本地选择的 JSON；
- 不支持跨 lifecycle 强制导入；
- absent 空初始化和 invalid restore 都需要二次确认；
- UI 必须提示：outer unreadable 时，覆盖前若需保留原始字节，应先停止 Host 并按运维文档备份。

## 12. 自动测试方案

### 12.1 Core

新增测试：

- archive strict schema 和 version；
- payload digest round-trip；
- record 任一字段、source 或 exportedAt 改动后 digest 失败；
- healthy record export 后重新 parse 和 consistency check；
- schema-invalid/consistency-invalid archive 只能诊断，不能恢复；
- archive identity、Session id 和 lifecycle 不匹配；
- oversized archive；
- raw record digest 覆盖 identity、history、recentMutations 和 recentMaintenance，不只 current；
- envelope 派生字段与 record 不一致时拒绝，即使 payload digest 已重算；
- maintenance receipt 的 replay、id reuse、裁剪和 restore 后再 edit。
- rc.3 写入 receipt 后用 rc.2 schema 重读会安全隔离，升级回 rc.3 后恢复；
- `maxRecoveryBytes` 出现在 View limits，最终 record 追加 receipt 后越界会被拒绝。

### 12.2 Host 与真实 JSON backend

新增场景：

1. `resume + absent` 不写文件，view 为 absent-unconfirmed；
2. malformed outer JSON 在 resume 后字节和 hash 保持不变；
3. rejected wrapper version 在 resume 后保持不变；
4. startup 新 Session 仍能初始化；
5. resumed fork child 缺记录时不从 parent 重新 fork；
6. explicit initialize 只对 absent 生效；
7. invalid target export 后可用健康 archive 恢复；
8. healthy target restore 被拒绝且文件不变；
9. lifecycle mismatch restore 被拒绝；
10. restore response 重试通过 maintenance receipt 返回 replayed；
11. restore 已提交、响应丢失、随后普通 edit，再重试仍能在回执窗口内确认原结果；
12. restore 与 edit/initialize 并发时，队列只允许一个合法顺序；
13. restore 后 prompt、`charter_read`、watch 和 storage digest 一致；
14. over-budget archive 可以恢复，但不会注入；
15. domain 打开延迟期间创建新 Agent，权威 startup 不会被 reattach/unknown 吞掉。

### 12.3 Scripted storage fault backend

测试目录新增一个不进入发布包的 backend，可按调用次序控制：

```text
open: pass | reject | defer
loadAll: pass | reject | defer
putRecord[n]: pass | reject | defer | commit-then-reject
deleteRecord[n]: pass | reject | defer
close: pass | defer
```

必须证明：

- domain open/load 失败不会生成空记录；
- startup initial put 失败不发布 ready；
- transform/callback 内的 `CharterError`、`MutationReplay`、`RevisionConflict` 和 `DomainError(missing-key|closed)` 是已知写前结果，不进入 write-uncertain；
- callback 已成功产生 next 后发生的 backend reject 不发布待写入内容，并把目标 Session 标为 write-uncertain；`put()` 对除已知 preflight DomainError 外的 reject 采用同样规则；
- commit-then-reject 模拟 rename 后 fsync 失败：domain memory 保持旧值、介质可能是新值、目标 Session 被隔离；重启后从介质收敛；
- deferred write resolve 前不提前发布；
- close 等待已准入写入并拒绝新写；
- 一个 Session 的 write-uncertain 不会把其他 Session 的 read/prompt 一起禁用；
- Remote/client 另行模拟“业务成功但响应丢失”，验证 maintenance receipt replay。

### 12.4 Remote 与 watch

- descriptor 数量从 3 增至 6；
- 三个新方法的 strict codec 和 Session resource；
- 0.2.1 owner enforcement；0.1.7/0.2.0 maintenance fail-closed；restore outer codec 与 deep archive parse 的顺序有真实 Gateway 测试；
- `recordState` 变化即使 revision、promptDigest 不变也必须发布 changed；
- record digest 变化必须发布；
- 仅 recentMaintenance 或 capability 变化，即使 revision、promptDigest 不变也必须发布；
- legacy Host frame 默认到 unknown/legacy-host；
- archive/request 中未知字段被拒绝；
- 新错误码完成 wire round-trip。

### 12.5 Client

- UI 不再通过 message substring 分类；
- edit/bootstrap unknown 时恢复禁用；
- restore unknown 后 exact request 保留；
- stream-first success 不 half-clean attempt；
- repeated UNAVAILABLE 继续保留请求；
- pre-dispatch RemoteError 结束 attempt，可能 post-dispatch 的 RemoteError 保留 attempt；
- replay success 清理 attempt；
- INVALID_ARCHIVE/RECORD_CONFLICT 清理 attempt并解锁；
- lifecycle 变化不把 archive改写到新 lifecycle；
- record section 在窄屏、明暗主题和键盘操作下可用；
- diagnostic export、健康 export、absent 初始化和 restore 二次确认均有组件测试。

### 12.6 最终 tarball

release workflow 只打包一次，后续任务下载同一 artifact：

1. 校验 SHA-256；
2. 运行现有 exact-artifact package smoke；
3. 从 tarball 安装 Host/Remote/client；
4. 用 packed `CharterService` 跑 storage fault smoke；
5. 建立含 Unicode、pending、archived、superseded 和 history 的记录；
6. 导出、删除测试目标、以相同 Session identity 恢复；
7. 重启两次，比较 record digest、state digest、prompt digest 和 tool projection；
8. 验证健康目标不能被旧 archive 覆盖；
9. 最低和最高支持 DSH 版本至少各跑一次 fresh profile；
10. GitHub Release 和 npm publish 复用同一 tarball，不再 pack。

真实模型 compaction 继续作为人工发布证据，不进入普通 PR CI。

## 13. 发布阻塞验收

以下条件全部满足才能发布 rc.3：

| ID | 验收条件 |
| --- | --- |
| RC3-01 | resume/reattach 的 absent record 不发生 `put()` |
| RC3-02 | malformed/version-rejected 文件在 Host 启动、view、edit 尝试后字节不变 |
| RC3-03 | resumed fork child 不从 parent 重新构造 |
| RC3-04 | export 包含完整 record；restore receipt 绑定 archive record digest，恢复后的 current/history/mutations 与 archive 一致 |
| RC3-05 | restore 只接受同 Session、同 lifecycle、结构与一致性有效的 archive |
| RC3-06 | healthy target、变化后的 invalid target和 lifecycle mismatch 均拒绝覆盖 |
| RC3-07 | initialize/restore 的未知结果在有界 maintenance receipt 窗口内可精确重试，含 restore 后再 edit 的场景 |
| RC3-08 | storage reject 不发布待写内容；目标进入 write-uncertain；commit-then-reject 后重启能从介质和回执收敛 |
| RC3-09 | watch/client 不会漏掉同 revision 的 recordState 或 digest 变化 |
| RC3-10 | Node 22.19/24、五个 DSH 精确版本的基础检查通过；maintenance 在 0.2.1 启用、旧版本 fail closed |
| RC3-11 | 最终 `.tgz` 的 export/restore/fault smoke 通过 |
| RC3-12 | 中英文 README、设计、用户指南、验证记录、changelog 和发布清单同步 |
| RC3-13 | 写入 recentMaintenance 后降级 rc.2 会安全隔离且不覆盖；重新升级 rc.3 可恢复读取 |

## 14. 实施顺序

### 阶段 A：纯类型与检查

- 提取 `charterIdentitySchema`，增加 optional maintenance receipt schema；
- 增加 record digest、`CharterRecordState` 和 archive schema；
- 定义 maintenanceLimit、独立 restore admission 和 receipt consistency；
- 增加 archive 校验和 restore plan 纯函数；
- 完成 core 单测。

### 阶段 B：Host 安全边界

- sessions table 恢复为 `KvTable<SessionId, unknown>`；
- 集中 stored-record inspection；
- source-aware 初始化；
- source intent coalescing 和 startup/reattach 竞态处理；
- per-Session mutation queue；
- write-uncertain Session fence；
- 删除 edit 的隐式 startup 初始化；
- 增加 export/initialize/restore service 方法；
- 完成真实 JSON 和 fault backend 测试。

### 阶段 C：Remote 与客户端

- wire 和 contribution 扩展到六个方法；
- watch/client dedupe 纳入 recordState；
- attempt 联合加入 initialize/restore；
- 增加“存储与恢复”section、双语文案和响应式样式；
- 完成 Remote、store、draft 和 Pane 测试。

### 阶段 D：产物与发布

- 更新 remote/client/package smoke；
- 增加消费最终 artifact 的 release workflow；
- 跑五版本兼容矩阵；
- 更新用户指南、验证记录、changelog 和发布说明；
- 产出唯一 tarball 和 SHA-256；
- 完成人工真实 profile 和 compaction 复核。

## 15. 主要改动位置

预计修改：

```text
src/core/schemas.ts
src/core/errors.ts
src/core/digest.ts
src/core/record.ts
src/host/types.ts
src/host/service.ts
src/remote/wire.ts
src/remote/service.ts
src/remote/contribution.ts
src/remote/watch.ts
src/client/store.ts
src/client/draft-store.ts
src/client/CharterPane.tsx
src/client/locales.ts
src/client/charter.css
tests/core/*
tests/host/*
tests/client/*
scripts/verify/*
.github/workflows/*
```

不修改：

- `charter:standing` prompt 格式；
- `charter_read` 模型工具语义；
- item/review/lifecycle/progress 数据模型；
- compaction summary bootstrap 解析规则；
- 现有字段的 JSON 结构；rc.3 只增加 optional `recentMaintenance`。

## 16. rc.3 完成后的产品边界

rc.3 发布后，可以准确承诺：

> 已有 Session 恢复时，如果 Charter record 没有被 storage 正常加载，插件不会自动用空记录或当前 parent 状态替换它。用户可以导出完整记录，并把有效备份恢复到同一个 Session lifecycle。成功响应只在持久化完成后返回；底层写入结果不确定时会隔离该 Session，并要求重启后核对介质。

仍需保留的限制说明：

> 当前 DSH per-record storage API 不暴露单条外层文件的读取错误。插件只能把这种情况标记为“缺失或不可读”，不能自动取回原始字节。没有备份时，应停止 Host 后按运维指南修复或恢复 storage 文件。
