# 文档索引与规范

本索引是仓库文档入口，并规定所有方案、设计、评审和发布说明的文件命名与状态规则。

## 状态词表

每份设计/方案/评审文档开头必须有状态块，状态只使用以下值：

| 状态 | 含义 |
| --- | --- |
| `Active` | 当前权威或当前操作指南，持续维护。 |
| `Implemented — pending release acceptance` | 源码实现已存在并通过源码门禁，但发布/人工门禁尚未完成。 |
| `Historical` | 已完成或已放弃决策的冻结记录；只读，不作为当前指导。 |
| `Superseded` | 已被指定文档替代；只作为历史保留。 |
| `Archived (local)` | 本地忽略的草稿或调查材料，不具权威性，不进入发布文档。 |
| `Development candidate` | 仅用于发布说明：已实现但未发布；不存在 tag/Release/npm 产物。 |

状态块格式：

```text
> **Status:** Active
> **Version scope:** 0.2.2
> **Baseline:** 2026-11-06
> **Authority:** docs/design/version-roadmap.zh.md
> **Supersedes / Superseded by:** none / <路径或 none>
```

状态变更属于文档变更：必须在同一提交中更新本索引、文档头和所有入链。不要因为历史方案失效就删除它，应移入
`docs/history/`。

## 命名规范

- 当前产品设计：`docs/design/<product>-v<major>.md`（中文 `.zh.md`），例如
  [charter-design-v1.md](design/charter-design-v1.md)。
- 当前专题设计：明确只写中文时使用 `docs/design/<topic>-v<major>.zh.md`，例如
  [charter-workspace-v2.zh.md](design/charter-workspace-v2.zh.md)。
- 跨版本路线：`docs/design/version-roadmap.md`（范围以 `.zh.md` 为准）。
- 兼容矩阵：`docs/design/compatibility.md`（兼容声明以 `.zh.md` 为准）。
- 历史材料：`docs/history/YYYY-MM-DD-<slug>.md`（中文 `.zh.md`）。`docs/design/` 下不得再放裸的
  `*-plan.md` 或 `*-review.md`。
- 发布说明：`docs/release-notes/<semver>.md`；未发布开发候选必须在头部写明。
- 本地忽略草稿：`docs/archive/`（git 忽略）；发布文档不得链接到它。
- 英文使用默认文件名，中文追加 `.zh.md`。声明某一边为 normative 时，必须在头部说明并保持链接一致。

## 当前文档地图

| 文档 | 状态 | 版本范围 | 说明 |
| --- | --- | --- | --- |
| [design/charter-design-v1.md](design/charter-design-v1.md) | Active | 0.1 核心；不变量适用于 0.2 | Charter 核心不变量与 v1 产品基线。 |
| [design/charter-workspace-v2.zh.md](design/charter-workspace-v2.zh.md) | Implemented — pending release acceptance | 0.2.0 | 工作区、提案时间线、依赖；专题范围。 |
| [design/version-roadmap.md](design/version-roadmap.md) | Active | 全版本线 | 范围与版本权威；中文为 normative。 |
| [design/compatibility.md](design/compatibility.md) | Active | 已声明 DSH 版本 | 兼容声明与矩阵。 |
| [history/2026-10-19-charter-design-v1-review.md](history/2026-10-19-charter-design-v1-review.md) | Historical | 0.1 | 冻结的 v1 设计评审。 |
| [history/2026-10-27-release-0.1.0-rc.5-plan.md](history/2026-10-27-release-0.1.0-rc.5-plan.md) | Historical | 0.1.0-rc.5 | 已完成并冻结的 rc.5 稳定化方案。 |
| [research/charter-research.md](research/charter-research.md) | Historical | 调研快照 | v1 调研事实；不作为当前决策。 |
| [verification.md](verification.md) | Active | 当前树 | 证据记录、计数与矩阵结果。 |
| [releasing.md](releasing.md) | Active | 当前版本线 | 发布流程。 |
| [user-guide.md](user-guide.md) | Active | 当前版本线 | 安装与使用指南。 |
| [release-notes/0.1.0-rc.5.md](release-notes/0.1.0-rc.5.md) | Historical | 0.1.0-rc.5 | 已发布 npm 版本的发布说明。 |
| [release-notes/0.1.0-rc.6.md](release-notes/0.1.0-rc.6.md) | Historical | 0.1.0-rc.6 | 已发布并验收的发布说明。 |
| [release-notes/0.2.0.md](release-notes/0.2.0.md) | Historical | 0.2.0 | 已发布 npm 版本和 GitHub Release。 |
| [release-notes/0.2.2.md](release-notes/0.2.2.md) | Historical | 0.2.2 | 已发布 npm 版本和 GitHub Release；依赖图与冲突二次确认。 |
| [release-notes/0.2.1.md](release-notes/0.2.1.md) | Historical | 0.2.1 | 已发布 npm 版本和 GitHub Release。 |

## 维护规则

- 新增、重命名文档必须同时更新索引和链接。
- 历史文档冻结；只修链接/状态，不改结论。
- `docs/` 内使用相对链接；发布文档不要链接 `docs/archive/`。
- 方案完成后从 `docs/design/` 移入 `docs/history/`，并加日期前缀。
- 设计被替代时，先给旧文档标 `Superseded` 并链接新文档，再实施新方案。
