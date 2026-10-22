# `dsh-charter` 验证记录

[English](verification.md) | 中文

验证日期：2026-10-20；第二、三轮发布就绪评审后复跑：2026-10-21。
环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`；当前 Desktop 运行时 DSH `0.2.0-rc.2`。
本地开发依赖基线：DSH `0.2.1-rc.2`。

本文记录可复现的命令和结果。临时目录、profile、tarball 和抓取到的 HTML 都在 `.tmp/` 下，不进入发布包。

## 1. 结论

| 验证项 | 结果 |
| --- | --- |
| TypeScript 严格类型检查（5 个 DSH 版本） | 通过 |
| Vitest（5 个本地可用版本 × 144 tests） | 通过 |
| Host ESM 构建 + 浏览器单文件 bundle | 通过 |
| Remote 装饰器/资源 smoke | 通过（0.1.7/0.2.0 按预期无资源声明） |
| 浏览器 factory bundle 物化与 `apply` smoke | 通过 |
| 真实 DSH profile 安装、组合、启动（0.1.7-rc.2 / 0.2.0-rc.2） | 通过 |
| Web boot graph 与 `/plugins` 服务 | 通过 |
| 真实浏览器 UI 交互（0.2.0-rc.2 Web profile） | 通过：标签顺序、中英文切换、目标/约束编辑、预览、Apply、刷新持久化；见第 7 节 |
| 非 live Session 的只读 stored view | 通过：composition 测试覆盖 stored view 与 live 后自动升级 |
| 从压缩摘要生成历史草案 | 通过：core 解析器（含真实 bullet-only 摘要格式）+ composition 真实 Session 事件；见 4.4 |
| 单记录损坏隔离 | 通过：单条 schema 不合法记录只禁用其 Session 并保留原文；见 4.5 |
| 预算收紧与收敛 | 通过：调低预算后显示 `overBudget`、停止注入、缩小编辑可收敛；不可用配置被 clamp；见 4.5 |
| Session 级客户端草稿 | 通过：单测覆盖 binding 卸载/重挂载后草稿存活、重试复用 mutation id、冲突 rebase、bootstrap 不抢占 section；见 4.5 |
| 运行期 schema 重新校验 | 通过：mount 后把记录改成非法 schema，只有该 Session 不可用且原始记录保留；见 4.6 |
| 打包产物可安装性 | 通过：CI 运行 `smoke:package`（tarball 内容、exports、packed Host import、client bundle）；见第 2 节 |
| Compaction checker 退出条件 | 通过：fixture 覆盖成功、system prompt 污染、charter_read 不匹配、快照丢失、摘要泄漏 warning；见 4.7 |
| 陈旧异步草稿结果 | 通过：edit/bootstrap 结果按 source/generation/请求身份围栏；空草稿和 idle 草稿会回收；见 4.7 |
| 真实模型 + compaction 端到端 | **2026-10-22 实测 PASS**（`session-45c509c6…`）：326 条历史消息 / 约 228k tokens 被压缩，revision 1 会话契约存活，压缩后快照与 `charter_read` 均验证（见 8.4） |

## 2. 本地基线

```bash
npm run typecheck
npm test
```

结果：

- typecheck 通过；
- build 通过；
- 17 个测试文件、144 个测试全部通过；
- `remote-smoke` 断言 `watch,bootstrap,edit`、stream mode 和 Session resource；
- `client-smoke` 断言单文件 factory bundle、外部依赖白名单、不引用 Node-only `Buffer`、`apply` 注册
  tab/pane/Remote contribution。
- `smoke:package` 构建并打包 tarball、校验必需文件和文件 mode 以及所有 `exports` 目标、拒绝泄漏的工作区文件，
  把 tarball 安装到一个**空 consumer 项目**（只使用其声明依赖），再加载 packed `dsh-charter/core` 入口与
  client bundle。

CI 在每次 push/PR 上运行 `npm run check` 和 `npm run smoke:package`，绿色构建现在同时代表可安装产物已验证。

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
| `tests/host/composition.spec.ts` | 真实 Cordis/Storage/SystemPrompt/Tools 组合、user-role 边界、actor 策略、`item.add` + `item.propose` 混合原子 Apply、user actor 的 proposal、完整 standing 与有上限 `all`、单条损坏记录隔离、调低预算后的 over-budget 收敛、不可用配置 clamp、child retry 发布 ready 帧、fork、幂等、配额、父环拒绝、lifecycle、非 live Session 的只读 stored view 与 live 升级、从真实 `compaction/summary` 事件生成草案 |
| `tests/host/watch.spec.ts` | opening snapshot、竞态、去重、abort、装饰器兼容、resource-scope 能力检测 |
| `tests/host/actor.spec.ts` | principal 感知策略：现代运行时缺失 principal 拒绝、仅旧版 owner 回退、非 owner 记录、按版本选择的 `resolveRemoteActor` |
| `tests/host/remote.spec.ts` | Remote 描述符、wire schema、旧 Host view snapshot、零 pending 上限 |
| `tests/client/store.spec.ts` | 提交后立即接受 view、忽略陈旧/重复 revision、opening snapshot 单调、权威不可用降级、attach 重试、共享 source lease/引用计数、旧 lease no-op、忽略其他 Session 的 stream 帧 |
| `tests/client/bootstrap-plan.spec.ts` | 溢出候选仍在一个 plan 中；单遍规划与逐候选结果（近乎全部 active 时最坏 O(n²)，已披露）；active 前缀符合字节预算；bootstrap 结果分类（draft/discard/stale/unavailable） |
| `tests/client/draft.spec.ts` / `draft-store.spec.ts` | Session 绑定的请求构造（A 的 ops 不会为 B 构造请求）；binding 卸载/重挂载后草稿存活；重试复用 mutation id；冲突 rebase；陈旧异步结果不能覆盖新的 draft/source/lifecycle；bootstrap 不抢占 section |
| `tests/client/preview.spec.ts` | 投影后的 draft 行（add/edit/accept/progress/supersede/purge）；渲染器一致性与 pending 排除 |
| `tests/verify/compaction-checks.spec.ts` | compaction checker fixture：system prompt 污染、charter_read 调用但不匹配、压缩后快照丢失、摘要泄漏 warning、紧凑 standing 投影一致 |

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
| `0.1.7-rc.2` | 通过 | 通过 | 144/144 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.1` | 通过 | 通过 | 144/144 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.2` | 通过 | 通过 | 144/144 | 通过（无 resources 警告） | 通过 |
| `0.2.1-rc.1` | 通过 | 通过 | 144/144 | 通过 | 通过 |
| `0.2.1-rc.2` | 通过 | 通过 | 144/144 | 通过 | 通过 |

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
- **尚未**在真实模型会话中执行一次完整 compaction 并观察后续请求。

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

UI 的自动草案面板依赖客户端 `useEffect` 和 Remote bootstrap；本轮未在真实浏览器中构造“已完成压缩且为 live”的
Session 做截图验证，客户端代码通过 typecheck/build，Remote 通过契约测试。真实压缩会话的 UI 行为仍需在目标
profile 手工确认。

### 4.5 记录隔离、预算降级与客户端草稿所有权

第三轮发布就绪评审补充了此前只有静态审查的降级路径平台级回归：

- **损坏记录隔离**：直接在 `storages/dsh_charter_v1/sessions/<id>.json` 写入带未知字段的记录后重新挂载，
  仅该 Session 变为 `unavailable` 且原始文件保持不变；无关 Session 仍能读取、注入和编辑。
- **预算调低**：默认 8 KiB 预算下创建的契约，以 `maxPromptBytes: 300` 重新挂载；view 为 `ready` +
  `overBudget`，`promptText()` 返回空（不注入），增加内容返回 `QUOTA_EXCEEDED`，归档条目因 prompt 缩小而被
  允许，最终离开 `overBudget`。
- **不可用配置**：`maxPromptBytes`、`maxRecordBytes`、`maxHistoryBytes` 设为 `1` 时被抬到文档化最小值并
  记录 Host warning，避免出现 ready 但永久不可编辑的 Session。
- **初始化重试**：parent record 尚未持久化时先创建的 child Session 先显示 `unavailable`；parent 出现后，
  瞬时失败在 `put` 发布前清除，随后发布 ready 帧（修复了此前只发布 stale unavailable 帧的问题）。
- **客户端所有权**：单测覆盖 draft 在卸载/重挂载后存活、未知结果重试复用 mutation id、冲突 rebase 使用新 id、
  bootstrap 在编辑器打开时不抢占 section、投影条目在 Apply 前即显示暂存状态。
- **规划规模**：单遍 bootstrap planner 用 2,000 个候选测试，并返回逐候选 active/pending 结果；最终用精确渲染
  校验预算。

### 4.6 运行期完整性、权限 fail-closed 与客户端状态边界

第四轮发布就绪评审针对启动后或运行时损坏才出现的失败路径补充了回归：

- **运行期 schema 重新校验**：service 正常 mount 后，测试直接向 table 写入 `recordSchemaVersion: 2` 的记录。
  `recordFor()` 和 edit transform 每次重新解析存储文档；只有该 Session 变为 `unavailable`，prompt 为空，
  edit 返回 `UNAVAILABLE`，无关 Session 仍可读写。
- **Remote 装饰 fail-closed**：兼容层只对文档化的“不支持该选项”错误回退；现代 factory 的任意其他异常直接抛出，
  `resourceScopes` 保持未设置，缺 principal 的调用不会被降级到 owner fallback。
- **草稿 lifecycle 与内存边界**：草稿携带 Host 提供的 Session lifecycle 指纹；lifecycle 变化时清空暂存、
  编辑器和历史草案；已释放草稿按有界 LRU 回收，长时间浏览不会无界增长。
- **共享文本校验**：Host 归一化和客户端编辑器都使用 `inspectUserText()`（` ` / 孤立 surrogate 在暂存阶段
  就被拒绝并给出本地化反馈），历史候选在 Apply 前使用同一校验。
- **pending 与 active 分离**：active UI 计数和 Overview 卡片只包含 `accepted + current`；pending proposal
  仍以独立行可见；重连时显示非阻塞提示，说明暂时只读并展示最近一次确认状态。
- **调试投影与 envelope**：`charter_read all` 返回 origin/order/createdRevision/替代链/验证来源，32 KiB
  上限按最终 tool envelope 测量（用 30 条大归档条目测试）；`overBudget` 也反映调低的 history/mutation 数量上限。
- **打包产物门禁**：CI 打包 tarball 并校验必需文件、所有 `exports` 目标、无工作区泄漏、packed Host import 和
  packed client bundle（`npm run smoke:package`）。

### 4.7 Checker 退出条件、草稿异步围栏与在线修复

- **Compaction checker（fixture）**：`tests/verify/compaction-checks.spec.ts` 覆盖精确成功条件：正常通过、
  system prompt 污染、调用了 `charter_read` 但 standing 不匹配、压缩后快照丢失、摘要泄漏 warning。transcript
  reader 现在构造与 Host 相同的紧凑 standing 投影（`kind`/`text`/`verification`/`progress`），所有必需证据
  都参与退出码；只有 WAIT/BLOCKED 状态会在评估前短路。
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
  并加载 packed Runtime 入口；不再软链工作区 `node_modules`。

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
- `apply` 注册 `conversation.view` 的 `charter` entry、正文组件和 Remote contribution；
- 已有 tab 顺序为 chat 0 / trajectory 10 / context 20 时，`charter` 排在最后；
- 模拟后续注册的 `fleet` tab 后，`charter` 自动重新注册并再次排在最后，且不重复；
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
包含动态顺延逻辑（`ensureLast`），`/` 与客户端入口均返回 200。

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
- 另用 `client-smoke` 模拟一个后注册的 tab：本插件会 dispose 后重新注册，再次回到最后，且不会产生
  重复 entry；
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
- 面板从「会话会话契约 / 目标 / 硬约束 / 1 条约束 / 预览上下文 / 应用」切换为
  `SESSION CHARTER / OBJECTIVE / INVARIANTS / 1 constraint / Preview context / Apply`；
- 统计、状态、按钮、占位符、错误码说明全部来自同一 `dsh-charter` locale namespace；
- 刷新页面后语言偏好仍为 English，标签和面板保持英文。

中文截图见 [charter-pane.png](assets/charter-pane.png)，英文截图见
[charter-pane.en.png](assets/charter-pane.en.png)。用户输入的目标和约束正文不翻译，这是数据，不是 UI 文案。

### 7.6 重设计 UI 与预算验证

本节截图已用第三轮评审后的构建重新生成：面板现在包含声明性上下文提示、始终可用的**历史草案** section、
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
prompt renderer 计算草案预览，并在条目/目标/所选草案/投影上下文超预算时禁用 Apply。本轮没有在浏览器里
实际录入超限文本走一遍禁用态。

### 7.5 说明

- 测试使用了一个格式合法但没有真实额度的 API Key，所以 Chat 里显示模型请求失败；这是模型调用问题，
  不影响会话契约标签页的目标/约束编辑和 Apply。
- 尚未在浏览器中自动验证：两标签页并发冲突、两个 Session 隔离、0.1.7/0.2.1 的逐版交互。这些逻辑由
  Host/Remote 测试覆盖，仍建议在目标 profile 手工走一遍。

## 8. 真实 compaction 端到端

状态：**2026-10-22 已在真实 DSH Session 上记录 PASS**（`session-45c509c6-ab85-45a8-99e9-adb4079a3192`，
`infcode-eval-service`）：`/compact` 压缩 326 条消息（约 228k tokens），下一次请求携带字节一致且 digest 匹配的
`charter:standing` 快照。`npm run check` 不调用模型，因此不会执行这项检查；证据见 8.4。

### 8.1 已经证明的部分

- DSH 会把每个装配后的 runtime context 持久化为 `user/message` 事件（`source.kind === "runtime-context"`，
  带 `sections` 数组）。在一个真实 Web profile Session（`session-aa06df32…`，revision 6，245 B 会话契约）
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
5. transcript 中的 `charter_read` standing 结果等于 Host 的紧凑 standing 投影（`kind`/`text`/
   `verification`/`progress`），而不只是 revision/objective；旧版 debug 形状的 tool result（额外
   id/review/lifecycle 字段）会先归一到同一投影，因此未重启的 Host 仍可给出可比的 working-set 证据；
6. 压缩之后的压缩摘要没有夹带渲染正文（这是 warning：它会削弱证明，而不是静默通过）。

真实 profile 中的操作步骤：

1. 在目标 Session 打开「会话契约」标签页，审阅历史草案并点击 Apply（或手动设置目标），然后发送一条消息，
   让 runtime context 落进 transcript；
2. 运行 `npm run verify:compaction`：预期 `charter established`、注入、digest、system-prompt 和
   `charter_read` 检查通过，compaction 步骤为 `WAIT`；
3. 在同一 Session 执行 `/compact`，然后发送一条消息；
4. 再次运行命令：预期 `PASS`，并输出 compaction seq、压缩后快照 seq 和 digest。

检查器只会 fail closed 为 `BLOCKED`（还没有契约）或 `WAIT`（压缩后还没有新请求）；一旦存在压缩后请求，
`survivesCompaction`、system prompt 洁净、以及“调用了 charter_read 但 standing 不匹配”都会参与退出码；
摘要泄漏记录为 warning 而不是静默通过。`tests/verify/compaction-checks.spec.ts` 用 fixture 覆盖这些通过/失败
组合，不依赖真实模型。它绝不把 checkpoint 摘要当作“存活”证据。

### 8.3 平台依据

`@deepseek-ai/dsh-agent-loop@0.2.1-rc.2` 的 `RuntimeContextProjection` 在 retained snapshot 被
replacement/compaction 遮蔽后清空 retained，下一次请求重新生成；本插件的 context provider 调用
`charter.promptText(session)`，同步读取 storage 正本并校验派生 digest。

### 8.4 真实模型实测记录（2026-10-22）

目标：`session-45c509c6-ab85-45a8-99e9-adb4079a3192`（workspace `infcode-eval-service`）。先审阅并应用其上一轮
压缩摘要生成的历史草案，成为 **revision 1**（13 条 active 条目，5,081 B，`promptDigest sha256:4dd9e615…`）。
随后 `/compact` 以 compaction seq **31801**（source `cmd-635e3d77-2`）完成，压缩 326 条消息（约 228,181
tokens）。压缩后第一次请求产生 runtime-context 快照 seq **31810**，包含
`sections [sandbox:policy, approval:policy, charter:standing]`，5,081 B 会话契约的字节/digest 与 storage 一致；
随后 `charter_read` 返回相同 revision/objective/working set。完整 checker 输出：

```text
$ npm run verify:compaction -- --session session-45c509c6-ab85-45a8-99e9-adb4079a3192 \
    --home /Users/ryanzhang/.dsh \
    --store /Users/ryanzhang/.dsh/storages/dsh_charter_v1/sessions/session-45c509c6-ab85-45a8-99e9-adb4079a3192.json
  PASS  charter established
  PASS  latest runtime context carries charter:standing
  PASS  injected text matches storage authority and promptDigest
  PASS  system prompt carries no charter body
  PASS  charter_read standing view matches the storage revision/objective
  PASS  charter survives compaction — snapshot seq 31810 > compaction seq 31801
  PASS  compaction summary does not carry the charter text
result: PASS
```

注：运行中的 Desktop 进程加载的是重启前的 Host bundle，所以它的 `charter_read` 结果仍带 legacy debug 字段；
checker 已将这些字段归一到当前紧凑投影。要让 UI/tool ABI 与磁盘上的当前包完全一致，仍需完全重启 Desktop app。

## 9. 未支持的验证项

- 多进程共享 storage 的实时同步：`domain/changed` 只在单进程内可见，本插件按单 Host 进程部署设计。
- 真实模型是否遵守会话契约：会话契约是声明，不承诺模型行为。
- 永久审计：history/mutation 回执有界，不构成审计。
- 配额真实样本校准：默认值是产品初值。

## 10. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 git，也不进入 npm 包。
