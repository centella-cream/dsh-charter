# 发布 dsh-charter

[English](releasing.md) | 中文

这份清单用于让 GitHub/npm 发布可复现，并避免发布过期的 client bundle。顺序是刻意设计的：先仓库元数据与
CI，再构建已验证产物，然后打 tag，最后发布。已推送的 tag 绝不移动，打 tag 后绝不重新打包。

## 1. 外部前置条件 — 公开仓库准备

公开 GitHub 仓库已创建：<https://github.com/centella-cream/dsh-charter>。本树已把 `package.json` 的
`repository`、`homepage`、`bugs` 指向该仓库；如果 checkout 还没有 `origin`，请先配置。下面的发布状态是动态的，
每次发布前都必须重新核对。如果暂存 RC 期间还留有临时本地 `v0.1.0-rc.2` tag，请在元数据/CI commit 前删除——
除非 tag 是在公开门禁之后创建，否则不能保留：

```bash
git tag -d v0.1.0-rc.2   # 仅当它存在；它从未被推送
git remote -v            # origin 必须指向公开仓库
```

如需内部追溯，可使用只在本地存在的标记 tag（例如 `v0.1.0-rc.2-build`）；它绝不推送，也不是发布 tag。

先准备仓库与公开门禁：

1. 确认 `origin` 指向 `https://github.com/centella-cream/dsh-charter`（公开仓库已创建）；
2. 确认 `package.json` 的 `repository`、`homepage`、`bugs` 指向该 URL（本树已恢复）；
3. 启用并验证仓库的**私有安全报告**（security advisories/private reporting）在发布前可用；
4. 更新所有发生变化的可变发布状态描述（仓库元数据、公开 CI 状态、发布前置项），重跑 `npm run check` 与
   **普通** `npm run smoke:package`，并把文档刷新并入同一个元数据/CI状态/文档更新 commit；
5. 只推送 `main`，此时不要推 tag（`git push origin main`；不要用 `--follow-tags`）；
6. 等待 `.github/workflows/ci.yml` 的公开 CI 在 Node `22.19.0` 与 `24` 上对该 commit 变绿（CI 只运行
   `npm run check` 与普通 `npm run smoke:package`；exact-artifact 模式不是 CI job）。

随后按顺序：从最终源码**只构建一次**发布 tarball，对同一文件运行 exact-artifact smoke
（`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.2.tgz --sha256 SHA256SUMS`，同时校验 SHA-256）
并在同一文件上做 fresh-profile UI 检查，然后创建最终 annotated `v0.1.0-rc.2` tag，GitHub Release 与
`npm publish --tag next` 复用同一份已验证 tarball。tag 只有在 digest commit 已进入 `main`、公开 CI 在该 commit
通过之后才创建；在验证前推 tag 会让发布产物依赖未经门禁的树。

已接受的非阻塞限制（legacy transcript 严格性、compaction 序列边界、WAIT 诊断措辞、artifact-smoke 固化残余、
外层 JSON 平台风险、mutation receipt 保留窗口、文档计数漂移）在验证记录第 9 节披露，不是发布阻塞项；不要声称
这些限制已关闭。

## 2. 发布前检查

- 版本在 `package.json`、`CHANGELOG.md` / `CHANGELOG.zh.md` 中一致更新；本树是预发布（`0.1.0-rc.2`），必须
  使用非 latest dist-tag 发布；
- 新支持的 DSH prerelease 已重新核对兼容矩阵；
- 工作树中没有密钥、私人对话或 `.tmp` 产物。

## 3. 验证

```bash
npm ci
npm run check
npm run smoke:package
```

`npm run check` 必须通过 typecheck、build、Remote smoke、client smoke 和完整 Vitest；
`npm run smoke:package` 另外会打包 tarball 并校验必需文件、所有 `exports` 目标、packed `core` import 和 packed
client bundle（Host/Remote 运行时 import 由工作区 build smoke 覆盖）。CI 在推送的元数据 commit 上运行
`npm run check` 与**普通模式**的 `npm run smoke:package`；它不运行 exact-artifact 模式。exact-artifact 检查是
**本地发布门禁**：在构建最终 tarball 之后、打 tag/推送/发布之前，用
`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.2.tgz --sha256 SHA256SUMS` 验证这批确切字节而不重新
打包。它会先按提供的 sums 文件校验 SHA-256、校验每个 tar member 与 packed manifest，再对同一文件执行
manifest/files/modes/exports、空 consumer 安装、packed `core` import 与 client bundle 检查；绝不 build 或 pack。
如果希望在 CI 中做 exact-artifact 验证，需要新增一个消费已发布产物的独立 release workflow——当前 CI 不做这件事。
已记录的真实模型 compaction `PASS`（验证记录 8.4）就是 compaction 韧性声明的验收证据；下面的手工命令保留
用于在目标 profile 重新跑一次。

