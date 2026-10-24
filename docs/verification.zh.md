# `dsh-charter` 验证记录

[English](verification.md) | 中文

验证日期：2026-10-20；第二、三轮发布就绪评审后复跑：2026-10-21；本地 `0.1.0-rc.1` RC 构建与 tracked 产物 digest 的
最终树复跑：2026-10-22。
环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`；当前 Desktop 运行时 DSH `0.2.0-rc.2`。
本地开发依赖基线：DSH `0.2.1-rc.2`。

本文记录可复现的命令和结果。临时目录、profile、tarball 和抓取到的 HTML 都在 `.tmp/` 下，不进入发布包。

## 1. 结论

| 验证项 | 结果 |
| --- | --- |
| TypeScript 严格类型检查（5 个 DSH 版本） | 通过 |
| Vitest（5 个本地可用版本 × 263 个测试） | 通过 |
| Host ESM 构建 + 浏览器单文件 bundle | 通过 |
| Remote 装饰器/资源 smoke | 通过（0.1.7/0.2.0 按预期无资源声明） |
| 浏览器 factory bundle 物化与 `apply` smoke | 通过 |
| 真实 DSH profile 安装、组合、启动（0.1.7-rc.2 / 0.2.0-rc.2） | 通过 |
| Web boot graph 与 `/plugins` 服务 | 通过 |
| 真实浏览器 UI 交互（0.2.0-rc.2 Web profile） | 通过：标签顺序、中英文切换、目标/约束编辑、预览、Apply、刷新持久化；见第 7 节 |
| 非 live Session 的只读 stored view | 通过：composition 测试覆盖 stored view 与 live 后自动升级 |
| 从压缩摘要生成历史草案 | 通过：core 解析器（含真实 bullet-only 摘要格式）+ composition 真实 Session 事件；见 4.4 |
| 单记录损坏隔离 | 对**内部** schema 不合法记录通过（只禁用其 Session 并保留原文）；外层 JSON 不可读是已记录的残留风险，不在此保证内；见 4.5 |
| 预算收紧与收敛 | 通过：调低预算后显示 `overBudget`、停止注入、缩小编辑可收敛；不可用配置被 clamp；见 4.5 |
| Pane 跨连接状态渲染 | 通过：replay 谓词与 `confirmAbandon` 重置 effect 位于所有 early return 之前，connecting/null → ready 与 error/null → retry → ready 的 hook 顺序不变；真实 `react-test-renderer` 测试精确复现修复前的 "Rendered more hooks than during the previous render" 并在修复后通过；见第 2 节 |
| Session 级客户端草稿 | 通过：edit 与 bootstrap 共用**一个**持久 attempt 类型 `{request, sourceGeneration, status: in-flight|unknown}`；传输失败与任何 UNAVAILABLE（含 source 未 attach/remote 不可用）转为 unknown 且绝不清除 mutationId/baseRevision/ops，只有成功或确定性业务码才解决；unknown 期间所有 request-changing 操作（stage/unstage/编辑器/objective/候选/选择/rebase/普通 Discard/Dismiss）都 no-op，Pane 在冲突/准入失败时仍启用 **Retry last Apply**，并提供单独的确认式 **Abandon unknown request**（只有它能清除 attempt）；流帧不会 half-clean（needs-stale + 可见可 replay payload，显式 abandon/dismiss 才完整清理）；attempt 未解决或编辑器/历史草案占用 baseline 时 Rebase 被阻止；编辑器 revision baseline 冻结；历史草案按提取 revision 门禁；原子 lifecycle-bind-then-extract；共享 `draftAdmission` 与 bootstrap store 预检；单一投影显示顺序；lifecycle fingerprint 转换；bootstrap 不抢占 section；见 4.5 |
| 客户端 source 恢复与 retry | 通过：重试收到相同 revision 时恢复 `ready` 并清除 watchdog；终止的 snapshot stream 被 dispose，Retry 会重建它（首个快照前后均有覆盖）；见 4.5 |
| 运行期 schema 重新校验 | 通过：mount 后把记录改成非法 schema，只有该 Session 不可用且原始记录保留；见 4.6 |
| 打包产物可安装性 | 通过：本地 `npm run smoke:package`（tarball 内容、exports/文件、packed `core` import、client bundle；Host/Remote 运行时 import 由工作区 build smoke 覆盖）；exact-artifact `--artifact/--sha256` 模式校验 SHA-256、用**结构化 Node ustar/PAX 解析器**读取 archive（512 字节 header、checksum 校验、GNU longname/longlink、PAX path；只接受普通文件/目录，拒绝 symlink/hardlink/字符/块/fifo、绝对/穿越/反斜杠/package 外路径、重复、截断/越界数据、坏 checksum）并校验 archive 内 packed manifest（身份与 files/exports/dependencies/peers/engines 必须与工作树一致），再对确切字节执行同样的 consumer 检查且不 build/pack；不解析任何平台 `tar -v` 文本；见第 2 节 |
| Compaction checker 退出条件 | 通过：纯函数 fixture 覆盖严格生命周期状态机；现代 `charter_read` 认证要求 `sourceEventSeqs` 恰好指向一个更早的 `charter_read` call 且 toolCallId/turn/step 全部存在并精确相等（缺失/不匹配/malformed 一律拒绝，不回退 legacy、不做 wildcard）；严格 arguments；活动门禁；成功证据之后的**所有**后续 attempt（任一 landed-failed ⇒ FAIL，即使后面还有未 landing 的 attempt；任一 open ⇒ WAIT）；同 id retry 的 checkpoint 按 attempt seq 区间关联；transcript envelope 校验（对象/type/seq/time/data/严格递增）带行号拒绝中间损坏；WAIT 内部一致（pending gate 时 `verification.evaluated=false`、failures 为空、无 FAIL verdict line，只有已评估的 active evidence 才可 FAIL）；失败 end 不作证据、commit 落在 start/end 之间需重新 compaction、快照丢失、checkpoint 泄漏 warning、OPEN attempt 渲染；并断言 exit code/JSON verdict/text/warnings；见 4.7 |
| 陈旧异步草稿结果 | 通过：edit/bootstrap 结果按 source/generation/请求身份围栏；空草稿和 idle 草稿会回收；见 4.7 |
| 真实模型 + compaction 端到端 | **2026-10-22 实测 PASS**（一个匿名评估会话）：326 条历史消息 / 约 228k tokens 被压缩，revision 1 会话契约存活，压缩后快照与 `charter_read` 均验证（见 8.4） |

## 2. 本地基线

```bash
npm run typecheck
npm test
```

结果：

- typecheck 通过；
- build 通过；
- 20 个测试文件、263 个测试全部通过（来自 `npm test`，即 build 后运行 `vitest run`）；
- `remote-smoke` 断言 `watch,bootstrap,edit`、stream mode 和 Session resource；
- `client-smoke` 断言单文件 factory bundle、外部依赖白名单、不引用 Node-only `Buffer`、`apply` 注册
  tab/pane/Remote contribution。
- `smoke:package` 构建并打包 tarball、校验必需文件和文件 mode 以及所有 `exports` 目标、拒绝泄漏的工作区文件，
  把 tarball 安装到一个**空 consumer 项目**（只使用其声明依赖），再加载 packed `dsh-charter/core` 入口与
  client bundle。exact-artifact 模式（`--artifact <tgz> --sha256 <sums>`）不 build、不 pack：校验给定 archive 的
  SHA-256，用**结构化 Node ustar/PAX 解析器**读取 gzip archive（512 字节 header、checksum 校验、GNU
  longname/longlink、PAX path；只接受普通文件/目录，拒绝 symlink/hardlink/字符/块/fifo、绝对/穿越/反斜杠/
  package 外路径、重复、截断/越界数据、坏 checksum）并校验 archive 内 packed manifest（身份与
  files/exports/dependencies/peers/engines 必须与工作树一致；packed manifest 作为 export/dependency 检查的
  来源），再对确切字节执行同样的 consumer 检查。不解析任何平台 `tar -v` 文本（Ubuntu GNU tar/`LC_ALL` 差异与
  解析无关）。`npm pack --json` 解析支持 object、以包名为 key 的 object 与单元素数组（npm 10/11/12）。

CI（`.github/workflows/ci.yml`）对 Node `22.19.0` 与 Node `24` 运行 `npm run check` 和
`npm run smoke:package`；本文档记录的本地门禁运行于 Node `v22.23.1`。

关键测试文件：

| 文件 | 覆盖 |
| --- | --- |
| `tests/core/commands.spec.ts` | 目标、条目、替代、状态转换、purge 生命周期保护、`item.propose` clientRef 铸造、整批回滚 |
| `tests/core/record.spec.ts` | 原子提交、幂等、revision、history 裁剪、篡改检测 |
| `tests/core/prompt.spec.ts` | 确定性渲染、`{{` 转义、UI 预览与 Host 渲染一致 |
| `tests/core/normalize-render.spec.ts` | NFC、控制字符、字节上限、100 次稳定性 |
| `tests/core/state.spec.ts` | 替代链必须指向 current successor |
| `tests/core/fork.spec.ts` | fork 重铸 id、替代链重映射 |
| `tests/core/bootstrap.spec.ts` | 压缩摘要分节抽取、latest objective、UTF-8 拆分/不截断、最新/损坏 summary、回退到较旧可用 summary |
| `tests/host/composition.spec.ts` | 真实 Cordis/Storage/SystemPrompt/Tools 组合、user-role 边界、actor 策略、`item.add` + `item.propose` 混合原子 Apply、user actor 的 proposal、完整 standing 与有上限 `all`、单条损坏记录隔离、调低预算后的超预算收敛、不可用配置 clamp、child retry 发布 ready 帧、fork、幂等、配额、父环拒绝、lifecycle、非 live Session 的只读 stored view 与 live 升级、从真实 `compaction/summary` 事件生成草案 |
| `tests/host/watch.spec.ts` | opening snapshot、竞态、去重、abort、装饰器兼容、resource-scope 能力检测 |
| `tests/host/actor.spec.ts` | principal 感知策略：现代运行时缺失 principal 拒绝、仅旧版 owner 回退、非 owner 记录、按版本选择的 `resolveRemoteActor` |
| `tests/host/remote.spec.ts` | Remote 描述符、wire schema、旧 Host view snapshot、零 pending 上限 |
| `tests/client/store.spec.ts` | 提交后立即接受 view、忽略陈旧/重复 revision、opening snapshot 单调、权威不可用降级、attach 重试、相同快照的 retry 恢复与 watchdog 清除、终止 stream 在 Retry 时重建（首快照前后）、终止失败先推进 connection epoch 且迟到 Apply 成功被拒绝、保留 mutation id 的 retry、真实 controller 下的未知结果 edit 恢复（已提交但丢失的 M1 → source 脱离 → UNAVAILABLE 保留 exact request 并锁住编辑 → 重新 attach 后 replay 同 mutationId、最终只有一个 committed item）、待生效 attach 在 stream 启动前被取消、共享 source lease/引用计数、旧 lease no-op、忽略其他 Session 的 stream 帧 |
| `tests/client/bootstrap-plan.spec.ts` | 溢出候选仍在一个 plan 中；O(1) 增量字节核算，覆盖 3,000 全 active、混合、2,000 CRLF/NFD 用例；base objective 已超预算时返回全 pending 计划且不触发 quadratic fallback（`usedExactFallback`/`exactRenders` 诊断）；逐候选结果；bootstrap 结果分类（draft/discard/stale/unavailable） |
| `tests/client/draft.spec.ts` / `draft-store.spec.ts` | Session 绑定的请求构造（A 的 ops 不会为 B 构造请求）；binding 卸载/重挂载后草稿存活；统一的 `{request, sourceGeneration, status}` attempt 生命周期：传输/UNAVAILABLE 转为 unknown 且不清 mutationId/baseRevision/ops、所有 request-changing 操作被锁、replay 先于 admission、确定性业务错误解决并解锁、显式 abandon 是唯一清除路径（unknown 期间普通 dismiss/discard 被锁）、bootstrap 先流帧后传输错误保留可见可 replay payload 并重发 exact request（成功反馈来自 retained request）；attempt 未解决时 Rebase 被阻止；编辑器打开时拒绝冲突 rebase；冻结的编辑器 revision baseline；历史草案按提取 revision 门禁；原子 lifecycle-bind-then-extract；共享 `draftAdmission`；归一化准入上限；unstage 后的 order 分配；lifecycle null→fingerprint 转换；陈旧异步结果不能覆盖新的 draft/source/lifecycle；bootstrap 不抢占 section |
| `tests/client/pane-hooks.spec.tsx` | 真实 `react-test-renderer` 渲染导出的 `CharterPane`（无 DOM/testing-library）：connecting + null view → ready 快照、error + null view → retry → ready、ready → revision 更新；修复前的 hook 位置在前两种场景以 React 的 "Rendered more hooks than during the previous render" 失败，修复后全部渲染通过 |
| `tests/client/preview.spec.ts` | 投影后的 draft 行（add/edit/accept/progress/supersede/purge）；purge 预览会解除后继的 supersedes 关联；committed fixture 下两种 purge 顺序都保留直接暂存后继的 Unstage，只有纯派生行才隐藏；渲染器一致性与 pending 排除；pending/active 行按单一投影顺序显示（接受后保持顺序）；按 order（而非 Host id）排序渲染；prompt 预算的 Apply 准入（缩短、同字节、增长、预算内四种渲染） |
| `tests/verify/compaction-checks.spec.ts` | compaction checker fixture：严格生命周期状态机（合法序列、失败 end、end-before-start、summary-before-start、同 id retry）；现代 `charter_read` producing-call 认证（合法；identity 字段缺失 toolCallId/turn/step 或 call 侧缺失、不匹配、source seq 非有限/≥result、歧义/非 charter call）与 legacy 重复 callId 配对；严格 arguments（缺省/普通对象/standing 有效，其他 malformed 形状全部拒绝）；活动门禁（无活动 = WAIT，执行但无 runtime 快照 = FAIL）；成功证据之后所有后续 attempt（landed-failed 后跟 unlanded 仍 FAIL、open = WAIT、未 landing 保留 PASS、后续成功需新证据）；checkpoint 按 attempt seq 区间关联（同 id retry 不继承旧 checkpoint）；WAIT 内部一致（`evaluated=false`、failures 空、无 FAIL line，仅 active evidence 可 FAIL）；system prompt 污染；commit 落在 start/end 之间需重新 compaction；断言 exit code/JSON verdict/文本/warnings；紧凑 standing 投影一致 |
| `tests/verify/transcript-parser.spec.ts` | CLI fixture：末尾 torn line（append 未完成）被忽略；中间损坏行与完整的末尾损坏行都会带行号失败，绝不 PASS；非法 event envelope（null/数字/数组/缺字段/重复或倒序 seq/缺 data/time）同样带行号且无 Node stack |
| `tests/verify/package-smoke.spec.ts` | pack JSON 解析：object/以包名为 key 的 object/单元素数组（完整输出解析）、SHA sums 解析与 exact-artifact digest 校验（匹配 + 不匹配 + 缺失条目）、用 JS 构造的 GNU/BSD ustar、PAX 长路径、GNU longname archive 验证结构化 Node tar 解析，并拒绝 symlink/hardlink/fifo/重复/穿越/绝对/package 外/坏 checksum/截断数据、tar 内 packed manifest 的身份/files/exports/dependencies/peers/engines 与工作树一致性校验、artifact 模式参数配对 |

## 3. 跨版本矩阵

每个版本使用独立目录和独立 `node_modules`：

```text
.tmp/compat/017rc2/proj
.tmp/compat/020rc1/proj
.tmp/compat/020rc2/proj
.tmp/compat/021rc1/proj
.tmp/compat/021rc2/proj
```

复制源码（排除 `node_modules`、`lib`、`.build-ts`、`.tmp`），把版本目录的 `node_modules` 链接进 `proj`，然后执行：

```bash
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

结果：

| 版本 | typecheck | build | Vitest | remote smoke | client smoke |
| --- | --- | --- | --- | --- | --- |
| `0.1.7-rc.2` | 通过 | 通过 | 260/260 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.1` | 通过 | 通过 | 260/260 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.2` | 通过 | 通过 | 260/260 | 通过（无 resources 警告） | 通过 |
| `0.2.1-rc.1` | 通过 | 通过 | 260/260 | 通过 | 通过 |
| `0.2.1-rc.2` | 通过 | 通过 | 260/260 | 通过 | 通过 |

最终 `0.1.0-rc.1` 树在 2026-10-22 重新跑过：每个版本均为 19 个测试文件 / 260 个测试，且 build 内含 remote/client
smoke 断言。

这个五版本矩阵是**本地证据**：版本目录和驱动脚本位于被 git 忽略的 `.tmp/`，公开 CI 不会复现它。CI
（`.github/workflows/ci.yml`）在 Node `22.19.0` 与 Node `24` 上运行已提交的门禁（`npm run check` +
`npm run smoke:package`）。

`0.1.7-rc.2` 和 `0.2.0` 的 remote smoke 输出：

```text
remote-smoke: this DSH generation has no @Remote resources; per-Peer Session authorization is unavailable (expected on 0.1.7/0.2.0).
```

`0.2.1` 的 remote smoke 不打印警告，并断言两个方法都有 `resources.session`。

复现跨版本目录（示例）：

```bash
mkdir -p .tmp/compat/020rc2
cd .tmp/compat/020rc2
printf '{"name":"compat-020rc2","private":true,"type":"module"}\n' > package.json
pnpm add --store-dir ../../pnpm-store \
  @deepseek-ai/cordis@4.0.4 \
  @deepseek-ai/dsh-agent@0.2.0-rc.2 \
  @deepseek-ai/dsh-agent-loop@0.2.0-rc.2 \
  @deepseek-ai/dsh-api-gateway@0.2.0-rc.2 \
  ... # 其余 dsh-* 同版本
cd ../..
rsync -a --exclude node_modules --exclude lib --exclude .build-ts --exclude .tmp ../../ ./proj/
ln -sfn ../node_modules ./proj/node_modules
```

完整包列表见 `.tmp/compat/020rc2/package.json`，或按 `package.json` 的 `devDependencies` 替换版本号。

## 4. Prompt 边界与压缩恢复

### 4.1 user-role 边界

`tests/host/composition.spec.ts` 在真实 `SystemPrompt` assembly 中验证：

- `assembly.contexts` 中存在 `charter:standing`；
- `renderContextSnapshot(assembly)` 包含会话契约正文；
- `renderPrompt(assembly)` 和 `assembly.sections` 不包含会话契约正文；
- 重新 assembly 得到相同字节；
- 编辑后重新 assembly 读到新目标，不再包含旧目标。

这证明用户正文只进入 runtime context（user role），没有进入 system-role prompt。

### 4.2 `{{...}}` 插值安全

同一测试写入 `Mention {{name}} and {{unknown}} literally in the docs`，然后在 `0.1.7-rc.2` 和
`0.2.0-rc.2` 的 `SystemPrompt` 上 assembly。结果：

- assembly 不抛 unknown prompt variable；
- 渲染文本不含 `{{name}}`；
- JSON 中显示为 `\u007b{name}`；
- `JSON.parse` 后仍是原始文本。

`0.2.1+` 还额外设置 `interpolate:false`，但转义使两种版本行为一致。

### 4.3 压缩后重新物化

本插件在每个 assembly 的 `text` provider 中调用 `charter.promptText(session)`，该调用同步读取 storage
正本并校验派生 digest，不读取任何 Session 摘要或 retained snapshot 缓存。DSH `0.2.0-rc.2` 的
`RuntimeContextProjection` 在 retained snapshot 被 replacement/compaction 遮蔽后清空 retained，下一次
`project()` 从当前 providers 重新生成文本。

因此：

- 单元/组合层已验证“每次 assembly 从正本读取”和“重新 assembly 字节稳定”；
- 平台层已验证 runtime-context 的重新物化路径；
- 真实模型 compaction **PASS 已记录在 8.4 节（2026-10-22）**；`npm run verify:compaction` 手工命令保留用于在目标 profile 重新跑一次。

### 4.4 从压缩摘要生成历史草案

`tests/core/bootstrap.spec.ts` 用一份典型压缩摘要验证：

- `Latest correction` 优先作为目标，其次 `Original`，最后才使用第一段；
- Primary Request 的 user-wants 条目、Critical Context 中的约束语义行进入候选硬约束；
- Pending Jobs / Next Step 条目进入候选交付物；
- 超过单条字节上限时按句子/分句/code point 边界拆成多个候选，不丢弃内容；
- 损坏或空 summary 被跳过，使用最近一条可用 summary；
- 无结构文本仍可作为目标，但不会伪造条目。

`tests/host/composition.spec.ts` 在一个真实 Session 上追加 `compaction/summary` 事件后调用
`service.bootstrap()`，验证返回的 objective/deliverables、`shadowedTokenCount` 来源元数据，并确认：
调用本身不改变 revision、不写 storage；只有用户点击应用后，草案才通过普通原子 edit 成为 revision 1。

UI 的自动草案面板依赖客户端 `useEffect` 和 Remote bootstrap；8.4 节记录了该面板的草案在真实压缩会话中被审阅并
应用为 revision 1。真正剩余的缺口只是没有为自动草案面板本身补浏览器截图；客户端路径由 typecheck/build 和 Remote
契约测试覆盖。

### 4.5 记录隔离、预算降级与客户端草稿所有权

第三轮发布就绪评审补充了此前只有静态审查的降级路径平台级回归：

- **损坏记录隔离**：直接在 `storages/dsh_charter_v1/sessions/<id>.json` 写入带未知字段的记录后重新挂载，
  仅该 Session 变为 `unavailable` 且原始文件保持不变；无关 Session 仍能读取、注入和编辑。
- **残留风险：外层 JSON 不可读**：JSON storage backend 刻意把 malformed/版本被拒绝的 per-record 文档当作
  **记录不存在**（`readRecord` 捕获所有读取/解析错误），而插件侧 `KvTable` 没有读取错误信号或原始文件视图。
  在不使用路径特判或切换 layout 的前提下，插件无法区分"外层文档不可读"与"记录缺失"，因此 service 初始化会在
  下一次写入时创建新的空记录，而不是保留不可读的字节。所以"保留原始文档"保证**只**适用于内部
  schema/一致性不合法的记录，不适用于外层 JSON 不可读；这是已记录的残留风险，不是已关闭问题，发布检查中也记录
  在 `docs/releasing.zh.md`。外层不可读的运营恢复方式：在 Host 初始化该 Session 之前停止 Host，备份并修复记录
  文件后再重启——插件本身无法检测或阻止这次覆盖。
- **预算调低**：默认 8 KiB 预算下创建的契约，以 `maxPromptBytes: 300` 重新挂载；view 为 `ready` +
  `overBudget`，`promptText()` 返回空（不注入），增加内容返回 `QUOTA_EXCEEDED`，归档条目因 prompt 缩小而被
  允许，最终离开 `overBudget`。
- **不可用配置**：`maxPromptBytes`、`maxRecordBytes`、`maxHistoryBytes` 设为 `1` 时被抬到文档化最小值并
  记录 Host warning，避免出现 ready 但永久不可编辑的 Session。
- **初始化重试**：parent record 尚未持久化时先创建的 child Session 先显示 `unavailable`；parent 出现后，
  瞬时失败在 `put` 发布前清除，随后发布 ready 帧（修复了此前只发布 stale unavailable 帧的问题）。
- **客户端所有权**：单测覆盖 draft 在卸载/重挂载后存活、未知结果重试复用 mutation id、冲突 rebase 使用新 id、
  bootstrap 在编辑器打开时不抢占 section、投影条目在 Apply 前即显示暂存状态。
- **连接恢复与终止重试**：`publishIfNewer` 把连接就绪与业务数据去重分开：retry/reattach 收到相同 revision 时
  发布 `ready` 并清除首帧 watchdog，而已经 ready 的面板收到相同 revision 仍然去重。结束/失败的 snapshot stream
  是终止状态：它被 dispose 并清空，因此 Retry 会重建 Remote watch，而不是重启一个已中止的 lifetime（覆盖首个快照
  前后，并且新快照后无 timeout）。
- **草稿 revision baseline 与准入**：编辑器打开时捕获 `editorBaseRevision`（已有暂存批次则沿用其 baseline，否则
  用当前 view revision）；保存 objective/item 编辑时用冻结的 baseline 暂存，因此无关的远端提交不会静默把编辑
  改到新 revision，只有显式 rebase 才推进它。字节预算、unchanged 比较、reason、候选上限与生成的 op 文本都使用
  `inspectUserText(...).value`，CRLF/NFD 输入不能绕过或浪费上限（有 contraction/expansion fixture），只做归一化
  的编辑视为 unchanged，同时其他合法 op 仍可暂存。
- **Order 分配与 purge 派生**：下一个暂存 order = committed max + 1 + 当前 staged add/propose/supersede/order-edit
  的最大有效 order，因此 add/unstage/add 不会复用 order；投影行按真实 op-target 规则推导
  `staged`/`unstageTarget`，所以同时被直接编辑/验证的 purge 派生后继保留 Unstage（只移除自己的 ops），纯派生
  的 link detach 才隐藏 Unstage。
- **终止失败与连接 epoch**：snapshot stream 结束/失败时先 `bumpConnection()` 再发布 error，controller listener
  会立即失效在途草稿请求（保留 ops 与 mutation id），迟到的 Apply 成功无法通过 generation guards；Retry 会重建
  stream 并复用同一 mutation id。
- **Rebase 限制与 bootstrap baseline**：编辑器打开或已审阅历史草案持有其他 baseline 时，`rebase()` 与 Pane 的
  Rebase 操作（共享 `rebaseAvailable` 谓词）都会拒绝/隐藏；保存旧编辑器后 Apply 仍报 revision conflict，关闭
  编辑器并显式 rebase 才推进。历史草案接受时捕获 `bootstrapBaseRevision`，Apply 使用它且要求当前 view 仍匹配、
  objective/items 为空，否则标记 stale 并要求重新提取；Rebase 不会推进 bootstrap baseline。
- **共享准入与显示顺序**：Pane 与 `applyDraft()` 共用纯函数 `draftAdmission(view, ops)`（maxOps、投影后
  maxItems/maxPendingItems 的逐步规则、prompt 增长/缩短规则）；不可准入的批次由 Pane 禁用并在 store 中直接
  拒绝，绝不调用 Remote。Pane 渲染单一已排序投影列表（`visibleItems`）而不是 active+pending 拼接，因此
  pending order-1 行保持在 active order-2 行之前，接受后也不重排。
- **生命周期 fingerprint 转换**：绑定旧 Host（无 fingerprint）的草稿首次收到 fingerprint 时，空草稿只 bind；
  非空草稿按 lifecycle 变更重置（保留 section），不把旧工作认领到新 lifecycle。
- **edit 与 bootstrap 统一的未知结果 attempt 状态机**：一个持久 attempt 类型
  `{request, sourceGeneration, status: 'in-flight' | 'unknown'}` 同时服务 edit Apply 与 bootstrap Apply（不再
  从 feedback 文案推断）。传输异常或任何 `UNAVAILABLE` 结果——包括 source 未 attach、Remote 不可用——把
  in-flight 转为 unknown 且绝不清除 mutationId/baseRevision/ops；只有成功或确定性业务码
  （REVISION_CONFLICT、QUOTA_EXCEEDED、INVALID_ARGUMENT 等）才解决/清除。unknown 期间所有 request-changing
  操作都被锁住：edit stage/unstage/add/save-editor/open-editor/文本 setter、bootstrap objective/候选/选择编辑、
  Rebase、普通 Discard 与普通 Dismiss。Pane 由同一组导出的
  `editReplayPending`/`bootstrapReplayPending`/`unknownAttempt` 谓词驱动：**Retry last Apply** 在 revision
  conflict 或 fresh admission 失败时仍可用，并在任何检查前原样重发 retained request；单独的
  **Abandon unknown request** 带确认步骤，是唯一清除 unknown attempt 的路径（保留已暂存 ops / 已审阅 bootstrap
  payload）。流帧不会 half-clean：in-flight/unknown bootstrap Apply 期间收到非空 frame 只设置 needs-stale 并保留
  payload/attempt/base；成功才完整清理；未知错误留下可审阅/可 replay 的草案；显式 abandon/dismiss 才完整清理并
  推进 generation。测试走真实 controller/store 路径：已提交但响应丢失的 M1 + source 脱离 + replay UNAVAILABLE
  保留 exact request 并锁住所有编辑；重新 attach 后 replay 同 mutationId，Host receipt 只应用一次；确定性
  conflict 解决并解锁；bootstrap 先流帧后传输错误保持可见可 replay 并重发 exact request。分类集中化：任何
  UNAVAILABLE 结果（包括 source 脱离或 ok:false 的 UNAVAILABLE 回复）以及任何传输异常都转为 unknown；
  attempt 清除审计保证 generation/lifecycle/source 变化只更新与请求 mutationId 匹配的 attempt，绝不含丢凭据。
  Pane 只有一个 `syncView` effect（store 内 bindLifecycle → ensure bootstrap → reconcileBootstrapView）；
  `ensureBootstrap` 只负责启动抽取，所有 reactive dismissal/cleanup 都是原子操作，因此 replay 锁不会变得不可见。
- **Bootstrap lifecycle、清理、预检、replay 与原子状态**：Pane 在同一 effect 内先 bind lifecycle 再
  `ensureBootstrap`；旧 Host 首次收到真实 fingerprint 时，会使在未知 lifecycle 下启动的 extraction 失效并为已
  定义 lifecycle 重新提取；切换 lifecycle 会丢弃旧 extraction，只接受新 lifecycle 的结果。已审阅草案遇到远端
  view 非空时走单一 stale/dismiss 清理路径（objective/items/base/attempt/generation 全部清除，`isEmpty` 为
  true）——但 Apply 在途或 replay-pending 时只标记 `bootstrapNeedsStale`，已审阅 payload 与 attempt 保持可见。
  任何 fresh Remote 调用之前，`applyBootstrap` 会执行与 Pane 相同的文本校验与扩展 admission。bootstrap Apply
  结果未知时，共享 unknown-attempt 状态锁住 objective/候选/选择编辑并执行同样的 replay-before-stale/admission
  规则：Retry 原样重发 retained request（同 mutationId/baseRevision/ops），成功反馈计数来自 retained request
  （绝不重新 plan），传输/UNAVAILABLE 保持可见可 replay 草案，普通 Dismiss 被锁住，确认式
  **Abandon unknown request**（或 attempt 解决后再 Dismiss）是唯一清除 attempt 并做完整清理的路径。
- **字段预算**：共享 admission 同时镜像 Host 的 `maxObjectiveBytes`/`maxItemBytes` 规则：超限时允许 unchanged
  或严格缩短，拒绝新增、增长或等字节但内容不同的值（`max-objective`/`max-item` 原因）；`applyDraft` 对此类
  批次直接拒绝、不调用 Remote。
- **规划规模**：bootstrap planner 使用与精确渲染一致的 O(1) 增量字节核算；用 2,000 个混合候选和 3,000 个全
  active 候选测试，返回逐候选 active/pending 结果，并保留最终精确渲染作为预算校验/回退。

### 4.6 运行期完整性、权限 fail-closed 与客户端状态边界

第四轮发布就绪评审针对启动后或运行时损坏才出现的失败路径补充了回归：

- **运行期 schema 重新校验**：service 正常 mount 后，测试直接向 table 写入 `recordSchemaVersion: 2` 的记录。
  `recordFor()` 和 edit transform 每次重新解析存储文档；只有该 Session 变为 `unavailable`，prompt 为空，
  edit 返回 `UNAVAILABLE`，无关 Session 仍可读写。
- **Remote 装饰 fail-closed**：兼容层只对文档化的“不支持该选项”错误回退；现代 factory 的任意其他异常直接抛出，
  `resourceScopes` 保持未设置，缺 principal 的调用不会被降级到 owner fallback。
- **草稿 lifecycle 与内存边界**：草稿携带 Host 提供的 Session lifecycle 指纹；lifecycle 变化时清空暂存、
  编辑器和历史草案；已释放草稿按有界 LRU 回收，长时间浏览不会无界增长。
- **共享文本校验**：Host 归一化和客户端编辑器都使用 `inspectUserText()`（`\u0000` / 孤立 surrogate 在暂存阶段
  就被拒绝并给出本地化反馈），历史候选在 Apply 前使用同一校验。
- **pending 与 active 分离**：active UI 计数和 Overview 卡片只包含 `accepted + current`；pending proposal
  仍以独立行可见；重连时显示非阻塞提示，说明暂时只读并展示最近一次确认状态。
- **调试投影与 envelope**：`charter_read all` 返回 origin/order/createdRevision/替代链/验证来源，32 KiB
  上限按最终 tool envelope 测量（用 30 条大归档条目测试）；`overBudget` 也反映调低的 history/mutation 数量上限。
- **可访问性与提示卫生**：同一时刻只渲染一条超预算提示（阻塞中的暂存草稿 > 已保存超预算记录 > 可提交的超预算
  渲染），并只给一个处理建议；`status`/`alert` 只包裹消息文本，操作按钮不再嵌套在 live region 内；条目操作
  菜单使用普通 `<details>` disclosure + 普通按钮（不声明 menu-button ARIA 契约），purge 确认按钮自动聚焦、
  取消后焦点回到 summary，行内操作后焦点不会掉到 `<body>`；替代/验证原因改为可见文本而非 title 属性；
  历史草案 idle 阶段使用独立的“尚未加载草案”文案。
- **打包产物门禁**：本地 `npm run smoke:package` 打包 tarball 并校验必需文件、所有 `exports` 目标、无工作区泄漏、
  packed `core` import 和 packed client bundle；Host/Remote 运行时 import 需要 Host peer 依赖图，由工作区
  `remote-smoke` / `client-smoke` 覆盖，不在空 consumer 中执行。CI 运行同一门禁（`.github/workflows/ci.yml`）。

### 4.7 Checker 退出条件、草稿异步围栏与在线修复

- **Compaction checker（fixture）**：event→report 判定是 `scripts/verify/compaction-checks.mjs` 中的纯函数；
  `tests/verify/compaction-checks.spec.ts` 用普通事件数组断言 exit code、JSON verdict、文本 verdict 与 warnings。
  覆盖：严格按 seq 排序的 start→summary→end attempt 状态机（合法序列、失败 end、end-before-start、
  summary-before-start、同 id retry 相互独立）；现代 `charter_read` producing-call 认证——**存在**
  `sourceEventSeqs` 时（含 malformed 值、top-level/data 不一致）一律走现代分支、不回退 legacy，且必须恰好指向
  一个更早的 `charter_read` call，toolCallId/turn/step 必须**全部存在且精确相等**（缺失 identity 字段、
  不匹配、malformed 都显式拒绝，不做 wildcard）；字段缺失时才用 legacy 回退；严格 arguments
  （缺省/普通对象/`view:"standing"` 有效）；活动门禁（压缩后完全没有请求活动 → WAIT，且
  `verification.ok`/failures 不出现伪失败；只有已执行请求但无 runtime 快照 → FAIL）；成功证据之后的**所有**
  后续 attempt（任一 open → WAIT；任一失败但已 landing checkpoint → FAIL，即使后面还有更新的未 landing
  attempt；失败未 landing 保留先前 PASS；其后成功需要新的压缩后证据）；WAIT 内部一致（pending gate 时
  `verification.evaluated=false`、failures 为空、无 FAIL verdict line，只有已评估的 active evidence 可以
  FAIL）；checkpoint 按 attempt 的 seq 区间 + id 关联（同 id retry 不会继承旧 checkpoint），无 id 的 legacy
  checkpoint 才用 positional fallback；OPEN attempt 渲染不格式化缺失的 end time；charter commit 落在 start/end
  之间需要重新 compaction；transcript parser 校验每个 event envelope（普通对象、非空 type、非负安全整数 seq、
  有限 time、对象 data、seq 严格递增唯一），对中间损坏/非法 envelope 带行号拒绝（只有末尾 torn line 可容忍）。
  fixtures 断言 exit code/JSON verdict/文本/warnings；transcript reader 构造与 Host 相同的紧凑 standing 投影
  （`kind`/`text`/`verification`/`progress`），所有必需证据都参与退出码；只有 WAIT/BLOCKED 状态会在评估前
  短路。
- **草稿异步围栏**：edit 和 bootstrap Apply 捕获 `asyncGeneration`、source 实例及其单调 connection epoch、
  lifecycle 和请求 ops 身份；已销毁 source 或 detach/reattach 周期的迟到结果不能清除或覆盖新草稿。source 失效
  保留 mutation id 以便幂等重试，attach/detach/retry 都会使在途结果失效。
- **草稿回收**：最后一个 lease 释放后立即丢弃空草稿；已释放草稿有 idle TTL 和 LRU 上限，切换标签不会无界保留
  文本，同时活跃工作仍会保留。
- **在线修复**：运行期损坏记录就地修复后，下一次 view/初始化会重新解析，Session 无需重启 Host 即恢复可编辑；
  仍不合法的文档保持隔离且原始字节保留。

补充覆盖：

- **Session dispose**：`session/disposed` 现在会关闭所有打开的 watch 订阅（listener 收到 `null`），阻塞中的
  `charter watch` generator 会结束，而不是等待一个 listener 已被删除的队列；fixture 覆盖 dispose/close 路径。
- **Lifecycle replacement**：Host 帧去重会比较 `lifecycle`，Client 即使新 lifecycle 的 revision 从 0 重新开始或
  digest 重复也会接受；同 ID 新 lifecycle 能到达 Pane 并清理旧 draft。
- **保存锁**：Apply 在途时 Unstage 被拒绝（按钮禁用）；bootstrap 的目标、候选、checkbox、全选在保存期间全部
  禁用，setter 也会拒绝修改。
- **历史草案保留**：`isEmpty` 把已审阅的 bootstrap draft 视为 dirty，lease release 清理不再在 Chat/Charter
  切换时删除它。
- **分步缩短**：已超预算的 objective/item 即使仍超限也允许继续缩短；测试分两步缩短 objective 与 item，最终
  离开 `overBudget`。
- **`all` 中的超大 objective**：如果 objective 本身无法放入 32 KiB debug envelope，`all` 返回
  `objective: null` + `objectiveTruncated: true`，不再突破响应上限；standing 仍携带完整 objective。
- **Bootstrap 元数据**：`shadowedTokenCount` 在 Host 侧也校验为非负整数，负值会在进入严格 Remote codec 前被跳过。
- **消费者安装**：`smoke:package` 现在在空项目中做真实安装（只依赖 tarball 与声明依赖），检查公开文件 mode，
  并加载 packed `core` 入口（root/Remote 运行时 import 由工作区 build smoke 覆盖）；不再软链工作区
  `node_modules`。
- **Watch/stream generation 竞态**：unsubscribe 只有在仍持有捕获的 listener Set 时才删除 Map 条目（已 dispose
  的 generation 不能误删同 ID 新 watch）；同 live stream 的重复 attach 是 no-op，旧 stream 的 `replace`/`update`
  帧按 attach generation 丢弃。
- **待生效 attach 的取消**：上一个 stream 仍在 dispose 时调用 `attach(B)`，随后在新 attach 取得 remote 之前
  调用 `detach(B)`：待生效 generation 被取消，dispose 迟到完成也不会再创建 `B` stream，source 保持 detached
  （测试见 `tests/client/store.spec.ts`）。
- **Prompt 预算的 Apply 门禁**：Pane 的 Apply 与 Host 的 `overLimitGrowth` 规则完全一致：只有修改让渲染后的
  prompt 变大时才禁用；仍超限但缩小或保持同字节时可以提交；单测覆盖缩短、同字节、增长和预算内四种渲染。
- **保存锁与导出围栏**：Apply/bootstrap 保存期间 Rebase 被禁用并拒绝；bootstrap 抽取按 source 实例 +
  connection generation 围栏；脏 draft 不会被 idle TTL/LRU 删除；编辑器允许 objective/同 ID item 已超预算时的
  分步缩短。
- **配置帧送达**：重连时首次出现的 lifecycle fingerprint 即使 revision 更低也接受；Client 去重比较
  `overBudget` 与全部 limits，预算收紧后的快照能到达 Pane。

## 5. 浏览器 bundle 验证

DSH 的 Web module loader 要求 plugin bundle 是：

- 单文件；
- 以 `window.__ModuleLoader__.load({ id, factory })` 注册；
- factory 内通过 `require()` 解析 baseline（React）和 `dsh.client.external` 声明的动态模块；
- 不能有相对 chunk 或独立 CSS import。

构建后检查：

```bash
head -3 lib/client.js
grep -n "^import\|require(\"" lib/client.js | head
ls lib/*.css
```

结果：

- `lib/client.js` 以 `window.__ModuleLoader__.load({ id: 'dsh-charter', factory: (require) => {` 开头；
- 只 `require` `react`、`react/jsx-runtime` 和 `@deepseek-ai/dsh-api-gateway/client`；
- zod 被打包进 client，不产生 `require("zod")`；
- 无相对路径 require；
- `lib/client.css` 已内联并删除；
- CSS 在 factory 内注入，带 `data-plugin-css="dsh-charter/charter.css"` 标记，重复 materialize 不重复插入。

`scripts/verify/client-smoke.mjs` 进一步用 fake module loader 和 fake client context 执行：

- `registration.id === 'dsh-charter'`；
- factory 只请求白名单模块；
- 导出 `apply` 和 `inject`；
- `apply` 只注册一个 `conversation.view` 的 `charter` entry、正文组件和 Remote contribution；
- 已有 tab 顺序为 chat 0 / trajectory 10 / context 20 时，`charter` 以稳定 order 1000 只注册一次并排在最后；
- 模拟后续注册的 `fleet` tab 和更高 order 的 `future-plugin` tab 后，`charter` 既不被复制也不重排，且
  bundle 不查询、不订阅 slot roster；
- 中文标签为「会话契约」，英文标签为「Charter」。

## 6. 真实 profile smoke

### 6.1 创建隔离 profile

```bash
mkdir -p .tmp/smoke/home
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --from-default-profile web --dump-config > /dev/null
```

生成的 `profiles/smoke/package.json` 包含 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` 两个 bundle。

### 6.2 安装 tarball

```bash
npm pack --pack-destination .tmp/smoke
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh plugin --profile smoke add "$PWD/.tmp/smoke/dsh-charter-0.1.0-rc.1.tgz"
```

结果：安装成功，profile 的 `bundles` 追加 `dsh-charter`。DSH 的兼容检查接受 peer range。

### 6.3 组合检查

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --dump-config | grep -A 20 'id: charter'
```

输出包含：

```yaml
- id: charter
  name: dsh-charter
  config: { ... }
- id: charter-remote
  name: dsh-charter/remote
```

### 6.4 启动与 HTTP

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --no-open --port 19388
```

日志打印带 token 的 URL。带 token 访问后：

- `/` 返回 200；
- `__DSH_BOOT__` 的 entries 包含：

```json
{
  "id": "dsh-charter",
  "url": "plugins/??dsh-charter/client.js&rev=...",
  "inject": [
    "@deepseek-ai/dsh-api-gateway",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-session",
    "@deepseek-ai/dsh-client-ui-slots"
  ],
  "external": ["@deepseek-ai/dsh-api-gateway/client"]
}
```

- 请求 `plugins/??dsh-charter/client.js&rev=...` 返回 200，内容以 `window.__ModuleLoader__.load` 开头。

这证明 Host 侧组合、客户端 bundle 发布、boot graph 和外部依赖声明都正确。

### 6.5 两次启动与卸载恢复

同一 profile 连续启动两次，boot graph 中 `dsh-charter` 的 `rev` 在两次启动间保持不变，两次 `/` 均
返回 200，`/plugins/??dsh-charter/client.js&rev=...` 均返回 200 且以 `window.__ModuleLoader__.load` 开头。

随后执行：

```bash
dsh plugin --profile smoke remove dsh-charter
```

profile 的 `bundles` 恢复为 `dsh-base` + `dsh-web-app`；重新启动 `dsh web` 仍返回 200，boot graph 中
`"id":"dsh-charter"` 出现 0 次。卸载不会破坏 profile 启动。

最后从 `dist/dsh-charter-0.1.0-rc.1.tgz` 重新安装并启动一次，`/` 返回 200，boot graph 仍包含
`dsh-charter` 的 `inject`/`external`，客户端入口返回 200 且包含内联 CSS 标记
`data-plugin-css="dsh-charter/charter.css"`。


### 6.6 DSH 0.1.7-rc.2 profile

为了验证最低版本，另外安装对应 CLI：

```bash
mkdir -p .tmp/dsh017
cd .tmp/dsh017
pnpm add --store-dir ../pnpm-store --config.dangerously-allow-all-builds=true @deepseek-ai/dsh@0.1.7-rc.2
./node_modules/.bin/dsh --version   # 0.1.7-rc.2
```

创建隔离 profile 并安装 `dist/dsh-charter-0.1.0-rc.1.tgz`：

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --from-default-profile web --dump-config > /dev/null
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  plugin --profile smoke017b add "$PWD/dist/dsh-charter-0.1.0-rc.1.tgz"
```

第一次使用旧 tarball 时，DSH 明确拒绝安装，并列出只覆盖 0.2.x 的 peer range；把 0.1.7-rc.2 加入
`peerDependencies` 并重新打包后，新 profile 安装成功。这说明 DSH 的兼容检查确实在安装前执行。

启动：

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --no-open --port 19389
```

结果：`/` 返回 200；boot graph 包含 `dsh-charter` 的 `inject` 和
`external:["@deepseek-ai/dsh-api-gateway/client"]`；`/plugins/??dsh-charter/client.js&rev=...` 返回 200，
内容以 `window.__ModuleLoader__.load` 开头。0.1.7 上 remote smoke 打印无资源授权警告，符合预期。

加入 `conversation.view` 标签页后，又用新 profile `smoke017c` 安装最终 tarball 复核：boot graph 的
`inject` 包含 `@deepseek-ai/dsh-client-locale` 和 `@deepseek-ai/dsh-client-ui-conversation`，客户端 bundle
以稳定 order 1000 只注册一次（没有 `ensureLast` 循环），`/` 与客户端入口均返回 200。

## 7. 浏览器 UI 验证（0.2.0-rc.2 Web profile）

在用户批准的沙箱外权限下，用本机 Chrome 以 headless + CDP 实际打开隔离的 Web profile：

```bash
# Chrome 以桌面尺寸启动，CDP 端口 9223
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --disable-crash-reporter \
  --window-size=1440,900 --remote-debugging-port=9223 \
  --user-data-dir="$PWD/.tmp/webview/chrome-desktop" about:blank

# Web profile 运行在 19391，扫描 workspace 后打开已存在的测试 Session
DSH_HOME="$PWD/.tmp/webview/home" dsh --profile charterweb2 --no-open --port 19391
```

通过 CDP 执行真实鼠标/键盘/导航操作，结果如下。

### 7.1 标签位置与名称

会话头部 tab bar 实际文本顺序：

```text
对话    轨迹    会话契约
```

- 「会话契约」位于「对话」「轨迹」之后；
- 再安装 `dsh-context@0.73.3` 后，实际顺序变为 `对话 / 轨迹 / 上下文 / 编队 / 会话契约`，会话契约仍然最后；
- 中文标签为「会话契约」，英文标签为「Charter」，由 `dsh-client-locale` 字典提供；
- 另用 `client-smoke` 注册一个后置 tab 和一个更高 order 的 tab：单次注册的会话契约保持稳定 order，不产生
  重复 entry，也不查询/订阅 slot roster；
- 空白 Session 不显示 View tab bar；发送第一条消息后出现。

真实截图：[中文面板](assets/charter-pane.png)、[English pane](assets/charter-pane.en.png)。

### 7.2 目标编辑、预览与 Apply

> 7.2/7.3 的 191 B / 220 B 是重设计前的功能验证数据；7.6 的截图来自后来使用 47 B 目标、240 B context 的数据。

在「会话契约」标签页中：

1. 点击 **Set objective**，输入 `Ship the charter tab safely`，点击 **Stage**；
2. 面板显示 `1 staged change`；
3. 点击 **Preview context**：显示 `191 bytes`，正文为
   `{"objective":"Ship the charter tab safely","invariants":[],"deliverables":[]}`；
4. 点击 **Apply**：revision 从 `0` 变为 `1`，目标显示在当前目标区，提示 `Saved revision 1.`；
5. 顶部统计从 `0 B context` 变为 `191 B context`。

### 7.3 新增约束与刷新持久化

1. 在 **Invariants** 下方输入 `Do not break the public API`，点击 **Stage item**；
2. 点击 **Apply**：revision 变为 `2`，显示 `1 active / 1 stored`、`220 B context`；
3. 刷新整个页面并重新打开同一 Session：仍显示 `rev 2`、目标 `Ship the charter tab safely` 和
   约束 `Do not break the public API`；
4. 标签顺序仍为「对话」「轨迹」「会话契约」。

这说明浏览器 UI → Remote → Host service → storage domain → 重新 assembly/UI 的整条链路可用。

### 7.4 中英文切换

在同一 Web profile 中把 DSH 语言从中文切到 English（Settings → Language → English），不做页面刷新：

- 标签从「会话契约」变为 `Charter`；
- 面板标签从「概览 / 目标 / 硬约束 / 预览上下文 / 应用」切换为
  `Overview / Objective / Invariants / Preview context / Apply`（重设计后的面板，见 7.5）；
- 统计、状态、按钮、占位符、错误码说明全部来自同一 `dsh-charter` locale namespace；
- 刷新页面后语言偏好仍为 English，标签和面板保持英文。

中文截图见 [charter-pane.png](assets/charter-pane.png)，英文截图见
[charter-pane.en.png](assets/charter-pane.en.png)。用户输入的目标和约束正文不翻译，这是数据，不是 UI 文案。

### 7.5 重设计 UI 与预算验证

本节截图已用最终 `0.1.0-rc.1` 构建（2026-10-22）在一个隔离的纯 demo profile 上重新生成（侧栏只有一个合成的
`Create a UI test session` session，不含任何真实 workspace 或 Session 标题）：面板包含声明性上下文提示、始终可用的
**历史草案** section、
**上下文** 中的 record 上限、投影后的草稿行，以及逐行操作菜单。

重设计后的面板在同一个 Web profile、1440×757 下验证了明暗主题和中英文：

- 带品牌 mark 的页头（`会话契约`、slogan）包含修订/生效/存储 chip 和实时 `240 B / 8.0 KiB 上下文` 预算条；
- 吸顶的预览/丢弃/应用工具栏在内容滚动时保持可见；
- 左侧 section 导航：概览 / 目标 / 硬约束 / 交付物 / 历史草案 / 上下文（历史草案始终存在；只有 bootstrap 阶段为
  `draft` 时才包含可应用草案）；
- 概览 dashboard 包含目标、约束/交付物卡片和预算明细，大块历史草案不再挤压工作模块；
- 独立的目标/条目 tab，section 内联添加输入和 `0 B / 1.0 KiB` 计数；
- hover/focus 出现的条目操作（编辑/替换/归档/标记验证）；
- 会话契约激活时隐藏对话框；切回对话后未发送草稿仍然保留；
- 明暗主题完全由 DSH 语义 token 驱动。

截图：[中文浅色](assets/charter-pane.png)、[英文浅色](assets/charter-pane.en.png)、
[暗色](assets/charter-pane.dark.png)、[窄屏](assets/charter-pane.narrow.png)。

解析器拆分/目标保持完整的自动化测试在 `tests/core/bootstrap.spec.ts`；客户端会标记超限字段、用同一
prompt renderer 计算草案预览，并且只在渲染后的 prompt 会变大且仍超预算时禁用 Apply；仍超预算但缩小或保持同
字节的渲染会被允许。字段编辑器同样允许已超限的 objective/同 ID item 在严格变短时提交。本轮没有在浏览器里
实际录入超限文本走一遍禁用态。

### 7.6 说明

- 测试使用了一个格式合法但没有真实额度的 API Key，所以 Chat 里显示模型请求失败；这是模型调用问题，
  不影响会话契约标签页的目标/约束编辑和 Apply。
- 尚未在浏览器中自动验证：两标签页并发冲突、两个 Session 隔离、0.1.7/0.2.1 的逐版交互。这些逻辑由
  Host/Remote 测试覆盖，仍建议在目标 profile 手工走一遍。

## 8. 真实 compaction 端到端

状态：**2026-10-22 已在真实 DSH Session 上记录 PASS**（一个匿名评估会话）：`/compact` 压缩 326 条消息
（约 228k tokens），下一次请求携带字节一致且 digest 匹配的 `charter:standing` 快照。`npm run check` 不调用模型，因此不会执行这项检查；证据见 8.4。

### 8.1 已经证明的部分

- DSH 会把每个装配后的 runtime context 持久化为 `user/message` 事件（`source.kind === "runtime-context"`，
  带 `sections` 数组）。在一个真实 Web profile Session（一个匿名评估会话，revision 6，245 B 会话契约）
  中，有 7 个快照包含 `charter:standing` section，其字节与 storage 记录的 `promptText` 完全一致，SHA-256
  也等于 `promptDigest`。这验证了真实 DSH 运行时上的 user-role 注入链路（包含 UI 驱动的编辑）。
- composition 测试证明 provider 每次请求都从 storage 正本重新装配；平台的 `RuntimeContextProjection` 在
  replacement/compaction 遮蔽 retained snapshot 后会清空并在下一次请求重新生成。

### 8.2 手工验收命令

`npm run verify:compaction` 是 transcript evidence checker，不是自动化端到端测试：runtime context 断言是精确的
字节/digest 相等，system-prompt 泄漏检查则是信号式启发（前缀、渲染正文、目标、较长的条目文本）。它不在
`npm run check` 中，不进入 npm 包（`scripts/` 不在 `files` 白名单内），读取本地 DSH transcript，并且需要
`zstd` 可执行文件。它支持 JSON storage backend 布局
`$DSH_HOME/storages/<domain>/sessions/<sessionId>.json`；其他布局用 `--store <file>` 指定。

```bash
npm run verify:compaction                          # 当前 Session：DSH_SESSION_ID + DSH_HOME
npm run verify:compaction -- --session <id> --json # 其他 Session / 机器可读
```

命令读取 Session transcript 和会话契约 storage 记录，并要求全部满足：

1. 当前 revision 的提交时间早于最近一次 `compaction/end`（压缩后才创建的契约不能证明“存活”）；
2. 最新 runtime-context 快照位于该 compaction 之后；
3. 该快照包含 `charter:standing`，文本与 `promptText` 字节一致，SHA-256 等于 `promptDigest`；
4. 没有任何 system-prompt 快照包含会话契约前缀、正文、目标或较长的条目文本；
5. **必需**：transcript 中**位于最近一次成功 compaction 之后**的 `charter_read` standing 结果等于 Host 的紧凑
   standing 投影（`kind`/`text`/`verification`/`progress`），而不只是 revision/objective。产生该结果的
   **tool call 本身必须被认证**：存在 top-level `sourceEventSeqs` 时，其引用的 seq 必须是早于 result 的有限整数，
   并且恰好指向**一个**产生该结果的 `charter_read` call（不能引用其他 tool call、不能有歧义），message
   `toolCallId`、turn、step 必须与该 call 一致；legacy transcript 没有该字段时才按 turn/step/callId + 事件顺序
   回退。call seq 必须晚于最近一次成功 compaction **和**最近一次压缩后 runtime-context 快照，arguments 必须
   缺省/普通对象/`view:"standing"`（malformed 形状与显式 `all` 都被拒绝），result 必须非 error 且晚于 call。
   结果缺失、call 未认证/有歧义/不匹配、压缩前读取、`all` 读取、error 结果都会让 PASS 失败；旧版 debug 形状的
   tool result（额外 id/review/lifecycle 字段）会先归一到同一投影，因此未重启的 Host 仍可给出可比的
   working-set 证据；
6. compaction 证据要求同一个 `compactionId` 具备严格按 seq 排序的 attempt 生命周期：start 打开 attempt、summary
   只能附到当前 attempt、end 只能关闭当前 attempt；成功必须满足 start.seq < summary.seq < end.seq、同一
   compactionId 且 end 无 error。之后失败的 end 不作为证据，同一 id 的 retry 是独立 attempt；end-before-start 或
   start 之前的 summary 永远不会 PASS。charter 必须在 compaction **start** 之前提交（落在 start/end 之间的提交
   不能证明存活，需要重新 compaction）；压缩后已有请求执行但没有新的 runtime-context 快照是 **FAIL**，只有
   完全没有压缩后请求活动才是 `WAIT`（exit 3）；
7. 与该 `compactionId` 关联的 checkpoint 没有夹带渲染正文（这是 warning：它会削弱证明，而不是静默通过）；
   明确属于其他 compaction id 的 checkpoint 绝不被关联，positional fallback 只适用于没有 id 的 legacy checkpoint；
8. transcript parser 遇到中间损坏会带行号拒绝，而不是跳过该行（只有 incomplete append 的末尾 torn line 可容忍），
   所以被评估的证据不会静默丢失 transcript 行。

真实 profile 中的操作步骤：

1. 在目标 Session 打开「会话契约」标签页，审阅历史草案并点击 Apply（或手动设置目标），然后发送一条消息，
   让 runtime context 落进 transcript；
2. 运行 `npm run verify:compaction`：预期 `charter established`、注入、digest、system-prompt 检查通过，
   compaction 步骤为 `WAIT`；
3. 在同一 Session 执行 `/compact`，发送一条消息，然后让模型调用一次 `charter_read`（默认/standing view、
   非 error），留下经认证的压缩后 standing 结果；
4. 再次运行命令：预期 `PASS`，并输出 compaction seq、压缩后快照 seq、压缩后 `charter_read` seq 和 digest。

检查器只会 fail closed 为 `BLOCKED`（还没有契约）或 `WAIT`（压缩后还没有新请求）；一旦存在压缩后请求，
`survivesCompaction`、system prompt 洁净、以及经认证且匹配的压缩后 `charter_read` standing 结果都会参与退出
码，缺失、未认证或不匹配的 read 都是 FAIL。摘要泄漏记录为 warning 而不是静默通过。`tests/verify/compaction-checks.spec.ts` 用 fixture 覆盖这些通过/失败
组合，不依赖真实模型。它绝不把 checkpoint 摘要当作“存活”证据。

### 8.3 平台依据

`@deepseek-ai/dsh-agent-loop@0.2.1-rc.2` 的 `RuntimeContextProjection` 在 retained snapshot 被
replacement/compaction 遮蔽后清空 retained，下一次请求重新生成；本插件的 context provider 调用
`charter.promptText(session)`，同步读取 storage 正本并校验派生 digest。

### 8.4 真实模型实测记录（2026-10-22）

目标：一个匿名评估会话。先审阅并应用其上一轮
压缩摘要生成的历史草案，成为 **revision 1**（13 条 active 条目，5,081 B，`promptDigest sha256:4dd9e615…`）。
随后 `/compact` 以 compaction seq **31801**（source `cmd-635e3d77-2`）完成，压缩 326 条消息（约 228,181
tokens）。压缩后第一次请求产生 runtime-context 快照 seq **31810**，包含
`sections [sandbox:policy, approval:policy, charter:standing]`，5,081 B 会话契约的字节/digest 与 storage 一致；
随后 `charter_read`（call seq **31824**，经 top-level `sourceEventSeqs` 认证；位于 compaction seq 31801 与
runtime 快照 seq 31810 之后；`view: standing`；非 error）以 result seq **31825** 返回相同
revision/objective/working set。完整 checker 输出：

```text
$ npm run verify:compaction -- --session "$SESSION_ID" \
    --home "$DSH_HOME" \
    --store "$DSH_HOME/storages/dsh_charter_v1/sessions/$SESSION_ID.json"
  PASS  charter established
  PASS  latest runtime context carries charter:standing
  PASS  injected text matches storage authority and promptDigest
  PASS  system prompt carries no charter body
  PASS  authenticated post-compaction charter_read standing view matches the storage revision/objective
  PASS  charter survives compaction — snapshot seq 31810 > compaction end seq 31801
  PASS  compaction summary does not carry the charter text
result: PASS
```

注：运行中的 Desktop 进程加载的是重启前的 Host bundle，所以它的 `charter_read` 结果仍带 legacy debug 字段；
checker 已将这些字段归一到当前紧凑投影。要让 UI/tool ABI 与磁盘上的当前包完全一致，仍需完全重启 Desktop app。

当前树复检：更严格的 checker（要求 `charter_read` 的 call 经认证、且晚于最近一次 compaction 与 runtime-context
快照并匹配 storage）已针对这份已记录的 transcript 重跑，仍然返回 `PASS`；唯一 call 为 seq **31824**、result
seq **31825**，位于 compaction seq 31801 与 runtime 快照 seq 31810 之后。

本轮预发布的证据时间线：

- 真实模型实测：2026-10-22，运行于 Desktop/Web runtime DSH `0.2.0-rc.2`（`dsh` CLI `0.2.0-rc.2`）。这次
  运行发生在上述完整重启 Desktop **之前**；当时仍在运行的进程加载的是重启前的 Host bundle，因此
  `charter_read` 结果带有 legacy debug 字段。
- compiled-bundle build commit：`0d9af924bdddeaa88b6c2400978866afdbc93e5d`——通过门禁的源码树，Host ESM 与浏览器 bundle 由它构建。
  该树的门禁：`npm run check`（typecheck + build + 19 个测试文件 / 260 个测试）、`npm run smoke:package`、本地
  五版本矩阵（每个版本 19 个文件 / 260 个测试）；另外用 compaction checker 对已记录的真实 transcript 复跑
  （PASS）。
- archive/evidence-tree commit：build commit 的直接子 commit，只添加本证据记录并刷新 tracked digest。打包的
  `dsh-charter-0.1.0-rc.1.tgz` 同时包含 build commit 构建的 bundle **和**证据树中 package 可见的文档，因此不能
  把整个 archive 归因于 build commit；同一套门禁在证据树上再次运行。本地 `v0.1.0-rc.1-build` 标记的 annotation
  记录该证据 commit 与 archive digest。
- 随发布产物的 digest：仓库根部 tracked 的 `SHA256SUMS`（由最终证据树 commit 刷新，该 commit 只更新此文件和本
  记录）固定从证据树构建的 `.tgz` digest；`dist/SHA256SUMS` 携带相同值。**本次本地构建不创建发布 tag**：
  临时的本地 tag 已删除，最终的 annotated `v0.1.0-rc.1` 只在发布时、基于已完成元数据/文档/CI 门禁的 commit
  创建（见 docs/releasing.zh.md）。
- 剩余手工检查：重启 Desktop 后重新打开会话契约 tab 一次，确认当前 bundle/tool ABI——这次重启后复核**不在**
  上述实测记录中，且只在发布稳定 `latest` 前必需，不影响以 `next` 发布本预发布。

### 8.5 `0.1.0-rc.2` 候选证据（2026-10-24）

- compiled-bundle build commit：`993623de57b413bf313313bd81e4de952ef70daf`；产物 digest 记录在 tracked 仓库根部
  `SHA256SUMS`（npm `files` 白名单之外）与 `dist/SHA256SUMS`。
- `npm test`：20 个测试文件 / 263 个测试通过；`npm run check` 通过；普通 `npm run smoke:package` 通过。
- `zod` 精确为 `4.6.7`（直接依赖；dev 树通过 `overrides` 去重为单一 zod，使 typecheck/audit 干净）；
  `npm audit --omit=dev` 为 0 漏洞，去重后的完整 `npm audit` 也为 0。
- 最终产物：`dist/dsh-charter-0.1.0-rc.2.tgz`；其 SHA-256 记录在 tracked 仓库根部 `SHA256SUMS` 与
  `dist/SHA256SUMS`（根部文件位于 npm `files` 白名单之外，因此 digest 不会改变打包字节）。exact-artifact smoke
  （`--artifact ... --sha256 SHA256SUMS`）在不重建的前提下对这些字节通过；升级后的构建通过五版本 DSH 矩阵；
  已记录的真实模型 compaction transcript 复跑 PASS。
- 本次准备阶段不创建 tag、不发布；release tag 与 npm 渠道移动只在门禁通过后的发布执行中发生。

## 9. 未支持的验证项与已接受的非阻塞限制

- 多进程共享 storage 的实时同步：`domain/changed` 只在单进程内可见，本插件按单 Host 进程部署设计。
- 真实模型是否遵守会话契约：会话契约是声明，不承诺模型行为。
- 永久审计：history/mutation 回执有界，不构成审计。
- 配额真实样本校准：默认值是产品初值。

已接受的非阻塞限制（本轮 RC 评审后刻意不再修复，均不声称已关闭）：

- **legacy transcript 严格性缺口**：没有 `sourceEventSeqs` 的旧 transcript 回退到 turn/step/callId + 事件顺序，
  对抗性地复用身份的旧 transcript 无法像现代路径一样完整认证。
- **compaction 序列边界**：容忍 seq gap；不同 id 的重叠 compaction start 不建模为同一条链；无 id checkpoint
  的 positional fallback 本质上是 best-effort 归因。
- **WAIT 诊断措辞**：WAIT verdict 的 detail 是面向人的提示，不是机器协议；组合 gate 时措辞可能较粗。
- **artifact smoke 固化残余**：结构化 tar reader 校验 header/path/type/checksum 与 packed manifest，但不额外
  canonicalize 列表之外的异形路径编码、不检查 `.env` 类运行时文件，manifest 比较是所选字段的 JSON 深度相等
  而非完整 semver 审计。
- **外层 JSON 平台风险**：不可读/损坏的外层 JSON 记录（或外层 version 被拒绝）会被 JSON storage backend 当作
  不存在；插件无法与缺失记录区分，之后初始化可能覆盖它（运营恢复：停止 Host 并从备份恢复）。内部 schema/
  一致性不合法记录仍被隔离并保留。
- **mutation receipt 保留窗口**：幂等 replay 依赖有界的 recent-mutation 回执窗口；超出窗口被淘汰后无法按 id
  识别，会被当作新请求。
- **文档计数漂移**：verification/locale 文本计数是手工同步的；未来新增测试而未更新叙述会留下小幅漂移（测试
  套件本身是事实来源）。

## 10. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 git，也不进入 npm 包。
