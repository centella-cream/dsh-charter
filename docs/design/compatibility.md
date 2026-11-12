# `dsh-charter` Compatibility Matrix and Degradation

English | [中文](compatibility.zh.md)

> **Status:** Active — compatibility claims for the declared DSH versions.
> **Version scope:** all declared DSH versions.
> **Baseline:** 2026-11-05
> **Authority:** [version roadmap](version-roadmap.md) for release scope; the matrix below for compatibility.
> **Supersedes / Superseded by:** none / none

Research/verification baseline: 2026-10-30.

This document answers three questions:

1. Which DSH versions are supported?
2. Which capabilities are complete or degraded on each version?
3. Why is `0.1.5-rc.1` and earlier not supported?

## 1. Support matrix

| DSH version | Status | Verification |
| --- | --- | --- |
| `0.1.7-rc.2` | Supported (minimum) | typecheck, build, Vitest suite, remote/client smoke, real profile install and startup |
| `0.2.0-rc.1` | Supported | typecheck, build, Vitest suite, remote/client smoke |
| `0.2.0-rc.2` | Supported | same + real profile install/startup, boot graph, bundle HTTP |
| `0.2.1-rc.1` | Supported | typecheck, build, Vitest suite, remote/client smoke |
| `0.2.1-rc.2` | Supported | same |
| `0.2.1-rc.3` | Supported | typecheck, build, Vitest suite, remote/client smoke (full nine-version matrix) |
| `0.2.1-rc.4` | Supported | same |
| `0.2.1-rc.5` | Supported | same |
| `0.2.2-rc.1` | Supported (previous baseline) | same + real Web profile install/startup, boot graph, bundle HTTP |
| `0.2.2-rc.2` | Supported (primary development baseline) | typecheck, build, Vitest suite, remote/client smoke, ten-version source matrix |
| `0.1.5-rc.1` / `0.1.5-rc.2` / `0.1.5-rc.3` | Not supported | contract differences too large; see section 4 |
| `0.1.6-alpha.x` | Not supported | same generation as 0.1.5; not individually verified |
| `0.2.2-alpha.2` / `0.2.2-alpha.3` | Not supported | strict-peer install fails because these alpha lines require a Cordis 4.0.6 alpha graph; the 0.2.2-rc.1 line pins Cordis 4.1.0. No tests run. |
| `0.3.x` | Not declared | major upgrade requires re-verification |

The DSH peer ranges and `engines.dsh` in `package.json` are exactly the ten verified versions:

```text
engines.dsh:
  0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0

verified peer ranges / dsh.compatibility.dshReleases:
  0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5 || 0.2.2-rc.1 || 0.2.2-rc.2
```

Token compatibility (0.3.0): the Pane consumes 41 static host design tokens plus one runtime
`--dsh-content-font-size` variable. The audit in `scripts/verify/token-coverage.mjs` checks that every static
token is defined by `@deepseek-ai/dsh-client-ui-theme` for every version above (2026-11-12: all present); the
runtime variable has a CSS fallback. No per-version fallback block is needed today; adding a host token requires
updating `scripts/verify/token-coverage.inventory.json` and passing the gate in `npm run check`.

`engines.dsh` intentionally uses a bounded 0.2-line range: DSH's compatibility gate evaluates it with
`includePrerelease`, and when `engines.dsh` is present, peer ranges are ignored for admission. This means a new
0.2.x prerelease (for example the `0.2.2-rc.1 → 0.2.2-rc.2` Desktop update) installs without a plugin rebuild.
The exact `dsh.compatibility.dshReleases` and peer list remain the **matrix-verified support set**; new versions
are still probed with `compat-matrix --discover` and added to that list after passing. A range pass is not a
substitute for matrix evidence: if a later 0.2.x release actually changes a surface the plugin uses, fix forward
or narrow the range in a new plugin release. `0.3.x` is deliberately excluded by the `<0.3.0-0` upper bound.
`0.1.7-rc.1` is excluded; the minimum is `0.1.7-rc.2`.

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
| `conversation.view` tab slot | Same shape | Same shape | No difference; the plugin registers once at a stable high order (1000) and never re-registers |
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
| Deprecated historical event read | isolated in `src/host/session-events.ts`; **known technical debt**, not a completed replacement — DSH 0.2.1-rc.2/rc.3/rc.4 expose no public non-deprecated reader yet |

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

Each version uses its own pnpm project with the exact DSH test manifest and the same source copied in; zod is
resolved to one graph through `pnpm-workspace.yaml` overrides, never by rewriting the virtual store:

```bash
pnpm install --ignore-scripts --no-frozen-lockfile
pnpm list --depth Infinity --json --silent
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

The runner records the full resolved DSH graph, lockfile SHA-256, Node/pnpm versions, and fails on missing, mixed,
or auto-resolved DSH versions.

`0.1.7-rc.2`, `0.2.0-rc.2`, and `0.2.1-rc.3`/`rc.4` additionally use the matching DSH CLI to create an isolated profile, install the
tarball, start Web, and check the boot graph and client bundle HTTP. Results and reproduction commands are in
the [verification record](../verification.md).

## 6. Upgrade policy

- New `0.2.x` stable: **not covered yet** — add the exact version to the peer ranges and `engines.dsh`, run the
  full version matrix, the Vitest suite, and profile smoke, then update this matrix; do not claim it before verification.
- New `0.2.x` prerelease: extend the peer range, then run the version matrix; do not claim compatibility
  without verification.
- `0.2.1` introduces resource authorization and is the minimum security recommendation.
- `0.3.0+`: re-verify Remote, storage domain, prompt context, conversation view slot, and client module loader.
- Later `0.1.7` releases (if any): same compatibility layer; rerun typecheck/build/tests and profile smoke.
