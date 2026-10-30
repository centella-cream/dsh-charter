# `dsh-charter` 验证记录

[English](verification.md) | 中文

验证日期：2026-10-30。本文件是当前证据记录；历史逐提交的叙事保留在 Git 历史和 Changelog。临时目录、profile、
tarball 和抓取内容位于 `.tmp/`，不进入发布包。

环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`。本地 DSH 开发基线：`0.2.1-rc.5`（当前 npm
`next`）。

## 1. 当前结论

当前发布状态（2026-10-30）：

- 已发布：`0.1.0-rc.4`（npm `latest`/`next`、GitHub Release）。
- 候选：`0.1.0-rc.5`，candidate run `40864078201` 全绿，精确产物
  `dsh-charter-0.1.0-rc.5.tgz` 的 SHA-256 为
  `94e27acf8851ad5423defd06a41253171317f4e805af809fe8e8e7a9ce83a939`。
- 发布提交：`C=d138d65dc4f1b2628dc043f2dd437ea213112a4d`，`C+1=tag v0.1.0-rc.5=0a6ccc5`。
- 当前源码：`0.1.0-rc.6`（未发布、未打 tag；DSH 0.2.1-rc.5 适配、文档/UI/流量观测）。
- 待完成：npm token 发布、GitHub prerelease、受保护 browser evidence、Promotion。

| 项目 | 结果 |
| --- | --- |
| TypeScript 严格检查 | 当前树通过 |
| Vitest | 30 个测试文件 / 379 个测试通过（`npm test`，先 build） |
| Host ESM 构建 + 浏览器 factory bundle | 通过 |
| Remote 契约与 client smoke | 通过 |
| 普通 package smoke | 通过 |
| exact-artifact package smoke | 对最终 `.tgz` 字节（`94e27acf…`）通过，不重建；本地 rc.6 验证包也通过 exact package smoke |
| packed recovery smoke | 通过：export、删除 target、restore、receipt replay、两次 restart、健康目标拒绝、packed fault 子集 |
| 真实 `TypertGatewayService` | 精确 artifact 在隔离的 DSH `0.2.1-rc.3` / `rc.4` 依赖图上通过 |
| 兼容 sentinel | `0.1.7-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.1-rc.5` 通过 |
| 八版本全量 rerun | tracked `compat-matrix --versions all --allow-new-release` 通过（每版本 379/379） |
| 未跟踪 `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run；rc.6 明确不支持 |
| 本地 Web + Desktop profile | PASS：rc.6 artifact 已安装到两者；Desktop app 仍为 `0.2.1-rc.3`，rc.5 Desktop 验收待 Electron app 更新 |
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
`dsh.compatibility.dshReleases` 一致声明八个精确版本：

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5
```

受版本控制的 runner 为每个版本建立隔离 npm 项目，运行 typecheck/build/tests。`--allow-new-release` 只把隔离 workspace 的 `minimumReleaseAge` 设为 0，使刚发布的精确 DSH 版本能在 24 小时窗口内被测试；它不放宽 strict peers，不影响用户安装，也不是发布策略豁免。当前证据：

| DSH 版本 | 证据 |
| --- | --- |
| `0.1.7-rc.2` | 379/379 tracked matrix PASS |
| `0.2.0-rc.1` | 379/379 tracked matrix PASS |
| `0.2.0-rc.2` | 379/379 tracked matrix PASS |
| `0.2.1-rc.1` | 379/379 tracked matrix PASS |
| `0.2.1-rc.2` | 379/379 tracked matrix PASS |
| `0.2.1-rc.3` | 379/379 tracked matrix PASS |
| `0.2.1-rc.4` | 379/379 tracked matrix PASS |
| `0.2.1-rc.5` | 379/379 tracked matrix PASS |

当前 rc.6 源码树已于 2026-10-30 通过 `compat-matrix --versions all`：每个声明版本均通过 typecheck、build 和 379/379 测试。安装使用 pnpm strict peer、精确工具版本、单一 zod 4.6.7 图、完整 `pnpm list --depth Infinity` 图校验，并记录 lockfile SHA-256。未跟踪 `0.2.2-alpha.2` 已 probe：strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run，rc.6 明确不支持。

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

## 5.1 流量 / cache 观测

只读 checker 不改变 Host，报告上下文累积：

```bash
node scripts/verify/traffic-check.mjs --session <id> --home <DSH_HOME> [--json]
```

输出 model attempts（含 `assistant/attempt` stream usage）、active-surface / historical runtime-context
snapshots、compaction epoch、token usage 归因，以及 `charter_read` 调用和结果字节。本地运行只是**诊断**，**不是发布证据**：下面的记录是本地时点快照，但目前没有脱敏 fixture 或受控 A/B 结果，
不能把某次本地观测当作 cache 命中变化或“当前模型请求实际携带某状态”的证明。

checker 已有 fixture 测试覆盖；在改变 prompt 投递模型前仍需受控 A/B 实验。

### 5.1.1 本地诊断（不是发布证据）

2026-10-30 对本地 Session `session-f0aaa8dd-05bf-4a85-9a5e-b4bd016f6dd3`（transcript
`sha256:88f47145827ea40c67269dec8fe30fdbff63a8da0fc1c02eeae63871ddbfdb83`，34,841 events；
live Session，digest 固定为诊断时点）的一次诊断输出：

```text
historical runtime snapshots: 22（其中 16 个被 shadow）
active runtime snapshots:     6，总 7,712 B，相对最新快照重复 6,129 B
active charter:               总 2,097 B，最新 630 B，重复 1,467 B
section churn（active）:      app:web-surface ×2、charter:standing ×2、
                              approval:policy ×1、sandbox:policy ×1
section churn（全历史）:      app:web-surface ×7、approval:policy ×4、
                              sandbox:policy ×4、charter:standing ×2、
                              harness:source ×1、team:identity ×1、
                              working-directory:current ×1
tool schema:                  39 tools、32,173 B；charter_read 805 B
charter_read:                 4 次，全部发生在首个 active charter snapshot 之前
```

这是**本地诊断，不是发布证据**。它表明当前 active surface 的主要增长来自 DSH 的 runtime-context snapshot
append 模型，而不是 Charter 内容：当其他 section 触发新快照时，未变化的 Charter 文本会被再次携带。插件不能
安全地停止返回 Charter 文本，因为最新快照才是注入权威。因此 rc.6 将这一点记录为 DSH 上游限制，不修改注入
语义；工具 description 缩短是本次唯一落地的模型可见缩减。

## 6. 人工/外部缺口

- 真实浏览器 export → absent → restore → reload/restart 是受保护的人工 evidence gate
  （`.github/workflows/browser-evidence.yml`），尚未由 tracked browser script 自动化；promotion 要求与候选
  SHA 绑定的成功 evidence run。
- Web/Desktop 通过 host client-module carrier 共用同一个 `dsh.client` bundle。本机 Desktop app 仍为 `0.2.1-rc.3`；完成 rc.5 Desktop 验收需要更新 Electron app 和 profile，并重新执行人工 Desktop ABI/交互门禁。
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
| `0.1.0-rc.5` | 2026-10-29 | candidate 全绿并打 tag：visible-only review、future-schema fence、safe discard、UTF-8/error/a11y 硬化；npm/Release 待发布 |

逐版本详细变更见 `CHANGELOG.md`；已发布 tag 与 GitHub Release 不可修改。

## 8. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 Git 和 npm 包。
