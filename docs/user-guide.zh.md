# `dsh-charter` 使用与运维指南

[English](user-guide.md) | 中文

本文面向安装和使用插件的用户。设计约束见[设计规格](design/charter-design.zh.md)，版本差异见
[兼容矩阵](design/compatibility.zh.md)。

## 1. 安装前检查

```bash
dsh --version                  # 需要 >= 0.1.7-rc.2；推荐 0.2.0-rc.1+
node --version                 # ^22.19.0 || >=24.0.0
dsh --profile web --dump-config | grep -n "charter" || true
```

如果 profile 是 Web 或 Desktop，插件会注册：

- Host 服务 `charter`；
- Remote 服务 `charterRemote`（namespace `charter`）；
- 只读工具 `charter_read`；
- 浏览器侧 `dsh-charter/client.js` 和会话头部的「会话契约」/「Charter」标签页。

## 2. 安装

> **安装渠道。** 维护者发布 `next` dist-tag 后，可按精确版本或 tag 安装；如果 registry 中还没有列出该 tag，
> 请使用从本 checkout 构建并验证过的本地 tarball。

### 2.1 环境要求

- DSH：只支持[兼容矩阵](design/compatibility.zh.md)中列出的版本（`0.1.7-rc.2`、`0.2.0-rc.1`/`rc.2`、
  `0.2.1-rc.1`/`rc.2`）。在扩展矩阵前不声明支持更新的 stable/RC 版本；完整 per-Peer Remote 资源授权要求
  `0.2.1+`。
- Node.js **`^22.19.0 || >=24.0.0`**。
- Web 或 Desktop profile。

### 2.2 离线 / 本地 tarball 回退

```bash
npm install
npm run build
npm pack
dsh plugin --profile web add ./dsh-charter-0.1.0-rc.2.tgz
```

Desktop 若支持本地插件导入，可在 Plugins 页面安装同一个 tarball；否则通过 Desktop profile 自己的包管理器
安装（`dsh plugin --profile desktop` 会被 Electron app 拒绝）。profile 依赖是本地 `file:` 路径。registry 可达时
优先使用 §2.3 的 npm 安装。

### 2.3 npm / Registry 安装（推荐）— Web profile 按版本或 tag

```bash
dsh plugin --profile web add dsh-charter@0.1.0-rc.2   # 精确版本：可复现
dsh plugin --profile web add dsh-charter@next         # 最新预发布
```

`0.1.0-rc.2` 是 `next` dist-tag 下的当前预发布。按当前渠道策略，稳定版出现前 `latest` 也会指向最新 RC（npm
会保留 `latest` tag，由我们决定其指向；这是我们的策略，不是 npm 的强制要求）。预发布安装请使用精确版本或
`@next`；只有 registry 不可达时才使用上面的离线 tarball 回退。固定明确版本可以让 profile 可复现。

重启 `dsh web`，或让 HMR 重新组合 profile，然后刷新页面。profile 的 `package.json` 会增加依赖和 bundle
选择：

```json
{
  "dependencies": { "dsh-charter": "0.1.0-rc.2" },
  "dsh": { "profile": { "bundles": ["...", "dsh-charter"] } }
}
```

安装时 pnpm 可能提示缺少 `@deepseek-ai/dsh-*` peer。这些包由 DSH 运行时提供，不需要装进 profile；以 DSH 的
peer 兼容检查结果为准。

### 2.4 Registry 渠道 — Desktop Plugins

如果你的 Desktop 版本已接入公开插件目录，且包已发布到该目录，打开 **Desktop → Plugins**，搜索
**`dsh-charter`**，点击 **Install**。已安装时点击 **Update**；Desktop 管理插件生命周期并热更新 bundle。
否则使用 tarball 路径。

### 2.5 源码开发

源码改动可以链接 checkout 并重新构建：

```bash
dsh plugin --profile web add "$(pwd)"
npm run build
```

浏览器入口是构建产物，不能直接运行 TypeScript 源码。开发流程见 [CONTRIBUTING.zh.md](../CONTRIBUTING.zh.md)。
不要把源码链接当作普通用户的安装方式。

## 3. 首次使用

新会话的会话契约**默认为空**。插件不会自动把目标或约束写入有效记录；在你设置目标或添加条目之前，模型看不到任何
会话契约上下文。这是刻意设计：只有用户确认的内容才会生效。

如果已有 Session 触发过压缩、且会话契约为空，「会话契约」标签页会自动显示从最近一次可用压缩摘要抽取的**历史草案**（若最新摘要无法产出候选，会回退到更旧的可用摘要）。
检查/编辑草案后点击**应用草案**即可生效。草案本身不会进入 prompt，也不会调用模型。没有压缩摘要的 Session
保持普通空状态。

