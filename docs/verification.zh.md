# `dsh-charter` 验证记录

[English](verification.md) | 中文

> **状态：** Active — 当前操作记录。
> **版本范围：** `0.3.4` 草案校准开发候选；最新已发布 `0.3.3`（2026-11-24）；上一个已发布 `0.3.2`。
> **基准：** 2026-11-23

验证日期：2026-11-25。当前源码版本：`0.3.4`；最新已发布版本为 `0.3.3`（上一个 `0.3.2`）。本文件是当前证据记录；历史逐提交的叙事保留在 Git 历史和 Changelog。临时目录、profile、
tarball 和抓取内容位于 `.tmp/`，不进入发布包。

环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`。本地 DSH 开发基线：`0.2.2-rc.5`（当前 npm `latest`/`next`）。

## 1. 当前状态（2026-11-24）

- 最新已发布版本：`0.3.3`（npm `latest`/`next`，GitHub Release `v0.3.3`；精确 artifact digest 记录在 C+1 checksum commit 与 release evidence 中）。
- 上一个已发布版本：`0.3.2`（SHA-256 `9dcb82ae34eaaeb6d266bb98f3e1f92f3a0798042ce3dc282abe9173ff79e056`）。
- 更早发布：`0.3.1`、`0.3.0`、`0.2.2`；已发布 tag 与字节不可变。
- 当前源码线：`0.3.4` 草案校准开发候选，未发布；`0.3.3` 为最新已发布版本。`0.3.4` 新增 opt-in 校准、additive Remote/apply 字段；record schema 仍为 2，standing prompt/工具面未变。
- 当前源码门禁：`npm run check`（46 文件 / 567 测试）、token 覆盖 41 static + 1 dynamic、
  13 个声明 DSH 版本，以及 `verify:ui-metrics --gate=final`。
- 兼容矩阵：13 个声明版本通过本地矩阵（`.tmp/compat-13-034-final.json`（source `82d45bc`））；最新 DSH `0.2.2-rc.5` 为主基线。这是本地证据，不是 CI 结论。
- 发布后在隔离 `DSH_HOME` 做 exact CLI 安装，npm 解析到 `dsh-charter@0.3.2`，client `6ef68d25…` 与已发布
  artifact 一致。
- 已发布 artifact：`dsh-charter-0.3.2.tgz` SHA-256
  `9dcb82ae34eaaeb6d266bb98f3e1f92f3a0798042ce3dc282abe9173ff79e056`（client `6ef68d25…`）；tag/GitHub
  Release `v0.3.2` 已公开。根 `SHA256SUMS` 匹配，本地 profile 指向同一 artifact。exact-artifact package smoke
  与 packed recovery smoke PASS。
- 0.3.2 根字号证据：根字号 16/24/32 px 时图形画布整体缩放 1/1.5/2；实测文本无新增裁切，viewport 在 200%
  下可横向滚动。证据：`docs/assets/charter-graph-root-text-200-0.3.2.png`。
- 真实 AT/VoiceOver、最终六状态截图、Desktop 原生窗口矩阵、W0-1/W0-2 实测仍为已知缺口；0.3.2 candidate/promotion 已完成。

### 0.3.2 残留门禁

| 区域 | 当前状态 | 证据 / 下一步 |
| --- | --- | --- |
| A1 200% 根字号 | 已实现并实测（CDP 强制根字号） | 画布 scale 1/1.5/2；文本 scroll 指标不变；真实浏览器字号/最小字号设置并入 A2 人工走查 |
| A2 VoiceOver/NVDA | 未完成 | 真实 AT 走查 tabs/sheet/graph/meter/notice；不能用 AX-tree 代替 |
| A3 六状态 + media | 部分完成 | 已采 empty/staged/applied/conflict-confirmation + forced-colors/reduced-motion；unknown/replay 待补（`docs/assets/charter-state-*-0.3.2.png`） |
| A4 冻结稿并排 | 未完成 | 人工并排评审记录 |
| A5 Desktop 原生窗口 | 未完成 | Electron 窗口/ABI 矩阵 |
| A6 W0-1/W0-2 | 未完成 | px 化后的断点/栏宽与行容量实测 |
| B1–B6 文档/治理 | 本次处理 | 状态头、附录 D 对账、verification/index/tag 清理 |

## 1.2 0.3.0 GUI 正式版本（2026-11-13 已发布）

- 已从 `main` 发布 `0.3.0`；候选 run `43360673386`（producer commit `0613ead…`），release commit
  `4331cbc…`，提升 run `43361855799`；tag 与 GitHub Release `v0.3.0` 已公开，npm `latest`/`next` 均为 `0.3.0`。
  分支/工作树干净且已推送。
- 源码门禁（2026-11-12）：`npm run check` = 39 文件 / **492 测试** PASS（typecheck、build、remote/client
  smoke、Vitest、token gate）；`npm run verify:ui-metrics -- --gate=css|ia` PASS。
- 度量记录（W1/W2/W4）：CSS gate — 字号档 6、字重 3、颜色字面量 0、非 token 圆角 0、非 token shadow 0、
  padding 9、gap 8、`!important` 0；IA gate — 旧 objective 卡片 0、旧 overview/stat/budget 0、`goSection` 滚动/聚焦
  yes、操作条仅 dirty yes；final gate PASS。隔离 profile 与 CDP 矩阵均在已安装 livery 层
  （`body[data-dsh-livery]` 存在）下采集暗/亮两套；没有第二个 livery preset 可做更广抽查。记录：
  `.tmp/gui-acceptance/2026-11-12/livery-spotcheck.md`。
- Token 覆盖审计（W0）：`charter.css` 使用的 41 个静态 host token 在全部 11 个声明 DSH 版本的
  `@deepseek-ai/dsh-client-ui-theme` 中均有定义；`--dsh-content-font-size` 带 `14px` fallback；兼容块有意为空。
  门禁：`npm run verify:tokens`。
- 真实浏览器证据（把新 bundle 通过 CDP 注入已安装 Web Host；除特别说明外**不等于**已安装 artifact）：
  320/375/560/850/1440 多宽度、明/暗、forced-colors、reduced-motion、page-scale 2x；AX tree 命名 region、
  无嵌套 `main`、无空名按钮、命名 dialog；真实宿主滚动/焦点路由与窄屏 sheet Escape/focus restore。
- 隔离 profile 证据：当前树的 WIP artifact 曾安装到 `DSH_HOME=/tmp/dsh-w4-home`，安装后 `lib/client.js`
  hash 与仓库 build 一致；该开发包曾命名为 `dsh-charter-0.2.2.tgz`，因与已发布不可变 0.2.2 的
  artifact/digest 冲突，**审查后已删除**。今后 dev pack 必须先 bump 版本（如 `0.3.0`）再打包。
- 正式发布（2026-11-13）：候选 run `43360673386`，producer commit
  `0613ead1ffbf73b47c54a767aa09c3c5d257bf32`；release commit `4331cbc21f46be910e74e7b65c6a76bffcbebb88`；
  提升 run `43361855799`。已发布 artifact `dsh-charter-0.3.0.tgz`，SHA-256
  `31daf17dbc823837c1b0c1ba7bc1033444db1059a2f2cd6f1a481f8d330b5d78`；npm `latest`/`next` 均为 `0.3.0`，
  GitHub Release `v0.3.0` 已公开且不可变。安装以该发布 artifact 取代本地 `w6-final` 开发包。
- 0.3.1 GUI 收敛候选（2026-11-13）：`npm run check` 41 文件 / **499 测试** PASS；
  token 覆盖 41 static + 1 dynamic、11 个声明 DSH 版本 PASS；十一版本矩阵在候选兼容证据（run `43445530821`）中 PASS。共享 standing-envelope 构造函数由 Host 与
  Diagnostics 共用；64 个交付物、生产长度 id 的 fixture 证明 id 开销恰为 49 B/交付物且 envelope 不超过 32 KiB。
- `traffic-check` 的 propose 遥测改为解析真实 JSON tool-result envelope（`{ok, message}`），不再对序列化
  文本做正则。fixture 覆盖单个 `D1` 拒绝、未知 id、非 requires 类失败和 accepted：display-key=1、
  unknown-id=1、other=1、accepted=1；不再出现 `D1"}` 尾串污染。
