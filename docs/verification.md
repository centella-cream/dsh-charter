# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

> **Status:** Active — current operating record.
> **Version scope:** `0.3.4` draft-calibration release, published 2026-11-25; previous published `0.3.3` (2026-11-24); previous `0.3.2`.
> **Baseline:** 2026-11-23

Verification date: 2026-11-25. Current source/published version: `0.3.4`; previous published release is `0.3.3` (previous `0.3.2`). This is the current evidence record; historical per-commit narratives live in Git
history and the Changelog. Temporary directories, profiles, tarballs, and fetched HTML live under `.tmp/` and are
excluded from the published package.

- **Released:** `0.3.4` on 2026-11-25; npm `latest`/`next` and GitHub Release `v0.3.4`; tag `v0.3.4`; exact npm/GitHub tarball SHA-256 `954efd67217e7979a1c64553647a9fb7bb105f17d3442ffbdf58fcd3236acc41`, 7,594,915 B; Release candidate run `45582847333`; Promotion run `45584815676`; source/release commits `a5ca621` / `ecb8cc3`.
Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`. Local DSH development baseline:
`0.2.2-rc.5` (the current npm `latest`/`next`).

## 1. Current status (2026-11-25)

- Latest published release: `0.3.4` (npm `latest`/`next`, GitHub Release `v0.3.4`; exact artifact SHA-256 `954efd67…`, 7,594,915 B).
- Previous published release: `0.3.3` (SHA-256 `707043d3…`); earlier `0.3.2` (SHA-256 `9dcb82ae34eaaeb6d266bb98f3e1f92f3a0798042ce3dc282abe9173ff79e056`).
- Previous releases: `0.3.1`, `0.3.0`, `0.2.2`; published tags and bytes are immutable.
- Current source line: `0.3.4` draft-calibration release, published 2026-11-25. It adds opt-in calibration, additive Remote/apply fields, and keeps record schema 2 and the standing prompt/tool surface unchanged.
- Source gates on the current tree: `npm run check` (46 files / 567 tests), token coverage 41 static + 1 dynamic over 13 declared DSH versions, and `verify:ui-metrics --gate=final`.
- Compatibility: thirteen declared DSH versions are local-matrix verified (`.tmp/compat-13-034-final.json`, source `82d45bc`); latest DSH `0.2.2-rc.5` is the primary baseline. This is local evidence, not a CI claim. Fresh 0.2.2-rc.5 Web-profile install and 0.2.1-rc.3/rc.4 Gateway checks pass on the exact candidate.
- Post-release fresh exact CLI install in an isolated `DSH_HOME` resolved `dsh-charter@0.3.2` from npm and
  loaded client `6ef68d25…`, matching the published artifact.
- Published artifact: `dsh-charter-0.3.2.tgz` SHA-256
  `9dcb82ae34eaaeb6d266bb98f3e1f92f3a0798042ce3dc282abe9173ff79e056` (client `6ef68d25…`); tag/GitHub
  Release `v0.3.2` is public. Root `SHA256SUMS` matches; local professional profiles point to the same artifact.
  Exact-artifact package smoke and packed recovery smoke PASS.
- 0.3.2 root-text evidence: graph canvas scales as a unit at root font 16/24/32 px (scale 1/1.5/2); measured
  text has no new clipping and the viewport becomes horizontally scrollable. Evidence:
  `docs/assets/charter-graph-root-text-200-0.3.2.png`.
- Real AT/VoiceOver, final six-state screenshots, Desktop native-window matrix, and W0-1/W0-2 measurements
  remain known gaps. The 0.3.2 candidate/promotion completed.

### 0.3.2 residual gates

| Area | Current status | Evidence / next action |
| --- | --- | --- |
| A1 200% root text | implemented + measured (CDP-forced root font) | canvas scale 1/1.5/2; text scroll metrics unchanged; real browser font-size/min-font settings join A2 manual walk |
| A2 VoiceOver/NVDA | open | real AT walk of tabs/sheet/graph/meter/notice; not replaced by AX-tree checks |
| A3 six states + media | partial | empty/staged/applied/conflict-confirmation + forced-colors/reduced-motion captured; unknown/replay pending |
| A4 frozen mockup review | open | side-by-side human review record |
| A5 Desktop native window | open | Electron window/ABI matrix |
| A6 W0-1/W0-2 | open | breakpoint/column and line-capacity measurements after px geometry |
| B1–B6 docs/governance | this change | status headers, appendix D reconciliation, verification/index/tag cleanup |

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

## 1.2 0.3.0 GUI release (published 2026-11-13)

- Released `0.3.0` from `main`; candidate run `43360673386` (producer commit `0613ead…`), release commit
  `4331cbc…`, promotion run `43361855799`; tag and GitHub Release `v0.3.0` are public, npm `latest`/`next` are `0.3.0`.
  Branch/worktree are clean and pushed.
- Source gates (2026-11-12): `npm run check` = 39 files / **492 tests** PASS (typecheck, build, remote/client
  smoke, Vitest, token gate); `npm run verify:ui-metrics -- --gate=css|ia` PASS.
- Metric record (W1/W2/W4): CSS gate — `font-size` values 6, font weights 3, literal colors 0, non-token
  radius 0, non-token shadow 0, padding 9, gap 8, `!important` 0; IA gate — legacy objective card 0, legacy
  overview/stat/budget 0, `goSection` scroll/focus yes, action bar dirty-only yes; final gate PASS. The
  isolated profile and CDP matrix were captured under the installed livery layer (`body[data-dsh-livery]`
  present), dark and light; no second livery preset was available for a broader spot check. Record:
  `.tmp/gui-acceptance/2026-11-12/livery-spotcheck.md`.
- Token coverage audit (W0): 41 static host vars used by `charter.css` are defined in
  `@deepseek-ai/dsh-client-ui-theme` for **all 11 declared DSH versions**; `--dsh-content-font-size` has a
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
- 0.3.1 GUI convergence candidate (2026-11-13): `npm run check` 41 files / **499 tests** PASS;
  token coverage 41 static + 1 dynamic over 11 declared DSH versions PASS; eleven-version matrix PASS in
  candidate compatibility evidence (run `43445530821`). Shared standing-envelope builder
  (`src/core/standing-envelope.ts`) is used by both Host and Diagnostics; a 64-deliverable fixture with
  production-length ids proves the id cost is exactly 49 B/deliverable and the envelope stays under 32 KiB.
- `traffic-check` propose telemetry parses the actual JSON tool-result envelope (`{ok, message}`), not
  serialized text. Fixture now covers a single `D1` rejection, an unknown id, a non-requires proposal failure,
  and an accepted result: display-key=1, unknown-id=1, other=1, accepted=1. Raw `D1"}` contamination is gone.
