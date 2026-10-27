# `dsh-charter` 0.1.0-rc.5 稳定化方案

[English](rc5-stabilization-plan.md) | 中文

方案日期：2026-10-27。目标版本：`0.1.0-rc.5`。

## 1. 版本说明

`0.1.0-rc.4` 已作为 DSH `0.2.1-rc.3` / `0.2.1-rc.4` 兼容性补丁发布到 GitHub 和 npm，tag、Release 和 npm 版本均不可修改。原拟纳入 rc.4 的审阅、交互和稳定版门禁修复顺延到 rc.5。

rc.5 是 `0.1.0` stable 前的产品正确性和发布硬化版本。它不增加 proposal provenance、validator、查询面、record v2 或新的信息架构；这些能力仍属于 0.2.0。

## 2. 问题清单

| ID | 优先级 | 问题 | 风险 |
| --- | --- | --- | --- |
| RC5-01 | P0 | 历史草案隐藏候选默认选中，Apply 会提交未展示内容 | 违反强制人工审阅承诺 |
| RC5-02 | P0 | 未来 `recordSchemaVersion` 被当成可恢复损坏，旧归档可覆盖 | 降级后可能破坏未来版本正本 |
| RC5-03 | P0 | 普通 Discard 同时清空暂存、编辑器和未暂存输入 | 本地输入无确认丢失 |
| RC5-04 | P1 | committed/projected 状态混用，空状态和 Apply 禁用原因不清楚 | 状态误导、操作困难 |
| RC5-05 | P1 | archive preview 用字符数而不是 UTF-8 字节数 | 中文/emoji 与 Host 准入不一致 |
| RC5-06 | P1 | 错误详情、连接分类、ARIA 和移动端触控不足 | 故障不可诊断、无障碍和触屏体验差 |
| RC5-07 | P0 | compatibility manifest 缺 rc.3/rc.4；缺真实 Gateway 与浏览器恢复证据 | 声明、打包元数据和安全证据不一致 |
| RC5-08 | P1 | 发布依赖本地矩阵和人工多次打包 | 发布产物缺少可重复来源证明 |

## 3. RC5-01：历史草案必须显式审阅

### 3.1 当前问题

- `CharterDraft` 接收 bootstrap proposal 后把所有候选设为 `selected: true`。
- Pane 初始只展示前 40 条。
- “全选”作用于全部候选，不只当前显示项。
- planner 遍历全部 selected candidate，因此隐藏候选也会进入请求。
- `visibleCandidates` 是 Pane 本地状态；切换页面或重新挂载后回到 40，之前选中的后续内容可能再次隐藏。
- checkbox 和 textarea 位于同一个 `<label>` 中。

### 3.2 Store 设计

在 `CharterDraftState` 增加：

```ts
readonly bootstrapVisibleCount: number
```

默认值为 40。新 proposal、完整 cleanup 和 Session lifecycle 重置时回到 40；普通 section 切换和 Pane 卸载不重置。

新增：

```ts
showMoreBootstrapCandidates(batchSize?: number): void
setVisibleBootstrapSelected(selected: boolean): void
```

规则：

- candidate 初始全部 `selected: false`。
- `showMoreBootstrapCandidates()` 使用 `min(total, current + 40)`。
- `setVisibleBootstrapSelected()` 只修改 index `< bootstrapVisibleCount` 的条目。
- saving、maintenance saving 或任何 unknown attempt 存在时，两者均 no-op。
- fresh `bootstrapPlan()` 和文本校验只接收当前可见窗口，形成纵深保护。
- replay 路径仍优先发送 retained request，不重新规划。
- 删除可以修改全部隐藏项的 `setAllBootstrapSelected()` 入口。

### 3.3 Pane 设计

- 移除 Pane 本地 `visibleCandidates`，读取 store 中的 visible count。
- 顶部显示：`共 N 条 · 已显示 M 条 · 已选择 K 条`。
- “全选”改为“选择当前显示的 M 条”；清空选择同样只作用于当前显示项。
- “显示更多”显示下一批数量。
- 先保持 invariant-first、deliverable-second 的稳定顺序，再截取一个全局窗口；不能让每个分组各显示 40 条。
- invariant 和 deliverable 使用独立分组标题与数量。
- 候选行改为普通 `<div>`；checkbox 和 textarea 分别使用 `id`/`htmlFor`。用 `useId()` 生成 Pane 实例前缀。
- 成功 Apply 后结束本次 review；未选择候选不写入 Charter、不转成 pending，并随本次 review cleanup 丢弃。若要跨提交保留未选项，必须进入 0.2 Proposal Inbox 设计，rc.5 不新增这套生命周期。

