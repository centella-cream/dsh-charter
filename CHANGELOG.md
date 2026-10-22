# Changelog

English | [中文](CHANGELOG.zh.md)

All notable changes to `dsh-charter` are recorded here. The project follows a pre-1.0 version line while the
DSH plugin ABI is still moving.

## 0.1.0-rc.1 — Unreleased

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
- Raised the default charter-contribution budget to 8 KiB, the objective to 4 KiB, and one item to 1 KiB. No path silently truncates:
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
- 144 tests across core, host composition, fork, idempotency, quota, prompt boundary, Remote stream, history
  extraction, client reordering, compatibility, and decorator compatibility. Verified on DSH `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`,
  `0.2.1-rc.1`, and `0.2.1-rc.2`. The actual Web UI was exercised on `0.2.0-rc.2`: tab order, Chinese/English
  switching, objective and invariant editing, preview, Apply, and reload persistence.

### Security

- Principal-aware Remote actor resolution: DSH 0.2.1+ requires a `PeerScope.principal`. An absent principal
  is denied with `FORBIDDEN` instead of being elevated to `owner`; the owner fallback applies only to a
  runtime confirmed to be DSH 0.1.7/0.2.0 (no principal field).
- User-authored text never enters a system-role message.
- The model has no charter write capability.
- DSH 0.1.7-rc.2 and 0.2.0 cannot enforce per-Peer Remote resources; the plugin degrades to live-Session and
  lifecycle checks and documents the restriction.

### Known limitations

- Watch/edit frames still carry the full item set for a maximum-size charter; splitting history into a paged
  Remote endpoint is a follow-up rather than part of this round.
- `charter_read` `standing` is the complete working set and has no fixed byte cap: a maximum-size charter can
  produce a large tool result. Paging or an explicit response cap is a follow-up, not part of this round.
- Active client drafts are not byte-capped beyond their UI inputs; the idle TTL/LRU bounds released drafts, not
  text held by a currently mounted editor/bootstrap sheet.
- This tree is the `0.1.0-rc.1` pre-release and must be published with `npm publish --tag next`; a stable `latest`
  release requires the real-model compaction PASS. No public GitHub repository exists yet, so `repository`,
  `homepage`, and `bugs` are intentionally absent from `package.json` until the repository is created and reachable.
- Compaction rematerialization depends on the DSH runtime-context projection contract; the real-model
  end-to-end PASS is recorded in verification §8.4 (2026-10-22).
- Browser interaction was verified on `0.2.0-rc.2`; 0.1.7/0.2.1 were verified by typecheck/build/tests, not by
  repeated interactive flows.
- Default quotas are not calibrated against production samples.
- History extraction is deterministic and heuristic; stale or noisy items can appear in the draft and require
  review.

### Fixed

- Close every open watch subscription when its Session is disposed (listeners receive `null` and the generator
  exits), so a recreated Session is not stuck behind a listener removed from the service map; Host frame dedupe
  and client acceptance now compare the lifecycle, and a new lifecycle whose revision restarts at 0 is accepted.
- Lock mutating draft actions while a request is in flight: Unstage is rejected and disabled during Apply, all
  bootstrap editors/selectors are disabled during a bootstrap save, setters reject edits, retained bootstrap
  requests are only replayed when their ops and base revision still match the reviewed plan, and `dismissBootstrap`
  clears the attempt.
- Preserve a reviewed history draft across Chat/Charter tab switches by treating any non-empty bootstrap draft as
  dirty in the lease-release cleanup.
- Admit stepwise shrinking of an already over-budget objective or item even while it is still above the limit, so
  a tightened budget can converge without rejecting every intermediate edit.
- Keep the `all` tool envelope bounded even when `maxObjectiveBytes` exceeds it: omit the objective with
  `objectiveTruncated: true` instead of returning an oversized response; validate `shadowedTokenCount` as a
  non-negative integer before the Remote codec sees it.
- Normalize a legacy debug-shaped `charter_read` tool result (extra id/review/lifecycle fields from a Host that
  has not been restarted after a package update) to the current compact standing projection before evidence
  comparison, and record the real-model compaction PASS in verification §8.4.
- Make every compaction-checker success criterion participate in the exit code: the checker now compares the
  Host's compact standing projection, fails on a dirty system prompt or a called-but-mismatched `charter_read`
  standing result, and records a leaking summary as a warning; fixture tests cover each combination.
- Fence edit and bootstrap Apply results by draft generation, source connection epoch, source instance, lifecycle,
  and request identity, so a late response from a destroyed source or a detach/reattach cycle cannot clear or
  overwrite a newer draft; source invalidation keeps the mutation id for an idempotent retry through the replacement
  source.
- Drop empty drafts immediately on the last lease release, apply an idle TTL, and bound released drafts; a
  runtime-invalid record that is repaired in place is re-parsed on the next access and recovers without a Host
  restart, while a still-invalid document stays isolated and is never overwritten.
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
- Isolate the deprecated `snapshotEvents()` read behind one compatibility adapter. This is a known technical
  debt, not a completed migration: DSH 0.2.1-rc.2 exposes no public non-deprecated historical-event reader.
