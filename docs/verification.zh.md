# `dsh-charter` 验证记录

[English](verification.md) | 中文

> **状态：** Active — 当前操作记录。
> **版本范围：** 当前开发线。
> **基准：** 2026-11-05

验证日期：2026-10-30。本文件是当前证据记录；历史逐提交的叙事保留在 Git 历史和 Changelog。临时目录、profile、
tarball 和抓取内容位于 `.tmp/`，不进入发布包。

环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`。本地 DSH 开发基线：`0.2.2-rc.1`（当前 npm
`next`）。

## 1. 当前结论

当前发布状态（2026-11-05）：

- 已发布：`0.2.0`（npm `latest`/`next`；精确 SHA-256 `7bafffc24c18c9655d68a9a61017db54920839a159dfeeba0643337c3aae4286`）。GitHub Release `v0.2.0` 已公开且不可变。
- `0.1.0-rc.6`：上一公开版本；使用 recovery tag `v0.1.0-rc.6-republished`。
- 当前版本：`0.2.0`，已发布且不可变；从 0.2.0 起版本号不使用 `rc` 后缀。
- 当前源码证据：36 个测试文件 / 441 个测试，九版本矩阵 441/441 通过。已发布 0.2.0 artifact 早于发布后的消息提案 UI 澄清，携带 434 测试的源码构建。
- 待完成：发布后的 Desktop/浏览器诊断与真实模型 compaction 检查。

| 项目 | 结果 |
| --- | --- |
| TypeScript 严格检查 | 当前树通过 |
| Vitest | 36 个测试文件 / 441 个测试通过（`npm test`，先 build） |
| Host ESM 构建 + 浏览器 factory bundle | 通过 |
| Remote 契约与 client smoke | 通过 |
| 普通 package smoke | 通过 |
| exact-artifact package smoke | 对已发布 `0.2.0` `.tgz` 字节（`7bafffc2…`）通过，不重建 |
| packed recovery smoke | 通过：export、删除 target、restore、receipt replay、两次 restart、健康目标拒绝、packed fault 子集 |
| 真实 `TypertGatewayService` | 精确 artifact 在隔离的 DSH `0.2.1-rc.3` / `rc.4` 依赖图上通过 |
| 兼容 sentinel | `0.1.7-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-rc.1` 通过 |
| Fresh Web profile matrix (historical rc.6) | PASS：历史 rc.6 artifact 曾在 DSH `0.1.7-rc.2`、`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.1-rc.5` 上安装并启动 |
| Fresh Web 0.2.2 | 2026-11-05 PASS：全新 `DSH_HOME` + `dsh@0.2.2-rc.1 plugin --profile web add` 安装 `dsh-charter-0.2.0.tgz`（SHA-256 `fde5531d457effc713f4423f8b46c8f0e591770e59c55e19956f000c11bdeffc`）；Web 启动、页面 HTTP 200、charter bundle HTTP 200；boot graph 含 `dsh-charter`，页面 index 含 `dsh-charter/client.js` |
| 九版本全量 rerun | tracked `compat-matrix --versions all --allow-new-release` 通过（每版本 441/441） |
| 未跟踪 `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run；rc.6 明确不支持 |
| 本地 Web + Desktop profile | 0.2.0 开发 artifact 已装入本地 web/desktop profile；Desktop app 为 `0.2.2-rc.1`，真实 Electron ABI/交互仍需人工门禁 |
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
`npm run smoke:package`。exact-artifact、兼容 sentinel、Gateway 和真实模型 compaction 是独立 job
或人工门禁，不是 `npm test` 自动声称的覆盖。

## 3. DSH 兼容证据

`package.json` 的 `engines.dsh`、每个 `@deepseek-ai/dsh-*` peer range 和
`dsh.compatibility.dshReleases` 一致声明九个精确版本：

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5 || 0.2.2-rc.1
```

受版本控制的 runner 为每个版本建立隔离 npm 项目，运行 typecheck/build/tests。`--allow-new-release` 只把隔离 workspace 的 `minimumReleaseAge` 设为 0，使刚发布的精确 DSH 版本能在 24 小时窗口内被测试；它不放宽 strict peers，不影响用户安装，也不是发布策略豁免。当前证据：

| DSH 版本 | 证据 |
| --- | --- |
| `0.1.7-rc.2` | 441/441 tracked matrix PASS |
| `0.2.0-rc.1` | 441/441 tracked matrix PASS |
| `0.2.0-rc.2` | 441/441 tracked matrix PASS |
| `0.2.1-rc.1` | 441/441 tracked matrix PASS |
| `0.2.1-rc.2` | 441/441 tracked matrix PASS |
| `0.2.1-rc.3` | 441/441 tracked matrix PASS |
| `0.2.1-rc.4` | 441/441 tracked matrix PASS |
| `0.2.1-rc.5` | 441/441 tracked matrix PASS |
| `0.2.2-rc.1` | 441/441 tracked matrix PASS |

当前 main 树在源码提交 `cf3cc59af617fe725b966220681e869fbed07388` 上于 2026-11-06 通过
`compat-matrix --versions all --allow-new-release`：每个声明版本均通过 typecheck、build 和 441/441 测试；本地证据为
`.tmp/review-fixes-matrix7.json`。安装使用 pnpm strict peer、精确工具版本、单一 zod 4.6.7 图、完整 `pnpm list --depth Infinity` 图校验，并记录 lockfile SHA-256。未跟踪 `0.2.2-alpha.2` 已 probe：strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run，rc.6 明确不支持。

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

- 真实浏览器 export → absent → restore → reload/restart 是可选的诊断检查，不是 promotion 门禁，也不由
  tracked browser script 自动化。
- Web/Desktop 通过 host client-module carrier 共用同一个 `dsh.client` bundle。本机 Desktop app 为 `0.2.2-rc.1`，profile 已装入 0.2.0 开发 artifact；真实 Electron ABI/交互仍需人工门禁。
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
| `0.1.0-rc.6` | 2026-11-01 | DSH 0.2.1-rc.5 适配、导航帮助、格式化预览、流量观测；已正式验收并用 recovery tag 发布 |

逐版本详细变更见 `CHANGELOG.md`；已发布 tag 与 GitHub Release 不可修改。

## 8. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 Git 和 npm 包。
