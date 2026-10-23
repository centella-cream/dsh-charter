# `dsh-charter` 兼容矩阵与降级

[English](compatibility.md) | 中文

调研与验证基准日：2026-10-20。

本文回答三个问题：

1. 支持哪些 DSH 版本；
2. 不同版本上哪些能力完整、哪些降级；
3. 为什么不做 `0.1.5-rc.1` 及更早版本的兼容。

## 1. 支持矩阵

| DSH 版本 | 状态 | 验证内容 |
| --- | --- | --- |
| `0.1.7-rc.2` | 支持（最低版本） | typecheck、build、Vitest 套件、remote/client smoke、真实 profile 安装与启动 |
| `0.2.0-rc.1` | 支持 | typecheck、build、Vitest 套件、remote/client smoke |
| `0.2.0-rc.2` | 支持 | 同上 + 真实 profile 安装与启动、boot graph、bundle HTTP |
| `0.2.1-rc.1` | 支持 | typecheck、build、Vitest 套件、remote/client smoke |
| `0.2.1-rc.2` | 支持（主开发基线） | 同上 |
| `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.5-rc.3` | 不支持 | 契约差异过大，见第 4 节 |
| `0.1.6-alpha.x` | 不支持 | 与 0.1.5 同代，未逐一验证 |
| `0.2.2-rc.x` | 未声明 | peer range 未覆盖该 prerelease；验证后再加入 |
| `0.3.x` | 未声明 | 大版本升级需要重新核验 |

