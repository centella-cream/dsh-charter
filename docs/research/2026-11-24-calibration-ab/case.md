# Calibration A/B case: 10-turn `bookmarkctl`

> **Status:** Active — reproducible engineering case for 0.3.4 calibration evaluation.
> **Version scope:** 0.3.3 baseline / 0.3.4 v7 / 0.3.4 v8.
> **Baseline:** 2026-11-24.
> **Authority:** [calibration design](../../design/charter-draft-calibration-v1.zh.md) and [report](report.md).

## Purpose

Measure whether calibration improves the review draft on a **real** long-running session, using the
same ten user turns followed by a real `/compact`. This is an engineering A/B smoke, not the
human-blind A/B protocol 1.

## Session shape

- One new real DSH Web Session per variant.
- Ten user turns with no file/tool actions requested.
- Real model: DeepSeek-V4.1-Flash, reasoning High.
- After turn 10, issue `/compact` and collect `charter/bootstrapDraft`; for 0.3.4 also collect
  `charter/calibrateBootstrap`.
- The exact turn texts are in [data/turns.json](data/turns.json).

The turns ask for a `bookmarkctl` CLI with stable tables/JSON, XDG storage, atomic writes, corruption
handling, schema migration/backup, security boundaries, performance, tests, and a late favorited
schema change. This forces many durable constraints and several later overrides.

## Expected checks

1. Every key constraint from rounds 1–9 is represented or explicitly excluded.
2. Calibration does not lose later-round overrides (especially favorited replacing tags).
3. Default parameters do not fail with `max-tokens`.
4. Batch count/concurrency/tokens/wall-clock stay bounded.
5. Run returns usable candidates without silently presenting partial output as complete.

## Variants

| Variant | Install |
| --- | --- |
| `0.3.3` | published artifact |
| `0.3.4-v7-default` | pre-v8 candidate, default calibration |
| `0.3.4-v7-tuned` | pre-v8 candidate, `maxOutputTokens=8192` |
| `0.3.4-v8` | adaptive-batch implementation, default v8 parameters |