### 3.4 验收

- 41、80、100 条候选初始均为未选。
- 只选择前 40 条时，请求没有 index 40 之后的 item op。
- “选择当前显示”不修改隐藏项。
- 展开到 80、选择第 60 条、切换 section 或重新挂载后，第 60 条仍可见。
- 未选择的非法或超长文本不阻止 Apply；选中后按现有规则阻止。
- budget overflow 仍将明确选中的候选转成 pending，不丢弃或截断。
- unknown replay 的 mutation id、base revision 和 ops 逐字段不变。

## 4. RC5-02：未来 schema 只读围栏

### 4.1 当前风险

strict schema 解析未来 record 失败后，Host 会宽松读取 identity。只要 identity 匹配，就得到：

```ts
{ kind: 'invalid', reason: 'schema', recoverable: true }
```

restore 随后允许健康 v1 archive 覆盖它。未来 0.2 写入 v2 后，降级到 rc.4 并点击恢复可能破坏 v2 正本。

### 4.2 状态模型

保留 `kind: 'invalid'`，扩展 reason：

```ts
type InvalidRecordState =
  | {
      kind: 'invalid'
      reason: 'schema' | 'consistency'
      recoverable: boolean
      recordDigest: Sha256Digest
      observedRevision?: number
    }
  | {
      kind: 'invalid'
      reason: 'future-schema'
      recoverable: false
      recordDigest: Sha256Digest
      observedRevision?: number
    }
```

Core 增加并复用：

```ts
export const CHARTER_RECORD_SCHEMA_VERSION = 1 as const
```

rc.5 仍写 version 1，不增加持久字段，不改 domain/version。

Wire 使用判别联合或 refinement，强制 `reason:'future-schema'` 时 `recoverable` 必须是字面量 `false`。restore request 仍只接受 `schema | consistency`。

### 4.3 Host 判定与围栏

新增宽松版本读取，只接受有限整数。strict parse 失败后：

1. `recordSchemaVersion > current`：返回 `future-schema / recoverable:false`。
2. 其他失败继续使用现有 loose identity 规则。
3. 字符串 `"2"`、小数、缺失、负数和当前版本其他损坏都不是 future schema。

future 判定优先于 loose identity mismatch。`inspectionOf()` 与 non-live `viewById()` 共用 helper。

写入规则：

- prompt 和 `charter_read` fail closed。
- edit 返回 `UNAVAILABLE`，说明需要升级插件。
- initialize 返回 `RECORD_CONFLICT`。
- restore 在 CAS 前显式拒绝；旧 client 即使提交 `reason:'schema'` 和正确 digest 也不能写。
- restore request schema 不加入 `future-schema`，它不是合法恢复目标。
- 不增加错误码或 Remote 方法。

### 4.4 导出与 UI

- 允许 diagnostic export；archive health 继续写 `schema-invalid`，保持 archive format v1。
- archive 保留完整 raw record、digest 和宽松观察到的 revision。
- UI 显示“由更新版本写入，请升级插件”，不称为一般损坏。
- Export 可用；Initialize 和 Restore 不显示或禁用。
- maintenance admission 显式返回 `futureSchema`，不能只依赖 Pane 隐藏按钮。

Host/client bundle 短暂错配的边界：rc.4 client 的 strict wire 不认识 `future-schema`，因此新 Host 发出该状态时旧 client 会 fail closed 并要求刷新，错配期不保证显示诊断导出 UI；Host 写围栏始终生效。rc.5 client 读取旧 Host 继续沿用现有默认兼容。此版本不引入第二套 wire 或协议协商。

### 4.5 验收

- v2 + matching/mismatched/missing identity 都得到 `future-schema / false`。
- 普通 v1 schema-invalid 的 recoverable 规则不回归。
- edit、initialize、restore、prompt、tool 均不能写入或读取 future record。
- diagnostic export 深度等于 raw record，digest 正确。
- 所有尝试后真实 JSON 文件逐字节不变。
- queue race：preview 后目标变成 future record，队列内重读后拒绝。
- 测试用模拟 v2 schema 能重新解析保留的原始 bytes。

## 5. RC5-03：拆分丢弃与暂存操作

### 5.1 Store API

