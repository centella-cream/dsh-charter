# dsh-charter

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-centella--cream%2Fdsh--charter-181717?logo=github)](https://github.com/centella-cream/dsh-charter)
[![DSH](https://img.shields.io/badge/DSH-9%20verified%20versions-4b6bfb)](docs/design/compatibility.zh.md)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](package.json)
[![Status: preview](https://img.shields.io/badge/status-preview-orange)](#状态)

[English](README.md) | 中文

> **压缩会改写历史，但不会改写你的承诺。**

`dsh-charter` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的持久化、用户所有的
会话契约插件。目标、硬约束、交付物、证据和依赖状态在上下文压缩后仍然保留，并且始终可查看、可编辑。

## 状态

- **已发布版本：**`0.1.0-rc.6` 是当前 npm 公开发布版本。
- **发布候选：**`0.2.0` 已在 `feat/0.2.0-workspace` 准备，发布通过受保护 workflow 完成。
- **主要 DSH 基线：**`0.2.2-rc.1`；九个声明版本通过源码矩阵验证。
- 从 `0.2.0` 起版本号使用普通递增（`0.2.0`、`0.2.1`…），不再使用 `rc` 后缀。

## 功能

压缩可能丢掉“交付前运行测试”“保持 API 兼容”等长期约束。`dsh-charter` 将这些内容保存在独立的用户所有记录中，
并在每次模型请求前确定性重建模型可见上下文。

- **独立正本。**每个 Session 只有一个 `dsh-storage-domain` 记录；压缩摘要和 UI 缓存不能写入或恢复它。
- **用户角色。**契约正文进入 user-role runtime context，不进入 system message；模型可读不可写。
- **原子 Apply。**一个 Change Set 要么完整提交，要么不提交；带 revision 冲突、幂等重试和 Host canonical
  preview digest。
- **安全接入。**压缩过的 Session 可生成只读历史草案；用户确认前不会生效。
- **有界与可恢复。**prompt/record 预算显式可见；溢出不会被静默截断。导出/恢复和 write-uncertain fencing
  保护存储记录。

## 0.2 核心亮点：约束关系

0.2.0 最核心的变化，是 deliverable 不再是一份互不相关的顺序清单。一个 deliverable 可以声明对其他
deliverable 的**前置约束**，而这些关系会进入存储契约、校验边界、UI 计划和模型可见 prompt。

```text
测试 (D1) ────────────┐
迁移 (D2) ────────────┴──> 发布 (D3)
```

- **类型化、可校验的关系。**每个 deliverable 可携带 `requires: [id…]`。Host 拒绝自环、重复前置、
  悬空引用、非 active 端点和环；整个 Change Set 原子失败，不会写入半张图。
- **确定性的依赖投影。**standing deliverable 按 canonical 拓扑顺序获得稳定 `D<n>` key；prompt 按前置
  在前、依赖在后的顺序渲染，模型因此知道哪些承诺可以执行、必须先完成什么。
- **派生 readiness，而不是第二个持久状态。**readiness 由 acceptance、lifecycle、前置 readiness 和
  progress 派生：`ready`、`waiting`、`blocked`、`dependency-conflict`、`in-progress` 或 `terminal`，
  不保存一份容易过期的重复状态。
- **Pane 中可见、可编辑。**Workspace 展示依赖计划和前置选择器；非法图会显示冲突提示而不是拖垮 Pane，
  图不一致时禁用 Apply。
- **生命周期安全。**archive、restore、supersede、fork 和 proposal acceptance 都会校验或重映射关系；
  `proposedRequires` 让 pending deliverable 引用候选前置条件，接受时解析为正式 requires。
- **有界且安全。**关系集合同样受 record 和 prompt 预算约束，不引入独立的图正本。

这是一条明确边界：依赖是用户编写的**执行约束**，不是强制 sandbox 或权限系统。

## 其他 0.2 能力

- 三个一级区域：**Workspace**、**Review Center**、**Diagnostics & Maintenance**。
- record schema v2、内存 v1 迁移、proposal batch、类型化 provenance 和 objective proposal。
- `summary`/`watchSummary` 及分页 item/proposal/change query；Pane 使用 summary + query，完整 watch 仅作为兼容回退。
- pending-only `charter_propose`；用户触发的 message proposal（选择器、范围、kind）。
- Evidence Integrity 与 Fact Validity，以及 owner-only 注册式验证器：
  `workspace.path-exists`、`workspace.file-digest`、`workspace.file-contains`。
- message/compaction-summary/agent-tool batch 的 source integrity 投影复算；fork source integrity 明确返回
  `unsupported`。
- fork 的 item/validity/evidence/依赖重映射；Recovery Center 支持 export/initialize/restore。

契约是声明，不是强制执行策略。需要机器强制的限制请使用 Host permissions、sandbox policy、hooks 或执行守卫。

## 安装

当前公开版本是 `0.1.0-rc.6`；0.2.0 发布候选在正式发布前通过候选 tarball 安装：

```bash
npm pack
dsh plugin --profile web add ./dsh-charter-0.2.0.tgz
```

正式发布后，使用精确版本安装：

```bash
dsh plugin --profile web add dsh-charter@0.2.0
```

Desktop 请使用 **Desktop → Plugins → Install/Update**；若 Desktop 构建支持本地插件导入，也可导入同一 tarball。
`dsh plugin --profile desktop` 会被拥有该 profile 的 Electron 应用拒绝。

插件必须运行在已声明 DSH 版本上：

| DSH 版本 | 状态 |
| --- | --- |
| `0.1.7-rc.2` | 支持（最低版本） |
| `0.2.0-rc.1` / `0.2.0-rc.2` | 支持 |
| `0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.1-rc.5` | 支持 |
| `0.2.2-rc.1` | 支持（主基线） |
| `0.3.x` | 验证前不声明 |

完整证据和降级说明见[兼容矩阵](docs/design/compatibility.zh.md)。Node.js 要求 `^22.19.0 || >=24.0.0`。

## 快速开始

1. 打开一个 live Session，选择 **Charter** 标签页。
2. 设置 objective，添加 invariant/deliverable，按需配置 `requires`。
3. 检查精确的模型可见 preview，点击 **Apply**。
4. 在 Review Center 接受或拒绝 pending proposal；Diagnostics & Maintenance 提供 source integrity、validator、
   record health、export 和 restore。

已有压缩历史的 Session 可以从最新可用 compaction summary 生成草案；只应用需要生效的部分。

## 配置

在 profile patch 中覆盖默认值：

```yaml
- id: charter
  config:
    maxPromptBytes: 8192
    maxObjectiveBytes: 4096
    maxItemBytes: 1024
    contextOrder: 130
```

完整 limits 见[用户指南](docs/user-guide.zh.md)。模型可见容量只有 `maxPromptBytes`；`maxItems` 和
`maxPendingItems` 约束存储记录。

## 安全

- 用户正文不会进入 system-role message。
- 模型没有写权限；`charter_read` 只读。
- `owner` 可执行包括 purge 在内的所有编辑；`user` 可执行普通编辑但不能 purge；Host-only validator 结果
  不能由客户端 edit 路径伪造。
- 注册式 validator 仅 owner 可运行，只读取 Session workspace 内文件，受文件/字节/deadline 边界约束，
  不执行任意 shell。
- 普通日志只包含 id、kind、revision 和错误码，不包含用户正文。

威胁模型和报告方式见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm run check             # typecheck + build + remote/client smoke + Vitest
npm run smoke:package     # packed tarball installability
npm run verify:compaction # 手动真实模型 compaction 检查
node scripts/verify/compat-matrix.mjs --versions all --allow-new-release
```

当前源码证据：36 个测试文件 / 433 个测试；九版本 DSH 矩阵 9/9、每版 429/429。版本矩阵和 profile 检查
与真实 Gateway、Electron、可访问性和 512 项性能门禁分开记录。

文档：

- [用户指南](docs/user-guide.zh.md)
- [兼容矩阵](docs/design/compatibility.zh.md)
- [验证记录](docs/verification.zh.md)
- [Charter 设计](docs/design/charter-design-v1.zh.md)
- [0.2 工作区设计](docs/design/charter-workspace-v2.zh.md)
- [发布流程](docs/releasing.zh.md)

## 贡献

修改代码、发布元数据或用户状态前请阅读 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。未获明确授权不要 push、
tag 或 publish。

## License

MIT，见 [LICENSE](LICENSE)。
