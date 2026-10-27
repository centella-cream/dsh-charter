# 更新日志

[English](CHANGELOG.md) | 中文

记录 `dsh-charter` 的重要变更。DSH 插件 ABI 仍在演进，项目保持 pre-1.0 版本线。

## 0.1.0-rc.4 — 2026-10-27

针对 DSH `0.2.1-rc.3` 与 `0.2.1-rc.4` 的兼容性补丁。`0.1.0-rc.3` 只声明五个 DSH 精确版本，因此在 DSH
`0.2.1-rc.3` 上正确拒绝安装；插件 API 本身无需修改。

### 变更

- `engines.dsh` 与所有 DSH peer ranges 现在列出七个已验证版本：`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、
  `0.2.1-rc.1`、`0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4`。
- DSH `0.2.1-rc.4` 成为主开发基线；`0.2.1-rc.3` 由同一套完整矩阵验证。
- 不改变 record schema、domain、Remote 或 client 行为；rc.3 记录无需迁移即可读取。

### 验证

- `0.2.1-rc.3` 与 `0.2.1-rc.4` 上 typecheck、build、client/remote smoke 与 25 个测试文件 / 331 个测试全部通过。
- 七版本矩阵每个声明版本均为 331/331。
- 最终 tarball 的 normal、exact-artifact 与 packed recovery smoke 通过；公开 CI 在 Node 22.19.0/24 通过。

## 0.1.0-rc.3 — 2026-10-26

保留权威记录的恢复版本。会话契约记录现在通过统一的结构化状态机打开；恢复的 Session 缺失记录时不再自动重建；
owner 可以导出完整归档并将其恢复到同一 Session lifecycle。

### 新增

- 来源感知初始化：`startup` 可创建 root/fork 记录；`resume`、`clear`、`compact`、`reattach` 与未知来源停在
  `absent-unconfirmed` 且不写入。`session/created` 只记录意图，`agent/created` 才是权威来源；推断/权威启动意图
  会被合并；`edit` 不再隐式创建记录并返回 `INITIALIZATION_REQUIRED`。
- Host view 与 Remote wire 上的结构化 `CharterRecordState`（`healthy`、`absent-unconfirmed`、`invalid`、
  `lifecycle-mismatch`、`unknown`、`write-uncertain`），以及 `capabilities.recordMaintenance`、
  `maxRecoveryBytes`、`maintenanceLimit`；`recordState` 由 Host 推导、绝不持久化。集中检查覆盖 schema、一致性、
  lifecycle，并为 schema 不合法记录提供 loose identity 的 recoverable 判定。
- 完整记录导出与受控恢复：新增 owner-only 的 `exportRecord`、`initializeRecord`、`restoreRecord`
  （共六个 Remote 方法），带 Session 资源与严格 codec；restore 外层契约只校验小字段，能力/owner/存储检查在深层
  归档解析之前。归档包含 identity、当前快照、有界历史、mutation 回执与 payload digest；restore 要求同一
  Session/lifecycle、重做全部校验、拒绝健康目标、保留归档的 current/history/mutations 且只追加 maintenance 回执。
- 记录（`recordSchemaVersion: 1`）内新增有界 `recentMaintenance` 回执（默认 16），支持 initialize/restore 在响应
  丢失后的精确 replay（包括 restore 之后又发生普通 edit），同一 operation id 不同内容返回
  `OPERATION_ID_REUSED`。
- 写结果不确定围栏：可能已落盘的存储拒绝不会发布提议内容，停止 prompt 注入与 `charter_read`，拒绝
  edit/initialize/restore/export，只发一次结构化 watch 降级，同一 Host 生命周期内不再覆盖该键，重启后从介质收敛。
  已知的 pre-flight `DomainError`（`missing-key`/`closed`）仍是确定结果，不触发围栏。
- 每 Session 的 mutation 队列串行 startup 初始化、显式初始化、普通 edit 与 restore，每个队列槽都重新读取并做
  CAS。
- Context 之后的“存储与恢复”Pane 区：记录健康/revision/lifecycle/digest/超预算、敏感完整记录导出下载、归档选择与
  预览、显式空初始化与恢复的两步确认、absent-unconfirmed 指引（含“缺失或不可读、无法区分”与停止 Host 备份
  建议）、write-uncertain 重启说明、能力/record-limit 说明；中英文案、明暗与窄屏布局、键盘/focus 样式。
- 验证：脚本化存储故障矩阵（open/load/put/update 的 reject/defer/commit-then-reject）、真实 JSON Host 恢复场景，
  以及针对打包 tarball 的 final-artifact recovery smoke（`scripts/verify/recovery-smoke.mjs`）：export → 删除 →
  restore → 两次重启比较 record/state/prompt/tool 投影 → 健康目标拒绝覆盖 → 存储故障矩阵。

### 变更

- 新增确定性业务码：`INITIALIZATION_REQUIRED`、`INVALID_ARCHIVE`、`RECORD_CONFLICT`、
  `OPERATION_ID_REUSED`、`RECOVERY_UNSUPPORTED`。
- Remote namespace 从 3 个方法扩展到 6 个；旧 Host frame 将 `recordState` 默认为 `unknown/legacy-host`、
  `capabilities.recordMaintenance` 默认为 false。同 revision 的 record-state/digest/capability 变化现在会发出
  changed frame 并通过 watch/client 去重。
- 客户端 attempt 状态扩展 initialize/restore：精确保留 operation id/lifecycle/target digest/archive，共享
  replay/abandon 规则，并用稳定 RemoteError 分类（文档化的 pre-dispatch 失败为确定结果；所有可能已执行的失败保留
  请求；不做 message/`instanceof` 匹配）。

### 修复（审计跟进）

- 彻底移除读触发的 lazy startup 路径：`session/created → agent/created` 间隔内的 view/watch 读取不再推断
  `startup`、不写入，缺失一律归类为 `absent-unconfirmed`；只有权威 `agent/created(startup)` 才创建记录。探针测试覆盖
  该间隔内缺失、malformed/version-rejected 字节（逐字节不变）、缺失 fork 子记录（不重新 fork）。
- restore 拒绝模糊 maintenance 证据：若归档自身记录已含请求 operation id，而目标没有匹配的 replay 回执，返回
  `OPERATION_ID_REUSED` 且不写入；initialize 与 restore 在持久化 put 前都会断言记录一致性。
- 修复 `maintenanceLimit: 1` 时保留整个回执数组的 bug（`slice(-(limit-1))`）：只保留当前回执，并加测试。
- 关闭流程先关闭准入、排水初始化与每 Session mutation 队列，再关闭存储介质；startup put 在每 Session 队列内执行并
  重新读取/CAS，不会覆盖并发的 initialize/restore。
- maintenance replay 返回回执原始 result revision（而非后续 edit 后的当前 revision）；view 仍是当前权威。
- 客户端归档预览用 WebCrypto 校验 payload/record digest，显示导出时间/来源 Session，大小检查覆盖完整 envelope，
  仅对健康且完整性校验通过的归档开放 restore；导出/初始化/恢复使用共享 admission 谓词并显示本地化禁用原因；
  破坏性确认在 section/target/archive/lifecycle 变化时重置并提供取消；in-flight 与 unknown 状态分离 live-region
  语义；导出失败按确定性 code 本地化；移除 `prefers-color-scheme` 的文件输入覆盖，改用 DSH token；lifecycle
  展示不再暴露原始 cwd JSON。

### 修复（复审竞态）

- 排队的 `initializeRecord`/`restoreRecord` 在读取目标前重新确认 live Session 对象/lifecycle，并重新检查
  write-uncertain fence；Session 已被替换时返回 `LIFECYCLE_MISMATCH` 且不写入。
- maintenance 请求执行期间 lifecycle 变化时，attempt 转为 `unknown` 并清除 `maintenanceSaving`，Retry/Abandon 不会
  永久不可用。
- maintenance 失败结果携带的权威 view 会在结果分类前被接受，write-uncertain 立即显示而不是旧状态。
- archive 选择与记录导出加入请求 generation；较慢的旧文件/旧导出不会覆盖新选择，也不会跨 Session/lifecycle 完成。
- 完整 restore request 与导出/恢复后的 archive envelope 都检查 `maxRecoveryBytes`；`exportedAt` 限制在 JavaScript
  Date 可表示范围内，UI 预览使用安全格式化。

### 安全

- 维护操作 owner-only，且要求 DSH 0.2.1+ 的 principal/资源约束；0.1.7/0.2.0 上 Host 在深层归档解析或存储访问前以
  `RECOVERY_UNSUPPORTED` fail closed。归档包含用户文本并标注敏感；payload digest 检测意外损坏，不证明恶意来源。

### 已知限制

- **rc.2 降级：**rc.2 使用不含 `recentMaintenance` 的严格记录 schema。rc.3 为某 Session 写入 maintenance 回执后，
  rc.2 会把该 Session 隔离为 schema-invalid（不注入/不可编辑）但保留原始记录；重新升级到 rc.3 后恢复访问。没有
  maintenance 操作的记录仍可被 rc.2 读取。这是前向可读的升级兼容，不是 rc.2 回滚兼容。
- 存储 API 仍无法区分记录缺失与不可读的外层文档；UI/插件只报告“缺失或不可读，无法区分”，绝不声称识别了损坏。
  如需取证字节，请停止 Host 并备份/修复存储文件。
- `maxRecoveryBytes` 默认 4 MiB（至少 `maxRecordBytes + 64 KiB`，硬上限 16 MiB）。记录预算无空间的 profile 会关闭
  maintenance（`recordMaintenance:false`，reason `record-limit`），需要停止 Host 后离线备份；既有记录上限不会被
  静默降低。
- 有界 maintenance 回执：仅当回执仍在窗口内时保证 replay。
- 不支持跨 Session/lifecycle 导入、覆盖健康记录或 force 选项；不引入 v2 domain 或迁移。

### 测试

- 25 个测试文件 / 330 个测试（`npm test`），含新的 core archive/maintenance 套件、Host 恢复/故障场景、Remote
  六方法契约、客户端 attempt/分类测试与真实 `react-test-renderer` 恢复 UI 测试；另有打包产物 recovery smoke 与
  五版本矩阵。

## 0.1.0-rc.2 — 2026-10-24

小型补丁候选：Pane hook 顺序崩溃修复、安全升级与发布渠道/文档修正。

### 修复

- `CharterPane` 在 Session 从 connecting/null → ready 或 error/null → retry → ready 过渡时不再崩溃
  （"Rendered more hooks than during the previous render"）：replay 状态谓词
  （`editReplay`/`bootstrapReplay`/`unknownReplay`）与 `confirmAbandon` 重置 effect 已移到所有 early return
  之前，hook 顺序在不同连接状态下保持不变。
- 新增真实 `react-test-renderer` 回归测试（connecting/null → ready、error/null → retry → ready、
  ready → revision 更新三种场景）渲染真实 Pane；修复前代码会以精确的
  "Rendered more hooks than during the previous render" 失败。

### 安全

- `zod` 从 `4.4.3` 精确升级到 `4.6.7`（GHSA 超大 constrained collection 内存耗尽 advisory）。
  `npm audit --omit=dev` 为 0 漏洞，`npm ls zod` 显示生产依赖为 4.6.7；由于 tsdown 会把 Zod 内联进浏览器
  bundle，完整 build/wire/client-bundle/package smoke 与五版本兼容矩阵都针对升级后的构建重跑。

### 测试

- 20 个测试文件 / 263 个测试（`npm test`），包含 3 个真实 `react-test-renderer` Pane 回归测试；其中两个测试
  依赖修复后的 hook 位置。

### 变更

- 版本与当前发布文档迁移到 `0.1.0-rc.2`；保留 `0.1.0-rc.1` 的历史证据与 CHANGELOG 记录。
- 渠道策略显式化且是有意选择：rc.2 发布到 `next` dist-tag，同时在稳定版出现前把 `latest` 也指向最新 RC。
  这是当前策略（npm 会保留一个 `latest` tag，我们决定它指向哪里），不是 npm 的强制要求，也不声称是 npm 行为。
- 新增 rc.2 发布说明 `docs/release-notes/0.1.0-rc.2.md`（位于 npm `files` 白名单之外）。

## 0.1.0-rc.1 — 2026-10-22

首个 MVP。

### 新增

- 基于 `dsh-storage-domain`（`dsh_charter_v1`）的每 Session 持久会话契约正本。
- 原始/当前目标、硬约束、交付物，以及 review/lifecycle/verification/progress 状态。
- 单记录原子 Apply，包含 revision 冲突、幂等 mutation 回执、配额准入和有界 history。
- 通过 `systemPrompt.context()` 注入确定性的 user-role runtime context。
- 只读 `charter_read` 工具，支持 standing 和全部条目两种视图。
- 子 Session fork 时一次性复制父会话契约，并重铸条目 id。
- 非 live Session（例如在独立 Web 进程中打开 Desktop 会话）显示已保存会话契约的只读视图和说明；Session
  变为 live 后原位升级为可编辑，而不是让 Remote stream 直接抛 "not live" 原始错误。
- 重新设计会话契约面板：使用 DSH 语义 token，紧凑页头与预算条、吸顶预览/丢弃/应用工具栏、目标卡片、
  响应式硬约束/交付物双栏、hover/focus 条目操作、section 内联添加输入，并支持明暗主题。
- 默认 charter-contribution 预算提升到 8 KiB、目标 4 KiB、单条条目 1 KiB。任何路径都不静默截断：超长历史草案条目拆成
  多个候选，超限字段高亮。历史导入以真实上下文预算为准，不再用 per-kind active 条数拒绝整个草案：放不下的
  候选会在同一次原子 Apply 中保存为待审提案（`item.propose`），不会丢弃或截断。
- 移除 per-kind active 条数上限；存储限制提高到 `maxItems` 512、`maxPendingItems` 512、`maxOps` 1024、
  `maxRecordBytes` 1 MiB。
- 已有压缩历史且会话契约为空的 Session 会自动显示从最近一次压缩摘要确定性抽取的只读草案；不调用模型、不自动
  写入。用户编辑/取消勾选后点击应用才会生效。
- 完整的会话契约标签页与面板中英文界面，由 `dsh-client-locale` 和 DSH 当前语言驱动；计数、状态、按钮、
  占位符和错误码文案均包含在内。
- 主对话页 `conversation.view` 的会话契约标签页（中文「会话契约」/ English「Charter」），支持草稿暂存、
  冲突保留、预览、归档/恢复、替代、待审审阅（历史草案溢出；模型提议入口预留）、清除确认、进度和验证操作。标签
  以稳定的高 order（1000）只注册一次，排在 Chat/Trajectory 和常见插件标签之后，不会重新注册。
- 按 Session 授权的 Remote stream 和 edit 端点。
- DSH 0.1.7-rc.2 / 0.2.0 兼容层（`@Remote` 资源回退、prompt-context 扩展字段、actor 回退），以及针对旧版
  prompt 变量插值器的转义。
- 自包含 factory 形式的浏览器 bundle，内联 CSS、打包 zod，符合 DSH Web module loader 契约。
- 新浏览器 client 可以兼容仍在运行旧 Host 的 view snapshot（旧 Host 仍带 active 条数字段），避免 host/client
  revision 不一致时「会话契约」白屏；新的 pending 导入语义仍需要完整重启 Host 才生效。
- 已针对 DSH `0.2.1-rc.2` 验证，无需代码改动；现有 peer range 和兼容层已覆盖该 release candidate。
- 260 个测试，覆盖内核、Host 组合、fork、幂等、配额、prompt 边界、Remote stream、历史抽取、客户端 tab
  排序和装饰器兼容。已在 DSH `0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`、`0.2.1-rc.1`、`0.2.1-rc.2` 上验证。
  真实 Web UI 在 `0.2.0-rc.2` 上验证了标签顺序、中英文切换、目标/约束编辑、预览、Apply 和刷新持久化。

### 安全

- 感知 Peer principal 的 Remote actor 解析：DSH 0.2.1+ 要求 `PeerScope.principal`。principal 缺失时返回
  `FORBIDDEN`，不再提升为 `owner`；只有确认运行时是 DSH 0.1.7/0.2.0（协议无 principal 字段）才使用 owner 回退。
- 用户正文永远不进入 system-role 消息。
- 模型没有会话契约写能力。
- DSH 0.1.7-rc.2 和 0.2.0 无法执行 per-Peer Remote 资源授权；插件降级为 live-Session 和 lifecycle 校验，
  并在文档中说明限制。

### 已知限制

- 最大规模的会话契约仍会在 watch/edit 帧中携带完整条目集合；把历史拆成可分页的 Remote 端点是后续工作。
- `charter_read` 的 `standing` 是完整工作集，没有固定字节上限；最大规模的会话契约可能产生较大的 tool result。
  分页或显式响应 cap 是后续工作，本轮不做。
- 活跃客户端草稿不受额外字节上限约束（受 UI 输入限制）；idle TTL/LRU 约束的是已释放草稿，而不是当前挂载的
  编辑器/bootstrap 面板持有的文本。
- 当前树是 `0.1.0-rc.1` 预发布，使用非 latest 的 `npm publish --tag next` 发布；稳定 `latest` 还需要重启后
  对已安装 profile 的复核。发布状态前置项（仓库元数据、tag 顺序、CI 门禁）只记录在 `docs/releasing.zh.md`。
- 压缩后重新物化依赖 DSH 的 runtime-context projection 契约；真实模型端到端 PASS 已记录在验证记录 8.4
  （2026-10-22）。
- 浏览器交互在 `0.2.0-rc.2` 上验证；0.1.7/0.2.1 仅通过 typecheck/build/tests，未逐版重复交互流程。
- 默认配额尚未用生产样本校准。
- 历史抽取是确定性启发式；摘要中的陈旧或噪声条目可能进入草案，必须人工审阅。

### 修复

- watch unsubscribe 增加实例校验：已 dispose 的旧 generation 迟到 unsubscribe 时，不再删除同 ID 新 watch 的 Map
  条目（只有仍持有捕获 Set 时才删除）。
- 修复 attach/stream generation 竞态：同 Remote 的重复 attach 是真正 no-op；旧 stream 的 `replace`/`update` 帧
  在触达状态或 draft lifecycle 前先检查 generation。
- 把待生效的 Remote attach 记录为可取消状态：若上一个 stream 尚未 dispose 完成就收到 detach，则取消待生效的
  attach generation，被取消的 attach 恢复后也绝不会迟到启动 stream；source 保持 detached 状态。
- Apply/bootstrap 保存期间禁用并拒绝 Rebase，保留未知结果重试所需的 mutation attempt；bootstrap 抽取结果绑定
  source 实例/connection generation，重连后的旧 proposal 不会写入当前 draft。
- 不静默清除脏 draft：idle TTL 和 LRU 容量淘汰只针对空 draft，容量淘汰同时清理时间戳；staged ops、编辑器文本和
  已审阅历史草案会跨标签/Session 切换保留。
- 编辑器允许提交已超预算 objective/同 ID item 的分步缩短，与 Host 准入一致；新增或增长内容仍受硬上限约束。
- 重连时首次出现的 lifecycle fingerprint 即使 revision 更低也按权威替换接受；Client 帧去重加入
  `overBudget` 与全部 limits，预算收紧后的快照不会被丢弃。
- Session dispose 时关闭所有打开的 watch 订阅（listener 收到 `null`，generator 退出），避免 listener 已从 map 删除
  后 watch 永久等待；Host 帧去重和 Client 接受都改为比较 lifecycle，新 lifecycle 即使 revision 从 0 重新开始也会
  被接受。
- 请求在途时锁定草稿变更：Apply 期间 Unstage 被拒绝且按钮禁用；bootstrap 保存期间目标、候选、checkbox、全选
  全部禁用，setter 拒绝修改；保留的 bootstrap 请求只有在 ops 和 base revision 仍与已审阅 plan 一致时才重放，
  `dismissBootstrap` 会清除 attempt。
- `isEmpty` 把非空 bootstrap 草案视为 dirty，Chat/Charter 切换时 lease-release 清理不再删除已审阅的历史草案。
- 已超预算的 objective/item 允许继续分步缩短，即使仍高于上限，也能在预算收紧后逐步收敛。
- Apply 按钮与 Host 的 `overLimitGrowth` 规则完全一致：渲染后的 prompt 仍超限但缩小或保持同字节时允许提交；
  只有变大时才保持禁用。
- 把两条堆叠的超预算提示合并为一条带单一处理建议的提示；替代/验证失败原因改为条目行内可见文本，行内操作后
  焦点回到条目行而不是掉到 `<body>`。
- 修正 live region 模式：`status`/`alert` 只包裹消息文本，操作按钮不再嵌套在 live region 内；历史草案的 idle
  阶段显示专门的“尚未加载草案”文案，而不是“已抽取草案”的文案。
- 主按钮 fill/hover、内容字号和字体族改用真实 DSH 语义 token；统一中文 UI 术语（章节 / 待审 / 硬约束 /
  会话 / 标记为未验证）。
- `maxObjectiveBytes` 大于 `all` envelope 时，省略 objective 并返回 `objectiveTruncated: true`，不再突破响应
  上限；`shadowedTokenCount` 在进入 Remote codec 前校验为非负整数。
- 在证据比较前，把旧版 debug 形状的 `charter_read` tool result（未重启 Host 返回的额外
  id/review/lifecycle 字段）归一到当前紧凑 standing 投影；并在验证记录 8.4 记录真实模型 compaction PASS。
- compaction checker 的所有成功条件都参与退出码：按 Host 的紧凑 standing 投影比较，system prompt 被污染会失败，
  并且现在**必需**一个位于最近一次 compaction 之后、与当前 revision/objective 匹配的 `charter_read` standing
  结果（压缩后读取缺失或不匹配都是 FAIL；压缩前的读取按 seq 忽略）；摘要泄漏记为 warning；fixture 覆盖每种组合。
- edit/bootstrap 的异步 Apply 结果按 draft generation、source connection epoch、source 实例、lifecycle 和请求
  身份围栏：已销毁 source 或 detach/reattach 周期的迟到结果不能清除或覆盖新草稿；source 失效时保留 mutation id，
  通过新 source 重试仍幂等。
- 最后一个 lease 释放后立即清理空 draft，并加 idle TTL 与 released-draft 上限；运行期损坏记录被就地修复后，
  下一次访问/初始化会重新解析并恢复，无需重启 Host；仍不合法的文档保持隔离且绝不被覆盖。
- 在 service 和 `commitRecord()` 两层执行 actor 策略：拒绝 `host` 编辑；`user` 可普通编辑但不能 `item.purge`；
  `owner` 可 purge；被拒绝的调用不改变 storage、revision 或已发布 view。
- 在核心操作层拒绝 purge active accepted 或 pending item；只有 archived、rejected 或替代链条目可清除。
- 检测父 Session 自引用、多节点环和深度溢出，不再让初始化 Promise 永久等待。
- 最新合法摘要无法生成候选时回退到更旧的可用摘要。
- 增加 bootstrap 失败重试/过期请求处理；view 卸载时释放每 Session source；修复 detach generation 竞态。
- `charter_read` 的 `all` 视图限制为 64 条 / 32 KiB，并报告省略数量。
- 将已弃用的 `snapshotEvents()` 读取隔离在一个兼容适配器中。这是已知技术债，不是已完成的迁移：
  DSH 0.2.1-rc.2 尚未提供公开的非弃用历史事件读取接口。
- 为 `item.propose` 的 clientRef 铸造 Host id，使同时包含 active 条目与溢出提案的历史 Apply 能原子提交，
  而不再以 `INVALID_REFERENCE` 失败。
- 客户端 source 释放改为实例绑定的 lease + 引用计数：多个 view binding 共享同一 stream，只有最后一个 lease
  释放时才 dispose；旧 lease 不能再释放新 binding 的 source。
- `bootstrap` 的 `not-live` / `no-summary` / `unavailable` 原因会显示并提供 Retry；允许后续 view/lifecycle
  变化后重新请求；请求返回时用户已开始编辑则静默丢弃，不显示 stale 错误。
- stream snapshot/update 也校验 `view.sessionId`，不再只校验 edit 响应。
- view binding 切换 Session 时完整重置 Pane 草稿状态，并让 Apply 通过绑定 Session 的请求构造器提交，保证一个
  Session 的暂存 ops 不会被写到另一个 Session；异步 Apply 完成时用 Session generation 围栏丢弃过期结果。
- opening runtime snapshot 改为按 revision 单调更新，旧的 stream generation 不能再把已接受的 view 回退。
- `charter_read` 的 standing 返回完整工作集；只有 `all` 调试视图分页。
- Remote wire schema 接受 `maxPendingItems: 0`，与可关闭 proposal 的 Host 配置一致。
- 文档将 `item.propose` 定位为普通客户端编辑操作（模型不可见），不再称其为 host-internal 操作。
- 存储记录在每次运行期读取和写入路径（`recordFor`、只读 view、parent/fork 读取、`table.update` transform）都
  重新做严格 schema 校验，而不再只在启动时校验一次；运行期变成不合法的记录只禁用该 Session，且绝不被覆盖。
- Remote 装饰失败改为 fail closed：只有文档化的 “不支持装饰器选项” 错误才走 legacy 无 resources 路径；现代
  factory 的任意其他异常直接抛出，避免被误判为旧版而让缺 principal 的调用回退到 owner。
- 客户端草稿绑定 Session lifecycle 指纹，并对已释放草稿做有界 LRU；同一 Session id 被新 lifecycle 复用时
  不会继承旧草稿，长时间浏览也不会无界增长内存。
- 客户端复用 Host 的文本规范化规则：编辑器与历史候选会在编辑阶段拒绝控制字符和孤立 surrogate，并给出本地化
  反馈，而不是等到 Apply 才报通用错误。
- active UI 计数和列表只包含 accepted + current；pending proposal 仍在各自 section 可见；连接重试时显示非阻塞
  提示，说明暂时只读并展示最近一次确认状态。
- `charter_read all` 返回完整的有界调试投影（origin/order/createdRevision/替代链/验证来源），最终 tool
  envelope 限制在 32 KiB；超预算状态纳入 history/mutation 数量上限。
- CI 增加打包产物 smoke（tarball 可安装、exports 可解析、client bundle 可加载）；移除多余的
  `@deepseek-ai/schemastery` peer 声明；明确预发布与 compaction 验收口径。
- 存储记录校验按 Session 隔离：domain 边界保留原始文档，service 逐条解析；单条损坏或前向不兼容的记录只让该
  Session 不可用，其他 Session 仍可读写，原始文档保留用于诊断。
- 结构校验与配额准入分离：事后收紧预算时契约显示为 `overBudget` 而不是损坏，停止注入，并允许缩小的编辑逐步
  收敛；不可用的 profile 配置会被抬到文档化的最小值并记录 warning；view 暴露 `maxRecordBytes`。
- 在操作层强制单跳替代模型：对替代项归档/再次替换返回 `INVALID_TRANSITION` 而不是 `CORRUPT_STATE`；UI
  提供受支持的清理路径（清除被替代的前任以解除后继关联）。
- 按不可变 record 对象缓存校验，用 snapshot digest 比较代替全量 JSON 序列化；历史草案改为单遍规划（附带
  精确渲染校验/回退），病态单行摘要用累计字节数拆分。
- Pane 草稿所有权移到 per-Session store：暂存修改、行内编辑器、新条目输入、反馈和已审阅历史草案在切到
  对话/轨迹再回来时保留。Apply 对未知结果重试复用稳定 mutation id，冲突后提供“应用到最新修订”，连接失败
  有可用的 Retry 路径（含 attach watchdog 与重新挂载 stream）。
- Pane 渲染投影后的草稿视图：暂存条目立即可见，计数区分 active/pending/history，历史条目默认折叠，条目
  操作移入可访问的逐行菜单，sticky footer 同步历史草案的 Apply/Discard。
- bootstrap 改为持久化 phase machine（checking / draft / no-summary / not-live / failed / unavailable /
  dismissed），Overview 提供 callout 与稳定的“重新检查”，用户编辑时不再抢占当前 section。
- 反馈与 bootstrap 错误改为与语言无关的描述符；redirect reason 改为可选，不再把 UI 文案写入记录；字节
  单位、计数、验证来源和预览标签全部本地化。
- 加固 `npm run verify:compaction`：校验 storage record 结构、支持 `--store`、比较完整的 `charter_read`
  standing 投影、检查多个 system-prompt 泄漏信号；并在文档中明确它是手工检查（自动门禁不运行模型）。
- 会话契约 Conversation View 改为以稳定 order 1000 只注册一次，不再随 slot 变化重新注册：两个都想“永远最后”的
  插件不会互相无限重排，bundle 也不再查询或订阅 slot roster。
- 收紧所有 DSH peer 依赖范围到已测试兼容矩阵中的五个版本
  （`0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2`）。
- bootstrap 规划改为与精确渲染一致的 O(1) 增量字节核算（objective token + 拼接的 invariant/deliverable
  token）；完整渲染保留为校验/回退，并新增 3,000 个全 active 候选的测试。
- 条目操作菜单改为普通 `<details>` disclosure（不声明 `menu`/`menuitem` ARIA 契约），purge 确认按钮自动聚焦、
  取消后焦点回到 summary，行内操作后键盘焦点留在条目行。
- 预览中清除被替代的前任时同步解除后继的 `supersedes` 关联，与 Host purge 语义一致。
- 安装文档改为渠道中性（不可变 tarball 不再声明 registry 不可用），并记录正确的发布顺序：仓库元数据 → CI →
  已验证产物 → tag → 发布。
- `package-smoke` 的措辞与实际检查一致（packed `core` import + root/remote export/文件存在性）；Host/Remote
  运行时 import 继续由工作区 build smoke 覆盖。
- compaction checker 的 `charter_read` 证据必须认证 tool call：优先用 top-level `sourceEventSeqs` 解析唯一 call
  （legacy 用 callId），且 call 必须晚于最近一次 compaction **与** runtime-context 快照、使用默认/standing
  view、结果为非 error 且晚于 call；fixture 覆盖每种拒绝路径。
- `engines.dsh` 与 peer ranges 收紧为同样五个精确已验证版本；并说明未来 `0.2.x` 在验证并扩展兼容矩阵前不在
  覆盖范围内。
- bootstrap planner 在增量字节核算前用 `inspectUserText` 归一草案文本，CRLF/NFD 候选仍走 O(1) 路径；新增
  2,000-4,000 个 CRLF/NFD 候选的覆盖。
- purge 后解除关联的后继标记为派生暂存行（`unstageTarget: null`），面板不会提供无法移除任何操作的 Unstage
  按钮。
- 可变发布状态措辞只保留在 `docs/releasing.zh.md`，不进入不可变 tarball 文档；仓库/CI/tag 前置项、
  禁止临时 tag 规则、以及 final tag 前必须刷新文档的要求都记录在发布清单中。
- 连接就绪与业务数据去重分离：retry/reattach 收到相同 revision 时恢复 `ready` 并清除首帧 watchdog，而已 ready
  的面板收到相同 revision 仍然去重；结束/失败的 snapshot stream 是终止状态，Retry 会重建 Remote watch 而不是
  重启已中止的 lifetime（覆盖首个快照前后）。
- 编辑器打开时冻结 revision baseline，无关的远端提交不会静默把 objective/item 编辑改到新 revision；只有显式
  rebase 才推进 baseline，后续暂存也不会推进已冻结批次的 baseline。
- 字节预算、unchanged 比较、reason、候选上限与生成的 op 文本都基于 `inspectUserText(...).value` 计算，
  CRLF/NFD 输入不能绕过或浪费上限；只做归一化的编辑视为 unchanged。
- 下一个暂存 order 取 committed max 与当前 staged add/propose/supersede/order-edit 最大有效 order 的较大者 + 1，
  add/unstage/add 不会复用 order；`Unstage` 按真实 op-target 规则推导，purge 派生后继仍保留自己的可移除操作。
- 只有估算与渲染确实不一致时才走 quadratic bootstrap-planner fallback：base prompt 已超预算时直接返回全
  pending 计划、不逐候选重渲染，并通过 `usedExactFallback` / `exactRenders` 暴露诊断。
- compaction checker 改为纯事件数组求值：只接受完整的 start+summary+无 error end 生命周期，要求 charter 在
  compaction start 之前提交，按 `compactionId` 关联 checkpoint 的泄漏 warning，将压缩后执行但无 runtime 快照
  判为 FAIL，并让 legacy 重复 call id 按 turn/step + 事件顺序配对。
- 诚实收窄存储保留保证：只覆盖内部 schema/一致性不合法的记录；外层 JSON 不可读的文档会被 JSON storage backend
  当作不存在，仍是已记录的残留风险（插件侧没有读取错误 API，也不做路径特判）。
  用户手册、设计验收条款、验证记录和发布清单现在把两类情况拆开说明，并给出外层不可读的恢复方式（停止 Host，
  从备份恢复文件）。
- 终止的 snapshot stream 失败时先推进 connection epoch 再发布 error：在途草稿请求被失效，但暂存 ops 与 mutation
  id 保留；迟到的 Apply 成功不再被接受，Retry 复用同一 mutation id。
- 编辑器或已审阅历史草案持有其他 baseline 时拒绝 Rebase：Pane 通过同一个 `rebaseAvailable` 谓词隐藏 Rebase
  操作，store 也拒绝该调用，显式解决冲突时不会静默改到审阅过的 revision。
- 审阅历史草案被接受时捕获 `bootstrapBaseRevision`；Apply 使用该 revision，且准入要求当前 view 仍匹配它、
  objective/items 仍为空，否则草案变为 stale 并要求重新提取，绝不静默应用到更新的 revision。
- 所有暂存编辑批次统一走共享 `draftAdmission`（maxOps、投影后 maxItems、投影后 maxPendingItems 的 Host 逐步
  规则、以及 prompt 预算增长/缩短规则）：Pane 的 Apply 按钮与 `applyDraft` 判断一致，不可准入的批次不会到达
  Remote。
- 工作行按单一已排序投影列表渲染，而不是 active 后接 pending 分组：pending 的 order-1 行保持排在 active 的
  order-2 行之前，接受它也不会重排列表。
- 旧 Host 没有 fingerprint 时，首次收到 fingerprint 只对空草稿生效；有未保存内容时按 lifecycle 变更重置
  （保留 section），不把旧工作认领到新 lifecycle。
- 收紧 compaction checker：严格按 seq 排序的 start→summary→end attempt 状态机（乱序或重复 id 不会 PASS）；
  现代 `charter_read` producing-call 认证（source seqs 必须恰好指向一个更早的 charter_read call，且
  toolCallId/turn/step 匹配）；严格解析 arguments（只有缺省/普通对象/`standing` 有效）；压缩后没有请求活动时
  返回 WAIT exit 3（只有已执行请求但无 runtime 快照才是 FAIL）；checkpoint 只按 compactionId 关联、仅对无 id
  的 checkpoint 做 positional fallback；transcript parser 遇到中间损坏会带行号拒绝而不是跳过。
- 对可重试的未知结果 edit 请求先原样 replay（同一 mutationId/baseRevision/ops），再考虑当前 admission/limit
  检查，确保已提交但响应丢失的批次既不丢失也不重复；attempt 未解决时阻止 Rebase，replay 返回确定性冲突后清除
  attempt 并重新允许 Rebase。
- bootstrap lifecycle 处理改为原子顺序：Pane 先 bind lifecycle 再开始 extraction；旧 Host 首次收到真实
  fingerprint 时会使在未知 lifecycle 下启动的 extraction 失效并重新提取；切换 lifecycle 会丢弃旧结果、只接受
  新结果；已审阅草案变为 stale 时走单一清理路径（objective/items/base/attempt/generation 全部清除，
  `isEmpty` 为 true）。
- bootstrap 草案在到达 Remote 前先经过 store 预检（共享 admission + 草案文本校验）；admission 增加 Host 的
  objective/item 字段预算规则（超限时允许 unchanged 或严格缩短，拒绝新增、增长或等字节但内容不同的值）。
- checker 后续修正：区分“缺少 sourceEventSeqs”与“存在但格式错误”（后者不得回退 legacy）；考虑其后的 landed
  失败/未完成 compaction attempt（失败但已 landing checkpoint 时 FAIL，attempt 未完成时 WAIT）；无压缩后活动
  的 WAIT 不再包含伪 evidence failure；CLI 正确渲染 OPEN 的 compaction attempt，而不是格式化缺失的 end time。
- `smoke:package` 增加 exact-artifact 模式（`--artifact <tgz> --sha256 <sums>`）：校验给定 archive 的 SHA-256，
  并对这批确切字节执行完整 consumer 检查，不 build、不 pack；`npm pack --json` 改为完整解析（object、以包名
  为 key 的 object、或单元素数组），不再从第一个 `{` 截取。
- 未知结果 Apply 未解决时通过共享 `editReplayPending` 锁住所有草稿编辑：Pane 显示可用的 **Retry last Apply**，
  忽略 revision conflict/fresh admission 并原样 replay 已存请求（同 mutationId/baseRevision/ops）；
  stage/unstage/add/编辑器/discard 均为 no-op，Rebase 在确定性回复清除 attempt 前保持阻止。
- bootstrap Apply 采用同样的未知结果处理：在 stale/text/plan/limit 检查前 replay retained request、锁住
  objective/候选/选择编辑、成功反馈计数来自 retained request；RPC 在途期间流变化只标记 needs-stale 而不
  half-dismiss，保留已审阅 payload，显式 Dismiss 是唯一完整清理。
- exact-artifact smoke 增加 tar 安全与一致性校验：拒绝绝对路径/穿越/链接/特殊成员/重复成员/package 外路径，
  从 archive 内读取 `package.json` 并校验其身份/files/exports/dependencies/peers/engines 与工作树一致，
  只安装这棵已验证的树。
- 收紧 compaction checker 的 release-blocking 边界：检查成功证据之后的**所有** attempt（landed-failed 后面
  跟更新的 unlanded attempt 仍 FAIL；同 id retry 的 checkpoint 按 attempt seq 区间关联）；现代
  `charter_read` 的 toolCallId/turn/step 必须存在且精确相等；校验 transcript event envelope（形状/type/seq/
  time/data/严格递增）并带行号报错；WAIT 状态内部一致（`verification.evaluated=false`、failures 为空、无
  FAIL verdict line，只有已评估的 active evidence 才能 FAIL）。
- 修正发布文档：CI 运行 `npm run check` 与普通 `npm run smoke:package`；exact-artifact 检查是构建最终 tarball
  之后、打 tag/推送/发布之前的本地发布门禁，若要放进 CI 需要单独的 release workflow。
- edit 与 bootstrap 共用统一的未知结果 attempt 生命周期（持久 `{request, sourceGeneration, status:
  in-flight|unknown}`）：传输失败与任何 UNAVAILABLE（含 source 未 attach/remote 不可用）转为 unknown 且不清
  mutationId/baseRevision/ops；unknown 期间所有 request-changing 操作与普通 discard/dismiss 被锁；Retry 在任何
  conflict/admission 检查前原样重发 retained request；单独的确认式 **Abandon unknown request** 是唯一清除
  attempt 的路径；in-flight/unknown bootstrap Apply 期间的流帧只标记 needs-stale 并保留可见可 replay payload。
  测试走真实 controller/store 路径（丢失 M1 + source 脱离 + UNAVAILABLE → exact replay 只应用一次；bootstrap
  先流帧后传输错误 → 可见可 replay 草案）。
- package-smoke 用结构化 Node ustar/PAX 解析器替换 `tar -v` 文本解析（node:zlib + 512 字节 header、checksum
  校验、GNU longname/longlink 与 PAX path；只接受普通文件/目录；拒绝链接/特殊类型/绝对/穿越/反斜杠/package 外/
  重复/截断/坏 checksum 成员），安装前从解析出的 archive 读取 `package/package.json`，并用 JS 构造的
  GNU/BSD/PAX 测试 archive 覆盖——Ubuntu GNU tar/`LC_ALL` 差异不再影响解析，normal 与 exact-artifact smoke 均在
  真实最终 tarball 上通过。
- edit 与 bootstrap replay 的未知结果分类集中化：任何 UNAVAILABLE 结果（包括 source 脱离或 `ok:false` 的
  UNAVAILABLE 回复）与任何传输异常都转为 `unknown`；attempt 清除审计保证 generation/lifecycle/source 变化保留
  精确的 mutationId/base/ops，view 帧不再能丢掉可 replay 的 attempt。Pane 改为单一 `syncView` effect + 单一
  store 方法（bind lifecycle → ensure bootstrap → 原子 reconcile 已审阅草案），因此 in-flight 或 replay-pending
  的 bootstrap Apply 绝不会变得不可见；`ensureBootstrap` 只负责启动抽取，所有 dismissal/cleanup 由原子 reconcile
  路径拥有（Retry/Abandon 保持可见，unknown 期间普通 dismiss 保持锁定）。
- 发布前置条件/已知限制文档化：公开仓库 + remote、恢复元数据、验证私有安全报告、公开 Node 22.19/24 CI（仅
  check + normal smoke）、只构建一次最终 tarball、对同一文件做 exact-artifact smoke + SHA + fresh-profile UI
  检查、最终 annotated tag，然后 GitHub Release 与 `npm publish --tag next` 复用该 tarball；已接受的非阻塞限制
  在验证记录第 9 节披露。