删除 `discard(force)`，改为：

```ts
type ComposerKind = 'invariant' | 'deliverable'

interface LocalDraftWorkSummary {
  stagedOps: number
  editorOpen: boolean
  nonEmptyComposers: number
}

discardStaged(): boolean
unstageObjective(): boolean
clearComposer(kind: ComposerKind): boolean
discardAllLocalWork(): boolean
localWorkSummary(): LocalDraftWorkSummary
```

语义：

- `discardStaged()` 只清 ops/base revision，保留 editor 和 composer，并设置 `discarded` feedback。
- `unstageObjective()` 过滤所有 objective op，保留 item ops；剩余为空时清 base revision。
- `clearComposer()` 只清指定输入。
- `closeEditor()` 只关闭 editor。
- `discardAllLocalWork()` 在 Pane 确认后清 ops/editor/composer，不清 bootstrap review。
- saving、bootstrap saving、maintenance saving 或 unknown attempt 时，上述方法全部 no-op。
- 只有 `abandonUnknown()` 可以清 unknown attempt；它继续保留 staged payload。

### 5.2 Pane 交互

- Action bar 使用“丢弃暂存修改”。
- editor 内保留“取消编辑”。
- 每个 composer 在非空时提供“清空输入”。
- objective 卡显示 staged tag 和“取消暂存”。
- staged/editor/composer 任一存在时可选择“丢弃全部本地修改”；第一次点击显示摘要，第二次执行，并提供取消。
- 摘要列出 N 个 staged ops、是否有 editor、N 个非空 composer。

### 5.3 验收

- `discardStaged()` 不清 editor/composer。
- `closeEditor()` 不清 staged ops。
- 两个 composer 可分别清除。
- objective op 可单独撤销，item ops 和 base revision 保持正确。
- full discard 不清 bootstrap payload。
- 分别对 edit、bootstrap、initialize、restore unknown 调用 `discardStaged()`、`discardAllLocalWork()`、`unstageObjective()`、`unstage(item)`、`clearComposer()`、`closeEditor()` 和 ordinary bootstrap dismiss；全部 no-op，完整 retained request 深比较不变。只有确认后的 `abandonUnknown()` 清 attempt。

## 6. RC5-04：区分 committed 与 projected

- revision、Stored、默认 Active 来自 committed `CharterView`。
- 有 staged ops 时单独显示 `After Apply` 数量和预算；数量未变化也显示“有未应用修改”。
- revision 使用中性样式，健康状态单独表达。
- objective staged 直接从 ops 判断，并提供独立 unstage。
- 空 Charter 在 `idle`、`dismissed`、`failed`、`unavailable`、`no-summary`、`not-live` 时都保留主要 CTA；read-only 控件仍禁用。

Pane 新增纯派生 Apply gate：

```ts
type ApplyBlockReason =
  | 'no-changes'
  | 'editor-open'
  | 'revision-conflict'
  | 'quota'
  | 'connection'
  | 'read-only'
  | 'busy'
  | 'stale'
  | 'invalid-text'
```

unknown outcome 不走 fresh gate：按钮切成 Retry，并在 admission 前重放 retained request。Apply 旁始终显示首要原因，并用 `aria-describedby` 关联。

## 7. RC5-05：恢复归档按 UTF-8 字节准入

把 `serialized.length` 改为 `new TextEncoder().encode(serialized).byteLength`。

边界：

- `File.size` 是原文件 bytes，含缩进和空白。
- preview 检查 canonical JSON bytes。
- Host 检查完整 restore request bytes，还包含小型 wrapper 字段。
- 三层都用 UTF-8，但数值不要求相等；Host 是最终权威。
- `crypto.subtle` 不可用时返回明确 `cryptoUnavailable`，Restore 保持禁用。
- `subtle.digest()` reject 同样映射为 `cryptoUnavailable`，不能误报 digest mismatch 或 invalid archive。

测试覆盖 ASCII、中文、emoji、NFC/NFD、恰好等于上限和“字符数未超、UTF-8 bytes 已超”。

## 8. RC5-06：错误、连接、ARIA 与移动端

### 8.1 连接错误

保留 `error: string | null`，增加可选：

```ts
type CharterConnectionErrorKind =
  | 'timeout'
  | 'disconnected'
  | 'host-service-missing'
  | 'runtime-unsupported'
  | 'unknown'
```

按稳定 RemoteError code 分类，不匹配 message 或 `instanceof`。storage failure 继续属于 record state，不归为连接错误。

