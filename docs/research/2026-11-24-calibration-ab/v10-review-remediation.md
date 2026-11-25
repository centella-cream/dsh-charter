# v10 review remediation

> **Status:** Implemented — pending release acceptance
> **Version scope:** 0.3.4 development candidate
> **Baseline:** v9 source `60c28a5` / v10 implementation `78fcc19`
> **Authority:** the user's 0.3.4 v8/v9 implementation review (P1/P2/P3 items)
> **Supersedes / Superseded by:** supersedes the v9 review findings in this directory; no later supersession.

## P1 fixes

1. **Business error visibility** — `charter/calibrateBootstrap` now catches `CharterError` asynchronously
   and returns a domain `CharterCalibrationFailure { ok:false, code, message }`; the strict wire schema
   accepts it; the client source converts it to `CharterCalibrationCallError`; the Pane shows the business
   code and message. Transport/infrastructure errors still remain Remote errors.
2. **objective/conflicts** — objective and deliverable kinds follow source provenance; an invariant merged
   from an objective ref becomes the objective, and a deliverable-sourced split becomes a deliverable.
   Objective candidates are accepted only from the batch that carried objective input; extra objectives
   become `conflicts`. The wire exposes v8 `batchCount`/`partial`/`excludedRefs`/`conflicts`/`usage.calls`;
   the Pane renders the conflicts status line.

## P2/P3 fixes

- user-guide now documents consent v2 and all v9/v10 calibration defaults (`maxCandidates=32`,
  `batchCandidates=8`, per-batch `maxOutputTokens=4096`, `maxTotalOutputTokens=16384`, concurrency,
  retry/timeout).
- §5.7/§5.8/§8/§9 no longer promise batchKey cache, per-batch retry, or per-batch progress; those are
  explicitly future gates. The implemented cache remains run-level.
- contractness status/history matching now exempts hard-invariant and imperative lines, so
  `Tests must pass`, `Coverage must stay …`, and `User decision authority remains …` are retained.
- degraded split parts are matched by `degraded.parts` after global renumbering, not the old
  `ref.startsWith('c-R.')` assumption.
- §5.5.6's old "Host does not treat non-contract text" sentence is corrected to the v9 double gate.
- 25% wording aligned to the implemented ~30% deliverable quota.
- candidate limit has a bounded split margin so a legitimate compound split does not immediately become
  `CALIBRATION_SCHEMA`.

## Verification

- `npm run check`: 46 files / **566 tests** PASS.
- 13-version source matrix: 13/13 PASS, source `78fcc19`
  (`.tmp/compat-13-034-v10-p3.json`).
- exact artifact: `dist/dsh-charter-0.3.4.tgz` SHA-256 `e86909fb8ba6fdfe1213a68868d0dc1e631619752ffa6957a81e07c598c8857b`, 167 files.
- isolated real-summary host check (same `85809bdb…` summary, no user record mutation):
  - consent v1 → Remote **domain failure** `CALIBRATION_CONSENT_REQUIRED` (not `gateway/internal`);
  - consent v2 → 3/3 batches, no truncation, 1 objective, 10 deliverables, 8 invariants,
    17 non-contract refs, 5 calls, 6,499 output tokens, 28.1 s;
  - T-1/T-2/T-3 are deliverables; objective retained; no heading/status/optional candidates.
- exact-artifact package smoke, recovery smoke, fresh-profile Web smoke, Gateway acceptance on
  0.2.1-rc.3/rc.4 and `verify:ui-metrics --gate=final` PASS after the final pack.

## Plugin detail localization verification

DSH 0.2.2-rc.5 `@deepseek-ai/dsh-plugin-detail` does **not** select localized README files by suffix: its fallback list is only `README.md`, `readme.md`, `Readme.md`, `README.markdown`, `README`. Chinese detail is selected by `meta.detail` in `locale/zh.json` (English chain falls back to `locale/en.json` or README). The previous `README.zh.md` filename is therefore unchanged; `locale/zh.json` now points to it with `meta.detail: "README.zh.md"` and `locale/en.json` points to `README.md`. The package smoke now requires both `meta.detail` values to name packaged Markdown files.

## Residual / recorded P3

- **Conflict provenance:** fixed after review. `conflicts.refs` now contains L1 merged-from refs (or an
  empty set for a model-invented objective without provenance), never batch-local `c-<i>` refs. Regression
  test asserts every conflict ref starts with `d-`; the Pane still renders the conflict count.
- **Quota wording:** §5.12 now says 30% (ceil), matching the implementation.
- **A/B data in package:** the synthetic research data and test session ids remain in npm files; accepted
  and recorded, not a release blocker.
- Exact T-3 configuration facts remain atomic invariants; duplicate 151-no-execution constraints can
  remain across phrasing. Bounded semantic reduce remains a future quality optimization.
- Batch-level cache, per-batch retry and per-batch progress are documented future gates, not shipped.

## Post-review optimization (v11, 2026-11-25)

The new export's latest summary (`seq 44692`) exposed two further quality gaps:

1. calibration shortened the objective to only “Harbor 0.22.0 upstream defects are out of scope”,
   dropping the primary “fix remaining 0.3.4 blockers before 151 rerun” clause;
2. planner quota left a real gate/commit deliverable (`d-del-12`) in `global-cap`.

Changes:

- objective candidates are checked against the source objective; if they lose stable anchors
  (numbers/versions/proper nouns) or are materially shorter, the Host falls back to the source
  objective text with source provenance. Regression test covers the shortened-objective case;
- planner now selects all contract deliverables before filling invariants (with a small invariant
  floor), fixing the previous slice end-index bug; `d-del-8`-style “must” requirements stay
  deliverable unless they are prohibitions; status-like “just changed” notes are filtered.

Final real-summary run (same latest summary, isolated Host):

| Metric | v10 | v11 |
| --- | ---: | ---: |
| objective | truncated to out-of-scope clause | **exact source objective** |
| candidates | 26 | 31 |
| deliverables | 10 | 18 (planner selected all; source fallback restores model-omitted `d-del-12`) |
| batches | 4/4 | 4/4 |
| calls / output tokens / time | 5 / 11,504 / 30.4 s | 5 / 7,555 / 38.2 s |
| `truncated` | true; 6 global-cap | true; 1 invariant global-cap + 1 invariant model-omitted; no deliverable lost |

`truncated=true` remains honest because one lower-priority invariant is capped and one is model-omitted; a model-omitted deliverable is restored from source;
the key deliverables and objective are retained.

Evidence: `npm run check` 46 files / 566 tests; matrix 13/13 source `82d45bc`
(`.tmp/compat-13-034-final.json`); artifact `e86909f…` (167 files), package/recovery/profile/Gateway/UI
smokes PASS.