- 依赖图浏览器审计（2026-11-13，Chromium 1440×1000，合成 applied session）：泳道标题、5 个箭头 marker、
  SVG 沿路径命中描边（`vector-effect: non-scaling-stroke`；1440 px 实测 21–22 px 在带内 / 23 px 在带外，即 44 px 宽）、`max-height: none`；860/900/1000/1100/1200/1440 与 200% 页面缩放均无横向
  溢出。1100 视口下 app shell 内容容器为 813 px，低于 880 px 折叠阈值，图形区保持折叠但语义列表可用；
  记录为布局观察，不宣称 W0-1 双栏通过。真实 VoiceOver/AT 仍是人工门禁。
- 流量取证（2026-11-13）：`traffic-check` 增加 `charter_propose` 调用/拒绝统计、display-key/unknown-id 分类
  和 active charter surface hash；`traffic-diff` 对比前后 JSON 基线。纯本地只读，无运行时埋点/上报。
- 旧版流量基线样本（2026-11-13）：一个 65,491 events / 234 turns 的 0.3 前会话报告 4 次 `charter_read`
  （共 182 B）、0 次 `charter_propose`；10 份 active `charter:standing` 全部字节相同（630 B），整个 active
  runtime 的重复率 95.3%。该样本只用于确定 0.3.x 基线，不据此断言重复由插件造成或构成回归。报告：
  `.tmp/traffic-baseline/session-0651-0.2x.json`（本地，不随包发布）。
