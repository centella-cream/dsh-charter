# `dsh-charter` 验证记录

[English](verification.md) | 中文

> **状态：** Active — 当前操作记录。
> **版本范围：** `0.2.2`，2026-11-11 已发布。
> **基准：** 2026-11-11

验证日期：2026-11-11。当前源码版本：`0.2.2`（2026-11-11 已发布）。本文件是当前证据记录；历史逐提交的叙事保留在 Git 历史和 Changelog。临时目录、profile、
tarball 和抓取内容位于 `.tmp/`，不进入发布包。

环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`。本地 DSH 开发基线：`0.2.2-rc.2`（当前 npm
`next`）。

## 1. 当前结论

当前发布状态（2026-11-11）：

- 已发布：`0.2.2`（npm `latest`/`next`；精确 SHA-256 `ccb094342ceda030b77c2c3555bc2838ee8a4f6ef2efe4f1ac80a9d39fca7875`）。GitHub Release `v0.2.2` 已公开且不可变。
- `0.2.1`：上一公开版本；GitHub Release `v0.2.1` 保持不可变。
- `0.2.0`：更早的公开版本；GitHub Release `v0.2.0` 保持不可变。
- `0.1.0-rc.6`：更早的公开版本；使用 recovery tag `v0.1.0-rc.6-republished`。
- 从 0.2.0 起版本号使用普通递增，不使用 `rc` 后缀。
- 当前源码证据：0.2.2 最终树在源码提交 `f9d93c0` 上通过 37 个测试文件 / 475 个测试；九版本矩阵在该树上 475/475 通过（Node `v22.23.1` / pnpm `12.3.4`，证据 `.tmp/0.2.2-final-matrix2.json`）。
- 发布后诊断：真实模型 compaction PASS（session `session-da7e7b0d-f0b0-49a2-8391-148b4782892c`）；512 条性能于 2026-11-06 PASS（core read/planning p95，见下）。

| 项目 | 结果 |
| --- | --- |
| TypeScript 严格检查 | 当前树通过 |
| Vitest | 37 个测试文件 / 475 个测试通过（`npm test`，先 build） |
| Host ESM 构建 + 浏览器 factory bundle | 通过 |
| Remote 契约与 client smoke | 通过 |
| 普通 package smoke | 通过 |
| exact-artifact package smoke | 对已发布 `0.2.1` `.tgz` 字节（`d4ae14e1…`）通过，不重建 |
| packed recovery smoke | 通过：export、删除 target、restore、receipt replay、两次 restart、健康目标拒绝、packed fault 子集 |
| 真实 `TypertGatewayService` | 精确 artifact 在隔离的 DSH `0.2.1-rc.3` / `rc.4` 依赖图上通过 |
| 兼容 sentinel | `0.1.7-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-rc.1` 通过 |
| Fresh Web profile matrix (historical rc.6) | PASS：历史 rc.6 artifact 曾在 DSH `0.1.7-rc.2`、`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.1-rc.5` 上安装并启动 |
| Fresh Web（历史 0.2.2 DSH / 0.2.0 插件） | 2026-11-05 PASS：全新 `DSH_HOME` + `dsh@0.2.2-rc.1 plugin --profile web add` 安装 `dsh-charter-0.2.0.tgz`（SHA-256 `fde5531d457effc713f4423f8b46c8f0e591770e59c55e19956f000c11bdeffc`）；Web 启动、页面 HTTP 200、charter bundle HTTP 200；boot graph 含 `dsh-charter`，页面 index 含 `dsh-charter/client.js` |
| 0.2.2 promotion | 2026-11-11 PASS：候选 run `43024720739`（C `51789db`），checksum-only C+1 `d65a4d6`，promotion run `43026165062`；npm `latest`/`next` 均为 `0.2.2`，GitHub Release `v0.2.2` 已公开并带 tarball、`SHA256SUMS`、`release-evidence.json`。 |
| 0.2.2 精确 artifact smoke | 2026-11-11 PASS：已发布 `dsh-charter-0.2.2.tgz`（98 个文件，SHA-256 `ccb094342ceda030b77c2c3555bc2838ee8a4f6ef2efe4f1ac80a9d39fca7875`）；package smoke 在空 consumer 中安装精确字节，packed recovery smoke 的 export/restore/两次重启/故障检查全部通过。 |
| 九版本全量 rerun | tracked `compat-matrix --versions all --allow-new-release` 通过（每版本 475/475） |
| 未跟踪 `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run；rc.6 明确不支持 |
| 本地 Web + Desktop profile | 0.2.0 开发 artifact 已装入本地 web/desktop profile；Desktop app 为 `0.2.2-rc.1`，真实 Electron ABI/交互仍需人工门禁 |
| 真实浏览器恢复 | 受保护的人工 evidence gate；未自动化 |
| 真实模型 compaction | 2026-10-22 记录 PASS；仍是人工发布门禁 |
| 0.2.2 兼容矩阵 | 2026-11-11 PASS：源码 `f9d93c031eabfe5e44cf17e302729eb7093d7e94`，Node `v22.23.1` / pnpm `12.3.4`；九个声明 DSH 版本全部通过 typecheck、build 和 475/475 测试（`.tmp/0.2.2-final-matrix2.json`）。 |
| 0.2.2 全新 profile 安装 | 2026-11-11 PASS：隔离 `DSH_HOME=/tmp/dsh-charter-fresh-022-home` 初始化全新 Web profile，安装精确本地 `dsh-charter-0.2.2.tgz`；`dsh web` 提供 Pane 入口（HTTP 303 token redirect）。已验证 CLI/tarball 路径；Desktop、真实 Pane 交互和中英切换仍需人工。 |
| 0.2.2 依赖图源码 | 2026-11-11 PASS：`npm run check` 37 个文件 / 475 个测试；W0-0 原型 41/41（旧契约；无边孤立节点网格例外由 `tests/client/relation-graph.spec.ts` 的产品测试覆盖）；Web Pane 在 3 条 active + 4 条 pending 交付物的 Session 上渲染图形、候选泳道、inspector 和常驻语义列表；浏览器 console 无错误。UI 自测（2026-11-11）：三节点孤立图 + 空提示、紧凑列表、添加依赖/隐藏/显示、本地 key 前置摘要均正常，无 console 错误。W0-1/2/3 与真实 AT/人工门禁仍待完成。 |
| 0.2.2 依赖图 bundle | 2026-11-11 以 `d362d6f` 为基线，按统一预算方法 `gzip -9 -c lib/client.js | wc -c` 实测：113,990 → 130,474 B（+16,484 B），`<40 KB` gzip 预算通过。raw 仅作诊断：`lib/client.js` 591,936 → 670,173 字节（+78,237 B），CSS output 47,230 → 55,540 B（+8,310 B）；raw 不作为预算口径。 |

