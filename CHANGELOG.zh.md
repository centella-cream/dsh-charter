# 更新日志

[English](CHANGELOG.md) | 中文

记录 `dsh-charter` 的重要变更。DSH 插件 ABI 仍在演进，项目保持 pre-1.0 版本线。

## 0.1.0 — 未发布

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
- 重新设计 Charter 面板：使用 DSH 语义 token，紧凑页头与预算条、吸顶预览/丢弃/应用工具栏、目标卡片、
  响应式硬约束/交付物双栏、hover/focus 条目操作、section 内联添加输入，并支持明暗主题。
- 默认预算提升到 8 KiB context、4 KiB 目标、1 KiB 单条条目。任何路径都不静默截断：超长历史草案条目拆成
  多个候选，超限字段高亮。历史导入以真实上下文预算为准，不再用 per-kind active 条数拒绝整个草案：放不下的
  候选会在同一次原子 Apply 中保存为待审提案（`item.propose`），不会丢弃或截断。
- 移除 per-kind active 条数上限；存储限制提高到 `maxItems` 512、`maxPendingItems` 512、`maxOps` 1024、
  `maxRecordBytes` 1 MiB。
- 已有压缩历史且会话契约为空的 Session 会自动显示从最近一次压缩摘要确定性抽取的只读草案；不调用模型、不自动
  写入。用户编辑/取消勾选后点击应用才会生效。
- 完整的 Charter 标签页与面板中英文界面，由 `dsh-client-locale` 和 DSH 当前语言驱动；计数、状态、按钮、
  占位符和错误码文案均包含在内。
- 主对话页 `conversation.view` 的 Charter 标签页（中文「会话契约」/ English「Charter」），支持草稿暂存、
  冲突保留、预览、归档/恢复、替代、待确认审阅（历史草案溢出；模型提议入口预留）、清除确认、进度和验证操作。标签跟随 Chat/Trajectory，
  并动态排到后续注册的插件标签之后。
- 按 Session 授权的 Remote stream 和 edit 端点。
- DSH 0.1.7-rc.2 / 0.2.0 兼容层（`@Remote` 资源回退、prompt-context 扩展字段、actor 回退），以及针对旧版
  prompt 变量插值器的转义。
- 自包含 factory 形式的浏览器 bundle，内联 CSS、打包 zod，符合 DSH Web module loader 契约。
- 新浏览器 client 可以兼容仍在运行旧 Host 的 view snapshot（旧 Host 仍带 active 条数字段），避免 host/client
  revision 不一致时「会话契约」白屏；新的 pending 导入语义仍需要完整重启 Host 才生效。
- 已针对 DSH `0.2.1-rc.2` 验证，无需代码改动；现有 peer range 和兼容层已覆盖该 release candidate。
- 90 个测试，覆盖内核、Host 组合、fork、幂等、配额、prompt 边界、Remote stream、历史抽取、客户端 tab
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

- 压缩后重新物化依赖 DSH 的 runtime-context projection 契约；完整 compaction 端到端仍需要真实模型会话。
- 浏览器交互在 `0.2.0-rc.2` 上验证；0.1.7/0.2.1 仅通过 typecheck/build/tests，未逐版重复交互流程。
- 默认配额尚未用生产样本校准。
- 历史抽取是确定性启发式；摘要中的陈旧或噪声条目可能进入草案，必须人工审阅。

### 修复

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
- 加固 `npm run verify:compaction`：校验 storage record 结构、支持 `--store`、比较完整的 `charter_read`
  standing 投影、检查多个 system-prompt 泄漏信号；并在文档中明确它是手工检查（自动门禁不运行模型）。