真实模型 compaction 验收是手工步骤：应用会话契约、执行 `/compact`、发送一条消息，然后运行
`npm run verify:compaction -- --session <id> --home <DSH_HOME>`，并把 `PASS` 证据记录到验证记录第 8 节。
这项检查需要模型，永远不属于 `npm run check`。记录中的 `PASS` 已代表 compaction 韧性声明被接受；如果提供该
证据的 Desktop 进程在最后一次包更新后没有重启，发布稳定 `latest` 前重启一次并重新打开会话契约 tab（本次
`next` 预发布不需要；见 8.4）。

## 4. 构建已验证产物、打 tag、推送、发布

在最终已验证 commit（元数据已恢复、文档已刷新、CI 绿色、所有门禁通过）上：

```bash
npm pack
mkdir -p dist && mv dsh-charter-0.1.0-rc.2.tgz dist/
(cd dist && shasum -a 256 dsh-charter-0.1.0-rc.2.tgz > SHA256SUMS)
```

把同一 digest 写入仓库根部 tracked 的 `SHA256SUMS`。根部文件刻意不在 npm `files` 白名单内，因此提交它不会改变
打包产物的字节。提交后**再次推送 `main`**，让这个最终 digest commit 进入主干，并等待公开 CI 在该 commit 上
通过：

```bash
git push origin main
# 等待该确切 commit 的公开 CI 通过
```

绝不能在尚未推送、或公开 CI 未通过的 commit 上创建发布 tag（不要制造只在 tag 上可达的 commit）。打 tag 前先对
最终 `dist/` 文件运行上面的 exact-artifact 检查；GitHub release 附件、npm publish 输入与校验和文件必须都是这个
已验证的同一 tarball——此后绝不再重新构建。`dist/` 不进 git，也永远不提交 tarball。

用该 tarball 在全新 profile 中安装并验证：

```bash
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add dist/dsh-charter-0.1.0-rc.2.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

打开打印的 URL，新建 Session，检查会话契约 tab 和中英文切换。只有当最终 digest commit 已推送到 `main` 且
公开 CI 在该 commit 上通过之后，才在这个确切 commit 上创建 annotated tag 并只推送一次：

```bash
git tag -a v0.1.0-rc.2 -m "dsh-charter 0.1.0-rc.2"
git push origin v0.1.0-rc.2
```

已推送的 tag 绝不移动；tag 有误时提升版本号，而不是移动 tag。从该 tag 创建 GitHub release，并附加**已经构建
并验证过**的 `dist/dsh-charter-0.1.0-rc.2.tgz` 和 `dist/SHA256SUMS` —— 打 tag 之后不要再运行 `npm pack`，
直接发布已构建好的文件：

```bash
npm publish dist/dsh-charter-0.1.0-rc.2.tgz --access public --tag next
```

验证记录 8.4 记录通过门禁的 source commit，并指向 tracked 的随发布产物 digest；tracked 根部 `SHA256SUMS` 与
`dist/SHA256SUMS` 固定从 tagged tree 构建的产物。

只有在公开仓库链接就位、验证记录 8.4 的重启后复核已记录，且 tagged tree 上 `npm run check`/`smoke:package`
通过后，才发布稳定 `latest` 版本。不要发布 API key、profile 数据或包含私人内容的本地截图。

## 5. 发布后

- 用已发布产物验证 README 安装命令；
- 渠道策略（当前，有意选择）：预发布发布到 `next`，并在稳定版出现前把 `latest` 也指向最新 RC。npm 会保留
  `latest` tag，由我们决定其指向；不要把这一点描述成 npm 的强制要求。`@next` 与精确版本仍是预发布渠道。
  rc.2 tarball 会在其 README/user-guide/发布说明中携带这一定义；
- 记住已记录的残留风险（验证记录 4.5）：**外层 JSON 不可读**的契约记录会被 JSON storage backend 当作不存在，
  插件侧 API 无法将其与"记录缺失"区分。不要宣称"损坏数据总是被保留"：保证需区分内部 schema/一致性不合法
  记录（插件隔离并保留）与外层 JSON malformed/不可读或外层 version 被拒绝（已知覆盖风险，需停止 Host 并从
  备份恢复）。打 tag 前重新检查不可变文档，确保这一限制仍然写明。
- 若测试了新的 DSH 版本，更新兼容矩阵；
- 保持 `docs/archive/` 不被 git 跟踪；它只包含本地历史设计材料，并且不在 npm `files` 白名单内，保证
  GitHub 与 npm 内容一致。
