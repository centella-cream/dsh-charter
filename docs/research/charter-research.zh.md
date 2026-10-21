# `dsh-charter` 调研记录

[English](charter-research.md) | 中文

调研基准日：2026-10-19。DSH 和外部产品都在持续迭代，本文只记录本次可核对的事实；我方取舍见
[charter-design.zh.md](../design/charter-design.zh.md)。

## 1. 调研问题与来源等级

本次调研回答一个问题：**外部 DSH 插件怎样保存并注入用户的持续目标和约束，使它们不依赖压缩摘要，
同时不越过用户内容的权限层级？**

来源等级：

- `[源码]`：当前工作区参考项目或 npm 发布包实现；
- `[官方]`：厂商文档和 DSH 发布包 README；
- `[论文]`：论文原文；
- `[社区]`：公开工程实践或原作者文章，不作为平台契约。

本次重点核对以下版本：

- `dsh-context-enhancement@0.2.2`，其 DSH 依赖固定在 `0.1.5-rc.1`；
- `dsh-ontology@0.2.1`，开发依赖为 DSH `0.1.5-rc.2`；
- DSH `0.2.1-rc.2` npm 发布包，并对 `0.2.1-alpha.5` 的关键限制做了复核。

`dsh-context-enhancement` 的基线提交为 `d13cf3a`，本次读取的工作树还有未提交修改；
`dsh-ontology` 基线提交为 `ca2399a`，工作树干净。参考项目版本低于目标 DSH 版本。它们能证明工程模式
和事故，不能替代目标版本契约核验。

## 2. 两个参考项目

### 2.1 [`dsh-context-enhancement`](https://github.com/chuxindd/dsh-context-enhancement)

`[源码]` 当前实现由两条链组成：

1. 自定义 compaction：三区维护、工具组摘要、确定性裁剪和 overflow 恢复；
2. 独立 task-state：过滤 Session 事件，调用辅助模型重写状态，Host 校验后写入 storage domain，随后在
   prompt assembly 中同步读取。

已经验证、可复用的做法：

- storage domain 使用 `per-record`，避免 append-heavy audit 每次重写整份介质；
- 持久化成功后才发布内存指针；
- 记录绑定 `sessionId + createdAt + cwd`，避免 Session ID 复用串数据；
- 后台更新和手工编辑进入同一 Session worker，并在队列内检查 revision；
- `agent/created`、`session/event`、dispose 的生命周期处理明确；
- prompt assembly 只做同步内存读取，不执行存储 I/O；
- 真实故障路径有 open/commit/finish/repair 测试。

不适合照搬的部分：

- 模型每次输出整份状态，输出规模随状态规模增长；
- task state 与 Session 日志是两份无法自动对账的事实来源；
- `sessions + audit` 两表没有跨表事务，需要 repair；
- 客户端自建 baseline、增量、generation、重连和退避，代码面很大；
- 旧版 `systemPrompt.context()` 的累积行为没有按当前版本重新验证；
- task-state 与 compaction 的实现锁定旧 DSH 接口。

### 2.2 [`dsh-ontology`](https://www.npmjs.com/package/dsh-ontology)

`[源码]` 该项目把核心分为纯规则层、存储适配层、工具层和 prompt 层：

- `GraphView` 是只读内核边界，规则不依赖 Cordis 或存储；
- 写入前返回稳定 `Violation { code, message }`；
- schema 重定义先构造 overlay，再检查历史事实是否会失效；
- 派生事实读时计算，不写成第二份事实；
- 工具返回 canonical JSON，再单独渲染模型文本；
- prompt 只放小型词汇索引，实例按需查询；
- smoke 测试安装真实 tarball，执行两次启动并验证持久化。

不适合照搬的部分：

- 多项工具写入不是事务，部分成功不会回滚；
- 没有 revision、CAS 或并发写保护；
- `strict:false` 允许违规状态落盘；
- 模型工具可以直接执行有效写入；
- TBox/ABox、推理闭包和图查询不属于会话会话契约问题；
- term comment 会进入 system prompt，存在把普通数据提升为系统指令的风险。

### 2.3 共同结论

两个项目虽然目标不同，但给出相同的工程方向：

- 规则和渲染必须是纯函数；
- 存储和工具只做薄适配；
- 写入必须先在草稿状态上完整校验；
- 模型输出只能是候选，不应直接成为有效状态；
- prompt 只加载有硬上限的工作集；
- 重启、卸载、失败和真实宿主测试比 mock 注册测试更重要。

## 3. DSH `0.2.1-rc.2` 契约核验

### 3.1 Session 插件记录

`[官方]` `@deepseek-ai/dsh-session@0.2.1-rc.2/README.md` 的
“Write experimental plugin records”明确说明：