- Diagnostics envelope UI（2026-11-13）：显示精确估算字节、32 KiB cap、条目/交付物数、`maxPromptBytes`、
  id 开销和 80%/超限三态。
- 0.3.1 README 截图由精确本地构建注入运行中的 Web app 后重采：
  `docs/assets/charter-pane-0.3.1.png`、`charter-pane-0.3.1.zh.png`、`charter-graph-0.3.1.zh.png`。
- 0.3.1 正式发布（2026-11-13）：候选 run `43445530821`，producer commit
  `de1b83be004aecc63b09cfaeaf647ca94fb7567a`；release commit `0c00715d85be0e873d43175a4a26b724ea6c14d4`；
  提升 run `43449411538`。已发布 artifact `dsh-charter-0.3.1.tgz`，SHA-256
  `62fd230209dbf5c58aed09f0870775aa6d0d69feb4eff18aebf83f9803f28353`；npm `latest`/`next` 均为 `0.3.1`，
  GitHub Release `v0.3.1` 已公开且不可变。候选兼容证据覆盖 11 个声明 DSH 版本（含 `0.2.2-rc.3`）。
- 本地验收 artifact（2026-11-13）：`dist/dsh-charter-0.3.1.tgz` SHA-256
  `9f779443fd83c8e320d94d1981c18dc896d9d5905a7cc3f7dc8673f307806860`；exact-artifact package smoke 与 packed
  recovery smoke PASS。`dist/dsh-charter-0.3.1.tgz`（同一字节）已安装到本地 `web` 与 `desktop` profile；
  两端 client 均为 `fcd56a48…`。Host 版本 chip 在干净重启 Host 后更新。
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
  `.tmp/gui-acceptance/2026-11-13/matrix-final/`。这替换了 Review/Diagnostics 子集的旧 W6 前矩阵；另从合成暂存行重采了最终构建的脏态与依赖图各一张（1440）。
  空/已应用/冲突状态与冻结稿并排对照仍缺。


- 最终构建专项证据（2026-11-13）：从 `w6-final` 在 1440 重采 forced-colors、reduced-motion 与 page-scale-2 截图；Pane 已挂载、无横向溢出、3 个 tabs，媒体模拟命中。证据：`.tmp/gui-acceptance/2026-11-13/final-special/`。page-scale-2 是缩放代理，不等于完整 200% 文本布局、键盘或 AT 走查。


- 机械并排对照（2026-11-13）：`.tmp/gui-acceptance/2026-11-13/side-by-side/` 下用冻结稿与 `w6-final` 构建合成了 dirty/graph 两张对照图；这是参考材料，不等于人工并排评审，empty/applied/conflict 截图仍缺。

- 十一版本源码矩阵（2026-11-13）：全部声明版本 `0.1.7-rc.2` … `0.2.2-rc.3` 通过 typecheck、build 与测试；
  因 rc.2 仍在 pnpm 24 小时 `minimumReleaseAge` 窗口内，矩阵以 `--allow-new-release` 运行；已生成并跟踪 rc.2
  的兼容 lockfile。证据：`.tmp/compat-matrix-0.3.0.json`。
