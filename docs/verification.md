# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

> **Status:** Active — current operating record.
> **Version scope:** current development line.
> **Baseline:** 2026-11-03

Verification date: 2026-11-03. Current source version: `0.2.0` (unreleased development). This is the current evidence record; historical per-commit narratives live in Git
history and the Changelog. Temporary directories, profiles, tarballs, and fetched HTML live under `.tmp/` and are
excluded from the published package.

Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`. Local DSH development baseline:
`0.2.1-rc.5` (the current npm `next`).

## 1. Current conclusion

Current release state (2026-10-30):

- Published: `0.1.0-rc.6` (npm `latest`/`next`; exact SHA-256 `21ddbea0ae3fd88994d4e4731429ef4d8cb75db2b97e83cd7530a0386e425825`). GitHub Release uses recovery tag `v0.1.0-rc.6-republished`.
- `0.1.0-rc.5`: previous accepted npm release; its canonical GitHub tag/release remains pending restoration.
- Active release: `0.1.0-rc.6`, formally accepted.
- Active development: `0.2.0` on `feat/0.2.0-workspace`; package versions from 0.2.0 onward never use an `rc` suffix.
- 0.2.0 source evidence: 35 files / 409 tests and the eight-version matrix pass 409/409 on the current development tree.
- Pending: restore the canonical rc.5 GitHub tag/release and complete the protected browser evidence/post-release checks.

| Item | Result |
| --- | --- |
| Strict TypeScript check | Pass on the current tree |
| Vitest | 35 files / 409 tests pass (`npm test`, which builds first) |
| Host ESM build + browser factory bundle | Pass |
| Remote contract and client smoke | Pass |
| Normal package smoke | Pass |
| Exact-artifact package smoke | Pass on the published rc.6 `.tgz` bytes (`21ddbea0…`) without rebuild |
| Packed-artifact recovery smoke | Pass: export, target removal, restore, receipt replay, two restarts, healthy-target refusal, packed fault subset |
| Real `TypertGatewayService` | Pass on exact artifact with isolated DSH `0.2.1-rc.3` and `rc.4` graphs |
| Compatibility sentinels | Pass on `0.1.7-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4`, `0.2.1-rc.5` |
| Eight-version full rerun | Pass via tracked `compat-matrix --versions all --allow-new-release` (409/409 each) |
| Fresh Web profile matrix | PASS: local rc.6 artifact (pre-withdrawal) installed and served on DSH `0.1.7-rc.2`, `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4`, `0.2.1-rc.5` |
| Untracked `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run; explicitly unsupported in rc.6 |
| Local Web + Desktop profiles | rc.6 artifact was installed before withdrawal; this is not release evidence. Desktop app is still `0.2.1-rc.3` |
| Real browser recovery | Manual protected evidence gate; not automated |
| Real-model compaction | Separately recorded PASS (2026-10-22); still a manual release gate |

### 1.1 0.2.0 development acceptance

The `feat/0.2.0-workspace` tree has passed source-level acceptance for the implemented workspace core:

- record v2 write path and in-memory v1 migration;
- dependency `requires` validation, derived readiness, and dependency-aware prompt equivalence;
- three-area Pane information architecture and dependency editor;
- proposal-batch provenance, objective-proposal lifecycle, summary/item/proposal/change query projections, `watchSummary`, and pending-only `charter_propose`;
- `npm run check`: 35 files / 409 tests;
- eight-version DSH matrix: 409/409 on every declared version;
- normal package smoke: `dsh-charter-0.2.0.tgz` installs and its client factory bundle loads.

This is source acceptance, not a release acceptance: real browser/Desktop A/B, real-model compaction, performance,
and the remaining full-design gates must be recorded separately before declaring `0.2.0` stable. The Pane still
uses the full `watch` stream, so the 512-item summary/query scale contract is not yet part of this acceptance.

## 2. Local baseline

```bash
npm run check                 # typecheck + build + remote/client smoke + Vitest
npm run smoke:package         # normal pack + consumer install
npm run smoke:package -- --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/recovery-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/gateway-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/compat-matrix.mjs --versions minimum,old-boundary,current
```

CI (`.github/workflows/ci.yml`) runs `npm run check` and normal `npm run smoke:package` on Node `22.19.0` and
`24`. Exact-artifact mode, compatibility sentinels, Gateway/browser acceptance, and real-model compaction are
separate jobs or manual gates, not claims made by `npm test` alone.