`package.json` 的 DSH peer 范围与 `engines.dsh` 就是已验证的五个精确版本：

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2
```

使用精确版本是刻意的：宽范围会声明尚未测试的 DSH prerelease。只有在跑过该版本的版本矩阵之后才扩展这个
列表，并保持 peer ranges 与 `engines.dsh` 一致。`0.1.7-rc.1` 不在范围内；最低支持版本是 `0.1.7-rc.2`。

## 2. 版本差异

### 2.1 `0.1.7-rc.2` / `0.2.0` 与 `0.2.1-rc.1+`

| 契约 | 0.1.7-rc.2 / 0.2.0 | 0.2.1+ | 本插件的处理 |
| --- | --- | --- | --- |
| `@Remote({ resources })` | 不接受，装饰器对非 `mode` 键抛错 | 支持按 Session 资源授权 | 先尝试现代形式，失败时回退为 `mode:'stream'` 或裸 `@Remote` |
| `PeerScope.principal` | 不存在 | 存在 | 读取可选 `principal`；缺省时按 owner 记录 |
| `PromptContext.interpolate` | 不存在 | 支持 | 仍传入该字段（旧版本忽略），同时在渲染层转义 `{{` |
| `PromptContext.required` | 不存在 | 支持 | 仍传入该字段（旧版本忽略） |
| prompt context 插值 | 总会执行 | `interpolate:false` 可关闭 | 渲染器把连续 `{` 的第一个起编码为 `\u007b`，任何版本都不会出现 `{{name}}` |
| `RemoteStream` / `RemoteStreamHandle` | 导出 | 导出 | 直接使用 |
| `conversation.view` tab slot | 结构相同 | 结构相同 | 无差异；插件以稳定高 order（1000）只注册一次，不做动态顺延 |
| `agent/created` payload | 含 `source`/`signal` | 含 `source`/`signal` | 直接使用 |
| storage domain 单记录 `update()` | 相同 | 相同 | 直接使用 |
| Session projection / compaction | 相同语义 | 相同语义 | 依赖宿主重新物化 |

### 2.2 关键结论

- **0.1.7-rc.2 / 0.2.0 可以用**，但 Gateway 没有 per-Peer 资源授权。插件只能校验 Session 存活和 lifecycle
  identity；任何能访问该 Host 的 Peer 都能调用本插件的 Session Remote。请在可信的单操作者环境使用这些版本。
- **0.2.1+ 是推荐版本**。`@Remote.resources` 让 Gateway 在业务方法执行前完成 Session 资源授权，
  `required:true` 让会话契约在可选 runtime context 被关闭时仍保留。
- 会话契约正文的完整性不依赖版本：每次 assembly 都从 storage 正本读取，并对 `{{` 做 JSON 转义。

## 3. 兼容实现位置

| 机制 | 位置 |
| --- | --- |
| Remote 装饰器回退 | `src/remote/compat.ts` |
| 资源声明测试 | `scripts/verify/remote-smoke.mjs` |
| PromptContext 扩展字段 | `src/host/service.ts` |
| `{{` 转义 | `src/core/prompt.ts` |
| actor 解析 | `src/host/service.ts` 的 `resolveActor()`，版本策略在 `src/remote/actor.ts`；0.2.1+ 的 Remote 调用缺少 Peer principal 时 fail closed |
| 版本化类型验证 | `docs/verification.zh.md` 描述的独立 `node_modules` 副本 |
| 已弃用的历史事件读取 | 隔离在 `src/host/session-events.ts`；**已知技术债**，不是已完成的替换——DSH 0.2.1-rc.2 尚无公开的非弃用读取接口 |

兼容层刻意保持很小：只有装饰器形态、两个可选 context 字段、actor 读取和隔离的历史事件读取。没有为旧版本维护第二套
Remote 编解码、第二套 session 事件协议或第二套侧栏注册 API。0.1.7 与 0.2.0 共享同一套降级逻辑。

## 4. 为什么不做 `0.1.5-rc.1` 及更早版本

对 `0.1.5-rc.1` 直接做 typecheck 会出现以下阻断项：

- `TypertCodec` 的 strict 形态是 `{ schema }`，不是 `0.1.7` / `0.2.x` 的 `{ create() }`；
- `RemoteStream` / `RemoteStreamHandle` 未导出，stream 结果的类型结构不同；
- `@Remote` 没有 `resources`，且装饰器签名与后续版本不同；
- `ctx.invocation` 不存在，无法读取调用者身份；
- `agent/created` payload 没有 `source` / `signal`；
- `SidebarRightGuideEntry` 不接受 `id`，侧栏 guide 结构不同。

这些不是加几个可选字段能解决的差异：Remote 线协议和客户端注册都不同。若强行兼容，需要维护两套协议、
两套构建产物或运行时按版本加载不同模块，维护成本和回归面都远超收益。

`0.1.7-rc.2` 已经回到与 `0.2.0` 相同的 Remote 编解码、事件负载和侧栏结构，因此可以用同一套代码适配，
只保留资源授权、`principal`、`interpolate`/`required` 的降级。项目的最小支持版本因此定为 `0.1.7-rc.2`，
产品上推荐 `0.2.0-rc.1+`，安全上推荐 `0.2.1+`。

## 5. 验证方式

每个版本使用独立目录和独立 `node_modules`，把同一份源码复制进去，执行：

```bash
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

`0.1.7-rc.2` 和 `0.2.0-rc.2` 另外用对应版本的 DSH CLI 创建隔离 profile、安装 tarball、启动 Web，并检查
boot graph 与客户端 bundle HTTP。结果和复现命令见[验证记录](../verification.zh.md)。

## 6. 升级策略

- 新的 `0.2.x` stable 版本：**尚未覆盖**——先把精确版本加入 peer ranges 与 `engines.dsh`，跑完整版本矩阵、
  Vitest 套件和 profile smoke，再更新本矩阵；验证前不要宣称兼容。
- 新的 `0.2.x` prerelease：先补 peer range，再跑版本矩阵；不要未经验证就宣称兼容。
- `0.2.1` 引入了资源授权，是安全边界上的最小推荐版本。
- `0.3.0` 及以上：重新核验 Remote、storage domain、prompt context、conversation view slot 和 client module loader 五组契约。
- `0.1.7` 系列后续版本（如有）：同一套兼容层，补跑 typecheck/build/tests 和 profile smoke 即可。
