# `dsh-charter` 验证记录

[English](verification.md) | 中文

验证日期：2026-10-27。本文件是当前证据记录；历史逐提交的叙事保留在 Git 历史和 Changelog。临时目录、profile、
tarball 和抓取内容位于 `.tmp/`，不进入发布包。

环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`。本地 DSH 开发基线：`0.2.1-rc.4`（当前 npm
`next`）。

## 1. 当前结论

| 项目 | 结果 |
| --- | --- |
| TypeScript 严格检查 | 当前树通过 |
| Vitest | 28 个测试文件 / 362 个测试通过（`npm test`，先 build） |
| Host ESM 构建 + 浏览器 factory bundle | 通过 |
| Remote 契约与 client smoke | 通过 |
| 普通 package smoke | 通过 |
| exact-artifact package smoke | 对最终 `.tgz` 字节通过，不重建 |
| packed recovery smoke | 通过：export、删除 target、restore、receipt replay、两次 restart、健康目标拒绝、packed fault 子集 |
| 真实 `TypertGatewayService` | 精确 artifact 在隔离的 DSH `0.2.1-rc.3` / `rc.4` 依赖图上通过 |
| 兼容 sentinel | `0.1.7-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4` 通过 |
| 七版本全量 rerun | tracked `compat-matrix --versions all` 通过（每版本 362/362） |
| 未跟踪 `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.5 pins 4.0.5; no tests run；rc.5 明确不支持 |
| 真实浏览器恢复 | 受保护的人工 evidence gate；未自动化 |
| 真实模型 compaction | 2026-10-22 记录 PASS；仍是人工发布门禁 |

## 2. 本地基线

```bash
npm run check
npm run smoke:package
npm run smoke:package -- --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/recovery-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/gateway-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/compat-matrix.mjs --versions minimum,old-boundary,current
```

CI（`.github/workflows/ci.yml`）在 Node `22.19.0` / `24` 上运行 `npm run check` 与普通
`npm run smoke:package`。exact-artifact、兼容 sentinel、Gateway/browser 和真实模型 compaction 是独立 job
或人工门禁，不是 `npm test` 自动声称的覆盖。

## 3. DSH 兼容证据

`package.json` 的 `engines.dsh`、每个 `@deepseek-ai/dsh-*` peer range 和
`dsh.compatibility.dshReleases` 一致声明七个精确版本：

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4
```

受版本控制的 runner 为每个版本建立隔离 npm 项目，运行 typecheck/build/tests。当前证据：

| DSH 版本 | 证据 |
| --- | --- |
| `0.1.7-rc.2` | 362/362 tracked matrix PASS |
| `0.2.0-rc.1` | 362/362 tracked matrix PASS |
| `0.2.0-rc.2` | 362/362 tracked matrix PASS |
| `0.2.1-rc.1` | 362/362 tracked matrix PASS |
| `0.2.1-rc.2` | 362/362 tracked matrix PASS |
| `0.2.1-rc.3` | 362/362 tracked matrix PASS |
| `0.2.1-rc.4` | 362/362 tracked matrix PASS |

rc.5 tracked `compat-matrix --versions all` 已于 2026-10-27 完成：每个声明版本均通过 typecheck、build 和 362/362 测试。安装使用 pnpm strict peer、精确工具版本、单一 zod 4.6.7 图、完整 `pnpm list --depth Infinity` 图校验，并记录 lockfile SHA-256。未跟踪 `0.2.2-alpha.2` 已 probe：strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.5 pins 4.0.5; no tests run，rc.5 明确不支持。

## 4. 测试覆盖

- **Core：** record/schema 校验、原子提交/幂等、history 边界、prompt/render、normalization、fork 重映射、
  bootstrap 抽取、archive/payload/record digest、maintenance receipt、restore、future-schema、recovery 大小/时间戳边界。
- **Host：** 真实 Cordis 组合、source-aware init、lifecycle、queue/fence、malformed/version-rejected bytes、
  export/initialize/restore、write-uncertain、脚本化 storage fault、watch、future-schema 只读。
- **Remote：** descriptor/wire codec、legacy Host frame、future-schema 严格编码、六方法契约。
- **Gateway：** 真实 `TypertGatewayService`/`RemoteAccessService` owner/guest、业务前 policy 拒绝、guest
  maintenance/purge 拒绝、missing principal fail closed。
- **Client：** draft/store attempt、exact replay、visible-only bootstrap、safe discard、UTF-8/WebCrypto、
  connection 分类、Pane recovery、locale parity。
- **Verification：** npm pack 解析、结构化 tarball/checksum、consumer install、exact-artifact、recovery smoke、
  compatibility runner、Gateway smoke。

## 5. 恢复验收矩阵

| 区域 | 结果 |
| --- | --- |
| resume/absence 不自动创建 | PASS |
| 显式 initialize + replay + 权限/lifecycle 拒绝 | PASS |
| invalid target 上 export/restore 完整记录 | PASS |
| healthy target 拒绝与 operation-id 复用拒绝 | PASS |
| 跨 Session/lifecycle archive 拒绝 | PASS |
| storage 拒绝 fence 与 restart 收敛 | PASS |
| unknown-outcome exact replay | PASS |
| 跨 lifecycle attempt lock/abandon | PASS：attempt 变为 unknown，Retry 被阻止，staged work 不写入新 lifecycle |
| future-schema 诊断导出、不可读写、字节不变 | PASS |
| visible-only bootstrap 选择与 exact replay | PASS |
| discard/editor/composer 独立性与 unknown evidence 保留 | PASS |

## 6. 人工/外部缺口

- 真实浏览器 export → absent → restore → reload/restart 是受保护的人工 evidence gate
  （`.github/workflows/browser-evidence.yml`），尚未由 tracked browser script 自动化；promotion 要求与候选
  SHA 绑定的成功 evidence run。
- Desktop 重启后的 ABI、交互和 screen reader 仍人工验证。
- 真实模型 compaction 已于 2026-10-22 记录 PASS，仍是发布人工门禁。
- 多 Host 写入/lease 不在范围内；单写 Host 限制已记录。
- 无法读取/格式错误的 **outer** JSON 在 storage 边界与 absence 不可区分；初始化前应停止 Host 并从备份恢复。
  Inner invalid record 会保留并隔离。
- legacy transcript 严格性与 compaction 序列边界仍是已记录限制，不是已关闭保证。

## 7. 版本历史（摘要）

| 版本 | 日期 | 关键结果 |
| --- | --- | --- |
| `0.1.0-rc.1` | 2026-10-22 | 初始压缩历史审阅插件、Pane 与 compaction checker |
| `0.1.0-rc.2` | 2026-10-24 | Pane hook-order 恢复、依赖安全更新、发布渠道文档 |
| `0.1.0-rc.3` | 2026-10-26 | 权威恢复：结构化 record state、archive export/initialize/restore、write-uncertain fence |
| `0.1.0-rc.4` | 2026-10-27 | 仅兼容性：支持 DSH `0.2.1-rc.3`/`rc.4` |
| `0.1.0-rc.5` | 2026-10-27 | 稳定化候选：visible-only review、future-schema fence、safe discard、UTF-8/error/a11y 硬化 |

逐版本详细变更见 `CHANGELOG.md`；已发布 tag 与 GitHub Release 不可修改。

## 8. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 Git 和 npm 包。