- Graph browser audit (2026-11-13, Chromium 1440×1000, synthetic applied session): lane headings, 5 arrow
  markers, an SVG edge hit path with `vector-effect: non-scaling-stroke`, measured 21–22 px inside / 23 px outside the segment at 1440 px (44 px stroke), `max-height: none`, and no horizontal overflow at 860/900/1000/1100/1200/1440
  or at 200% page scale. At 1100 the app shell's content container is 813 px, below the 880 px graph-fold
  threshold, so the graph stays folded while the semantic list remains available; recorded as a layout
  observation, not a two-column W0-1 pass. Real VoiceOver/AT remains a manual gate.
- Traffic forensics (2026-11-13): `traffic-check` now counts `charter_propose` calls/rejections and classifies
  raw rejection values as display-key vs unknown-id, and reports active charter-surface hashes; `traffic-diff`
  compares before/after JSON baselines. This is local, read-only tooling; no runtime telemetry or upload exists.
- Legacy traffic baseline sample (2026-11-13): a 65,491-event / 234-turn pre-0.3 session reports 4
  `charter_read` calls (182 B total), 0 `charter_propose` calls, and 10 active `charter:standing` surfaces all
  byte-identical at 630 B (whole active runtime duplicate rate 95.3%). This is a 0.2.x sample used only to shape
  the 0.3.x baseline; it does not attribute duplicates to the plugin or claim a regression. Report:
  `.tmp/traffic-baseline/session-0651-0.2x.json` (local, not shipped).
