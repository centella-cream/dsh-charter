# `dsh-charter` 验证记录

[English](verification.md) | 中文

验证日期：2026-10-20。
环境：macOS，Node `v22.23.1`，npm `12.0.2`，pnpm `12.3.4`；当前 Desktop 运行时 DSH `0.2.0-rc.2`。
本地开发依赖基线：DSH `0.2.1-rc.2`。

本文记录可复现的命令和结果。临时目录、profile、tarball 和抓取到的 HTML 都在 `.tmp/` 下，不进入发布包。

## 1. 结论

| 验证项 | 结果 |
| --- | --- |
| TypeScript 严格类型检查（5 个 DSH 版本） | 通过 |
| Vitest（5 个版本 × 66 tests） | 通过 |
| Host ESM 构建 + 浏览器单文件 bundle | 通过 |
| Remote 装饰器/资源 smoke | 通过（0.1.7/0.2.0 按预期无资源声明） |
| 浏览器 factory bundle 物化与 `apply` smoke | 通过 |
| 真实 DSH profile 安装、组合、启动（0.1.7-rc.2 / 0.2.0-rc.2） | 通过 |
| Web boot graph 与 `/plugins` 服务 | 通过 |
| 真实浏览器 UI 交互（0.2.0-rc.2 Web profile） | 通过：标签顺序、中英文切换、目标/约束编辑、预览、Apply、刷新持久化；见第 7 节 |
| 非 live Session 的只读 stored view | 通过：composition 测试覆盖 stored view 与 live 后自动升级 |
| 从压缩摘要生成历史草案 | 通过：core 解析器 + composition 真实 Session 事件；见 4.4 |
| 真实模型 + compaction 端到端 | **未完成**，需要可用的模型会话；见第 8 节 |

## 2. 本地基线

```bash
npm run typecheck
npm test
```

结果：

- typecheck 通过；
- build 通过；
- `12` 个测试文件、`66` 个测试全部通过；
- `remote-smoke` 断言 `watch,bootstrap,edit`、stream mode 和 Session resource；
- `client-smoke` 断言单文件 factory bundle、外部依赖白名单、`apply` 注册 tab/pane/Remote contribution。

关键测试文件：

| 文件 | 覆盖 |
| --- | --- |
| `tests/core/commands.spec.ts` | 目标、条目、替代、状态转换、整批回滚 |
| `tests/core/record.spec.ts` | 原子提交、幂等、revision、history 裁剪、篡改检测 |
| `tests/core/prompt.spec.ts` | 确定性渲染、`{{` 转义、UI 预览与 Host 渲染一致 |
| `tests/core/normalize-render.spec.ts` | NFC、控制字符、字节上限、100 次稳定性 |
| `tests/core/state.spec.ts` | 替代链必须指向 current successor |
| `tests/core/fork.spec.ts` | fork 重铸 id、替代链重映射 |
| `tests/core/bootstrap.spec.ts` | 压缩摘要分节抽取、latest objective、UTF-8 拆分/不截断、最新/损坏 summary |
| `tests/host/composition.spec.ts` | 真实 Cordis/Storage/SystemPrompt/Tools 组合、user-role 边界、fork、幂等、配额、lifecycle、非 live Session 的只读 stored view 与 live 升级、从真实 `compaction/summary` 事件生成草案、`charter_read` |
| `tests/host/watch.spec.ts` | opening snapshot、竞态、去重、abort、装饰器兼容 |
| `tests/host/actor.spec.ts` | 0.1.7/0.2.0 无 principal 回退、非 owner 记录 |
| `tests/host/remote.spec.ts` | Remote 描述符和 wire schema |
| `tests/client/store.spec.ts` | 提交后立即接受 view、忽略陈旧/重复 revision |

## 3. 跨版本矩阵

每个版本使用独立目录和独立 `node_modules`：

```text
.tmp/compat/017rc2/proj
.tmp/compat/020rc1/proj
.tmp/compat/020rc2/proj
.tmp/compat/021rc1/proj
.tmp/compat/021rc2 由主仓库直接验证
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
| `0.1.7-rc.2` | 通过 | 通过 | 66/66 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.1` | 通过 | 通过 | 66/66 | 通过（无 resources 警告） | 通过 |
| `0.2.0-rc.2` | 通过 | 通过 | 66/66 | 通过（无 resources 警告） | 通过 |
| `0.2.1-rc.1` | 通过 | 通过 | 66/66 | 通过 | 通过 |
| `0.2.1-rc.2` | 通过 | 通过 | 66/66 | 通过 | 通过 |

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
- `renderContextSnapshot(assembly)` 包含章程正文；
- `renderPrompt(assembly)` 和 `assembly.sections` 不包含章程正文；
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
- 中文标签为「章程」，英文标签为「Charter」。

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
  dsh plugin --profile smoke add "$PWD/.tmp/smoke/dsh-charter-0.1.0.tgz"
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

最后从 `dist/dsh-charter-0.1.0.tgz` 重新安装并启动一次，`/` 返回 200，boot graph 仍包含
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