1. 打开任意已开始的会话，会话头部会依次出现「对话」「轨迹」「会话契约」。若没有「会话契约」，先确认 profile 的
   boot graph 包含 `dsh-charter/client.js`，并确认会话不是空白 Session（空白 Session 会隐藏 View 标签栏）。
   「会话契约」标签以稳定的高 order 注册一次，因此排在「对话」「轨迹」和常见插件标签之后。
2. 使用左侧 section 导航：**概览 / 目标 / 硬约束 / 交付物 / 历史草案 / 上下文**。历史草案始终可见，展示当前
   bootstrap 阶段并提供**重新检查**。窄窗口下自动变成横向 tab。
3. 在 **目标** 中设置目标。原始目标只写一次。
4. 在 **硬约束** 中添加必须长期可见的约束，例如：
   - `Do not modify migrations/`
   - `Run pnpm test before delivery`
   - `Keep the public API backward compatible`
5. 在 **交付物** 中添加交付物，选择 `not-started` / `in-progress` / `blocked` / `done` / `cancelled`。
   标签名和面板全部文案跟随 DSH 当前语言：中文显示「会话契约」，英文显示 `Charter`。
6. 所有修改先进入草稿，列表会立即显示投影后的结果。**预览上下文** 显示点击**应用**后模型会看到的 user-role
   文本和字节数。
7. **应用** 原子提交。成功后 revision 加一，下一个请求生效。网络失败时保留同一 mutation id，**重试**可以
   安全重放结果未知的写入。
8. 如果期间其他人或另一个标签页提交了修改，面板会保留草稿并提供**将草稿应用到修订 N**；选择它即可基于
   最新 revision 重新提交，或丢弃草稿重新开始。
9. 暂存修改、打开中的行内编辑器和已审阅的历史草案属于 Session 而不是当前挂载的标签页：切到「对话」再回来
   会恢复。只有 应用、显式丢弃或 Session 变化才会清除。

### 3.1 条目操作与替代链

条目操作放在每行的**操作**菜单里（仅可编辑时出现），避免长会话契约产生大量 tab 停靠点。替代项不能再次
归档或替换：请先清除它已替代的前任条目，这会解除后继关联，使后继恢复为普通条目。历史条目默认折叠，使用
**显示 N 条历史条目**检查、恢复或清除。

验证是人工标记：**标记为已验证**记录 `verified（手动标记）`。validator 产生的 `failed`/`unavailable`
是只读状态，原因会显示出来，当前 UI 不能创建这些状态。

### 3.2 状态维度

| 维度 | 值 | 说明 |
| --- | --- | --- |
| `review` | `pending` / `accepted` / `rejected` | 用户新建即 accepted；历史草案溢出导入和显式客户端 `item.propose` 为 pending；模型没有写工具 |
| `lifecycle` | `current` / `superseded` / `archived` | archived 可恢复；superseded 不复活 |
| `verification` | `unchecked` / `verified` / `failed` / `unavailable` | 与 lifecycle 独立 |
| `progress` | 仅 deliverable | 与 verification 独立 |

只有 `accepted + current` 进入 standing 工作集和模型可见 context。`done` 不自动 verified，
`verification.failed` 也不自动归档。当前 MVP UI 只切换 `unchecked`/`verified`；`failed`/`unavailable`
是记录层接受、留给未来 validator 集成的只读状态，不能从当前 UI 创建。

### 3.3 永久清除

archived / rejected / superseded 条目仍计入“全部条目”配额。**Purge** 仅 owner 可执行，会二次确认，并在同一个
原子记录更新中：

- 删除该条目；
- 解除可安全解除的替代链接；
- 清洗近期 history 和 mutation 回执中可能包含的正文。

active accepted/pending 条目会被核心拒绝；只有 archived、rejected 或 superseded 链条目可清除。若后续条目仍
引用它，Purge 会被拒绝；先处理引用方。

### 3.4 只读工具视图

`charter_read` 默认返回 `standing`，返回完整的当前工作集（目标 + 全部 accepted/current 条目，受 record 配额
约束）。`all` 是**有上限的调试视图**，不是当前工作集：它包含 rejected、
archived、superseded 条目，最多返回 64 条 / 32 KiB，并在 `truncated` 中报告省略数量。它不能替代
standing 会话契约，也不应作为常规工作流。

### 3.5 Actor 策略

- `owner`：所有会话契约编辑，包括不可逆的永久清除；
- `user`：普通目标/条目/进度/验证编辑，但不能 `item.purge`；
- `host`：不会通过 Remote edit 路径被接受；内部初始化/fork 使用专门代码；
- agent/model：没有暴露写工具或 edit API。

### 3.6 非 live Session