- 兼容范围策略：`engines.dsh` 现为 `0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0`。DSH 以 `includePrerelease` 求值，
  且存在 `engines.dsh` 时忽略 peers 做准入，因此未来 0.2.x prerelease 无需插件重新发版即可安装；`0.3.x` 被排除。
  精确的 peer/`dshReleases` 列表仍是十版本矩阵已验证支持集；新版本先由 `compat-matrix --discover` 探测再加入。
- Pane 页面级拆分（2026-11-12）：`CharterPane.tsx` 3459 → 1842 行；新增 `WorkspacePage`/`ReviewCenterPage`/
  `DiagnosticsPage` 与生成的 `pane-scope.ts`；共享 `pane-format`/`pane-ui`；真实浏览器 v0.3.0 三区域路由验证；
  492 测试 + final gate PASS。
- W6 文档感视觉冻结（2026-11-12）：下划线 tabs 取代左侧纵向导航；≥1100 为 720px 文档列 + 280px Change Set rail；section/行解剖、36px 虚线空态、40/16/16 skeleton、单行 notice、quietlink、暂存 inset 语言与 px 几何依赖图（184px 节点、三层解剖、legend、紧凑 inspector）已落地。`charter.css` 现消费 41 个已审计静态 host token；`npm run check` 39 文件 / 492 测试 PASS；`verify:ui-metrics -- --gate=final` PASS。CDP 注入截图：`.tmp/gui-acceptance/2026-11-12/ux-after-workspace-1440.png`、`w6-dirty-1440.png`、`w6-graph-1440.png` 与九节点重叠回归 `w6-graph-9nodes.png`、`w6-review-1440.png`、`w6-diagnostics-1440.png`。CDP 视口实测：320/850/1440 的 root/document 横向溢出均为 0；图形区在 320/850 隐藏、1440 可见；用户字号 10/14/22 下节点文本 scrollWidth/clientWidth 与 scrollHeight/clientHeight 相等（无裁切）。冻结稿并排与人工验收仍待完成。
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

## 1.3 0.3.2 无障碍/证据发布（2026-11-16，带已知缺口发布）

- 源码：`npm run check` 42 文件 / **500 测试** PASS；11 个声明 DSH 版本 token 覆盖 PASS；
  `verify:ui-metrics -- --gate=final` PASS；十一版本源码矩阵 PASS（`.tmp/compat-032-release.json`，source commit `0425a06`）。
- A1 根字号：根字号 16/24/32px 时图形画布整体 scale 1/1.5/2；节点文本 scrollWidth/clientWidth 与
  scrollHeight/clientHeight 未新增裁切；viewport 在 200% 下可横向滚动。证据：
  `docs/assets/charter-graph-root-text-200-0.3.2.png`。
- A3 状态/媒体证据：空/暂存/已应用/冲突确认（`docs/assets/charter-state-empty-0.3.2.png`、`docs/assets/charter-state-staged-0.3.2.png`、
  `docs/assets/charter-state-applied-0.3.2.png`、`docs/assets/charter-state-conflict-0.3.2.png`）以及 forced-colors/reduced-motion 截图（`docs/assets/charter-state-forced-colors-0.3.2.png`、`docs/assets/charter-state-reduced-motion-0.3.2.png`）；
  已截取冲突确认态；unknown/replay 仍需最终复核。staged 截图已重采，画面不含前置编辑器或残留 bootstrap notice。
- A6 断点：860/900/1000/1100/1200/1440 无横向溢出、无节点重叠、列表行无溢出；1100 下 graphcard
  因 app shell 内容容器窄于 880px 折叠，语义列表仍可用，记为 layout observation。
- B：GUI 方案状态头、附录 D 对账、dependency-graph 状态、verification 当前状态、roadmap/docs index
  pending 措辞已清理；本地已 fetch `v0.3.0`/`v0.3.1` tag。
- A2/A4/A5 仍待人工/受环境阻塞：VoiceOver 可启动但 Apple Events/辅助功能授权缺失，不能声称真实 AT 已跑；
  冻结稿并排签收仍是人工门禁；Desktop 原生截图被 macOS Screen Recording 权限阻塞（`screencapture` 报
  `could not create image from display`）。未有证据前不标记完成。

