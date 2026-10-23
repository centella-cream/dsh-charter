# 安全策略

[English](SECURITY.md) | 中文

## 支持版本

安全修复以当前 `0.1.x` 版本线为目标。推荐运行时为 DSH `0.2.1+`，因为它提供 per-Peer Remote 资源授权。
DSH `0.1.7` / `0.2.0` 只能校验 Session 是否 live、lifecycle identity 是否匹配，请在可信单操作者环境使用。

## 报告漏洞

**疑似漏洞不要开公开 issue。**

请通过仓库的 GitHub Security Advisories 私密渠道报告：<https://github.com/centella-cream/dsh-charter/security/advisories/new>，并提供：

- 受影响版本/commit；
- DSH 版本和 profile 类型；
- 复现步骤或 PoC；
- 影响评估；
- 建议修复（如有）。

请给 triage 和 coordinated disclosure 留出合理时间。报告中不要包含真实 API key、凭据或私人用户内容。

## 威胁模型

`dsh-charter` 把用户编辑的会话契约正文视为**不可信用户内容**：

- 通过 `systemPrompt.context()` 以 user role 注入，绝不作为 system message；
- 不得覆盖 Host policy、工具权限、sandbox 规则或执行守卫；
- 模型只有 `charter_read`，没有写工具或可用写 Remote；
- Host 执行 actor 策略：`owner` 可执行所有编辑（含 purge）；`user` 可普通编辑但不能 purge；`host` 在 Remote
  edit 路径上被拒绝；
- core 也拒绝 purge active accepted 或 pending item，直接调用 API 无法绕过 UI 保护；
- 存储记录绑定 Session lifecycle identity；同一 Session id 但 `createdAt`、`cwd`、`parentSession` 不同会被拒绝；
- UI 文案本地化，原始 storage 错误不会作为指令式内容渲染；
- 普通日志不记录用户正文和证据摘录。

## 不在范围内

- 模型主动不遵守会话契约。会话契约是声明，不是强制机制。
- 用户会话契约正文内的 prompt injection 被模型执行。硬限制请使用 Host policy、sandbox、approval 和工具守卫。
- 多进程 `domain/changed` 实时同步；插件按单 Host 进程设计。
- 在插件之外删除 profile、domain 或 storage 目录造成的数据丢失。