- Mint Host ids for `item.propose` client refs, so a history Apply that contains both active items and
  overflow proposals commits atomically instead of failing with `INVALID_REFERENCE`.
- Replace the per-`sessionId` client source release with an instance-bound lease and ref counting: several
  view bindings share one stream and only the last lease disposes it; a stale lease can no longer dispose a
  newer binding.
- Surface `bootstrap` unavailability reasons (`not-live` / `no-summary` / `unavailable`) with a Retry action,
  allow a later view/lifecycle change to ask again, and silently discard an in-flight draft when the user
  started editing instead of showing a stale error.
- Validate `view.sessionId` on stream snapshots and updates, not only on the immediate edit response.
- Reset every Pane draft field when the view binding switches Sessions, and route Apply through a
  Session-scoped request builder so one Session's staged ops can never be submitted under another Session id;
  async Apply completions are fenced by a Session generation.
- Make the opening runtime snapshot revision-monotonic, so an older stream generation cannot roll the accepted
  view back after an edit response.
- Return the complete standing working set from `charter_read`; only the `all` debugging view is paged.
- Accept `maxPendingItems: 0` in the Remote wire schema, matching the Host configuration that disables proposals.
- Document `item.propose` as a normal client edit operation (never model-facing) instead of a host-internal
  operation.
- Re-validate every stored record against the strict schema on every runtime read and write path
  (`recordFor`, read-only views, parent/fork reads, and the `table.update` transform), not only at startup; a
  record that becomes invalid at runtime disables only its Session and is never overwritten.
- Fail closed when decorating Remote methods: only the documented "unsupported decorator options" rejection may
  select the legacy no-resources path; arbitrary modern-factory errors propagate, so a broken modern runtime can
  no longer be misclassified as legacy and re-open the owner fallback for missing principals.
- Bind client drafts to the Session lifecycle fingerprint and keep the per-Session draft map bounded with an LRU
  of released entries, so a reused Session id cannot inherit staged work and long browsing does not grow memory
  without limit.
- Share the Host's text normalization rules with the client: control characters and unpaired surrogates are
  rejected in the editor and in reviewed history candidates, with localized feedback before Apply.
- Exclude pending proposals from active UI counts and lists while keeping them visible in their own section; add a
  non-blocking reconnecting banner that explains the temporary read-only state.
- Return a complete bounded debug projection from `charter_read all` (origin/order/createdRevision/supersede
  chain/verification provenance) and cap the final tool envelope at 32 KiB; include history/mutation count limits
  in the over-budget state.
- Add a packed-artifact smoke to CI (installable tarball, exports resolve, client bundle loads), remove the
  redundant `@deepseek-ai/schemastery` peer declaration, and make the pre-release/compaction wording explicit.
- Isolate stored-record validation per Session: the domain boundary keeps raw documents and the service parses
  each one, so one corrupt or forward-skewed record marks only that Session unavailable while every other
  Session still reads and edits. The raw document is preserved for diagnosis.
- Separate structural validation from admission policy. Lowering a budget later now renders the charter as
  `overBudget` (not corrupt), stops injecting it, and admits shrinking edits so it can converge; non-viable
  profile values are clamped to documented minimums with a warning. `maxRecordBytes` is exposed in the view.
- Enforce the single-hop replacement model at the operation layer: archiving or replacing a replacement now
  fails with `INVALID_TRANSITION` instead of `CORRUPT_STATE`, and the pane exposes the supported escape hatch
  (purge the superseded predecessor to detach the successor).
- Cache record validation per immutable record object and compare snapshot digests instead of serialising the
  full item set; plan history imports in one pass (with an exact-render verification/fallback) and split
  pathological single-line summaries with a running byte counter.
- Move Pane draft ownership into a per-Session store: staged edits, inline editors, new-item text, feedback and
  the reviewed history draft survive switching to Chat/Trajectory and back. Apply reuses a stable mutation id
  for unknown-outcome retries, offers apply-to-latest after a conflict, and reports connection failures with a
  working Retry path (including an attach watchdog and stream re-attach).
- Render the projected draft view in the Pane: staged rows are visible immediately, counts split active/pending/
  historical, historical rows collapse by default, item actions move into an accessible per-row menu, and the
  sticky footer mirrors history-draft apply/discard.
- Make bootstrap a persisted phase machine (checking / draft / no-summary / not-live / failed / unavailable /
  dismissed) with Overview callouts and a stable Check again action, never stealing the section while the user
  edits.
- Keep feedback and bootstrap errors as locale-independent descriptors, make the redirect reason optional
  instead of persisting UI copy, and localise byte units, counts, verification provenance, and preview labels.
- Harden `npm run verify:compaction`: validate the storage record shape, accept `--store`, compare the full
  `charter_read` standing projection, and check multiple system-prompt leak signals. Document it as a manual
  check (the automated gate never runs a model).