### 8.2 错误详情

增加小型 `ErrorDetails`：本地化摘要使用 `alert/status`，`state.error`、`view.message`、Draft/Bootstrap/Maintenance detail 放入可展开 `<details>`。React 文本转义，不用 `dangerouslySetInnerHTML`。Action bar 允许换行，不把唯一详情藏在 `title`。

### 8.3 ARIA 与触控

- budget 使用 `role="meter"` 和 value text。
- 两个 composer 使用不同 accessible name。
- TextEditor 接收 objective/invariant/deliverable 具体 label。
- 预算、错误和键盘提示通过 id 接入 `aria-describedby`。
- 空值、非法字符和超预算设置 `aria-invalid`。
- 窄屏或 coarse pointer 下按钮、导航和 select 最小高度 40–44px。
- Apply 使用显式 `.charter-actionbar__primary` 跨列；删除 `:last-child` 规则，防止 Abandon 成为视觉主操作。

## 9. RC5-07：兼容元数据和真实平台证据

### 9.1 Manifest 与矩阵

`engines.dsh` 和 peer ranges 已包含 `0.2.1-rc.3`/`rc.4`，但 `dsh.compatibility.dshReleases` 仍只列五个版本。补齐两项，保证三处集合一致。

新增受版本控制的 compatibility runner：每个版本建立隔离依赖图，执行 typecheck、build、Vitest、remote/client smoke，并输出机器可读 evidence。PR 跑 minimum、old-boundary、current 三个 sentinel；release/nightly 跑七版本。

### 9.2 真实 Gateway

使用真实 `TypertGatewayService`，不能直接调用业务 service：

- owner 普通 edit 成功；
- 获准 user 普通 edit 成功，purge 在业务层 `FORBIDDEN`；
- user 的 export/initialize/restore 均 `FORBIDDEN`；
- cross-Session deny 在 receiver、Session activation 和 storage probe 前发生；
- malformed missing-principal Peer 在业务/storage 前失败；正常现代 Peer 的 principal 是协议必填，不能伪造合法但缺 principal 的连接；
- cancellation 不产生迟到写；
- 在 DSH `0.2.1-rc.3` 和 `rc.4` 均运行。

### 9.3 真实浏览器恢复

使用同一 release tarball 安装 DSH `0.2.1-rc.4` Web profile：

1. 创建含中文、emoji 的 Charter 并 Apply。
2. 点击 Export，捕获真实 download。
3. healthy target 选择文件，WebCrypto preview 通过但 Restore 不可用。
4. 停 Host，删除测试 record，重启并确认 absent-unconfirmed。
5. 用真实 file chooser 上传归档，两次确认恢复。
6. reload 和第二次 Host restart 后比较 revision、objective、items、digest。
7. 确认健康目标不能覆盖，storage bytes 不变。
8. 覆盖 UTF-8 上限、长错误详情、320/375/390px、中英文、键盘和至少一种 screen reader。

Desktop 重启后的 tab/tool ABI 和真实模型 compaction 仍是人工门禁。

## 10. RC5-08：一次打包的发布流水线

### 10.1 Candidate

新增 `release-candidate.yml`：

```text
source-gates
compat-matrix
pack（唯一 npm pack）
exact-artifact
packed-recovery
gateway-matrix
profile-matrix
browser-evidence
candidate-summary
```

source gate 不运行普通模式 `npm run smoke:package`，因为该命令会自行 build/pack。`pack` 是唯一 producer，输出 tarball、`SHA256SUMS` 和 `release-metadata.json`。后续 job 只下载同一 artifact ID，并以 `--artifact/--sha256` exact 模式运行 package smoke；不得重新 pack 或从 registry 代替。

### 10.2 Promotion

新增受保护环境的 `release-promote.yml`：

1. Candidate 记录打包来源 commit `C`、workflow run、artifact ID 和 SHA。
2. Candidate 全绿后，操作者只更新仓库根 `SHA256SUMS`，形成 release commit `C+1`；该文件不在 npm `files` 白名单内。
3. Promotion 下载 candidate artifact，校验 `C+1` 相对 `C` 只修改根 `SHA256SUMS`，不允许 `docs/**` 或其他包内 evidence 差异。
4. 校验 tracked digest、artifact digest、版本和 metadata 一致，复跑 exact-artifact，不 build、不 pack。
5. tag 指向 `C+1`；release metadata 同时记录 C、C+1、workflow run/artifact ID 和 tarball SHA。
6. 创建 GitHub Release，并 `npm publish <tgz> --tag next`，禁止目录 publish。
7. `next` 和 `latest` 都指向最新 RC；stable 发布时才把 `latest` 指向 stable。禁止把 `next`/`latest` 回退到旧 RC。
8. 回读 registry exact version、dist-tags 和 tarball digest。

