# `dsh-charter` Compatibility Matrix and Degradation

English | [中文](compatibility.zh.md)

Research/verification baseline: 2026-10-20.

This document answers three questions:

1. Which DSH versions are supported?
2. Which capabilities are complete or degraded on each version?
3. Why is `0.1.5-rc.1` and earlier not supported?

## 1. Support matrix

| DSH version | Status | Verification |
| --- | --- | --- |
| `0.1.7-rc.2` | Supported (minimum) | typecheck, build, 157 tests, remote/client smoke, real profile install and startup |
| `0.2.0-rc.1` | Supported | typecheck, build, 157 tests, remote/client smoke |
| `0.2.0-rc.2` | Supported | same + real profile install/startup, boot graph, bundle HTTP |
| `0.2.1-rc.1` | Supported | typecheck, build, 157 tests, remote/client smoke |
| `0.2.1-rc.2` | Supported (primary development baseline) | same |
| `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.5-rc.3` | Not supported | contract differences too large; see section 4 |
| `0.1.6-alpha.x` | Not supported | same generation as 0.1.5; not individually verified |
| `0.2.2-rc.x` | Not declared | peer range does not cover this prerelease; add after verification |
| `0.3.x` | Not declared | major upgrade requires re-verification |

The DSH peer range in `package.json` is:

```text
>=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-rc.1 <0.3.0-0
```

This is required by semver prerelease semantics: `>=0.2.0-rc.1 <0.3.0` alone does not match `0.2.1-rc.2`
because the range has no prerelease comparator for the `0.2.1` tuple. Likewise 0.1.7 needs its own comparator.
Add a new clause after verifying each new minor prerelease. `0.1.7-rc.1` is excluded; the minimum is
`0.1.7-rc.2`.

## 2. Version differences

### 2.1 `0.1.7-rc.2` / `0.2.0` vs `0.2.1-rc.1+`

| Contract | 0.1.7-rc.2 / 0.2.0 | 0.2.1+ | Plugin handling |
| --- | --- | --- | --- |
| `@Remote({ resources })` | Not accepted; decorator throws on non-`mode` keys | Supports per-Session resource authorization | Try modern form; fall back to `mode:'stream'` or bare `@Remote` |
| `PeerScope.principal` | Absent | Present | Read optional `principal`; when absent, record owner |
| `PromptContext.interpolate` | Absent | Supported | Still pass the field (old versions ignore it); escape `{{` in the renderer |
| `PromptContext.required` | Absent | Supported | Still pass the field (old versions ignore it) |
| prompt-context interpolation | Always runs | `interpolate:false` disables it | Encode the first of each `{` run as `\u007b`; no version sees `{{name}}` |
| `RemoteStream` / `RemoteStreamHandle` | Exported | Exported | Used directly |
| `conversation.view` tab slot | Same shape | Same shape | No difference; placement follows slot registration order, and the plugin re-registers to stay last |
| `agent/created` payload | Has `source`/`signal` | Has `source`/`signal` | Used directly |
| storage-domain single-record `update()` | Same | Same | Used directly |
| Session projection / compaction | Same semantics | Same semantics | Rely on host re-materialization |

### 2.2 Key conclusions

- **0.1.7-rc.2 / 0.2.0 are usable**, but the Gateway has no per-Peer resource authorization. The plugin can
  only validate live Session and lifecycle identity; any Peer that can reach the Host can call the Session
  Remote. Use these versions in a trusted single-operator environment.
- **0.2.1+ is recommended.** `@Remote.resources` lets the Gateway authorize the Session resource before the
  business method runs; `required:true` keeps the charter present when optional runtime context is disabled.
- Charter-body integrity does not depend on the version: every assembly reads the storage authority and
  JSON-escapes `{{`.

## 3. Compatibility implementation

| Mechanism | Location |
| --- | --- |
| Remote decorator fallback | `src/remote/compat.ts` |
| Resource declaration test | `scripts/verify/remote-smoke.mjs` |
| PromptContext extension fields | `src/host/service.ts` |
| `{{` escaping | `src/core/prompt.ts` |
| Actor resolution | `resolveActor()` in `src/host/service.ts`, generation policy in `src/remote/actor.ts`; 0.2.1+ fails closed when a Remote call has no Peer principal |
| Version-specific type verification | independent `node_modules` copies described in [verification](../verification.md) |
| Deprecated historical event read | isolated in `src/host/session-events.ts`; **known technical debt**, not a completed replacement — DSH 0.2.1-rc.2 exposes no public non-deprecated reader yet |

The compatibility layer is deliberately small: only decorator shape, two optional context fields, an actor
reading branch, and the isolated historical-event reader. There is no second Remote codec, second session event protocol, or second sidebar API for old
versions. 0.1.7 and 0.2.0 share the same degradation path.

## 4. Why not `0.1.5-rc.1` and earlier

Typechecking against `0.1.5-rc.1` fails on:

- `TypertCodec` strict shape is `{ schema }`, not the `{ create() }` used by `0.1.7`/`0.2.x`;
- `RemoteStream` / `RemoteStreamHandle` are not exported; stream result types differ;
- `@Remote` has no `resources`, and the decorator signature differs;
- `ctx.invocation` does not exist, so caller identity cannot be read;
- `agent/created` payload has no `source`/`signal`;
- `SidebarRightGuideEntry` does not accept `id`; the sidebar guide structure differs.

These are not optional-field differences: the Remote wire protocol and client registration both differ.
Forcing compatibility would require two protocols, two build artifacts, or runtime version-based module
loading, with a regression surface far larger than the benefit.

`0.1.7-rc.2` already shares the Remote codec, event payloads, and sidebar structure of `0.2.0`, so one code
path works with only resource-authorization, `principal`, and `interpolate`/`required` degradation. The
minimum supported version is therefore `0.1.7-rc.2`; the product recommendation is `0.2.0-rc.1+`, and the
security recommendation is `0.2.1+`.

## 5. Verification method

Each version uses its own directory and `node_modules`, with the same source copied in:

```bash
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

`0.1.7-rc.2` and `0.2.0-rc.2` additionally use the matching DSH CLI to create an isolated profile, install the
tarball, start Web, and check the boot graph and client bundle HTTP. Results and reproduction commands are in
the [verification record](../verification.md).

## 6. Upgrade policy

- New `0.2.x` stable: peer range already covers it; run 157 tests + profile smoke once.
- New `0.2.x` prerelease: extend the peer range, then run the version matrix; do not claim compatibility
  without verification.
- `0.2.1` introduces resource authorization and is the minimum security recommendation.
- `0.3.0+`: re-verify Remote, storage domain, prompt context, conversation view slot, and client module loader.
- Later `0.1.7` releases (if any): same compatibility layer; rerun typecheck/build/tests and profile smoke.