## 3. DSH compatibility evidence

`package.json` `engines.dsh`, every `@deepseek-ai/dsh-*` peer range, and
`dsh.compatibility.dshReleases` all declare the same eight exact versions:

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5
```

The tracked runner creates isolated pnpm projects with strict peers and runs typecheck/build/tests per version. `--allow-new-release` sets only the isolated workspace `minimumReleaseAge: 0` so a just-published exact DSH version can be tested inside the 24-hour window; it does not relax strict peers, does not affect user installs, and is not a release-policy exemption. Current evidence:

| DSH version | Evidence |
| --- | --- |
| `0.1.7-rc.2` | 409/409 tracked matrix PASS |
| `0.2.0-rc.1` | 409/409 tracked matrix PASS |
| `0.2.0-rc.2` | 409/409 tracked matrix PASS |
| `0.2.1-rc.1` | 409/409 tracked matrix PASS |
| `0.2.1-rc.2` | 409/409 tracked matrix PASS |
| `0.2.1-rc.3` | 409/409 tracked matrix PASS |
| `0.2.1-rc.4` | 409/409 tracked matrix PASS |
| `0.2.1-rc.5` | 409/409 tracked matrix PASS |

The current 0.2.0 development tree passed `compat-matrix --versions all --allow-new-release` on 2026-11-03: every declared version passed typecheck, build, and 409/409 tests. Installs use pnpm strict peer resolution, exact tool pins, a single zod 4.6.7 graph, full `pnpm list --depth Infinity` graph validation, and recorded lockfile SHA-256 values. The untracked `0.2.2-alpha.2` probe is recorded as unsupported: strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run.

## 4. What the tests cover

- **Core:** record/schema validation, atomic commit/idempotency, history bounds, prompt rendering, normalization,
  fork remapping, bootstrap extraction, archive/payload/record digests, maintenance receipts, restore semantics,
  future-schema classification, and recovery size/timestamp bounds.
- **Host:** real Cordis composition, source-aware initialization, session lifecycle, queue ordering and fences,
  malformed/version-rejected bytes, recovery export/initialize/restore, write-uncertain behavior, scripted storage
  faults, watch frames, and forward-schema read-only enforcement.
- **Remote:** descriptor/wire codecs, legacy Host frames, strict future-schema encoding, and the six-method
  contract.
- **Gateway:** real `TypertGatewayService`/`RemoteAccessService` owner and guest paths, policy denial before
  business dispatch, guest maintenance/purge refusal, and missing-principal fail-closed behavior.
- **Client:** draft/store attempt lifecycle, exact replay, visible-only bootstrap review, safe discard, UTF-8
  archive preview and WebCrypto failure, connection classification, Pane rendering/recovery flows, and
  English/Chinese locale parity.
- **Verification tooling:** npm pack parsing, structured tarball/checksum validation, packed consumer install,
  exact-artifact mode, recovery smoke, compatibility runner, and Gateway smoke.

## 5. Recovery acceptance matrix

| Area | Result |
| --- | --- |
| Resume/absence never auto-creates | PASS |
| Explicit initialize with replay and ownership/lifecycle denial | PASS |
| Export and restore complete record on invalid target | PASS |
| Healthy-target refusal and operation-id reuse rejection | PASS |
| Cross-session/lifecycle archive rejection | PASS |
| Storage rejection fences and restart convergence | PASS |
| Unknown-outcome exact replay | PASS |
| Cross-lifecycle attempt lock/abandon | PASS: attempt becomes unknown, Retry blocked, Abandon visible in the Pane, staged work not written to the new lifecycle |
| Future-schema diagnostic export, no reads/writes, byte preservation | PASS |
| Visible-only bootstrap selection and exact replay | PASS |
| Discard/editor/composer independence and unknown evidence retention | PASS |

## 5.1 Traffic / cache observation

The read-only checker reports context accumulation without changing the Host:

```bash
node scripts/verify/traffic-check.mjs --session <id> --home <DSH_HOME> [--json]
```

It reports model attempts (including `assistant/attempt` stream usage), active-surface and historical
runtime-context snapshots, compaction epochs, token usage attribution, and `charter_read` calls/result bytes.
A local run is **diagnostic only and is not release evidence**: the point-in-time record below is archived in this
document, but no sanitized fixture or controlled A/B result exists yet. Do not cite a local observation as proof
that cache hit changed or that a particular snapshot state is present in the current model request.

The checker itself has fixture coverage; a controlled A/B experiment is still required before changing the
prompt-delivery model.

### 5.1.1 Local diagnostic (not release evidence)

One local diagnostic run on 2026-10-30 (Session `session-f0aaa8dd-05bf-4a85-9a5e-b4bd016f6dd3`,
transcript `sha256:88f47145827ea40c67269dec8fe30fdbff63a8da0fc1c02eeae63871ddbfdb83`, 34,841 events;
live Session, digest fixed at the diagnostic time) reported:

```text
historical runtime snapshots: 22 (16 shadowed)
active runtime snapshots:     6, 7,712 B total, 6,129 B duplicate over latest
active charter:               2,097 B total, latest 630 B, 1,467 B duplicate
section churn (active):       app:web-surface ×2, charter:standing ×2,
                              approval:policy ×1, sandbox:policy ×1