- `appendPluginRecord()` 只允许仓库内 `packages/experimental/` 的生产代码调用；
- 外部插件同样不得调用；
- 记录标为 `ignorable`，不进入 surface，resume/fork 会携带；
- Session 格式迁移只做 best-effort 保留；
- 即使名称已声明，读取后的 `data` 仍是 `unknown`，拥有者必须重新校验。

`0.2.1-alpha.5` 发布包仍保留相同限制。结论是：这个机制可以作为未来方向，当前不能作为外部插件正本。

### 3.2 Storage domain

`[官方]` `@deepseek-ai/dsh-storage-domain@0.2.1-rc.2` 提供：

- 每个 domain 一条写链；
- 后端 durability 成功后才修改内存并发出 `domain/changed`；
- `KvTable.update()` 在写链槽位内执行同步 read-modify-write，并发 update 不交错；
- 同步内存读取；
- `per-record` 介质布局；
- 打开 domain 时对全部权威记录做 schema 校验。

当前限制：

- 没有跨表、跨记录事务；
- 没有二级索引；
- `domain/changed` 只在单进程内可见；
- 没有自动数据迁移；
- `compatibleVersions` 只允许当前 schema 直接读取旧格式，不执行转换。

这决定了 Charter 的一次 Apply 必须只改一个 Session record。

### 3.3 Prompt 注入

`[官方]` `@deepseek-ai/dsh-system-prompt@0.2.1-rc.2` 区分两条通道：

- `section()` 进入 system-role prompt；
- `context()` 进入 durable user-role runtime snapshot；
- 两者都支持 `interpolate:false`；
- provider 在每次 assembly 时求值；
- context 的所有贡献会合并成一份快照。

`[源码]` `@deepseek-ai/dsh-agent-loop@0.2.1-rc.2` 的 `RuntimeContextProjection` 只在联合文本变化时
产生新快照。它监听 surface replacement；当前 retained snapshot 被替换或遮蔽后会清空 retained，下一次
请求可从当前 context 重新物化同样的文本。

因此，独立 storage 正本配合 `context()` 能实现“每次请求重新得到当前用户级会话契约”，不需要把用户正文
提升到 system role。代价是任一 context 贡献变化都会追加整份联合快照。

### 3.4 Session projection

`[官方]` `@deepseek-ai/dsh-session-projection@0.2.1-rc.2` 只 fold 已提交 Session events：

- `apply` 必须同步；
- 无关事件必须返回同一引用；
- `wire` 提供 schema 校验后的完整客户端值与 `asOfSeq`；
- framework checkpoint 可加快冷读；
- 文档要求 state-carrying log event 携带完整 post-state，而不是裸 delta。

Charter 正本既然在独立 storage domain，就不能靠 Session projection 自动驱动。强行使用会制造第二条同步链。

### 3.5 Gateway 与客户端流

`[官方]` `@deepseek-ai/dsh-api-gateway@0.2.1-rc.2` 提供：

- Remote 参数校验；
- `@Remote({ resources })` 资源声明和非 owner 访问决策；
- `RemoteSnapshotStream`：每个物理代次一个 opening snapshot，后续接 delta；
- 载体断线重连期间保留上一份已接受状态。

它不能替 Host 解决 snapshot 与 listener 之间的竞态，也不提供业务 revision 去重。Host 仍需先挂 listener、
再读初始状态；客户端仍需按 revision 忽略重复值。

### 3.6 UI 入口（历史：右侧栏）

`[官方]` 本轮最初调研的是右侧栏；当前实现已改为主对话页 `conversation.view` 标签页。以下为历史记录：

`@deepseek-ai/dsh-client-ui-sidebar-right@0.2.1-rc.2` 使用两阶段注册：

1. `ctx.sidebarRightTabs.register(definition)` 注册 tab 类型；
2. `ctx.slots.register({ name:'sidebar.right.pane.tab', key:definition.id }, Body)` 注册正文。

`[官方]` `conversation.session.header.actions` 在 conversation 包中存在，可以作为可选入口；本轮没有找到
原稿所写的 `conversation.chat.assistant-actions`。

`[官方]` `@deepseek-ai/dsh-settings@0.2.1-rc.2` 是抽象配置表单服务。发布文档明确说当前没有已发布客户端
按 schema 自动生成页面。因此 MVP 不假定存在 `settings.plugins.tab`，配置继续走插件 Config，诊断放自身面板。

## 4. 外部证据

### 4.1 压缩会丢持续约束

`[论文]` *Lost in Context Compaction*（arXiv:2608.11242v2）在其受控实验中报告：

- 邮箱实验中，压缩前未经批准删除为 0/100，压缩后为 30/100；
- 被测压缩器平均保留 17% 的注入式 Side Constraints；
- 独立抽取、维护并追加约束后，三个受控场景都超过 90% 语义保留率。

