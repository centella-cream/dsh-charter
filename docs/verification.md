# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

Verification date: 2026-10-30. This is the current evidence record; historical per-commit narratives live in Git
history and the Changelog. Temporary directories, profiles, tarballs, and fetched HTML live under `.tmp/` and are
excluded from the published package.

Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`. Local DSH development baseline:
`0.2.1-rc.4` (the current npm `next`).

## 1. Current conclusion

Current release state (2026-10-30):

- Published: `0.1.0-rc.4` (npm `latest`/`next`, GitHub Release).
- Candidate: `0.1.0-rc.5`, candidate run `40864078201` green, exact artifact
  `dsh-charter-0.1.0-rc.5.tgz` with SHA-256
  `94e27acf8851ad5423defd06a41253171317f4e805af809fe8e8e7a9ce83a939`.
- Release commits: `C=d138d65dc4f1b2628dc043f2dd437ea213112a4d`, `C+1=tag v0.1.0-rc.5=0a6ccc5`.
- Active source: `0.1.0-rc.6` (unreleased, untagged; documentation/UI/traffic observation).
- Pending: npm token publication, GitHub prerelease, protected browser evidence, Promotion.

| Item | Result |
| --- | --- |
| Strict TypeScript check | Pass on the current tree |
| Vitest | 30 files / 377 tests pass (`npm test`, which builds first) |
| Host ESM build + browser factory bundle | Pass |
| Remote contract and client smoke | Pass |
| Normal package smoke | Pass |
| Exact-artifact package smoke | Pass on the final `.tgz` bytes (`94e27acf…`) without rebuild |
| Packed-artifact recovery smoke | Pass: export, target removal, restore, receipt replay, two restarts, healthy-target refusal, packed fault subset |
| Real `TypertGatewayService` | Pass on exact artifact with isolated DSH `0.2.1-rc.3` and `rc.4` graphs |
| Compatibility sentinels | Pass on `0.1.7-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4` |
| Seven-version full rerun | Pass via tracked `compat-matrix --versions all` (377/377 each) |
| Fresh Web profile matrix | PASS: exact artifact installed and served on DSH `0.1.7-rc.2`, `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4` |
| Untracked `0.2.2-alpha.2` probe | strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run; explicitly unsupported in rc.6 |
| Real browser recovery | Manual protected evidence gate; not automated |
| Real-model compaction | Separately recorded PASS (2026-10-22); still a manual release gate |

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
`dsh.compatibility.dshReleases` all declare the same seven exact versions:

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4
```

The tracked runner creates isolated pnpm projects with strict peers and runs typecheck/build/tests per version. Current evidence:

| DSH version | Evidence |
| --- | --- |
| `0.1.7-rc.2` | 377/377 tracked matrix PASS |
| `0.2.0-rc.1` | 377/377 tracked matrix PASS |
| `0.2.0-rc.2` | 377/377 tracked matrix PASS |
| `0.2.1-rc.1` | 377/377 tracked matrix PASS |
| `0.2.1-rc.2` | 377/377 tracked matrix PASS |
| `0.2.1-rc.3` | 377/377 tracked matrix PASS |
| `0.2.1-rc.4` | 377/377 tracked matrix PASS |

The current rc.6 source tree passed `compat-matrix --versions all` on 2026-10-30: every declared version passed typecheck, build, and 377/377 tests. Installs use pnpm strict peer resolution, exact tool pins, a single zod 4.6.7 graph, full `pnpm list --depth Infinity` graph validation, and recorded lockfile SHA-256 values. The untracked `0.2.2-alpha.2` probe is recorded as unsupported: strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run.

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
- Desktop ABI after restart and interaction/screen-reader behavior remain manual.
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

Detailed release-by-release changes are in `CHANGELOG.md`; published tags and GitHub Releases are immutable.

## 9. Cleanup

```bash
rm -rf .tmp
```

`.tmp/` is excluded from Git and the npm package.
