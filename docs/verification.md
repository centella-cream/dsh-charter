# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

> **Status:** Active — current operating record.
> **Version scope:** `0.2.2` released 2026-11-11.
> **Baseline:** 2026-11-11

Verification date: 2026-11-11. Current source version: `0.2.2` (published 2026-11-11). This is the current evidence record; historical per-commit narratives live in Git
history and the Changelog. Temporary directories, profiles, tarballs, and fetched HTML live under `.tmp/` and are
excluded from the published package.

Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`. Local DSH development baseline:
`0.2.2-rc.2` (the current npm `next`).

## 1. Current conclusion

Current release state (2026-11-11):

- Published: `0.2.2` (npm `latest`/`next`; exact SHA-256 `ccb094342ceda030b77c2c3555bc2838ee8a4f6ef2efe4f1ac80a9d39fca7875`). GitHub Release `v0.2.2` is public and immutable.
- `0.2.1`: previous public release; GitHub Release `v0.2.1` remains immutable.
- `0.2.0`: earlier public release; GitHub Release `v0.2.0` remains immutable.
- `0.1.0-rc.6`: earlier public release; recovery tag `v0.1.0-rc.6-republished`.
- Versioning from 0.2.0 onward uses plain increments and never an `rc` suffix.
- Current source evidence: 37 files / 475 tests on the final 0.2.2 tree at `f9d93c0`; the nine-version matrix passes 475/475 on that tree (Node `v22.23.1` / pnpm `12.3.4`, evidence `.tmp/0.2.2-final-matrix2.json`).
- Post-release diagnostics: real-model compaction PASS (session `session-da7e7b0d-f0b0-49a2-8391-148b4782892c`); 512-item performance PASS on 2026-11-06 (core read/planning p95, see below).

| Item | Result |
| --- | --- |
| Strict TypeScript check | Pass on the current tree |
| Vitest | 37 files / 475 tests pass (`npm test`, which builds first) |
| Host ESM build + browser factory bundle | Pass |
| Remote contract and client smoke | Pass |
| Normal package smoke | Pass |
| Exact-artifact package smoke | Pass on the published `0.2.1` `.tgz` bytes (`d4ae14e1…`) from the root `SHA256SUMS`, without rebuild |
| Packed-artifact recovery smoke | Pass: export, target removal, restore, receipt replay, two restarts, healthy-target refusal, packed fault subset |
| Real `TypertGatewayService` | Pass on exact artifact with isolated DSH `0.2.1-rc.3` and `rc.4` graphs |
| Compatibility sentinels | Pass on `0.1.7-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4`, `0.2.1-rc.5` |
| 0.2.2 promotion | PASS on 2026-11-11: release candidate run `43024720739` (C `51789db`), checksum-only C+1 `d65a4d6`, promotion run `43026165062`; npm `latest`/`next` both `0.2.2`, GitHub Release `v0.2.2` public with tarball `SHA256SUMS` and `release-evidence.json`. |
| 0.2.2 exact artifact smoke | PASS on 2026-11-11: published `dsh-charter-0.2.2.tgz` (98 files, SHA-256 `ccb094342ceda030b77c2c3555bc2838ee8a4f6ef2efe4f1ac80a9d39fca7875`); package smoke installed the exact bytes in an empty consumer and the packed recovery smoke passed all export/restore/two-restart/fault checks. |
| Nine-version full rerun | Pass via tracked `compat-matrix --versions all --allow-new-release` (475/475 each) |
| Fresh Web profile matrix (historical rc.6) | PASS: local rc.6 artifact (pre-withdrawal) installed and served on DSH `0.1.7-rc.2`, `0.2.0-rc.2`, `0.2.1-rc.2`, `0.2.1-rc.4`, `0.2.1-rc.5` |
| Fresh Web profile (historical 0.2.2 DSH / 0.2.0 plugin) | PASS on 2026-11-05: fresh `DSH_HOME` + `dsh@0.2.2-rc.1 plugin --profile web add` of `dsh-charter-0.2.0.tgz` (SHA-256 `fde5531d457effc713f4423f8b46c8f0e591770e59c55e19956f000c11bdeffc`); Web boot, page HTTP 200, charter bundle HTTP 200; boot graph contains `dsh-charter` and the page index contains `dsh-charter/client.js` |
| Untracked `0.2.2-alpha.2` / `0.2.2-alpha.3` probes | strict-peer install fails because these alpha lines require a Cordis 4.0.6 alpha graph; the 0.2.2-rc.1 line pins Cordis 4.1.0; no tests run; explicitly unsupported. |
| 0.2.1 real Web Pane | PASS on 2026-11-06: local Web profile installed the `0.2.1` candidate artifact; Pane reports `v0.2.1`, diagnostics/recovery cache and the editable message proposal render, and the browser console is clean. |
| 0.2.1 local human acceptance | PASS on 2026-11-06: user completed local acceptance of the 0.2.1 UI/interaction batch. |
| 0.2.1 Desktop ABI | PASS on 2026-11-06: Desktop profile installed the exact candidate, the Electron process was restarted, and the Pane/tab ABI was confirmed. |
| 0.2.2 compatibility matrix | PASS on 2026-11-11: source `f9d93c031eabfe5e44cf17e302729eb7093d7e94`, Node `v22.23.1` / pnpm `12.3.4`; all nine declared DSH versions passed typecheck, build, and 475/475 tests (`.tmp/0.2.2-final-matrix2.json`). |
| 0.2.2 fresh profile install | PASS on 2026-11-11: isolated `DSH_HOME=/tmp/dsh-charter-fresh-022-home` initialized a fresh Web profile and installed the exact local `dsh-charter-0.2.2.tgz`; `dsh web` served the Pane entry (HTTP 303 token redirect). CLI/tarball path verified; Desktop, real Pane interaction, and zh/en switch remain manual. |
| 0.2.2 dependency graph source | PASS on 2026-11-11: `npm run check` 37 files / 475 tests; W0-0 prototype 41/41 (pre-isolated-grid contract; product isolated-grid tests are in `tests/client/relation-graph.spec.ts`); Web Pane rendered the graph, candidate lane, inspector, and always-present semantic list for a session with 3 active + 4 pending deliverables; browser console clean. UI self-check on 2026-11-11: isolated three-node graph + empty hint, compact list, add-edge/hide/show, and local-key prerequisite summary all rendered without console errors. W0-1/2/3 and real AT/manual gates remain pending. |
| 0.2.2 dependency graph bundle | Measured on 2026-11-11 against `d362d6f` with the standardized budget method `gzip -9 -c lib/client.js | wc -c`: 113,990 → 130,474 B (+16,484 B), so the `<40 KB` gzip budget passes. Raw diagnostic: `lib/client.js` 591,936 → 670,173 B (+78,237 B); raw CSS output 47,230 → 55,540 B (+8,310 B). Raw bytes are not the budget channel. |
| Real-model compaction | PASS on 2026-11-06 for `session-da7e7b0d-f0b0-49a2-8391-148b4782892c`: latest compaction seq 32610–32614, post-compaction snapshot seq 32623, `charter_read` call/result seq 32631/32632; injected, digest match, injection-after-compaction, survival, authenticated standing read, and no-checkpoint-leak all pass. |
| 512-item performance | PASS on 2026-11-06, local Node `22.23.1`: 512 pending items, 300 warm-ups then 30 samples; full pagination query p95 5.2 ms and 5-op Change Set planning p95 0.6 ms against the 100 ms budget. This measures the pure core read/planning path, not UI/network. |
| Real browser diagnostics | Local manual checks recorded; not a release gate |
| Real-model compaction | Separately recorded PASS (2026-10-22); still a manual release gate |

### 1.1 0.2.0 development acceptance

The `main` tree has passed source-level acceptance for the implemented workspace core:

- record v2 write path and in-memory v1 migration;
- dependency `requires` validation, derived readiness, and dependency-aware prompt equivalence;
- three-area Pane information architecture and dependency editor;
- proposal-batch provenance, objective-proposal lifecycle, summary/item/proposal/change query endpoints, `watchSummary`, and pending-only `charter_propose`;
- `npm run check`: 36 files / 441 tests;
- nine-version DSH matrix: 475/475 on every declared version;
- normal package smoke: `dsh-charter-0.2.0.tgz` installs and its client factory bundle loads.

This is source acceptance, not a release acceptance: real Desktop/browser diagnostics, real-model compaction, performance,
and the remaining full-design gates must be recorded separately before declaring `0.2.0` stable. The Pane uses `watchSummary` plus paged queries with a full-watch compatibility fallback; the network layer still fetches all pages, so the 512-item performance gate remains separate.

## 1.2 0.3.0 GUI development candidate (unreleased, local acceptance pending)

- Branch `feat/0.3.0-gui`; W6 implementation commits `f3ac8f2`/`2ad1df3`/`bb576cd`/`840d202` plus follow-up docs are committed and the
  worktree is clean at audit time. **Not pushed/merged/tagged/published**; no `0.3.0` availability claim.
- Source gates (2026-11-12): `npm run check` = 39 files / **492 tests** PASS (typecheck, build, remote/client
  smoke, Vitest, token gate); `npm run verify:ui-metrics -- --gate=css|ia` PASS.
- Metric record (W1/W2/W4): CSS gate — `font-size` values 6, font weights 3, literal colors 0, non-token
  radius 0, non-token shadow 0, padding 9, gap 8, `!important` 0; IA gate — legacy objective card 0, legacy
  overview/stat/budget 0, `goSection` scroll/focus yes, action bar dirty-only yes; final gate PASS. The
  isolated profile and CDP matrix were captured under the installed livery layer (`body[data-dsh-livery]`
  present), dark and light; no second livery preset was available for a broader spot check. Record:
  `.tmp/gui-acceptance/2026-11-12/livery-spotcheck.md`.
- Token coverage audit (W0): 41 static host vars used by `charter.css` are defined in
  `@deepseek-ai/dsh-client-ui-theme` for **all 10 declared DSH versions**; `--dsh-content-font-size` has a
  `14px` fallback; the compat block is intentionally empty. Gate: `npm run verify:tokens`.
- Real-browser evidence (CDP-injected new bundle into the installed Web Host; explicitly **not** the same as an
  installed artifact unless stated): multi-width 320/375/560/850/1440, dark/light, forced-colors,
  reduced-motion, page-scale 2x; AX tree named region/no nested `main`/no unnamed buttons/named dialog; real
  host scroll/focus routing and narrow-sheet Escape/focus restore.
- Isolated-profile evidence: a WIP artifact of the current tree was installed into
  `DSH_HOME=/tmp/dsh-w4-home` and its `lib/client.js` hash matched the repo build; the dev tarball named
  `dsh-charter-0.2.2.tgz` was **deleted** after review because it collided with the published immutable 0.2.2
  artifact/digest. Future dev packs must bump the version (e.g. `0.3.0`) before packing.
- Release publication (2026-11-13): candidate run `43360673386` at producer commit
  `0613ead1ffbf73b47c54a767aa09c3c5d257bf32`; release commit `4331cbc21f46be910e74e7b65c6a76bffcbebb88`; promotion
  run `43361855799`. Published artifact `dsh-charter-0.3.0.tgz` SHA-256
  `31daf17dbc823837c1b0c1ba7bc1033444db1059a2f2cd6f1a481f8d330b5d78`; npm `latest`/`next` both `0.3.0`, GitHub
  Release `v0.3.0` public and immutable. This supersedes the local `w6-final` development artifact for installation.
- Local acceptance deployment (2026-11-12): the W6 acceptance build is
  `dist/dsh-charter-0.3.0-w6-final.tgz` (SHA-256 `ab74591c…`, client `986f8403…`). It is installed in both local
  `web` and `desktop` profiles, with the bounded `engines.dsh` range and package version `0.3.0`. Also updated:
  the Pane header version chip (`v0.3.0`) is restored at the user's request.
- Desktop hot reload (2026-11-12, corrected): Desktop does **not** require a quit/reopen to load a rebuilt
  `dsh-charter` bundle. With the installed profile, a profile dependency replace was observed to swap the
  running Pane in a CDP-driven page at `127.0.0.1:51452` without a page reload: a bundle probe appeared in
  **824 ms**, a CSS probe was applied in **402 ms**, and the final bundle+CSS state appeared in **886 ms**. Across
  both swaps `.charter-tabs__tab` stayed at 3, exactly one `style[data-plugin-css="dsh-charter/charter.css"]`
  remained, the version chip and Pane stayed mounted, and no page exceptions were recorded. This is the
  Host profile recomposition + client bundle HMR path; no Host restart is needed for a plugin-only change.
- Disclosure affordance (2026-11-12): the execution-path `details` summary names `Expand dependency map` when closed and `Collapse dependency map` when open; verified closed → open → closed without duplicate sections.


- Final-build matrix (2026-11-13): from the installed `w6-final` artifact (client `986f8403…`), Review Center was
  recaptured at 320/375/560/850/1440 × dark/light × zh/en (20 images) plus Diagnostics at 850/1440; every capture
  had `documentElement.scrollWidth == clientWidth`, three `charter-tabs__tab` entries, and a mounted Pane. Evidence:
  `.tmp/gui-acceptance/2026-11-13/matrix-final/`. This replaces the pre-W6 matrix for the Review/Diagnostics subset; final-build dirty and graph states were also
  captured at 1440 from synthetic staged rows. Empty/Applied/Conflict states and the frozen-mockup side-by-side
  are still missing.


- Final-build special evidence (2026-11-13): forced-colors, reduced-motion and page-scale-2 screenshots were recaptured from `w6-final` at 1440: Pane mounted, no horizontal overflow, three tabs; media emulation matched. Evidence: `.tmp/gui-acceptance/2026-11-13/final-special/`. This is a page-scale proxy, not a full 200% text-layout or keyboard/AT audit.


- Mechanical mockup comparison (2026-11-13): `dirty-mockup-vs-final.png` and `graph-mockup-vs-final.png` were composed from the frozen mockups and the `w6-final` build under `.tmp/gui-acceptance/2026-11-13/side-by-side/`; this is reference material only, not the human side-by-side review, and empty/applied/conflict captures remain missing.

- Ten-version source matrix (2026-11-12): all declared DSH versions `0.1.7-rc.2` … `0.2.2-rc.2` pass
  typecheck, build, and tests; run with `--allow-new-release` because rc.2 is inside the pnpm 24-hour
  `minimumReleaseAge` window. The tracked rc.2 compatibility lockfile was generated and added. Evidence:
  `.tmp/compat-matrix-0.3.0.json`.
- Compatibility-range strategy: `engines.dsh` is now `0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0`. DSH evaluates that
  range with `includePrerelease` and ignores peers when `engines.dsh` is present, so future 0.2.x prereleases
  install without a plugin rebuild; `0.3.x` is excluded. The exact peer/`dshReleases` list remains the verified
  ten-version matrix; new versions are probed with `compat-matrix --discover` before being added to it.
- Pane page split (2026-11-12): `CharterPane.tsx` 3459 → 1842 lines; new `WorkspacePage`, `ReviewCenterPage`,
  `DiagnosticsPage` and generated `pane-scope.ts`; shared `pane-format`/`pane-ui`; real-browser v0.3.0 three-area
  route check; 492 tests and final gate PASS.
- W6 document-feel visual freeze (2026-11-12): underline tabs replace the left rail; 720px document column + 280px Change Set rail at ≥1100; section/row anatomy, dashed 36px empty add rows, 40/16/16 skeleton, single-line notice, quietlinks, staged inset language and px-geometry graph (184px nodes, three-layer anatomy, legend, compact inspector). `charter.css` now consumes 41 audited static host tokens; `npm run check` 39 files / 492 tests PASS; `verify:ui-metrics -- --gate=final` PASS. CDP-injected screenshots: `.tmp/gui-acceptance/2026-11-12/ux-after-workspace-1440.png`, `w6-dirty-1440.png`, `w6-graph-1440.png` and nine-node overlap regression `w6-graph-9nodes.png`, `w6-review-1440.png`, `w6-diagnostics-1440.png`. CDP viewport measurements: 320/850/1440 root and document horizontal overflow 0; graph hidden at 320/850 and visible at 1440; node text at user font preferences 10/14/22 has equal scroll/client width and height (no clipping). Human before/after sign-off remains pending.
- Still manual/blocked before release: fresh-profile Host+Session Pane, Desktop window, real screen reader,
  true 200% text-layout audit, zh/en switch, livery spot-check record, and all human acceptance (W1–W6).

## 2. Local baseline

```bash
npm run check                 # typecheck + build + remote/client smoke + Vitest + token gate
npm run smoke:package         # normal pack + consumer install
npm run smoke:package -- --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/recovery-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/gateway-smoke.mjs --artifact <tgz> --sha256 SHA256SUMS
node scripts/verify/compat-matrix.mjs --versions minimum,old-boundary,current
```

CI (`.github/workflows/ci.yml`) runs `npm run check` and normal `npm run smoke:package` on Node `22.19.0` and
`24`. Exact-artifact mode, compatibility sentinels, Gateway acceptance, and real-model compaction are
separate jobs or manual gates, not claims made by `npm test` alone.

## 3. DSH compatibility evidence

`package.json` `engines.dsh`, every `@deepseek-ai/dsh-*` peer range, and
`dsh.compatibility.dshReleases` all declare the same nine exact versions:

```text
0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5 || 0.2.2-rc.1
```

The tracked runner creates isolated pnpm projects with strict peers and runs typecheck/build/tests per version. `--allow-new-release` sets only the isolated workspace `minimumReleaseAge: 0` so a just-published exact DSH version can be tested inside the 24-hour window; it does not relax strict peers, does not affect user installs, and is not a release-policy exemption. Current evidence:

| DSH version | Evidence |
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

The 0.2.2 candidate tree at source commit `f9d93c031eabfe5e44cf17e302729eb7093d7e94` passed
`compat-matrix --versions all --allow-new-release` on 2026-11-11 with Node `v22.23.1` / pnpm `12.3.4`: every
declared version passed typecheck, build, and 475/475 tests. The local evidence file is
`.tmp/0.2.2-final-matrix2.json`. Installs use pnpm strict peer resolution, exact tool pins, a single zod 4.6.7 graph, full `pnpm list --depth Infinity` graph validation, and recorded lockfile SHA-256 values. The untracked `0.2.2-alpha.2` probe is recorded as unsupported: strict-peer install fails because DSH requires Cordis ~4.0.6-alpha.1 while rc.6 pins 4.0.5; no tests run.

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

- Real browser export → absent target → restore → reload/restart is an optional diagnostic check. It is not a
  promotion gate and is not automated by a tracked browser script.
- Web and Desktop share the same `dsh.client` bundle through the host client-module carrier. The installed Desktop app is `0.2.2-rc.1`, and the local Desktop profile carries the 0.2.0 development artifact. Real Electron ABI/interaction acceptance remains a manual gate.
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