Web 进程可以只读显示另一个进程中 live 的 Session 的已存会话契约。编辑和历史草案抽取要求 Session 在当前
进程 live；Session 重连后标签页升级为可编辑。因此 `charter.bootstrap` 返回 `not-live`，而不是读取另一个
进程的事件日志。

## 4. 配置

默认值写在 `cordis.patch.yml`。在 profile 的 `cordis.patch.yml` 中覆盖同名项：

```yaml
- id: charter
  config:
    maxPromptBytes: 8192
    maxObjectiveBytes: 4096
    maxItemBytes: 1024
    contextOrder: 130
```

| 字段 | 默认 | 说明 |
| --- | ---: | --- |
| `maxPromptBytes` | 8192 | 仅会话契约 contribution 的 UTF-8 预算（不含历史消息、system、tools 和其他 context） |
| `maxObjectiveBytes` | 4096 | 目标文本的 UTF-8 上限 |
| `maxItemBytes` | 1024 | 单条条目文本上限 |
| `maxItems` | 512 | 全部条目存储上限 |
| `maxPendingItems` | 512 | pending 条目上限；设为 `0` 可禁用新提案 |
| `maxRecordBytes` | 1048576 | 单条 Session record（含受限历史/回执）上限；面板中显示 |
| `maxOps` | 1024 | 单次应用 的 op 数 |
| `historyLimit` | 64 | 近期 history 条数 |
| `maxHistoryBytes` | 131072 | 近期 history 字节上限 |
| `mutationLimit` | 128 | 近期 mutation 回执上限 |
| `contextOrder` | 130 | runtime context 排序；默认在 sandbox/approval/subagent 之后 |

模型可见容量只有 `maxPromptBytes`；active 条目数不再单独设上限。存储由 `maxItems`、`maxPendingItems` 和
`maxRecordBytes` 约束。会让 Session 处于 ready 但永久不可编辑的配置值会被抬到文档化最小值，并由 Host 记录 warning。

### 4.1 预算与溢出

「会话契约」标签激活时独占阅读区域：对话框隐藏，未发送的草稿保留；切回「对话」时恢复对话框和草稿。
审批、提问和计划审阅等必须保留的输入位不会隐藏。

标签页显示实时上下文预算条和每个字段的字节计数。任何内容都不会被静默截断：

- 历史草案中的长条目按句子/分句边界拆成多个候选，全部保留。仍然超过单条上限的候选会高亮，应用
  保持禁用，直到你缩短它。
- 目标保持完整。若超过 `maxObjectiveBytes`，草案显示全文和超限提示；请缩短后再应用。
- 候选放不进上下文预算时，能放下的部分直接生效，其余保存为**待审提案**。应用 仍然可用；不会拒绝、
  截断、丢弃或再次摘要。等上下文有余量时再逐条接受提案。
- 目标、单条字节、存储/单批容量仍是硬限制；UI 会显示具体问题，只有这些真实限制会让应用 禁用。

会话契约需要更多空间时，可在 profile 中调高预算。

### 4.2 超预算记录

预算是准入策略，不是记录有效性。若记录已存在后调低上限，受影响的 Session 显示 **超预算（over-budget）** 状态：视图
仍可读取，Host 不把会话契约注入 prompt，面板解释原因。增加内容会被拒绝，而归档、清除、缩短等操作会被允许，直到记录回到预算内。编辑器按旧值比较：objective 或
同 ID item 只要严格变短，即使仍超过上限也可以提交。**上下文** 中会显示 record 上限。

## 5. 数据与隐私

- 正本：`dsh_charter_v1` domain 的 `sessions` 表，每个 Session 一条记录。
- 记录包含目标、条目、派生 `promptText`/digest、近期 history 和 mutation 回执。
- 记录绑定 `createdAt`、`cwd`、`parentSession`，Session id 复用但 lifecycle 不同时会拒绝读取和覆盖。
- 普通日志只记录稳定 id、kind、revision 和错误码，不记录用户正文。
- 模型可见 context 不含 revision、时间、verification、origin、evidence 或计数。