## 1.2 0.3.0 GUI 开发候选（未发布，待本地人工验收）

- 分支 `feat/0.3.0-gui`，HEAD `433bdce` + 未提交改动；**未推送/未合并/未 tag/未发布**，无 0.3.0 可用性声明。
- 源码门禁（2026-11-12）：`npm run check` = 39 文件 / **490 测试** PASS（typecheck、build、remote/client
  smoke、Vitest、token gate）；`npm run verify:ui-metrics -- --gate=css|ia` PASS。
- 度量记录（W1/W2/W4）：CSS gate — 字号档 6、字重 3、颜色字面量 0、非 token 圆角 0、非 token shadow 0、
  padding 9、gap 8、`!important` 0；IA gate — 旧 objective 卡片 0、旧 overview/stat/budget 0、`goSection` 滚动/聚焦
  yes、操作条仅 dirty yes；final gate PASS。隔离 profile 与 CDP 矩阵均在已安装 livery 层
  （`body[data-dsh-livery]` 存在）下采集暗/亮两套；没有第二个 livery preset 可做更广抽查。记录：
  `.tmp/gui-acceptance/2026-11-12/livery-spotcheck.md`。
- Token 覆盖审计（W0）：`charter.css` 使用的 41 个静态 host token 在全部 10 个声明 DSH 版本的
  `@deepseek-ai/dsh-client-ui-theme` 中均有定义；`--dsh-content-font-size` 带 `14px` fallback；兼容块有意为空。
  门禁：`npm run verify:tokens`。
- 真实浏览器证据（把新 bundle 通过 CDP 注入已安装 Web Host；除特别说明外**不等于**已安装 artifact）：
  320/375/560/850/1440 多宽度、明/暗、forced-colors、reduced-motion、page-scale 2x；AX tree 命名 region、
  无嵌套 `main`、无空名按钮、命名 dialog；真实宿主滚动/焦点路由与窄屏 sheet Escape/focus restore。
- 隔离 profile 证据：当前树的 WIP artifact 曾安装到 `DSH_HOME=/tmp/dsh-w4-home`，安装后 `lib/client.js`
  hash 与仓库 build 一致；该开发包曾命名为 `dsh-charter-0.2.2.tgz`，因与已发布不可变 0.2.2 的
  artifact/digest 冲突，**审查后已删除**。今后 dev pack 必须先 bump 版本（如 `0.3.0`）再打包。
- 本地验收部署（2026-11-12）：W6 验收构建为 `dist/dsh-charter-0.3.0-w6-final.tgz`
  （SHA-256 `ab74591c…`，client `986f8403…`）。已安装到本地 `web` 与 `desktop` profile，包版本 `0.3.0`，
  `engines.dsh` 为有界 0.2 线范围。另按用户要求恢复 Pane 页头版本 chip（`v0.3.0`）。
- Desktop 热更新（2026-11-12，纠正）：Desktop **不需要**退出重开来加载重建后的 `dsh-charter` bundle。在已安装
  profile 下，对 profile 依赖做替换后，CDP 驱动的 `127.0.0.1:51452` 页面无需刷新即完成 Pane 替换：bundle
  probe 在 **824ms** 出现，CSS probe 在 **402ms** 生效，最终 bundle+CSS 在 **886ms** 生效。两次替换中
  `.charter-tabs__tab` 始终为 3，`style[data-plugin-css="dsh-charter/charter.css"]` 始终为 1 个，版本 chip 与
  Pane 保持挂载，页面无异常。路径为 Host profile 重组 + client bundle HMR；仅插件变更无需重启 Host。