- Diagnostics envelope UI (2026-11-13): shows exact estimated bytes, 32 KiB cap, item/deliverable counts,
  `maxPromptBytes`, id overhead, and 80%/over-cap states. Screenshot:
  `.tmp/gui-acceptance/2026-11-13/diagnostics-envelope-031.png`.
- 0.3.1 README screenshots were recaptured from the exact local build injected into the running Web app:
  `docs/assets/charter-pane-0.3.1.png`, `charter-pane-0.3.1.zh.png`, `charter-graph-0.3.1.zh.png`.
- 0.3.1 release publication (2026-11-13): candidate run `43445530821` at producer commit
  `de1b83be004aecc63b09cfaeaf647ca94fb7567a`; release commit `0c00715d85be0e873d43175a4a26b724ea6c14d4`;
  promotion run `43449411538`. Published artifact `dsh-charter-0.3.1.tgz` SHA-256
  `62fd230209dbf5c58aed09f0870775aa6d0d69feb4eff18aebf83f9803f28353`; npm `latest`/`next` both `0.3.1`, GitHub
  Release `v0.3.1` public and immutable. Candidate compatibility evidence covers 11 declared DSH versions,
  including `0.2.2-rc.3`.
- Local acceptance artifact (2026-11-13): `dist/dsh-charter-0.3.1.tgz` SHA-256
  `9f779443fd83c8e320d94d1981c18dc896d9d5905a7cc3f7dc8673f307806860`; exact-artifact package smoke and packed
  recovery smoke PASS. `dist/dsh-charter-0.3.1.tgz` (same bytes) is installed in local `web` and `desktop`
  profiles; both resolve client `fcd56a48…`. The Host version chip updates after a clean Host restart.
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

- Eleven-version source matrix (2026-11-13): all declared DSH versions `0.1.7-rc.2` … `0.2.2-rc.3` pass
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

## 1.3 0.3.2 accessibility/evidence release (2026-11-16, published with known gaps)

- Source: `npm run check` 42 files / **500 tests** PASS; token coverage PASS over 11 declared DSH versions;
  `verify:ui-metrics -- --gate=final` PASS; eleven-version source matrix PASS (`.tmp/compat-032-release.json`, source commit `0425a06`).
- A1 root text: graph canvas scales 1/1.5/2 at root font 16/24/32px; node text scroll/client metrics show no
  new clipping; the viewport is horizontally scrollable at 200%. Evidence:
  `docs/assets/charter-graph-root-text-200-0.3.2.png`.
- A3 state/media evidence: empty/staged/applied/conflict-confirmation captures (`docs/assets/charter-state-empty-0.3.2.png`,
  `docs/assets/charter-state-staged-0.3.2.png`, `docs/assets/charter-state-applied-0.3.2.png`, `docs/assets/charter-state-conflict-0.3.2.png`) plus forced-colors and reduced-motion captures (`docs/assets/charter-state-forced-colors-0.3.2.png`, `docs/assets/charter-state-reduced-motion-0.3.2.png`). The conflict-confirmation state is captured; the unknown/replay state still needs a final pass. The staged capture was re-taken with no prerequisite editor or stale bootstrap notice visible.
- A6 breakpoints: no horizontal page overflow, node overlap, or row overflow at 860/900/1000/1100/1200/1440;
  at 1100 the graphcard is folded because the app shell content container is below 880px, while the semantic
  list remains available — recorded as a layout observation.
- B: GUI design status/Appendix D reconciliation, dependency-graph status, verification current status,
  roadmap/docs-index pending wording, and local v0.3.0/v0.3.1 tags are cleaned up.
- A2/A4/A5 remain manual/blocked: VoiceOver launches but Apple Events/Accessibility authorization is absent, so
  no real AT claim is made; the frozen-mockup side-by-side sign-off is still human; native Desktop capture is
  blocked by macOS Screen Recording permission (`screencapture` reports `could not create image from display`).
  These gates are not marked complete without evidence.

## 1.4 0.3.3 structured draft and language following (2026-11-23, candidate)

