# `dsh-charter` v1 设计评审

[English](charter-design-review.md) | 中文

调研基准日：2026-10-19。

评审对象：v1 设计稿（中文，本地归档，不纳入 git 跟踪）。修订后的实现规格见
[charter-design.zh.md](charter-design.zh.md)，事实调研见 [charter-research.zh.md](../research/charter-research.zh.md)。

> 实现后更新（2026-10-20）：最低支持版本定为 DSH `0.1.7-rc.2`，产品上优先适配 `0.2.0-rc.1+`。`0.1.7` /
> `0.2.0` 的 Gateway 没有 `@Remote.resources` / `Principal`，per-Peer 资源授权从 `0.2.1` 起提供；降级和
> 版本矩阵见 [compatibility.zh.md](compatibility.zh.md)。`0.1.5-rc.1` 及更早版本因 Remote 编解码、事件负载
> 和侧栏 API 的破坏性变化不兼容。

## 1. 结论

原稿的产品方向成立，但不能直接作为实现规格。

成立的部分有四点：

1. 用户的持续约束不能交给压缩摘要保管。
2. 会话契约需要可见、可编辑、可追溯，模型不能成为最终写入者。
3. 每轮加载的内容必须有硬上限，完整历史按需读取。
4. 稳态文本应保持确定，避免无意义地破坏 prompt prefix cache。

需要重做的是技术落点。原稿把外部插件不能使用的实验接口当成了正本通道，把用户可编辑内容放进了
system role，还把生命周期、证据状态和交付进度塞进同一个状态机。继续沿这条路线实现，会在兼容性、
权限边界和并发一致性上留下结构性问题。

综合判断：**产品定义合理，数据与交互原则大体合理，持久化和注入方案需要替换，首版范围需要收缩。**

## 2. 阻断实现的问题

### P0-1：`appendPluginRecord()` 不是外部插件接口

原稿把 `plugin:charter/*` 会话记录定为唯一正本。目标版本
`@deepseek-ai/dsh-session@0.2.1-rc.2` 的发布文档却明确规定：

- `appendPluginRecord()` 只供仓库内 `packages/experimental/` 下的包使用；
- 外部插件同样不得调用；
- 记录在格式迁移中只做 best-effort 保留，允许丢失插件自有状态而不影响 Session 解释。

因此，这个接口可以证明上游存在相应架构，但不能作为 `dsh-charter` 外部插件的产品契约。继续使用会把
核心数据建在一个明确不受支持的入口上。

**修正**：正本改为 `dsh-storage-domain` 中的每会话单记录。只有上游以后发布正式、允许外部插件使用的
会话扩展记录后，才评估迁移。

### P0-2：用户正文被错误提升为 system role

原稿用 `systemPrompt.section()` 注入用户可编辑的目标和约束。这样会把普通用户输入提升到 system role，
与 Host policy、工具规则和部署指令处于同一角色层级。调整 section 顺序、加标签或转义都不能恢复原来的
权限边界。

**修正**：正文改用 `systemPrompt.context()`，保持 user role。固定的插件协议说明可以放 system section，
但首版没有必要。必须强制的限制继续交给权限、hook 或工具守卫。

### P0-3：写入协议没有真正定义原子性

原稿提出 `baseRevision`，但没有规定用户编辑、模型提议、证据对账、导入和准入操作是否共用同一个
线性化点。两个调用都可能先读到相同 revision，再各自提交。

参考项目 `dsh-context-enhancement` 的并发正确性不只来自 revision 检查，还来自每会话串行 worker。
目标版本的 `dsh-storage-domain` 提供了更直接的机制：同一 domain 的写入串行，单记录 `update()` 在队列
槽位内执行原子 read-modify-write。

**修正**：一次 Apply 所需的当前状态、revision、幂等回执和近期变更记录放入同一 Session 记录，并在
`update(sessionId, fn)` 的同步 transform 内检查 `baseRevision`、幂等键、状态转换和配额。

### P0-4：远程读写没有明确资源授权

原稿只描述一个 `edit` RPC，没有说明非 owner 客户端如何绑定 Session。Host-wide baseline 还会一次下发
所有 Session 的状态，使授权范围难以收敛。

**修正**：每个读写端点都要求 `sessionId`，并通过 Gateway 的 `@Remote({ resources: { session: ... } })`
声明 Session 资源。UI 每个 Session 建一个 snapshot stream，不提供跨 Session 全量流。

## 3. 需要修正的设计问题

### P1-1：一个 `status` 混合了三种状态

原稿中的 `proposed`、`active`、`archived`、`unverified`、`rejected` 分别表达审批、生命周期和证据状态；
交付物又有自己的完成状态。合法组合无法表达，例如“当前有效但证据无法核验”和“已完成但未验证”。

**修正**：拆成三个正交维度：

- `review`：`pending | accepted | rejected`；
- `lifecycle`：`current | superseded | archived`；
- `verification`：`unchecked | verified | failed | unavailable`；
- `deliverable.progress` 独立存在。

### P1-2：证据完整性被误当成事实有效性

