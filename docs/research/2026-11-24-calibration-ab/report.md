# Calibration A/B report — 10-turn real Web case

> **Status:** Active — engineering A/B evidence; not a release acceptance.
> **Version scope:** `0.3.3` vs `0.3.4` v7/v8 calibration.
> **Baseline:** 2026-11-24.
> **Authority:** [case](case.md), [calibration design](../../design/charter-draft-calibration-v1.zh.md), [verification](../../verification.md).

## Method

- One new real Web Session per variant, same [ten user turns](data/turns.json), then `/compact`.
- Model: DeepSeek-V4.1-Flash High; calibration route `deepseek-official/deepseek-flash`.
- DSH `0.2.2-rc.5`.
- `0.3.3` was installed from the published artifact; `0.3.4` variants were installed from local
  candidates into isolated Web profiles.
- v8 defaults in this run: `maxCandidates=32`, `batchCandidates=8`, `maxOutputTokens=4096` per batch,
  `maxConcurrency=3`, `maxTotalOutputTokens=16384`, `retrySplitDepth=2`.
- The run is not a strict transcript-controlled comparison: each variant is a new model session with
  identical user input. Model nondeterminism means counts differ.

## Results

| Variant | L1 invariants | L1 deliverables | Calibration | Candidates | Batches | Failed | Truncated | Output tokens | Wall |
| --- | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: | ---: |
| 0.3.3 | 22 | 6 | n/a | — | — | — | — | — | — |
| 0.3.4 v7 default | 16 | 11 | **FAIL: max-tokens** | 0 | — | — | — | — | — |
| 0.3.4 v7 tuned | 24 | 8 | success | 12 | 1 | 0 | `inputTruncated=true` | 3,437 | 14.5 s |
| 0.3.4 v8 default | 16 | 7 | success | 24 | 3 | 0 | `false` | 8,040 | 15.2 s |

v7 default error observed at the Web Remote:

```json
{"code":"gateway/internal","message":"calibration finished with max-tokens"}
```

v8 result metadata:

```json
{"batchCount":3,"completedBatches":3,"failedBatches":0,"partial":false,
 "truncated":false,"inputTruncated":false,
 "usage":{"inputBytes":3802,"outputTokens":8040,"durationMs":15167,"calls":3}}
```

## Coverage

v8 candidates cover the key constraints:

| Requirement | v8 candidate refs |
| --- | --- |
| no writes / no commands / final contract | c-0, c-13 |
| keep `src/legacy.ts`, API compatibility | c-1 |
| `bookmarkctl` four commands, table/JSON | c-2 |
| XDG storage, atomic write, corruption | c-3 |
| exit codes 2/3 | c-4 |
| favorited replaces tags; old v2 readable | c-5, c-8 |
| v1 migration, backup, rollback | c-6, c-7 |
| traversal/network/log boundary | c-9, c-10 |
| 10k list/search 200ms; case-insensitive; URL unchanged | c-11, c-12 |
| tests and delivery | c-13, c-15 |

v7 tuned only calibrated 12 of 32 draft items (`inputTruncated=true`) and did not cover the later
migration/security/performance/test/favorited requirements. 0.3.3 preserved the requirements but
returned them as round-prefixed process notes, pending decisions, and duplicates—usable as source,
but not a clean contract.

## Verdict

- **v8 default parameters pass this engineering case**: no max-tokens failure, all three batches
  completed, no truncation, 24 readable candidates in 15.2 s / 8,040 output tokens.
- **v7 default fails**: it cannot be used as the release baseline.
- **v7 tuned is incomplete**: increasing the single-call budget avoids the error but leaves later
  requirements out.
- The 0.3.3 baseline remains the completeness reference, but its draft is noisy and requires manual
  cleanup.
- This is **not** A/B protocol 1 (2 blind reviewers, 20 sanitized summaries, ≥3 runs). It is the
  engineering gate that must precede that protocol.

## Implementation evidence

- Engineering run artifact: `dist/dsh-charter-0.3.4.tgz` SHA-256
  `841eed5a0254e2af5b779c52d084b787288f5694ade2b5c522dab52d51dff5e2`.
- Final source candidate after the partial-UI/disclosure changes: SHA-256
  `c6ddf8704f63680b5f6a51248b2e1f173c0ef402bd1bb58e54d7651139872d75` (164 files).
- `npm run check`: 46 files / 551 tests PASS; token coverage PASS over 13 declared DSH versions.
- 13-version source matrix PASS (`.tmp/compat-13-034-v8.json`, source `e4a826c`).
- Exact-artifact package smoke, packed recovery smoke, fresh DSH 0.2.2-rc.5 Web profile smoke, and
  Gateway acceptance on DSH 0.2.1-rc.3/rc.4 PASS on the final bytes.
- This candidate is still not release-ready: formal A/B, L4 UI/AT, old-profile downgrade and manual gates remain.

## Limitations

- New session per variant; model nondeterminism affects item counts.
- Only one real case, one run per variant.
- No blind human scoring or 95% CI.
- The v8 Web UI partial-batch status and disclosure v2 flow still need source/UI completion and
  dedicated tests before release acceptance.

## Data

- [Turns](data/turns.json)
- [0.3.3 draft](data/0.3.3.json)
- [v7 default](data/0.3.4-v7-default.json)
- [v7 tuned](data/0.3.4-v7-tuned.json)
- [v8 result](data/0.3.4-v8.json)