## 1.4 0.3.3 结构化草案与语言跟随（2026-11-23，候选）

- 源码门禁：`npm run check` = 44 文件 / 524 测试 PASS；token coverage PASS；`verify:ui-metrics --gate=final` PASS。
- 结构化抽取：只按句边界切分、超长保留、>4x 显式截断、全等/前缀折叠、语言标注、稳定 `d-*` ref；见 `tests/core/structured-bootstrap.spec.ts`。
- Host apply：`charter/bootstrapDraft` + `d-*` ref + objective `clientRef`；legacy `charter/bootstrap` 与旧 clientRef 由既有 composition 测试继续覆盖。
- 自动语言跟随：首个 `bootstrapDraft` 请求即返回源语言草案（`language.status=pending`）；客户端立即渲染后再发 `awaitTranslation:true` 请求，由 Host 解析当前会话模型，经 `ctx.llm` 做有界分批严格 JSON 调用（本地流式文本组装）；模型缺失/输出不合格时回退原文并返回显式 `language.status`。每批独立超时并允许一次拆分重试；失败批保留源文并返回 `language.status=partial`；可选 `languageFollowProvider`/`languageFollowModel` 覆盖会话模型。单测覆盖成功、malformed、max-tokens、缺 ref、多批合并与 partial 合并；composition 测试覆盖假模型翻译、翻译后 apply、自定义翻译路由、partial 状态和 `languageFollow: false`；client 测试覆盖非 zh/en 结构化 bootstrap、方法缺失/失败回退和业务错误上抛。legacy golden fixture 锁定 0.3.2 抽取输出。
- 人工验收（2026-11-23）：用户在自适应翻译修改后确认 39 条 en→zh Desktop 草案可用；zh→en 由用户明确放弃人工验收，改由自动化 target-zh 翻译测试覆盖。README Pane/依赖图截图已从实时 `v0.3.3` Desktop 视图重拍。
- legacy golden fixture 为 10 条合成摘要（对方案“≥10 条真实摘要”目标记为接受偏差；当前无可安全提交的真实摘要语料）。
- 候选 artifact `dist/dsh-charter-0.3.3.tgz` SHA-256 `707043d343e6a0b14d4549e6bb92b29f28fa197d99bb48160b796b4e50c8552f`；exact-artifact package smoke 与 packed recovery smoke PASS。13 版本矩阵 PASS（`.tmp/compat-13-034-final4.json`（source `2a8d6c0`），source `26353d2`；含 DSH 最新 `0.2.2-rc.5`）；Web/Desktop profile 安装同一 `707043d…` artifact，143 个包文件逐字节相同；Web profile 由 DSH `0.2.2-rc.5` CLI 启动并显示 Pane `v0.3.3`；Desktop app 为 `0.2.2-rc.5`，profile 由 Electron 独占，原生窗口仍为人工门禁。当前候选未发布。真实 en→zh 已由用户确认；zh→en 按用户决定仅做自动化覆盖。一个 39 条 / 7589 B 的真实摘要此前在 10s 后台超时下返回 `translation finished with aborted`；分批 + 每批超时/拆分重试 + partial 合并 + 60s 后台窗口 + 可选专用翻译路由 + DeepSeek `reasoningEffort: off` 是修复，需重跑该人工用例。
## 1.5 0.3.4 草案校准（2026-11-24，开发候选）