## 6. 降级与故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 面板一直 `正在加载会话契约...` | Session 尚未初始化或初始化被阻塞 | 查看 Host 日志中的 `charter:` 行；确认 Session 存活 |
| 插件更新后会话契约面板白屏 | 浏览器 bundle 与 Host bundle 来自不同 revision（尤其手动安装 profile 后） | 完全重启 `dsh web` / DeepSeek Harness，让新 Host 加载；只刷新浏览器可能不会重启 Host |
| `unavailable` + lifecycle mismatch | 同 id 的 Session 换了 lifecycle | 不读取旧记录；新 Session 使用新记录 |
| 面板提示 Session 不在当前 Host / 只读 | 该 Session 属于另一个 DSH 进程（例如 Desktop），尚未在 Web 进程加载 | 在 Web 中新建会话或发送消息使其变为 live；标签页会自动升级为可编辑 |
| `unavailable` + 内部 schema/一致性不合法记录 | 外层 wrapper 可读，但内部 record 出现未知字段、错误结构，或派生 digest/history/state 不一致 | 非法期间不注入；内部记录不合法时保持隔离，原始字节保留（本插件不会覆盖它）。修复后下一次 view/初始化会重新解析并恢复，无需重启 Host |
| 外层记录错误后 `unavailable` 或静默为空 | 存储文件本身 malformed/截断，或外层 version stamp 被拒绝（JSON backend 完全无法读取 wrapper） | **已知覆盖风险，本插件无法修复**：backend 会把该文件当作不存在，之后初始化可能用新记录覆盖它。立即停止 Host，备份 `storages/dsh_charter_v1/sessions/<id>.json`，从备份修复后再重启；不要继续运行让插件初始化该 Session |
| `unavailable` + semantic corruption | schema 合法但记录内部的派生 digest/history/state 不一致 | 重新解析无法修复。检查 storage 并人工修复记录；若内存中的 Session 仍持有坏 revision，需重启 Host；修复前不注入 |
| `unavailable` + lifecycle mismatch | 同一 Session id 的 `createdAt`/`cwd`/父 Session 身份不同 | 这不是数据损坏，也不应被覆盖；旧记录不会被读取，新 lifecycle 使用自己的记录 |
|应用 返回 `REVISION_CONFLICT` | 期间有别的提交 | 草稿保留。先关闭打开的编辑器——编辑器打开期间**将草稿应用到修订 N** 操作会隐藏，因为编辑器保留你审阅时的 revision；之后再把这批 ops 指向最新 revision。已审阅的历史草案不做 rebase：它会变为 stale，需要在新 revision 上重新提取。未知结果的重试保留 mutation id，不会重复创建条目 |
|应用 返回 `QUOTA_EXCEEDED` | 超过 prompt、单条或存储/单批上限 | 检查高亮字段；减少候选或调高对应上限。active 条数没有单独上限 |
| `charter_read` 返回 `UNAVAILABLE` | 插件存储未就绪或记录不可用 | 会话仍可正常使用；修复后重试 |
| 会话头部没有「会话契约」 | 客户端 bundle 未加载/未注入，或当前是空白 Session | 检查 `dsh --profile web --dump-config` 中是否有 `charter` 行；先发送一条消息开始会话；刷新页面 |
| 0.1.7-rc.2 / 0.2.0 上出现授权担忧 | Gateway 无 `@Remote.resources` | 升级到 0.2.1+，或在可信单操作者环境使用 |

启动或写入失败不会回滚 Session 创建，也不会阻断普通对话。会话契约不可用时 Host 返回空 context，UI 显示明确状态。

## 7. 验证是否生效

1. 在「会话契约」标签页设置目标并 应用；
2. 让会话继续几轮，触发 compaction；
3. 再次打开「会话契约」标签页，确认目标/约束仍在；
4. 让模型调用 `charter_read`（或直接问它“当前会话契约是什么”），确认 standing 内容可见；
5. 在 Host 日志中确认没有 `charter:` 错误；
6. 需要 transcript 级证据时，在压缩后的第一条消息之后运行 `npm run verify:compaction`；它会把落盘 runtime
   context 快照与 storage 正本对比（见验证记录第 8 节）；
7. 重启 DSH 后重新打开同一 Session，确认 revision 和正文一致。

压缩后重新物化由 DSH 的 runtime-context projection 完成：本插件只保证每次 assembly 从 storage 正本读取，
并在 UI 预览中展示同一渲染函数的结果。

## 8. 卸载

```bash
dsh plugin --profile web remove dsh-charter
```

卸载后：

- 持久记录保留在 storage 中，不会自动删除；
- 已打开的 Session 可以正常恢复和继续对话；
- 重新安装后同一 Session 会重新读取原记录。

UI Purge **只能逐条清除条目**，不能删除目标、record identity/revision 或整条 Session record。如需彻底删除会话契约
数据，请先停止 DSH，确认路径后清理对应的 `dsh_charter_v1` domain 记录（或整个 profile storage 目录）。

## 9. 开发与贡献

```bash
npm run typecheck
npm test
npm run build
```

- 核心逻辑不得依赖 Cordis、Session、storage、React 或 LLM；
- 时间、UUID、actor 和 Session 查询从边界注入；
- 新增 UI 样式使用 `charter-` 前缀和 DSH 语义 token；
- 不要把用户正文放进 system prompt；
- 不要给模型增加写能力，除非重新设计审批和资源授权。