section churn (all history):  app:web-surface ×7, approval:policy ×4,
                              sandbox:policy ×4, charter:standing ×2,
                              harness:source ×1, team:identity ×1,
                              working-directory:current ×1
tool schema:                  39 tools, 32,173 B; charter_read 805 B
charter_read:                 4 calls, all before the first active charter snapshot
```

This is a **local diagnostic, not release evidence**. It shows that the dominant active-surface growth is the
DSH runtime-context snapshot append model, not Charter content: unchanged Charter text is repeated when another
section triggers a new snapshot. The plugin cannot safely stop returning Charter text because the latest snapshot
is authoritative for injection. rc.6 therefore records this as an upstream/DSH limitation and does not change
injection semantics; the tool-description shortening is the only model-visible reduction shipped here.

## 6. Manual and external gaps

- Real browser export → absent target → restore → reload/restart is a manual protected evidence gate
  (`.github/workflows/browser-evidence.yml`); it is not automated by a tracked browser script. Promotion requires
  a successful evidence run bound to the candidate SHA.
- Web and Desktop share the same `dsh.client` bundle through the host client-module carrier. The installed Desktop app here is `0.2.1-rc.3`; rc.5 Desktop acceptance requires updating the Electron app and its profile, then repeating the manual Desktop ABI/interaction gate.
- Real-model compaction was recorded PASS on 2026-10-22 and remains a manual gate for release.
- Multi-Host writes/leases are out of scope; the single-writer Host limitation is documented.
- An unreadable/malformed **outer** JSON document is indistinguishable from absence at the storage boundary; stop
  the Host and restore from backup before initializing. Inner invalid records are preserved and isolated.
- Legacy transcript strictness and compaction sequence edge cases remain documented limitations rather than
  closed guarantees.

## 7. Historical real-model evidence

The detailed real-model compaction run from `v0.1.0-rc.4` remains auditable at the immutable
[v0.1.0-rc.4 verification §8.4](https://github.com/centella-cream/dsh-charter/blob/v0.1.0-rc.4/docs/verification.md#84-recorded-real-model-run-2026-10-22).

## 8. Release history (summary)

| Version | Date | Key outcome |
| --- | --- | --- |
| `0.1.0-rc.1` | 2026-10-22 | Initial compacted-history review plugin, Pane and compaction checker |
| `0.1.0-rc.2` | 2026-10-24 | Pane hook-order recovery, security/dependency update, release-channel docs |
| `0.1.0-rc.3` | 2026-10-26 | Authority-preserving recovery: structured record state, archive export/initialize/restore, write-uncertain fence |
| `0.1.0-rc.4` | 2026-10-27 | Compatibility-only DSH `0.2.1-rc.3`/`rc.4` support |
| `0.1.0-rc.5` | 2026-10-29 | Candidate green and tagged: visible-only review, future-schema fence, safe discard, UTF-8/error/a11y hardening; npm/Release pending |
| `0.1.0-rc.6` | 2026-11-01 | DSH 0.2.1-rc.5 compatibility, navigation help, formatted preview, traffic observability; formally accepted and published with recovery tag |

Detailed release-by-release changes are in `CHANGELOG.md`; published tags and GitHub Releases are immutable.

## 9. Cleanup

```bash
rm -rf .tmp
```

`.tmp/` is excluded from Git and the npm package.