已发布 RC 不移动 tag、不重建同版本。

## 11. 实施顺序

1. future-schema 围栏及降级字节测试。
2. bootstrap visible-only selection 和 41/80/100 测试。
3. discard API 拆分及 unknown-outcome 不变量。
4. committed/projected、objective staged、empty CTA、Apply reason。
5. UTF-8 preview、crypto unavailable、错误详情、连接分类、ARIA、触控 CSS。
6. compatibility manifest 和受版本控制矩阵。
7. Gateway、profile、browser 测试。
8. pack-once candidate/promotion workflow。
9. 版本、changelog、verification、release docs 和最终产物。

版本号、lockfile 和发布文案在功能与门禁冻结后统一切到 rc.5，避免开发中反复改发布元数据。

## 12. 测试矩阵

```text
Client: bootstrap-plan, draft-store, archive-preview, store
Pane: pane-workflow, pane-recovery, pane-hooks, locales
Host: recovery, composition, remote, watch
Gateway: authorization
Platform: 七版本 matrix, exact artifact, packed recovery, profile, browser
Manual: Desktop ABI, real-model compaction
```

## 13. 发布阻塞验收

| ID | 验收条件 |
| --- | --- |
| RC5-A | fresh bootstrap request 不包含未展示或未明确选择的 candidate |
| RC5-B | future schema 只读保留，所有写入口拒绝，真实文件 bytes 不变 |
| RC5-C | 普通 discard 不清 editor/composer，unknown evidence 只能显式 Abandon |
| RC5-D | committed/projected、objective staged、empty CTA、Apply reason 均有 Pane 测试 |
| RC5-E | archive preview、File、Host 均使用 UTF-8 byte 单位并遵守各自载荷边界，crypto 不可用或 digest reject 时 fail closed |
| RC5-F | error detail、connection kind、ARIA、移动触控通过 |
| RC5-G | engines、peer ranges、compatibility map 与七版本矩阵一致 |
| RC5-H | 真实 Gateway owner/user/resource 顺序通过 rc.3/rc.4 |
| RC5-I | 同一 tarball 完成 browser export→absent→restore→restart |
| RC5-J | 只有 producer 调用一次 `npm pack`；C→C+1 只改根校验和；所有发布字节 digest 一致 |
| RC5-K | 中英文文档、版本、测试数、rc.4 历史和 rc.5 release notes 一致 |

## 14. 明确不做

- 不新增 `CharterOp`、Remote 方法、模型工具或 item kind。
- 不增加 provenance、evidence、validity、validator 或持久 schema version。
- 不创建新 domain。
- 不实现搜索、分页、批量审阅或 Review Center。
- 不重构整个 Pane/store 架构。
- 不解决多 Host 写入或上游 outer JSON missing/unreadable 限制。
- 不重写兼容性 rc.4 的历史，只追加 rc.5 记录。

这些内容继续留在 0.2.0 路线。

## 15. 预计改动文件

运行时代码：

```text
src/core/schemas.ts
src/core/record.ts
src/host/types.ts
src/host/service.ts
src/remote/wire.ts
src/client/archive-preview.ts
src/client/remote-error.ts
src/client/store.ts
src/client/draft-store.ts
src/client/CharterPane.tsx
src/client/locales.ts
src/client/charter.css
```

测试与发布：

```text
tests/client/archive-preview.spec.ts
tests/client/bootstrap-plan.spec.ts
tests/client/draft-store.spec.ts
tests/client/store.spec.ts
tests/client/pane-workflow.spec.tsx
tests/client/pane-recovery.spec.tsx
tests/host/recovery.spec.ts
tests/host/composition.spec.ts
tests/host/remote.spec.ts
tests/gateway/authorization.spec.ts
tests/browser/recovery.spec.ts
scripts/verify/compat-matrix.mjs
scripts/verify/profile-smoke.mjs
.github/workflows/release-candidate.yml
.github/workflows/release-promote.yml
docs/release-notes/0.1.0-rc.5.md
```