创建隔离 profile 并安装 `dist/dsh-charter-0.1.0.tgz`：

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --from-default-profile web --dump-config > /dev/null
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  plugin --profile smoke017b add "$PWD/dist/dsh-charter-0.1.0.tgz"
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
对话    轨迹    章程
```

- 「章程」位于「对话」「轨迹」之后；
- 再安装 `dsh-context@0.73.3` 后，实际顺序变为 `对话 / 轨迹 / 上下文 / 编队 / 章程`，章程仍然最后；
- 中文标签为「章程」，英文标签为「Charter」，由 `dsh-client-locale` 字典提供；
- 另用 `client-smoke` 模拟一个后注册的 tab：本插件会 dispose 后重新注册，再次回到最后，且不会产生
  重复 entry；
- 空白 Session 不显示 View tab bar；发送第一条消息后出现。

真实截图：[中文面板](assets/charter-pane.png)、[English pane](assets/charter-pane.en.png)。

### 7.2 目标编辑、预览与 Apply

> 7.2/7.3 的 191 B / 220 B 是重设计前的功能验证数据；7.6 的截图来自后来使用 47 B 目标、240 B context 的数据。

在「章程」标签页中：

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
4. 标签顺序仍为「对话」「轨迹」「章程」。

这说明浏览器 UI → Remote → Host service → storage domain → 重新 assembly/UI 的整条链路可用。

### 7.4 中英文切换

在同一 Web profile 中把 DSH 语言从中文切到 English（Settings → Language → English），不做页面刷新：

- 标签从「章程」变为 `Charter`；
- 面板从「会话章程 / 目标 / 硬约束 / 1 条约束 / 预览上下文 / 应用」切换为
  `SESSION CHARTER / OBJECTIVE / INVARIANTS / 1 constraint / Preview context / Apply`；
- 统计、状态、按钮、占位符、错误码说明全部来自同一 `dsh-charter` locale namespace；
- 刷新页面后语言偏好仍为 English，标签和面板保持英文。

中文截图见 [charter-pane.png](assets/charter-pane.png)，英文截图见
[charter-pane.en.png](assets/charter-pane.en.png)。用户输入的目标和约束正文不翻译，这是数据，不是 UI 文案。

### 7.6 重设计 UI 与预算验证

重设计后的面板在同一个 Web profile、1440×757 下验证了明暗主题和中英文：

- 紧凑页头，包含修订/生效/存储 chip 和实时 `240 B / 8.0 KiB 上下文` 预算条；
- 吸顶的预览/丢弃/应用工具栏在内容滚动时保持可见；
- 左侧 section 导航：概览 / 目标 / 硬约束 / 交付物 / 上下文，有草案时增加「历史草案」；
- 概览 dashboard 包含目标、约束/交付物卡片和预算明细，大块历史草案不再挤压工作模块；
- 独立的目标/条目 tab，section 内联添加输入和 `0 B / 1.0 KiB` 计数；
- hover/focus 出现的条目操作（编辑/替换/归档/标记验证）；
- 明暗主题完全由 DSH 语义 token 驱动。

截图：[中文浅色](assets/charter-pane.png)、[英文浅色](assets/charter-pane.en.png)。

解析器拆分/目标保持完整的自动化测试在 `tests/core/bootstrap.spec.ts`；客户端会标记超限字段、用同一
prompt renderer 计算草案预览，并在条目/目标/所选草案/投影上下文超预算时禁用 Apply。本轮没有在浏览器里
实际录入超限文本走一遍禁用态。

### 7.5 说明

- 测试使用了一个格式合法但没有真实额度的 API Key，所以 Chat 里显示模型请求失败；这是模型调用问题，
  不影响章程标签页的目标/约束编辑和 Apply。
- 尚未在浏览器中自动验证：两标签页并发冲突、两个 Session 隔离、0.1.7/0.2.1 的逐版交互。这些逻辑由
  Host/Remote 测试覆盖，仍建议在目标 profile 手工走一遍。

## 8. 未完成的压缩端到端

完整 compaction 需要一个可用的模型 provider 和足够长的会话。当前验证没有发起模型请求。建议：

1. 在一个测试 Session 中设置目标和 2-3 条约束；
2. 继续对话并执行 `/compact`（或让自动压缩触发）；
3. 压缩后检查：
   - Charter 面板仍显示相同 revision/正文；
   - `charter_read` 返回 standing 内容；
   - 系统 prompt 不包含章程正文；
   - 下一个请求的 runtime context 包含完整章程；
4. 重启 DSH，重新打开该 Session，再次检查 revision 和正文。

平台契约依据：`@deepseek-ai/dsh-agent-loop@0.2.0-rc.2` 的 `RuntimeContextProjection` 在 retained
snapshot 被 replacement/compaction 遮蔽后清空 retained，下一次请求重新生成；本插件每次 provider 调用都
从 storage 正本读取。

## 9. 未支持的验证项

- 多进程共享 storage 的实时同步：`domain/changed` 只在单进程内可见，本插件按单 Host 进程部署设计。
- 真实模型是否遵守章程：章程是声明，不承诺模型行为。
- 永久审计：history/mutation 回执有界，不构成审计。
- 配额真实样本校准：默认值是产品初值。

## 10. 清理

```bash
rm -rf .tmp
```

`.tmp/` 不进入 git，也不进入 npm 包。