这些数字只适用于论文的模型、数据集、压缩器和评估方法。论文按语义判断保留，不证明“逐字保存”是达到
90% 的必要条件。逐字冻结是本项目为了审阅和确定性渲染额外选择的不变量。

来源：https://arxiv.org/abs/2608.11242

### 4.2 外部正本在压缩后重新注入

`[官方]` Claude Code memory 文档确认：项目根 `CLAUDE.md` 在 `/compact` 后从磁盘重新读取并注入，
而不是依靠摘要器记住。文档还明确说这些文件是 context，不是 enforced configuration；需要硬阻止的动作应使用
hook 或权限。

这支持两个事实：关键内容应有压缩历史之外的正本；prompt 约束不能代替执行层强制。

来源：https://code.claude.com/docs/en/memory

### 4.3 被替代记录继续保留

`[社区]` Michael Nygard 的 ADR 原文规定：编号不复用，决策被反转时保留旧 ADR 并标为 superseded，
因为它曾经生效的事实仍有价值。这能支持显式替代关系，不能直接推出所有数据永久不可删除。

来源：https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

### 4.4 DeepSeek 缓存

`[官方]` DeepSeek Context Caching 文档确认：

- 缓存默认启用；
- 只有完整匹配已经持久化的 cache prefix unit 才算命中；
- unit 可在请求边界、检测到公共前缀时和长序列固定间隔处建立；
- 返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；
- 缓存是 best-effort，构建和回收时机不保证。

`[官方]` DeepSeek Anthropic 兼容表把 tools、text、tool_use、tool_result 上的 `cache_control` 都标为
Ignored。调用方不能指定 Anthropic 式缓存断点，只能维持前缀稳定并观察 usage。

来源：

- https://api-docs.deepseek.com/guides/kv_cache
- https://api-docs.deepseek.com/guides/anthropic_api

## 5. 调研能支撑什么

本轮事实能支撑以下结论：

1. 约束应独立于压缩摘要维护。
2. 外部 DSH 插件当前应使用 storage domain，而不是实验性 Session plugin record。
3. 用户可编辑会话契约应保持 user role；system role 留给 Host policy。
4. 一次 Apply 应收敛到单记录原子 update。
5. UI 应按 Session 授权并使用 snapshot stream，不做 Host-wide baseline。
6. 模型注入文本必须确定、有界，并从正本重新物化。

本轮事实不能证明：

1. 模型一定遵守会话契约；
2. DeepSeek 一定在某个 token 边界命中缓存；
3. 2KB、16 条或任何具体配额是最优值；
4. 外部插件能精确继承 fork boundary 时刻的父 Charter；
5. 目标 DSH 版本未来不会改变扩展政策。

## 6. 致谢

本节对比基于 2.1/2.2 中链接的公开仓库/包。它们是独立项目；本项目没有复制其源码，两个项目也不为
`dsh-charter` 背书。

## 7. 本机事实索引

| 事实 | 本机位置 |
| --- | --- |
| task-state 使用 `per-record`，authority 与 audit 分开 | `../../references/dsh-context-enhancement/src/internal/task-state/basic/domain.ts:1-55` |
| lifecycle fence 与 durable put 后发布 | `../../references/dsh-context-enhancement/src/internal/task-state/basic/service.ts:520-637` |
| 手工编辑进入 worker queue 并检查 revision | `../../references/dsh-context-enhancement/src/internal/task-state/basic/service.ts:712-769` |
| 旧客户端自建 Host-wide baseline 流 | `../../references/dsh-context-enhancement/src/internal/task-state/control/service.ts:71-157` |
| prompt assembly 同步读取 committed pointer | `../../references/dsh-context-enhancement/src/task-state-prompt.ts:58-76` |
| ontology 的纯 `GraphView` 边界 | `../../references/dsh-ontology/src/types.ts:124-150` |
| schema 重定义先用 overlay 验证历史事实 | `../../references/dsh-ontology/src/ontology.ts:455-500` |
| ontology 工具、存储与 prompt 的组装边界 | `../../references/dsh-ontology/src/index.ts:73-107` |
| DSH plugin record 外部插件禁用说明 | `@deepseek-ai/dsh-session@0.2.1-rc.2/README.md`，Write experimental plugin records |
| storage 单写链、单记录原子 update 与无跨表事务 | `@deepseek-ai/dsh-storage-domain@0.2.1-rc.2/README.md`，Design concept / Known Limitations |
| runtime context 被遮蔽后允许同值重建 | `@deepseek-ai/dsh-agent-loop@0.2.1-rc.2/lib/index.js`，RuntimeContextProjection |
| 右侧栏两阶段注册 | `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.1-rc.2/README.md`，tab registration |

npm 发布包只用于本轮契约核验，没有复制进项目。实现阶段应把 M0 contract tests 作为可持续证据，避免长期依赖
文档中的发布包行号。
