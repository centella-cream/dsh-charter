# Changelog

English | [中文](CHANGELOG.zh.md)

All notable changes to `dsh-charter` are recorded here. The project follows a pre-1.0 version line while the
DSH plugin ABI is still moving.

## 0.1.0 — Unreleased

Initial MVP.

### Added

- Durable per-Session charter in a `dsh-storage-domain` domain (`dsh_charter_v1`).
- Original/current objective, invariants, deliverables, review/lifecycle/verification/progress state.
- Atomic single-record Apply with revision conflicts, idempotent mutation receipts, quota admission, and
  bounded history.
- Deterministic user-role runtime context injected through `systemPrompt.context()`.
- Read-only `charter_read` tool with standing and all-item views.
- One-time fork copy of the parent charter with re-minted item ids.
- Non-live sessions (for example a Desktop session opened in a separate Web process) show their stored charter
  read-only with an explanatory notice, then upgrade in place when the session becomes live instead of failing
  the Remote stream with a raw "not live" error.
- Redesigned Charter pane with DSH semantic tokens: compact page header and budget meter, sticky Preview/Discard/
  Apply toolbar, objective card, responsive invariants/deliverables columns, hover/focus item actions, inline
  add composers, and light/dark support.
- Raised default budgets to 8 KiB context, 4 KiB objective, and 1 KiB per item. No path silently truncates:
  long history-draft items are split into candidates, over-limit fields are highlighted, and Apply is disabled
  until the selection fits the budget.
- Review-only history draft extracted deterministically from the latest compaction summary for an empty
  existing Session; no model call and no automatic write. The user edits/unchecks the draft and applies it.
- Complete English/Chinese localization for the Charter tab and pane, driven by `dsh-client-locale` and the
  active DSH language, including counts, statuses, buttons, placeholders, and error-code messages.
- Conversation-view Charter tab (中文「会话契约」/ English 「Charter」) with draft staging, conflict preservation,
  preview, archive/restore, supersede, pending review (history overflow; model proposal entry reserved), purge confirmation, progress, and verification
  controls. The tab follows Chat and Trajectory and dynamically moves after any later-registered plugin tab.
- Session-scoped Remote stream and edit endpoints.
- Compatibility layer for DSH 0.1.7-rc.2 / 0.2.0 (`@Remote` resource fallback, prompt-context extra fields,
  actor fallback) and prompt-variable escaping for their interpolator.
- Self-contained factory-form browser bundle, with inlined CSS and bundled zod, matching the DSH Web module
  loader contract.
- History import now treats the real context byte budget as the gate, not per-kind active counts: overflowing
  candidates are applied in one atomic edit as pending proposals (`item.propose`) instead of blocking the draft.
  No candidate is dropped or truncated. The per-kind active caps were removed; storage limits were raised to
  `maxItems` 512, `maxPendingItems` 512, `maxOps` 1024, and `maxRecordBytes` 1 MiB.
- A newly built browser client now tolerates a view snapshot from an older Host that still exposes the legacy
  active-count limit fields, preventing a blank Charter pane during a host/client revision skew; a full Host
  restart is still required for the new pending-import semantics.
- Verified against DSH `0.2.1-rc.2` with no code changes required; the existing peer range and compatibility layer
  cover the release candidate.
- 78 tests across core, host composition, fork, idempotency, quota, prompt boundary, Remote stream, history
  extraction, client reordering, compatibility, and decorator compatibility. Verified on DSH `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`,
  `0.2.1-rc.1`, and `0.2.1-rc.2`. The actual Web UI was exercised on `0.2.0-rc.2`: tab order, Chinese/English
  switching, objective and invariant editing, preview, Apply, and reload persistence.

### Security

- User-authored text never enters a system-role message.
- The model has no charter write capability.
- DSH 0.1.7-rc.2 and 0.2.0 cannot enforce per-Peer Remote resources; the plugin degrades to live-Session and
  lifecycle checks and documents the restriction.

### Known limitations

- Compaction rematerialization depends on the DSH runtime-context projection contract; the full compaction
  end-to-end still needs a real model session.
- Browser interaction was verified on `0.2.0-rc.2`; 0.1.7/0.2.1 were verified by typecheck/build/tests, not by
  repeated interactive flows.
- Default quotas are not calibrated against production samples.
- History extraction is deterministic and heuristic; stale or noisy items can appear in the draft and require
  review.

### Fixed

- Enforce actor policy at the service and `commitRecord()` boundaries: `host` edits are rejected, `user` may make
  ordinary edits but not `item.purge`, and `owner` may purge; forbidden calls do not change storage, revision, or
  published views.
- Reject purging an active accepted or pending item at the core operation layer; only archived, rejected, or
  superseded chain entries are purgeable.
- Detect self/multi-node `parentSession` cycles and depth overflow instead of leaving initialization promises
  waiting forever.
- Fall back to older compaction summaries when the newest valid summary yields no candidates.
- Add bootstrap retry/stale-request handling and release per-Session client sources on view unmount; guard the
  detach generation race.
- Bound the `charter_read` all view to 64 items / 32 KiB and report the omitted count.
- Isolate the deprecated `snapshotEvents()` read behind one compatibility adapter.