- 源码门禁：`npm run check` = 46 文件 / 567 测试 PASS；13 个声明 DSH 版本 token 覆盖 PASS；`verify:ui-metrics --gate=final` PASS。
- 已实现：opt-in 校准配置/consent 门禁、Host `ctx.llm` 单轮严格 JSON 调用、语义聚合/可读改写校验、`c-*` 候选与 `mergedFrom`、Host-only evidence excerpt、`applyBootstrap.calibrationRunId`、两个新 Remote 方法及基础审阅 UI（校准、uncertain/merge/split、原文、用原文、consent 披露、objective 提醒、诊断 usage）。
- README/README.zh 已精简并更新为当前构建：0.3.4 Pane 截图在 1440×1000 Web profile 视口下裁剪右侧 `.charter-root`，依赖图裁剪图元素并使用更高视口；均跟随系统浅色主题；UI 与契约文本同 README 语言一致（中文复用 `0.3.3` 演示会话的三条中文交付物，因为该 live 会话不能同时从 Web profile 打开）；`package:smoke` 现在校验本地化 `locale/en.json`/`locale/zh.json` metadata 且 description 包含包版本。Web Plugin Manager 在中英文下均渲染了本地化标题/描述和版本说明。
- v11 源码候选 `dist/dsh-charter-0.3.4.tgz` SHA-256 `e86909fb8ba6fdfe1213a68868d0dc1e631619752ffa6957a81e07c598c8857b`（167 文件）；`npm run check`（46 文件 / 567 测试）、13 版本源码矩阵（`.tmp/compat-13-034-final.json`，source `82d45bc`）、exact-artifact package smoke、packed recovery smoke、fresh DSH 0.2.2-rc.5 Web profile 安装/启动 smoke、DSH 0.2.1-rc.3/rc.4 Gateway acceptance（各 20 项授权检查）PASS。这还不是 release candidate：A/B 与 zh→en 人工验收已由发布负责人 waived；完整 L4 矩阵、Desktop 正式 hot-update 验收与发布流程仍待完成。
- P1-5 覆盖收口（2026-11-24）：另补 failure matrix（malformed/schema/text/tool-call/非 stop/超时）、effort 枚举拒绝与 0.3.2/0.3.3 实际 record fixture；0.3.2/0.3.3 实际产生的 v2 record fixture 在当前 strict schema 下无损解析；新增 capability 四态、缓存/单飞、30 分钟 run TTL、objective c-* 逐字、consent、混用命名空间、missing/expired run、wire evidence、run/handle、翻译回退、mergedFrom 与 oversized split 测试。
- P2 收口（2026-11-24）：移除未实现的 `calibration.trigger`/`calibration.cooldownMinutes` 配置与诊断 UI；补 non-owner calibration Remote 守卫测试；docs/README 索引改为“保留 0.3.3 翻译回退”并标记 pending release acceptance；英文披露文案改由共享 `CALIBRATION_DISCLOSURE` 常量单一来源。
- 插件详情本地化验证（2026-11-25）：使用已安装 DSH 0.2.2-rc.5 的 `@deepseek-ai/dsh-plugin-detail` 选择器，修改前 zh-CN 与 en-US 都解析到 `README.md`；fallback README 探测不包含 `README.zh.md`。在 `locale/zh.json` 增加 `meta.detail: "README.zh.md"`、`locale/en.json` 增加 `meta.detail: "README.md"` 后，同一选择器 zh-CN 解析到 `README.zh.md`、en-US 解析到 `README.md`。文件名不变；package smoke 校验两个 detail 路径存在。
- 延后到 0.3.5 的效果限制（2026-11-25）：已完成/无待办的 Session summary（真实 `dsh-livery` session `16c…`，`Pending Jobs: (none)`、`0.1.8 fully published`）仍会生成历史 objective 与完成态/证据候选。用户决定延后到 0.3.5，不阻断 0.3.4。
- waiver 后验证（2026-11-25）：发布负责人 waived A/B 协议 1/2（opt-in 手动草案改写不适合盲评，不据此宣称效果）；英文 source → 中文草案已人工验收通过，中文 → 英文人工验收 waived。新增 Host 集成测试证明 3 批校准期间 Session `append` 为零（transcript 隔离）；带校准 evidence 的 record fixture 同时通过当前 schema 与解包的 0.3.3 schema，提供反向 downgrade 的 schema 证据。`npm run check` = 46 文件 / **567 测试**；artifact 仍为 `e86909f…`；完整 L4 矩阵、Desktop 正式 hot-update 验收与发布流程仍待完成。
- v11 objective/配额优化（2026-11-25）：新导出最新 summary（`seq 44692`）把 objective 截成单一 out-of-scope 子句并把真实 gate/commit deliverable 裁进 cap。Host 现在在 stable anchor 丢失时回退源 objective，并先选全部契约 deliverable 再填 invariant。同一 summary：保留完整源 objective；4/4 批；5 次调用；7,555 output tokens；38.2s；1 objective / 18 deliverable / 12 invariant；模型遗漏的 gate/commit deliverable 由源恢复；1 条 invariant 被 cap、1 条 model-omitted 可见。`npm run check` 46 文件 / **567 测试**；矩阵 13/13 source `82d45bc`；artifact `e86909f…`（167 文件）；package/recovery/profile/Gateway/UI smokes PASS。
- v10 发布审查修复（2026-11-25）：Remote 校准业务失败改为 `CharterCalibrationFailure` 领域失败值，客户端转为 `CharterCalibrationCallError`；隔离 Host 用 consent v1 验证返回 `CALIBRATION_CONSENT_REQUIRED` 领域失败，而不是 `gateway/internal`。objective/deliverable 按来源 ref 溯源；多余 objective 进入 `conflicts`；v8 批次/冲突诊断进入 strict wire，Pane 渲染 conflicts；contractness 保留 Tests/Coverage/decision-authority 硬约束；degraded parts 全局重编号后重映射；user-guide 与 §5.7/§5.8/§8/§9 缓存/重试/进度承诺对齐。`npm run check` = 46 文件 / **567 测试**；13 版本矩阵 PASS（`.tmp/compat-13-034-final.json`，source `82d45bc`）；最终 artifact `e86909f…`（167 文件）package/recovery/profile/Gateway/UI smokes PASS。同一真实 summary：3/3 批、无截断、1 objective、10 deliverable、8 invariant、17 条 non-contract、5 次调用、6,499 output tokens、28.1s。仍是工程证据，正式 A/B 与人工门禁未完成。
- v9 契约质量验证（2026-11-24）：真实 `85809bdb…` summary 显示 v8 排除了 objective 和 4 个 deliverable，并保留 heading/状态/可选建议。v9 增加确定性契约性门禁、objective/交付物配额、prompt v2 与输出过滤；同一 summary 现在得到 19 候选（1 objective / 11 deliverable / 7 invariant）、3/3 批、3 次调用、5,216 output tokens、11.1s、`truncated=false`，18 条非契约 ref 显式排除。T-1/T-2/T-3 为 deliverable，heading/状态/可选建议不再进入契约；T-3 精确配置仍为原子 invariant，后续可加 bounded reduce。
- 校准方案重做（2026-11-24）：真实 Web 10 轮 + `/compact` 实测表明 v7 单次调用默认 2048 输出会 `max-tokens` 失败，且 32 条 draft 只校准 12 条。v8 自适应分批（planner/runner/reduce）已实现；同一 10 轮 case 在默认参数下通过（3/3 批、24 候选、无截断、15.2s），见 [research/2026-11-24-calibration-ab](research/2026-11-24-calibration-ab/report.md)。partial/truncated 状态与披露 v2 已实现；正式 A/B、L4/AT、旧 profile 降级与人工门禁仍未完成，候选**未达到发布条件**。
- 审查加固（2026-11-24）：0.3.3 语言归一始终作为自动回退运行，校准改用保留的 L1 源 handle；非 zh/en 不暴露校准；校准 run 与源 draft handle 绑定；mergedFrom excerpt 接入逐条 diff；新增 consent、混用命名空间、missing run、run/handle、wire evidence、mergedFrom 与翻译回退测试；Remote 校准仅允许 owner；修正 excerpt 截断/degraded 阈值、joined 标志与状态重置。
- 尚未完成：正式盲评 A/B 协议 1/2、完整 L4 UI/AT 证据（含批级 partial 状态）、P5 按**全部 batch** 复核 transcript 隔离、完整 13 版本真实 Host capability/failure 矩阵（M0-P3，含批并发/abort P9）、真实旧 profile 降级验证与真实模型人工校准验收。v8 内核与默认参数 10 轮 case 已完成；已知偏差仍按校准方案记录：effort 枚举/取消为保留项，按 ref 的 suppressed 选择集为 MVP 整体替换。校准默认关闭。
- Desktop 门禁状态（2026-11-24）：本机已安装 Desktop App `0.2.2-rc.5`，但 Desktop profile 被指向 0.3.4 文件时，已经运行的 Host 仍加载的是 0.3.3。候选**未在 Desktop 中激活**；必须由人工通过 Desktop Plugins 热更新路径安装/重载并完成验收，禁止通过终止或向 Desktop App/Host 发信号来强行推进门禁。