Session 日志是追加的。压缩只改变 surface，不会让原事件 digest 自动失效；反过来，文件、端口或外部环境
已经变化时，原事件 digest 仍然匹配。

**修正**：区分：

- `sourceIntegrity`：来源是否还能读取、内容摘要是否一致；
- `verification`：条目现在是否成立，由用户确认或专用 validator 给出。

压缩本身不能把用户约束自动降级。

### P1-3：`unverified` 与 prompt 稳定要求互相冲突

原稿一处要求 `unverified` 在注入面显示警示，另一处又要求元数据变化不得改变 prompt。两者无法同时成立。

**修正**：验证状态默认只在 UI 和工具结果中展示，不改变 standing context。只有用户显式修改正文、目标或
交付物进度时，模型可见字节才变化。

### P1-4：配额互相矛盾

原稿同时允许 24 条、每条 160 字节，却又要求整个注入面不超过 1.5KB。仅条目正文理论上就能达到
3.75KB。

**修正**：渲染后的 UTF-8 总字节数是首要硬约束；条数和单条上限只用于防止极端结构，不能被描述为都能
同时用满。初始数值必须通过 M0 样本和真实路由测量后确认。

### P1-5：缓存成本被写成了确定性保证

DeepSeek 只有完整匹配已存在的 cache prefix unit 才能命中，缓存建立时机和保留时间又是 best-effort。
请求级 hit/miss token 也不能精确归因到某个 Charter 编辑。

**修正**：实现只保证字节稳定和变化位置可控。面板展示 provider 原始 usage 与 Charter 文本哈希，不声称
精确计算“由 Charter 导致的 miss”。效果通过受控 A/B 测量，不以单次请求作为因果证明。

### P1-6：首版范围过大

原稿同时包含事件溯源、checkpoint、自动证据对账、后台模型提议、导入导出、四模块 UI、cache 归因和
复杂审阅队列。每一项都会引入自己的状态与失败面。

**修正**：MVP 只做用户维护的目标、硬约束和交付物；一个原子写接口、一个只读工具、一个会话头部标签页、
确定性 runtime context。自动提议、证据 validator、决策历史、导入导出和诊断后置。

## 4. 参考项目取舍

| 来源 | 取什么 | 不取什么 |
| --- | --- | --- |
| [dsh-context-enhancement](https://github.com/chuxindd/dsh-context-enhancement) | `per-record` 持久化；Session lifecycle fence；写入持久化后再发布；同步 prompt 读取；revision 冲突；故障隔离 | 辅助模型整份重写；`sessions + audit` 两表协议；Host-wide baseline；自建客户端重连层；动态全文 task-state 注入 |
| [dsh-ontology](https://www.npmjs.com/package/dsh-ontology) | 纯领域内核；稳定错误码；写前验证；overlay/草稿校验；工具 JSON 与文本渲染分离；真实宿主 smoke | 非事务批处理；`strict:false`；模型直接执行有效写入；图推理、TBox/ABox；任意 comment 进入 system prompt |

## 5. 修订后的关键决策

| 主题 | 原稿 | 当前决策 | 状态 |
| --- | --- | --- | --- |
| 正本 | Session `plugin:` 日志 | `dsh-storage-domain` 每 Session 单记录 | 已定，受公开 API 约束 |
| 注入 | `systemPrompt.section` | `systemPrompt.context` | 已定，受权限边界约束 |
| 写入 | 多条 revision op 的设想 | 单记录原子 `update()` | 已定，受存储事务粒度约束 |
| UI 读取 | `sessionProjections.wire` | 按 Session 的 Remote snapshot stream | 已定，独立 domain 不能由 Session projection fold |
| 状态 | 单一 `CharterStatus` | review/lifecycle/verification/progress 分离 | 已定 |
| 模型权限 | 含糊 | MVP 只读；后续只能提议 | 已定 |
| 审计 | 永久追加日志 | 同记录内有界近期回执 | 已定；永久审计不在 MVP |
| 压缩后恢复 | 依靠不可压缩节点 | 从 storage 正本重新物化 user-role 快照 | 已定 |

## 6. 尚未解决、留给 M0 的问题

1. **Fork 精确边界**：公开接口没有把父 Charter revision 写入 Session fork 事务。首版只能在 child
   `agent/created` 时复制父 Session 最新已提交版本，并记录其 revision；这不是严格的 fork-boundary 快照。
2. **全局 runtime-context 写放大**：任一 context 贡献变化都会追加整份联合快照。Charter 可以控制自己的
   2KB 左右预算，不能独立保证全局快照大小和变化频率。
3. **存储迁移**：`dsh-storage-domain` 没有自动迁移。不兼容版本需要新 domain 名和显式 side-by-side copy。
4. **目标版本稳定性**：本轮以 `0.2.1-rc.2` 为基准；发布标签和外部扩展政策仍可能变化。M0 必须以打包后
   的真实 Profile 做恢复、卸载、fork、权限和 prompt 测试。
5. **配额标定**：模型可见字节上限、单条长度和 inactive 条目上限目前是产品初值，不是实测结论。

这些问题不阻止纯内核和单记录写链实现，但会阻止把兼容性、fork 精确性和成本数字写成已保证行为。