- Source gates: `npm run check` = 44 files / 524 tests PASS; token coverage PASS; `verify:ui-metrics --gate=final` PASS.
- Structured extraction: sentence-boundary-only splits, oversized retention, >4x explicit truncation, exact/prefix folding, language tags, stable `d-*` refs; added to `tests/core/structured-bootstrap.spec.ts`.
- Host apply: `charter/bootstrapDraft` + `d-*` refs + objective `clientRef`; legacy `charter/bootstrap` and legacy clientRefs remain covered by the existing composition suite.
- Automatic language following: The first `bootstrapDraft` request returns the source draft with `language.status=pending`; the client renders it immediately and sends a second `awaitTranslation:true` request, which resolves the current session model in bounded batches with local streamed-text assembly, requires a complete strict-JSON `{items:[{ref,text}]}` response, and falls back to source text with an explicit `language.status` when the model is absent or invalid. Translation is batched by count/source bytes (12 items / 6000 B, at most four concurrent calls) so a 39-item draft does not hit a single response cap. Each batch has its own timeout and one split retry; failures keep source text and produce `language.status=partial`; an optional `languageFollowProvider`/`languageFollowModel` pair overrides the session model. Unit tests cover success, malformed output, max-tokens, missing refs, multi-batch merging, and partial merge; composition tests cover fake-model translation, translated apply, custom translation route, partial status, and `languageFollow: false`; client tests cover non-zh/en structured bootstrap, missing/failing-method fallback, and business-error propagation. A legacy golden fixture locks the 0.3.2 extraction output.
- Manual acceptance (2026-11-23): user confirmed the 39-item en→zh Desktop draft after the adaptive translation changes; zh→en was explicitly waived by the user and is covered by the automated target-zh translation test. README Pane/graph screenshots were recaptured from the live `v0.3.3` Desktop view.
- Legacy golden fixture contains 10 synthetic summaries (accepted deviation from the design's ≥10 real-summary target; real summaries were not available to commit).
- Candidate artifact `dist/dsh-charter-0.3.3.tgz` SHA-256 `707043d343e6a0b14d4549e6bb92b29f28fa197d99bb48160b796b4e50c8552f`; exact-artifact package smoke and packed recovery smoke PASS. Thirteen-version matrix PASS (`.tmp/compat-13-adaptive-final.json`, source `26353d2`; includes current DSH `0.2.2-rc.5`); Web and Desktop profiles install the same `707043d…` artifact and their 143 package files are byte-identical. The Web profile boots through the DSH `0.2.2-rc.5` CLI and reports `v0.3.3`; Desktop app is `0.2.2-rc.5`, but its profile is Electron-owned (CLI boot refused by design), so the native window remains a manual gate. This candidate was later published as `0.3.3`. The live en→zh case is user-confirmed; zh→en is automated-only by user decision. A live 39-item/7589-byte summary produced `translation finished with aborted` under the previous 10s background timeout; batching, per-batch timeouts with split retry, partial merge, a 60s background window, an optional dedicated translation route, and DeepSeek `reasoningEffort: off` are the fix and require re-running that manual case.
## 1.5 0.3.4 draft calibration (published 2026-11-25)

- Source gates: `npm run check` = 46 files / 567 tests PASS; token coverage PASS over 13 declared DSH versions; `verify:ui-metrics --gate=final` PASS.
- Implemented: opt-in calibration config/consent gate, Host `ctx.llm` one-shot strict JSON call, semantic aggregation/readable rewrite validation, `c-*` candidate refs with `mergedFrom`, trusted Host-only evidence excerpts, additive `applyBootstrap.calibrationRunId`, two new Remote methods and basic review UI (calibrate, uncertainty/merge/split badges, original excerpt, use-original, consent disclosure, objective warning, diagnostics usage).
- README/README.zh are concise current-build documents; 0.3.4 Pane screenshots crop the right-hand `.charter-root` at a 1440x1000 Web-profile viewport and the dependency graph crops the graph element at a taller viewport; both follow the system light theme and use README-language-matching UI and contract text (Chinese reuses the three Chinese deliverables from the `0.3.3` demo session because that live session cannot be opened concurrently from the Web profile); `package:smoke` now asserts localized `locale/en.json`/`locale/zh.json` metadata and that the description names the package version. Web Plugin Manager rendered the localized title/description and version note in both languages.
- v11 source candidate `dist/dsh-charter-0.3.4.tgz` SHA-256 `e86909fb8ba6fdfe1213a68868d0dc1e631619752ffa6957a81e07c598c8857b` (167 files); `npm run check` (46 files / 567 tests), 13-version source matrix (`.tmp/compat-13-034-final.json`, source `82d45bc`), exact-artifact package smoke, packed recovery smoke, fresh DSH 0.2.2-rc.5 Web profile install/serve smoke, and Gateway acceptance on DSH 0.2.1-rc.3/rc.4 (20 authorization checks each) PASS. Release-owner acceptance is recorded; A/B, zh→en, full L4 and desktop formal evidence are waived for 0.3.4. Candidate/promotion workflow is the remaining release step.
- P1-5 coverage closure (2026-11-24): also covers the calibration failure matrix (malformed/schema/text/tool-call/non-stop/timeout), explicit-effort rejection, and actual 0.3.2/0.3.3 record fixtures; actual 0.3.2 and 0.3.3-produced v2 record fixtures parse losslessly under the current strict schema; added calibration capability-state, cache/single-flight, 30-minute run-TTL, objective c-* exact-match, consent, mixed-namespace, missing/expired run, wire-evidence, run/handle, translation-fallback, mergedFrom, and oversized-split tests.
- P2 closure (2026-11-24): removed the unimplemented `calibration.trigger`/`calibration.cooldownMinutes` config and diagnostics UI; added a non-owner calibration Remote guard test; corrected the docs index to the retained 0.3.3 translation fallback and pending-release status; anchored the English disclosure copy to the shared `CALIBRATION_DISCLOSURE` constant.
- Plugin detail localization verification (2026-11-25): using the installed DSH 0.2.2-rc.5 `@deepseek-ai/dsh-plugin-detail` selector, the unmodified package resolved `zh-CN` to `README.md` and `en-US` to `README.md`; fallback README discovery does not include `README.zh.md`. Added `meta.detail` to `locale/zh.json` (`README.zh.md`) and `locale/en.json` (`README.md`); the same selector now resolves `zh-CN` to `README.zh.md` and `en-US` to `README.md`. The filename is unchanged; package smoke validates both detail paths.
- Deferred effect limitation (2026-11-25): a completed/no-pending Session summary (real `dsh-livery` session `16c…`, `Pending Jobs: (none)` and `0.1.8 fully published`) still produced a historical objective and completion/evidence candidates. The user deferred this to 0.3.5; it is not a 0.3.4 release blocker.
- Release-owner acceptance (2026-11-25): the Web profile calibration flow (including the localized draft and review UI) was manually accepted as working. The release owner also waived A/B protocol 1/2, zh→en manual acceptance, the full L4 matrix and Desktop formal hot-update evidence for 0.3.4; the remaining release work is the candidate/promotion workflow. No tag/npm/GitHub Release existed at the time of this record.
- Post-waiver validation (2026-11-25): A/B protocol 1/2 are waived by the release owner (blind protocol not applicable to an opt-in manual draft rewrite; no effect claim). English-source → Chinese draft was manually accepted; Chinese → English manual acceptance waived. Added a host integration test proving a 3-batch calibration run makes zero Session `append` calls (transcript isolation). An enriched record fixture with calibration evidence parses under both the current schema and the extracted 0.3.3 schema, giving the reverse downgrade direction schema evidence. `npm run check` = 46 files / **567 tests**; artifact remains `e86909f…`; full L4 matrix, desktop formal hot-update acceptance and release workflow remain.
- v11 objective/quota optimization (2026-11-25): the new export's latest summary (`seq 44692`) shortened the objective to only an out-of-scope clause and capped a real gate/commit deliverable. The Host now falls back to the source objective when stable anchors are missing and selects all contract deliverables before invariants. Same summary: exact source objective retained; 4/4 batches; 5 calls; 7,555 output tokens; 38.2 s; 1 objective / 18 deliverables / 12 invariants; model-omitted gate/commit deliverable restored from source; one invariant capped and one model-omitted invariant visible. `npm run check` 46 files / **567 tests**; matrix 13/13 source `82d45bc`; artifact `e86909f…` (167 files); package/recovery/profile/Gateway/UI smokes PASS.
- v10 review remediation (2026-11-25): Remote calibration business failures now return a domain `CharterCalibrationFailure` and the client surfaces `CharterCalibrationCallError`; isolated Host consent v1 returned `CALIBRATION_CONSENT_REQUIRED` as a domain value rather than `gateway/internal`. objective/deliverable kinds follow source provenance; extra objectives enter `conflicts`; v8 batch/conflict diagnostics are on the strict wire and the Pane renders conflicts. contractness retains mandatory Tests/Coverage/decision-authority lines; degraded parts are remapped after global renumbering; user-guide and §5.7/§5.8/§8/§9 cache/retry/progress claims are aligned. `npm run check` = 46 files / **567 tests**; 13 versions PASS (`.tmp/compat-13-034-final.json`, source `82d45bc`); final artifact `e86909f…` (167 files) passes package/recovery/profile/Gateway/UI smokes. Same real-summary check: 3/3 batches, no truncation, 1 objective, 10 deliverables, 8 invariants, 17 non-contract refs, 5 calls, 6,499 output tokens, 28.1 s. This remains engineering evidence; formal A/B and human gates are pending.
- v9 contract-quality validation (2026-11-24): the real `85809bdb…` summary showed v8 excluding the objective and four deliverables and retaining heading/status/optional material. v9 adds a deterministic contractness gate, objective/deliverable quotas, prompt v2 and output filtering; the same summary now produces 19 candidates (1 objective / 11 deliverables / 7 invariants), 3/3 batches, 3 calls, 5,216 output tokens, 11.1 s, `truncated=false`, with 18 non-contract refs explicitly excluded. T-1/T-2/T-3 are deliverables; heading/status/optional candidates are gone. Exact T-3 config facts remain atomic invariants; a bounded reduce pass is a follow-up.
- Calibration design rework (2026-11-24): a real Web 10-turn + `/compact` run showed the v7 single-call implementation fails default 2048 output (`max-tokens`) and truncates a 32-item draft to 12 calibrated candidates. v8 adaptive batches (planner/runner/reduce) are now implemented; the same 10-turn case passes with default parameters (3/3 batches, 24 candidates, no truncation, 15.2 s), documented in [research/2026-11-24-calibration-ab](research/2026-11-24-calibration-ab/report.md). Partial/truncated UI status and disclosure v2 are implemented; formal A/B, L4/AT, old-profile downgrade and manual gates remain; the candidate is **not release-ready**.
- Review hardening (2026-11-24): 0.3.3 language normalization now always runs as the automatic fallback and calibration uses the preserved L1 source handle; calibration is hidden outside zh/en; calibration runs are bound to their source draft handle; mergedFrom excerpts are wired into the per-item diff disclosure; added consent, mixed-namespace, missing-run, run/handle, wire-evidence, mergedFrom, and translation-fallback tests; calibration is owner-only on the Remote path; excerpt truncation/degraded thresholds and joined/state reset were corrected.
- Not yet complete: formal blind A/B protocol-1/2, full L4 UI/AT evidence (including batch partial notice), P5 transcript isolation across **all batches**, the complete 13-version real-Host capability/failure matrix (M0-P3, including batch concurrency/abort P9), real old-profile downgrade validation, and real-model/manual calibration acceptance. The v8 kernel and default-parameter 10-turn run are complete; known deviations are documented in the calibration plan: effort enumeration/call cancellation are reserved, and the per-ref suppressed selection set is MVP whole-list replacement. Calibration remains disabled by default.
- Desktop gate status (2026-11-25): the latest 0.3.4 files are installed in the local Desktop profile and the user reviewed the latest real-summary draft as acceptable. This is **not yet a recorded formal hot-update acceptance**: the Desktop Plugins install/reload evidence and full acceptance remain a human gate. Never terminate or signal the Desktop app/Host to force this gate.
