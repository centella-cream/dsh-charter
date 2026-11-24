# v9 calibration-contract-quality plan

> **Status:** Implemented — implementation and real-summary validation completed 2026-11-24.
> **Scope:** calibration preprocessing, planner selection, prompt, output filtering and tests; no record-schema change.
> **Baseline:** 0.3.4 v8 implementation, 2026-11-24.

## Observed failure

The real 10-round-class summary produced:

- L1: 23 invariants + 13 deliverables + 1 objective.
- Calibration: 32 candidates, 4/4 batches, `truncated=true`, 5 refs excluded.
- Objective and four deliverables were excluded by the global cap.
- Heading fragments, progress/status, historical context, pending decisions and optional suggestions survived as high-confidence contract items.
- T-3 was split into a parent fragment plus configuration fragments; T-1/T-2/T-3 were classified as invariants rather than work items.
- Cross-batch merge only collapses exact canonical text; it cannot merge semantically related fragments.

## v9 changes

### 1. Contractness gate (Host, deterministic)

Before planning, classify every L1 item:

- **fragment/heading**: text ends in `:`/`：`, has no complete predicate, or is a bare label.
- **status/progress**: current/implementing/done/completed/blocked, git status/HEAD, test/gate counts, coverage figures, “latest known”.
- **historical/context**: previously/rejected/goal state/decision authority/delegated/last instruction.
- **optional**: suggested/optional/nice-to-have/maybe/could.
- **pending decision**: need confirm/TBD/open question.
- **action item**: `T-n`/`D-n`/`F-n` with an imperative verb → reclassify as deliverable.
- **durable invariant**: must/never/always/should-not/numeric/path/code constraints.

Filtered items are not silently discarded: they go to `excludedRefs` with a `non-contract` reason. The original L1 draft remains visible.

### 2. Planner quotas and objective reservation

- Objective is selected before the cap and never excluded by global-cap.
- Reserve deliverable slots (at least 25% of `maxCandidates`, capped by available deliverables) before filling with invariants.
- Fill remaining slots with contract invariants, then extra deliverables.
- `inputTruncated` only reflects cap/budget cuts of contract items; non-contract filtering does not make the contract incomplete.
- Batch formation starts from the quota-selected list.

### 3. Prompt v2 (contract-only)

The prompt must explicitly:

- emit only durable contract items;
- drop headings, status/progress, git/test/gate evidence, historical narrative, decision history, optional suggestions and pending questions;
- merge related fragments into one complete item;
- allow fewer results than input; do not preserve an input item merely because it exists;
- convert action items (`T-1` etc.) to deliverables;
- keep a coherent requirement intact unless it contains independent obligations.

Bump `CALIBRATION_PROMPT_VERSION` to 2 (cache invalidation).

### 4. Output contractness filter

After model output:

- drop candidates that are fragments/status/history/optional/pending;
- reclassify action-like invariants as deliverables;
- record dropped source refs in `excludedRefs` with `non-contract`;
- never fail the whole run for filtered noise; only malformed/schema/invalid text remains a batch failure.

### 5. Cross-batch merge

- Keep exact canonical dedupe.
- Add deterministic grouping under the same `T-n`/`D-n`/`F-n` label where present.
- If the experiment still shows semantic fragmentation, add one bounded reduce call only for candidate groups that remain fragmented; this is measured before enabling by default.

## Tests

- synthetic fixture with heading/status/context/optional/action/T-3 fragments;
- objective and deliverables survive cap;
- prompt v2 contains the drop rules;
- fake model returning status/fragment is filtered, not accepted;
- all contract blocks still pass existing malformed/schema tests;
- real summary re-run: objective present, no fragment/status/optional candidates, key deliverables not excluded.

## Acceptance

1. `npm run check` passes.
2. Same summary calibration:
   - objective present;
   - no heading/status/optional/historical candidates;
   - T-1/T-2/T-3 classified as deliverables;
   - key deliverables not excluded;
   - record tokens/latency/candidate counts and coverage.
3. If still fragmented, the bounded reduce pass is added and tested before claiming completion.

## Result (2026-11-24)

Review remediation: see [v10-review-remediation.md](v10-review-remediation.md).


Implemented in `src/host/calibration-contractness.ts`, `draft-calibration.ts`, `service` result reasons and
client incomplete-state handling.

Before v9: 32 candidates, 4/4 batches, 7 calls, 40.0 s, 15,677 output tokens, `truncated=true`,
objective + 4 deliverables excluded; heading/status/optional material remained.

After v9 on the same summary: 19 candidates (1 objective, 11 deliverables, 7 invariants), 3/3 batches,
3 calls, 5,216 output tokens, 11.1 s, `truncated=false`, `inputTruncated=false`; 18 non-contract items
excluded with explicit reasons. T-1/T-2/T-3 are deliverables; heading/status/optional candidates are gone.
Residual: exact T-3 config facts remain atomic invariants and two 151-no-execution constraints remain
duplicated; a bounded reduce pass remains an optional follow-up.
