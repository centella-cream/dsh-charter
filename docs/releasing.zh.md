# dsh-charter 发布

[English](releasing.md) | 中文

> **状态：** Active — 当前操作记录。
> **版本范围：** 当前开发线。
> **基准：** 2026-11-03

这是当前发布清单，取代早期按 rc 编写的暂存说明。已发布的 tag、GitHub Release 和 npm 版本不可变：不移动
tag、不删除已发布 Release、不在打 tag 后重建字节。

## 当前状态（2026-11-05）

- **已发布：** `0.1.0-rc.6` — 当前 npm 公开发布版本；精确产物 SHA-256
  `21ddbea0ae3fd88994d4e4731429ef4d8cb75db2b97e83cd7530a0386e425825`。
- **发布候选：** `0.2.0`，位于 `feat/0.2.0-workspace`；目标 tag `v0.2.0`。
- **待完成：** 本地合入 `main`、candidate workflow、browser evidence 和 promotion workflow。
- 不得手动 publish，也不得绕过受保护门禁。

## 1. 准备源码

1. 确认范围符合[版本路线](design/version-roadmap.zh.md)和当前稳定化计划；候选版本不夹带计划外功能。
2. 在同一次修改中更新全部元数据：`package.json` version、`engines.dsh`、peer ranges、
   `dsh.compatibility.dshReleases`、`package-lock.json`、README/README.zh、兼容文档、验证记录、
   CHANGELOG、release notes 和根 `SHA256SUMS`。
3. 运行 `npm ci`、`npm run check` 和普通 `npm run smoke:package`。
4. 对每个声明 DSH 版本跑兼容回归，并 probe 未跟踪的 `next`/`latest` 版本；缺失、peer drift 或未验证版本
   阻断发布。
5. 在本地非 `main` 分支跑完门禁，线性合入本地 `main`，再推送 `main`。不要推送开发分支；远程只保留 `main`。工作树不得包含 secrets、用户记录或 `.tmp` 产物。

## 2. 只构建一次候选字节

`release-candidate.yml` 是发布字节的唯一生产者：执行 source gates、compatibility、一次 `npm pack`、
exact-artifact package smoke、packed-recovery smoke、exact artifact Gateway 验收和 fresh Web profile
安装/启动 evidence。所有下游必须下载同一个 artifact 并传 `--artifact`/`--sha256`；下游不得重建或重新打包。

Candidate 全绿后，在 candidate `C` 上创建只改 checksum 的 `C+1`：

- `git diff --name-only C C+1` 只有 `SHA256SUMS`；
- `C+1` 是 `C` 的直接子提交；在本地 `main` 只提交 `SHA256SUMS` 并直接推送。
- public CI 在精确 `C+1` 上全绿；
- tag 指向 `C+1`，不是 `C`。

stable release 同样遵守 C/C+1 顺序：`C+1` 是只改 checksum 的提交，tag 指向它。

## 3. Browser evidence

真实浏览器恢复 evidence 是受保护的人工门禁。必须针对精确候选 tarball 在真实 Web profile 完成：

```text
fresh profile → export → 保留 Session lifecycle 并移除 target → restore → reload → Host restart
→ healthy-target refusal → UTF-8 + error-detail + viewport/accessibility checks
```

通过受保护 `release` environment 的 `browser-evidence.yml` 记录机器可校验 JSON；必须绑定 candidate run、
head SHA、artifact SHA-256 和 restore digests。本地 fixture、source-only smoke 或 green candidate 都不能
替代该门禁。

## 4. Promotion

Promotion 是唯一允许创建 GitHub Release 和移动 npm channel 的路径。

### Repository token

Promotion 使用受保护 repository secret：

```text
secret: NPM_TOKEN
scope: package write
package: dsh-charter
2FA: bypass enabled
expiry: 过期前跟踪并轮换
```

不使用 OIDC，也不生成 provenance attestation。缺失、过期或 scope 不足都会阻断发布；请在过期前轮换并同步
secret。

### 运行

在受保护 `release` environment 运行 `release-promote.yml`，输入：

```text
candidate_run_id, candidate_commit=C, release_commit=C+1,
candidate_sha256, version=0.2.0, browser_evidence_run_id
```

workflow 校验 candidate/browser evidence 与 main-push CI，使用临时非 channel tag 发布精确 tarball，
回读 registry bytes，移动 `next`/`latest` 并做防回退检查，创建/校验 GitHub Release、附加
`release-evidence.json`，最后才公开 prerelease。

不要为发布手工执行 `npm publish`、`npm dist-tag` 或 `gh release`；它们会绕过 environment 审批、token
scope、browser evidence 和 release evidence。

## 5. 发布后

- 用实际发布产物验证 README 安装命令。
- 核对 npm `version`、`dist-tags` 和 tarball digest 与 candidate 一致。
- 只有新 DSH 版本通过完整回归后才更新兼容矩阵。
- 保留 outer-JSON 风险披露：完全不可读的外层 JSON 会被 JSON backend 当作不存在，插件无法区分；必须停止
  Host 并从备份恢复。这与内部 schema/consistency invalid 记录不同，后者会被隔离并保留。
- `docs/archive/` 保持 untracked；它只保存本地历史材料，且不在 npm `files` 白名单内。

## 6. Channel policy

RC 发布到 `next`；稳定版出现前，`latest` 也有意指向最新 RC。npm 保留 `latest` tag，由项目决定其指向；
这是项目策略，不是 npm 的强制要求。精确版本仍是可复现安装路径。

固定版本安装应使用精确版本，并考虑 pnpm release-age：新发布 RC 在窗口结束前可能不会参与无版本解析；不要
绕过兼容性门禁，也不要安装未声明的旧版本。
