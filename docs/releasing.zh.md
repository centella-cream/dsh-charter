# 发布 dsh-charter

[English](releasing.md) | 中文

这份清单用于让 GitHub/npm 发布可复现，并避免发布过期的 client bundle。

## 1. 前置检查

- `package.json` 的 `repository`、`homepage`、`bugs` 指向真实 GitHub 仓库；
- 版本在 `package.json`、`CHANGELOG.md` / `CHANGELOG.zh.md` 中一致更新；
- 新支持的 DSH prerelease 已重新核对兼容矩阵；
- 工作树中没有密钥、私人对话或 `.tmp` 产物。

## 2. 验证

```bash
npm ci
npm run check
npm run smoke:package
npm pack
```

`npm run check` 必须通过 typecheck、build、Remote smoke、client smoke 和完整 Vitest；
`npm run smoke:package` 另外会打包 tarball 并校验必需文件、所有 `exports` 目标、packed Host import 和 packed
client bundle。CI 同时运行两者。

用一个全新 profile 安装 tarball 并验证：

```bash
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add ./dsh-charter-0.1.0.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

打开打印的 URL，新建 Session，检查会话契约 tab 和中英文切换。

真实模型 compaction 验收是手工步骤：应用会话契约、执行 `/compact`、发送一条消息，然后运行
`npm run verify:compaction -- --session <id> --home <DSH_HOME>`，并把 `PASS` 证据记录到验证记录第 8 节。
这项检查需要模型，永远不属于 `npm run check`。

在该 `PASS` 证据记录之前，不要把构建标记为 compaction 能力的正式 release candidate；浅色、暗色、中英文和
窄屏截图已纳入验证记录。

## 3. 发布

1. 提交并打 tag `vX.Y.Z`；
2. 创建 GitHub release，附加 `.tgz`、`SHA256SUMS` 和简短亮点；
3. 可选 npm publish：

```bash
npm publish --access public
```

不要发布 API key、profile 数据或包含私人内容的本地截图。

## 4. 发布后

- 用已发布产物验证 README 安装命令；
- 若测试了新的 DSH 版本，更新兼容矩阵；
- 保持 `docs/archive/` 不被 git 跟踪；它只包含本地历史设计材料，并且不在 npm `files` 白名单内，保证
  GitHub 与 npm 内容一致。
