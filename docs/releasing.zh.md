# 发布 dsh-charter

[English](releasing.md) | 中文

这份清单用于让 GitHub/npm 发布可复现，并避免发布过期的 client bundle。

## 1. 外部前置条件 — 剩余发布阻塞

公开 GitHub 仓库尚不存在，当前 checkout 没有 `git remote`，`package.json` 的 `repository`、`homepage`、`bugs`
故意留空。先创建并推送仓库：

1. 创建公开仓库（owner/name 由维护者确定）；
2. `git remote add origin <url>` 并 `git push -u origin main --follow-tags`（同时推送 `v0.1.0-rc.1` tag）；
3. 把 `package.json` 的 `repository`、`homepage`、`bugs` 恢复为该 URL 并提交；
4. 确认 `.github/workflows/ci.yml` 在推送的 commit 上为绿色（Node 22.19.0 与 24 矩阵）。

完成这些步骤之后才应运行 `npm publish --tag next`。README 的仓库链接同样依赖该前置条件。

## 2. 发布前检查

- 版本在 `package.json`、`CHANGELOG.md` / `CHANGELOG.zh.md` 中一致更新；本树是预发布（`0.1.0-rc.1`），必须
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
`npm run smoke:package` 另外会打包 tarball 并校验必需文件、所有 `exports` 目标、packed Host import 和 packed
client bundle。CI 配置为在公开仓库存在后同时运行两者。已记录的真实模型 compaction `PASS`（验证记录 8.4）就是 compaction 韧性声明的
验收证据；下面的手工命令保留用于在目标 profile 重新跑一次。

用一个全新 profile 安装 tarball 并验证：

```bash
npm pack
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add ./dsh-charter-0.1.0-rc.1.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

打开打印的 URL，新建 Session，检查会话契约 tab 和中英文切换。

真实模型 compaction 验收是手工步骤：应用会话契约、执行 `/compact`、发送一条消息，然后运行
`npm run verify:compaction -- --session <id> --home <DSH_HOME>`，并把 `PASS` 证据记录到验证记录第 8 节。
这项检查需要模型，永远不属于 `npm run check`。记录中的 `PASS` 已代表 compaction 韧性声明被接受；如果提供该
证据的 Desktop 进程在最后一次包更新后没有重启，发布稳定 `latest` 前重启一次并重新打开会话契约 tab（本次
`next` 预发布不需要；见 8.4）。

## 4. 打 tag 与发布

```bash
git tag -a v0.1.0-rc.1 -m "dsh-charter 0.1.0-rc.1"
npm pack
mkdir -p dist && mv dsh-charter-0.1.0-rc.1.tgz dist/
(cd dist && shasum -a 256 dsh-charter-0.1.0-rc.1.tgz > SHA256SUMS)
```

在 tagged tree 上打包，保证产物与已提交源码一致。把产物 digest 同时写入 `dist/SHA256SUMS` 和仓库根部
tracked 的 `SHA256SUMS`（根部文件刻意不在 npm `files` 白名单内，因此不会改变打包产物）。提交根部文件后，再把
`v0.1.0-rc.1` tag 移到新的 HEAD。验证记录 8.4 记录通过门禁的 source commit，并指向 tracked 的随发布产物
digest；tracked 根部 `SHA256SUMS` 与 `dist/SHA256SUMS` 固定从 tagged tree 构建的产物。`dist/` 不进 git；把
`.tgz` 和 `SHA256SUMS` 附到 GitHub release，但不要提交 tarball。

1. 创建 GitHub release，附加 `.tgz`、`SHA256SUMS` 和简短亮点；
2. 用非 latest dist-tag 发布预发布版本：

```bash
npm publish --access public --tag next
```

只有在公开仓库链接就位、验证记录 8.4 的重启后复核已记录，且 tagged tree 上 `npm run check`/`smoke:package`
通过后，才发布稳定 `latest` 版本。在此之前 `dsh-charter@latest` 不存在：请安装 `@0.1.0-rc.1` 或 `@next`。

不要发布 API key、profile 数据或包含私人内容的本地截图。

## 5. 发布后

- 用已发布产物验证 README 安装命令；
- 若测试了新的 DSH 版本，更新兼容矩阵；
- 保持 `docs/archive/` 不被 git 跟踪；它只包含本地历史设计材料，并且不在 npm `files` 白名单内，保证
  GitHub 与 npm 内容一致。
