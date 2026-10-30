# `dsh-charter` 0.1.0-rc.5 Stabilization Plan

English | [中文](rc5-stabilization-plan.zh.md)

> This English file is a non-normative summary. The Chinese implementation plan is normative when details differ.

Plan date: 2026-10-27. Target: `0.1.0-rc.5`. Status: **complete and frozen; historical implementation plan.**

## 1. Version Correction

`0.1.0-rc.4` is already published on GitHub and npm as a compatibility-only patch for DSH `0.2.1-rc.3` and `0.2.1-rc.4`. Its tag, assets, and npm version are immutable. Review, interaction, and stable-release work therefore moves to rc.5.

rc.5 is the product-correctness and release-hardening candidate before `0.1.0` stable. It adds no proposal provenance, validator, query plane, record v2, or new information architecture.

## 2. Problems

| ID | Priority | Problem |
| --- | --- | --- |
| RC5-01 | P0 | Hidden bootstrap candidates start selected and can be applied unseen |
| RC5-02 | P0 | Future record schema is treated as recoverable corruption and can be overwritten by a v1 archive |
| RC5-03 | P0 | Ordinary Discard clears staged changes, editor content, and unstaged composer text together |
| RC5-04 | P1 | Committed/projected state and Apply blockers are unclear |
| RC5-05 | P1 | Archive preview counts characters instead of UTF-8 bytes |
| RC5-06 | P1 | Error detail, connection classification, ARIA, and mobile touch behavior are incomplete |
| RC5-07 | P0 | Compatibility metadata omits rc.3/rc.4 and real Gateway/browser evidence is missing |
| RC5-08 | P1 | Release production relies on local matrix scripts and repeated manual packing |

## 3. Bootstrap Review

Add per-Session `bootstrapVisibleCount`, default 40. Candidates start unselected. Add visible-only show-more and selection methods; fresh planning and validation see only the visible window. Pane remount and section changes retain visibility, while new extraction and full cleanup reset it.

Show total, visible, and selected counts; group invariants and deliverables; replace Select all with Select shown. Checkbox and textarea receive independent labels. Successful Apply closes the review and omits unselected rows. Unknown-outcome replay always sends the retained request before fresh planning.

Acceptance covers 41/80/100 rows, remount, mixed kinds, selected/unselected invalid text, pending fallback, and exact replay.

## 4. Forward-Schema Fence

Add `CHARTER_RECORD_SCHEMA_VERSION = 1` and an invalid-state `future-schema` reason whose `recoverable` value is statically false. A finite integer version greater than current is detected before loose identity handling in both live inspection and non-live views.

Future records receive no prompt/tool read, edit, initialize, or restore. Restore rejects them even if an old client submits `reason:'schema'` and the exact digest. Diagnostic export remains available and maps to existing archive health `schema-invalid`; archive format, errors, Remote methods, domain, and persistent version remain unchanged.

The wire enforces `future-schema => recoverable:false`; restore requests still accept only schema/consistency. An rc.4 client cannot decode this new strict enum value, so Host-new/client-old skew fails closed and requires a client refresh; the Host write fence remains effective and diagnostic UI is not promised during that skew window.

Tests compare actual JSON bytes after every downgrade operation, cover queue races, and parse preserved bytes with a test-only v2 schema.

## 5. Safe Discard

Replace `discard(force)` with explicit `discardStaged`, `unstageObjective`, `clearComposer`, `discardAllLocalWork`, and `localWorkSummary` operations. Staged discard preserves editor/composer text; editor cancel preserves staged operations; each composer clears independently; full discard requires a summary confirmation and does not clear bootstrap review.

Every ordinary mutation is a no-op while a durable outcome is unknown. Only explicit `abandonUnknown()` clears replay evidence and preserves the staged payload.

Tests invoke every destructive local API across edit/bootstrap/initialize/restore unknown attempts and deep-compare the complete retained request.

## 6. Committed and Projected State

Revision, Stored, and default Active counts come from committed view. Projected values are separately labeled After Apply whenever staged operations exist. Revision uses neutral styling; objective staging has its own tag and unstage action.

Empty-Charter CTAs remain after terminal bootstrap states. A pure Apply availability model exposes the first blocker and connects visible text to the button with `aria-describedby`. Unknown outcome changes Apply to exact Retry rather than fresh admission.

## 7. UTF-8 Recovery Admission

Archive preview uses `TextEncoder(...).byteLength`, not string length. Raw file, canonical preview, and complete Host request all use UTF-8 but may differ because whitespace and wrapper fields differ; Host remains authoritative. Missing WebCrypto produces explicit `cryptoUnavailable` and keeps Restore disabled.

`subtle.digest()` rejection is also classified as crypto unavailable, never digest mismatch.

## 8. Error, Connection, ARIA, and Mobile

Add optional connection error kind: timeout, disconnected, host-service-missing, runtime-unsupported, or unknown. Classify by stable RemoteError code; storage failure remains a business record state.

Show localized summaries plus expandable escaped detail for connection, view, draft, bootstrap, and maintenance failures. Add meter semantics, field-specific labels, `aria-invalid`, and `aria-describedby`.

On narrow/coarse-pointer layouts, buttons, navigation, and selects reach 40–44px. Apply gets an explicit primary class; remove the `:last-child` full-width rule so Abandon cannot become visual primary.

## 9. Compatibility and Platform Evidence

Add rc.3/rc.4 to `dsh.compatibility.dshReleases`. Add a tracked compatibility runner with isolated dependency graphs and machine-readable evidence. PR runs minimum/old-boundary/current sentinels; release/nightly runs all seven versions.

Add real `TypertGatewayService` acceptance for owner/user, purge, maintenance owner gates, cross-Session denial before activation/storage, malformed missing-principal Peer, cancellation, and unknown outcomes on DSH rc.3/rc.4.

Add real-browser recovery using the exact artifact: Unicode Apply, real download, file chooser, WebCrypto preview, absent target, restore, reload, Host restart, healthy-target refusal, UTF-8 limits, mobile viewports, keyboard, and screen reader. Desktop ABI and real-model compaction remain manual.

## 10. Pack-Once Release

`release-candidate.yml` runs source gates without normal package smoke, compatibility matrix, one producer pack, exact-artifact package/recovery, Gateway, profile, browser, and summary jobs. Every consumer downloads the same artifact id.

The candidate records artifact source commit C. After all gates pass, the operator creates C+1 by changing only root `SHA256SUMS`, which is outside npm `files`. `release-promote.yml` verifies that exact diff, reruns exact-artifact without build/pack, tags C+1, records both commits and the artifact id, creates the GitHub Release, publishes the exact tarball, and verifies registry version, tags, and downloaded digest.

## 11. Order and Blocking Gates

Implementation order is future-schema fence, visible-only bootstrap, discard split, committed/projected UI, UTF-8/error/a11y/mobile, compatibility matrix, Gateway/browser evidence, then pack-once workflows and release documentation.

Blocking gates require: no hidden bootstrap op; byte-identical future records with every write path denied; safe discard and unknown evidence; Pane coverage for projected/apply states; UTF-8 and WebCrypto fail-closed behavior; accessible errors/touch targets; identical compatibility declarations; real Gateway authorization; one-artifact browser restore; one producer pack; and consistent bilingual release evidence.

## 12. Non-Goals

No new Charter operation, Remote method, model tool, item kind, provenance, evidence, validity, validator, persistent schema version, domain, search, pagination, bulk review, Review Center, or full Pane/store architecture rewrite. These remain in the 0.2 roadmap.