- 依赖图 disclosure 文案（2026-11-12）：执行路径折叠时显示“展开依赖图”，展开后显示“收起依赖图”；已实测关闭 → 展开 → 再关闭，section 无重复。


- 最终构建矩阵（2026-11-13）：基于已安装 `w6-final` artifact（client `986f8403…`），重采 Review Center 的
  320/375/560/850/1440 × 暗/亮 × 中/英共 20 张，并采 Diagnostics 850/1440 两张；每张均满足
  `documentElement.scrollWidth == clientWidth`、3 个 `charter-tabs__tab`、Pane 已挂载。证据：
  `.tmp/gui-acceptance/2026-11-13/matrix-final/`。这替换了 Review/Diagnostics 子集的旧 W6 前矩阵；空/已应用/
  脏/冲突六状态矩阵与冻结稿并排对照仍缺。

- 十版本源码矩阵（2026-11-12）：全部声明版本 `0.1.7-rc.2` … `0.2.2-rc.2` 通过 typecheck、build 与测试；
  因 rc.2 仍在 pnpm 24 小时 `minimumReleaseAge` 窗口内，矩阵以 `--allow-new-release` 运行；已生成并跟踪 rc.2
  的兼容 lockfile。证据：`.tmp/compat-matrix-0.3.0.json`。
- 兼容范围策略：`engines.dsh` 现为 `0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0`。DSH 以 `includePrerelease` 求值，
  且存在 `engines.dsh` 时忽略 peers 做准入，因此未来 0.2.x prerelease 无需插件重新发版即可安装；`0.3.x` 被排除。
  精确的 peer/`dshReleases` 列表仍是十版本矩阵已验证支持集；新版本先由 `compat-matrix --discover` 探测再加入。
- Pane 页面级拆分（2026-11-12）：`CharterPane.tsx` 3459 → 1842 行；新增 `WorkspacePage`/`ReviewCenterPage`/
  `DiagnosticsPage` 与生成的 `pane-scope.ts`；共享 `pane-format`/`pane-ui`；真实浏览器 v0.3.0 三区域路由验证；
  490 测试 + final gate PASS。
- W6 文档感视觉冻结（2026-11-12）：下划线 tabs 取代左侧纵向导航；≥1100 为 720px 文档列 + 280px Change Set rail；section/行解剖、36px 虚线空态、40/16/16 skeleton、单行 notice、quietlink、暂存 inset 语言与 px 几何依赖图（184px 节点、三层解剖、legend、紧凑 inspector）已落地。`charter.css` 现消费 41 个已审计静态 host token；`npm run check` 39 文件 / 490 测试 PASS；`verify:ui-metrics -- --gate=final` PASS。CDP 注入截图：`.tmp/gui-acceptance/2026-11-12/ux-after-workspace-1440.png`、`w6-dirty-1440.png`、`w6-graph-1440.png` 与九节点重叠回归 `w6-graph-9nodes.png`、`w6-review-1440.png`、`w6-diagnostics-1440.png`。CDP 视口实测：320/850/1440 的 root/document 横向溢出均为 0；图形区在 320/850 隐藏、1440 可见；用户字号 10/14/22 下节点文本 scrollWidth/clientWidth 与 scrollHeight/clientHeight 相等（无裁切）。冻结稿并排与人工验收仍待完成。
- 发布前仍需人工/环境证据：fresh-profile Host+Session Pane、Desktop 窗口、真实 screen reader、真实 200%
  文本布局、zh/en 切换、livery 抽查记录，以及 W1–W6 全部人工验收。

## 2. 本地基线

```bash
npm run check                 # typecheck + build + remote/client smoke + Vitest + token gate
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
| `0.1.7-rc.2` | 475/475 tracked matrix PASS |
| `0.2.0-rc.1` | 475/475 tracked matrix PASS |
| `0.2.0-rc.2` | 475/475 tracked matrix PASS |
| `0.2.1-rc.1` | 475/475 tracked matrix PASS |
| `0.2.1-rc.2` | 475/475 tracked matrix PASS |
| `0.2.1-rc.3` | 475/475 tracked matrix PASS |
| `0.2.1-rc.4` | 475/475 tracked matrix PASS |
| `0.2.1-rc.5` | 475/475 tracked matrix PASS |
| `0.2.2-rc.1` | 475/475 tracked matrix PASS |

0.2.2 候选树在源码提交 `f9d93c031eabfe5e44cf17e302729eb7093d7e94` 上于 2026-11-11 通过
`compat-matrix --versions all --allow-new-release`（Node `v22.23.1` / pnpm `12.3.4`）：每个声明版本均通过
typecheck、build 和 475/475 测试；本地证据为 `.tmp/0.2.2-final-matrix2.json`。安装使用 pnpm strict peer、精确工具版本、单一 zod 4.6.7 图、完整 `pnpm list --depth Infinity` 图校验，并记录 lockfile SHA-256。未跟踪 `0.2.2-alpha.2` 已 probe：strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run，rc.6 明确不支持。

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
