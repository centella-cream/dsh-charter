# Changelog

English | [中文](CHANGELOG.zh.md)

All notable changes to `dsh-charter` are recorded here. The project follows a pre-1.0 version line while the
DSH plugin ABI is still moving.

## 0.1.0-rc.2 — 2026-10-24

Small patch candidate: a Pane hook-order crash fix, a security upgrade, and release-channel/doc corrections.

### Fixed

- `CharterPane` no longer crashes with "Rendered more hooks than during the previous render" when a Session
  transitions connecting/null → ready or error/null → retry → ready: the replay-state predicates
  (`editReplay`/`bootstrapReplay`/`unknownReplay`) and the `confirmAbandon` reset effect now run above every early
  return, so hook order is invariant across connection states.
- Real `react-test-renderer` regression tests (three cases: connecting/null → ready, error/null → retry → ready,
  ready → revision update) exercise the actual Pane component; the pre-fix code fails them with the exact
  "Rendered more hooks than during the previous render" error.

### Security

- Upgrade `zod` from `4.4.3` to `4.6.7` exactly (GHSA memory-exhaustion advisory for oversized constrained
  collections). `npm audit --omit=dev` reports 0 vulnerabilities and `npm ls zod` shows the production dependency
  at 4.6.7; because tsdown inlines Zod into the browser bundle, the full build/wire/client-bundle/package smoke
  and the five-version compatibility matrix are re-run against the upgraded build.

### Tests

- 20 test files / 263 tests (`npm test`), including the three real `react-test-renderer` Pane regression tests;
  the repaired hook placement is required for two of them.

### Changed

- Version and current-release documentation move to `0.1.0-rc.2`; historical `0.1.0-rc.1` evidence and CHANGELOG
  history are preserved.
- Channel policy is now explicit and deliberate: rc.2 is published under the `next` dist-tag, and we also point
  `latest` at the newest RC until a stable release exists. This is our current policy (npm keeps a `latest` tag and
  we choose where it points), not an npm requirement or a claim about npm's behavior.
- Added release notes for rc.2 at `docs/release-notes/0.1.0-rc.2.md` (outside the npm `files` whitelist).

## 0.1.0-rc.1 — 2026-10-22

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
  controls. The tab is registered once at a stable high order (1000) and follows Chat, Trajectory, and common
  plugin tabs without ever re-registering itself.
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
- 260 tests across core, host composition, fork, idempotency, quota, prompt boundary, Remote stream, history
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
- This tree is the `0.1.0-rc.1` pre-release and is published with a non-latest `npm publish --tag next`; a stable
  `latest` release additionally requires a post-restart confirmation of the installed profile. Release-state
  prerequisites (repository metadata, tag ordering, CI gating) are tracked only in `docs/releasing.md`.
- Compaction rematerialization depends on the DSH runtime-context projection contract; the real-model
  end-to-end PASS is recorded in verification §8.4 (2026-10-22).
- Browser interaction was verified on `0.2.0-rc.2`; 0.1.7/0.2.1 were verified by typecheck/build/tests, not by
  repeated interactive flows.
- Default quotas are not calibrated against production samples.
- History extraction is deterministic and heuristic; stale or noisy items can appear in the draft and require
  review.

### Fixed

- Make watch unsubscribe instance-safe: a disposed generation's late unsubscribe can no longer delete the
  Map entry of a same-id replacement watch (the entry is removed only when it still owns the captured Set).
- Fix attach/stream generation races: duplicate attach of the live stream is a true no-op, and `replace`/`update`
  frames from a replaced stream generation are ignored before they can touch state or reset a draft lifecycle.
- Track a pending Remote attach as a cancellable state: a detach that arrives before the previous stream finishes
  disposing cancels the pending generation, so the cancelled attach can never start its stream late; the source
  reports itself detached instead.
- Disable and reject Rebase while an Apply or bootstrap save is in flight, preserving the mutation attempt for an
  unknown-outcome retry; bind bootstrap extraction results to the source instance/connection generation so a
  reconnected Host cannot inject a stale proposal.
- Never silently evict dirty drafts: the idle TTL and LRU capacity target only empty drafts, and capacity eviction
  also clears the draft timestamp; staged ops, editor text, and reviewed history drafts survive tab/Session churn.
- Let the editor submit a stepwise shrink of an already over-budget objective/same-id item, matching Host
  admission, while new or growing content still requires the hard limit.
- Accept the first lifecycle fingerprint on reconnect even at a lower revision, and include `overBudget` plus all
  limits in client frame deduplication so a tightened-config snapshot is delivered.
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
- Gate the Apply button by the Host's exact `overLimitGrowth` rule: an over-budget rendered prompt is blocked
  only when the edit makes it grow, so a shrinking or unchanged over-budget render is accepted.
- Consolidate the two stacked over-budget alerts into one alert with one remedy; show replacement and
  verification-failure reasons as visible item-row text instead of title attributes, and restore keyboard focus
  to the item row after row actions.
- Correct the live-region pattern: `status`/`alert` roles now wrap only the message text, so action buttons are
  never nested inside live regions; the history-draft idle phase shows a dedicated no-draft message instead of
  the extracted-draft copy.
- Use real DSH semantic tokens for the primary-button fill/hover, content font size, and font family, and unify
  Chinese UI terminology (章节 / 待审 / 硬约束 / 会话 / 标记为未验证).
- Keep the `all` tool envelope bounded even when `maxObjectiveBytes` exceeds it: omit the objective with
  `objectiveTruncated: true` instead of returning an oversized response; validate `shadowedTokenCount` as a
  non-negative integer before the Remote codec sees it.
- Normalize a legacy debug-shaped `charter_read` tool result (extra id/review/lifecycle fields from a Host that
  has not been restarted after a package update) to the current compact standing projection before evidence
  comparison, and record the real-model compaction PASS in verification §8.4.
- Make every compaction-checker success criterion participate in the exit code: the checker compares the Host's
  compact standing projection, fails on a dirty system prompt, and now **requires** a matching `charter_read`
  standing result recorded after the latest compaction (a missing or mismatched post-compaction read fails; reads
  before the compaction are ignored by seq); a leaking summary is a recorded warning, and fixture tests cover
  each combination.
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
- Register the Charter conversation view exactly once at the stable order 1000 instead of re-registering on every
  slot change: two plugins that both try to stay "last" can no longer reorder each other forever, and the bundle
  neither queries nor subscribes to the slot roster.
- Tighten every DSH peer dependency range to the five versions in the tested compatibility matrix
  (`0.1.7-rc.2 || 0.2.0-rc.1 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2`).
- Replace the quadratic bootstrap-plan measurement with exact O(1) incremental byte accounting (objective token
  plus joined invariant/deliverable tokens); the full renderer stays as verification/fallback, and a
  3,000-candidate all-active plan is covered by tests.
- Use a plain `<details>` disclosure for the item action menu (no `menu`/`menuitem` ARIA contract), autofocus the
  purge confirmation, return focus to the summary on cancel, and keep keyboard focus on the row after actions.
- Detach a successor's `supersedes` link in the draft preview when its purged predecessor is removed, matching
  the Host purge semantics.
- Keep install documentation channel-neutral (the immutable tarball does not claim the registry is unavailable)
  and document the correct release order: repository metadata, CI, verified artifact, tag, then publish.
- Make `package-smoke` wording match what the empty consumer actually checks (packed `core` import plus
  root/remote export/file presence); Host/Remote runtime imports stay covered by the workspace build smokes.
- Authenticate the compaction checker's `charter_read` evidence by resolving the unique tool call (top-level
  `sourceEventSeqs`, legacy callId fallback) and requiring the call to follow the latest compaction **and**
  runtime-context snapshot, with the default/standing view and a non-error, later result; fixture tests cover
  every rejection path.
- Tighten `engines.dsh` to the same five exact verified versions as the peer ranges, and document that future
  `0.2.x` releases are not covered until the compatibility matrix is extended after verification.
- Normalize reviewed draft text with `inspectUserText` before the bootstrap planner's incremental byte accounting
  so CRLF/NFD candidates stay on the O(1) path; add 2,000-4,000 candidate CRLF/NFD coverage.
- Mark a purge-detached successor as a derived staged row (`unstageTarget: null`) so the pane never offers an
  Unstage action that cannot remove any staged operation.
- Keep mutable release-state wording out of the immutable tarball docs; repository/CI/tag prerequisites, the
  no-provisional-tag rule, and the required docs refresh before the final tag live only in `docs/releasing.md`.
- Separate connection readiness from business-data dedupe: a retry/reattach that delivers the identical revision
  now recovers `ready` and clears the first-frame watchdog, while an identical revision on an already-ready pane
  stays deduped; a snapshot stream that ends or fails is terminal, so Retry recreates the Remote watch instead of
  restarting an aborted lifetime (before or after the first snapshot).
- Freeze the editor's revision baseline at open time so an unrelated remote commit cannot silently retarget an
  objective/item edit; only an explicit rebase advances the baseline, and later staging never advances a frozen
  batch baseline.
- Compute byte budgets, unchanged checks, reasons, candidate limits, and generated op text from
  `inspectUserText(...).value`, so CRLF/NFD input cannot bypass or waste the limit; normalization-only edits count
  as unchanged.
- Allocate the next staged order from the committed max plus the max effective order among current staged
  add/propose/supersede/order-edit ops, so add/unstage/add never reuses an order, and derive `Unstage` from the
  real op-target rules so a purge-detached successor keeps its own removable operations.
- Keep the quadratic bootstrap-planner fallback only for an actual estimator/render mismatch: an already
  over-budget base prompt returns the all-pending plan without per-candidate re-rendering, and `usedExactFallback`
  / `exactRenders` expose the diagnostic.
- Make the compaction checker a pure event-array evaluator that only accepts a complete start+summary+no-error-end
  lifecycle, requires the charter commit before the compaction start, associates the checkpoint by `compactionId`
  for leak warnings, treats post-compaction execution without a runtime snapshot as FAIL, and pairs legacy
  duplicate call ids by turn/step plus event order.
- Narrow the stored-record preservation guarantee honestly: it covers an inner schema/consistency-invalid record;
  an unreadable outer JSON document is treated as absent by the JSON storage backend and remains a documented
  residual risk (no plugin-side read-error API, no path-specific workaround). The user guide, design acceptance
  clause, verification record, and release checklist now split the two cases and give the outer-unreadable
  recovery (stop the Host, restore the file from a backup).
- Advance the connection epoch on a terminal snapshot-stream failure before publishing the error, so in-flight
  draft requests are invalidated while staged ops and the mutation id survive; a late Apply success can no longer
  be accepted and Retry reuses the mutation id.
- Refuse Rebase while an editor or a reviewed history draft owns another baseline: the Pane hides its Rebase
  action through the same `rebaseAvailable` predicate and the store refuses the call, so an explicit conflict
  entry cannot silently retarget the reviewed revision.
- Capture `bootstrapBaseRevision` when a history draft is accepted; Apply sends that revision and admission
  requires the live view to still match it with an empty charter, otherwise the draft becomes stale and must be
  re-extracted rather than silently applied to a newer revision.
- Preflight every staged edit batch through one shared `draftAdmission` (maxOps, projected maxItems, projected
  maxPendingItems with the Host stepwise rule, and prompt-budget growth/shrink): the Pane Apply button and
  `applyDraft` agree, and an inadmissible batch never reaches the Remote.
- Render the single sorted projected list for working rows instead of active-then-pending groups, so a pending
  order-1 row stays above an active order-2 row and accepting it does not reorder the list.
- Treat the first lifecycle fingerprint reported after an older Host as a lifecycle transition only for an empty
  draft; dirty work is reset (section preserved) instead of being claimed into the new lifecycle.
- Tighten the compaction checker: strict seq-ordered start→summary→end attempt state machine (no out-of-order or
  duplicate-id PASS), modern `charter_read` producing-call authentication (source seqs must identify exactly one
  earlier charter_read call matching toolCallId/turn/step), strict argument parsing (only missing/plain
  object/`standing`), WAIT exit 3 when no post-compaction activity exists (FAIL only for execution without a
  runtime snapshot), checkpoint association only by compactionId with an id-less-only fallback, and a transcript
  parser that rejects middle corruption with its line number instead of skipping lines.
- Replay a retryable unknown-outcome edit request verbatim (same mutationId/baseRevision/ops) before any current
  admission or limit check, so a committed-but-lost batch is never dropped or duplicated; Rebase is blocked while
  an attempt is unresolved and becomes available again after a deterministic replay conflict clears it.
- Make bootstrap lifecycle handling atomic: the Pane binds the lifecycle before starting extraction, a first real
  lifecycle fingerprint invalidates an extraction started under the unknown lifecycle and re-extracts, switching
  lifecycles discards the previous result and accepts only the new one, and a reviewed draft that becomes stale is
  cleaned up through one path (objective/items/base/attempt/generation cleared, `isEmpty` true).
- Preflight bootstrap drafts in the store before any Remote call (shared admission + draft text validation), and
  extend admission with the Host's objective/item field budgets (unchanged or strict shrink admitted while over
  limit; new, grown, or equal-byte-different values rejected).
- Checker follow-ups: distinguish an absent `sourceEventSeqs` from a present-but-malformed one (no legacy
  fallback), account for later landed failed/open compaction attempts (FAIL when a failed attempt landed a
  checkpoint, WAIT while an attempt is still open), keep no-activity WAIT free of false evidence failures, and
  render OPEN compaction attempts in the CLI instead of formatting a missing end time.
- Add an exact-artifact `smoke:package` mode (`--artifact <tgz> --sha256 <sums>`) that validates the supplied
  archive's SHA-256 and runs the full consumer checks on those exact bytes without building or packing, and parse
  the full `npm pack --json` output (object, keyed object, or one-element array) instead of slicing from the first
  brace.
- Lock all draft edits while an unknown-outcome Apply is unresolved through one shared `editReplayPending`
  predicate: the Pane shows an enabled **Retry last Apply** that ignores revision conflict/fresh admission and
  replays the exact stored request (same mutationId/baseRevision/ops), while stage/unstage/add/editor/discard are
  no-ops and Rebase stays blocked until a deterministic reply clears the attempt.
- Give bootstrap Apply the analogous unknown-outcome handling: replay the retained request before stale/text/plan/
  limit checks, lock candidate/objective/selection edits, derive success feedback counts from the retained request,
  keep the reviewed payload visible while a stream change arrives during an in-flight RPC (needs-stale marker
  instead of a half-dismiss), and make explicit Dismiss the single full cleanup.
- Harden the exact-artifact smoke against malicious/inconsistent tarballs: reject absolute/traversal paths,
  links/special members, duplicate members and anything outside `package/`, read the packed `package.json` from the
  archive and validate its identity/files/exports/dependencies/peers/engines against the working tree, then install
  only that verified tree.
- Tighten the compaction checker's release-blocking edges: inspect ALL attempts after the successful evidence (a
  landed-failed attempt behind a newer unlanded one still FAILs; same-id retry checkpoints associate by attempt seq
  interval), require the modern `charter_read` call's toolCallId/turn/step to be present and exactly equal, validate
  transcript event envelopes (shape/type/seq/time/data/strict ordering) with line-numbered corruption, and make
  WAIT states internally consistent (`verification.evaluated=false`, empty failures, no FAIL verdict lines; only
  evaluated active evidence can FAIL).
- Correct the release documentation: CI runs `npm run check` plus the normal `npm run smoke:package`, while the
  exact-artifact check is the local release gate after building the final tarball and before tag/push/publish; a
  separate release workflow would be needed to run it in CI.
- Unify the unknown-outcome attempt lifecycle for edit and bootstrap with one persisted
  `{request, sourceGeneration, status: in-flight|unknown}` state: transport failures and every UNAVAILABLE
  (including source-not-attached/remote unavailable) become unknown without clearing mutationId/baseRevision/ops,
  all request-changing actions and ordinary discard/dismiss are locked, Retry always resends the exact retained
  request before conflict/admission checks, and a separate confirmed **Abandon unknown request** action is the only
  way to clear the attempt; stream frames during an in-flight/unknown bootstrap Apply only mark needs-stale and keep
  the replayable payload visible. Tests drive the real controller/store paths (lost M1 + detached source +
  UNAVAILABLE → exact replay applies once; bootstrap stream-first + transport error → visible replayable draft).
- Replace the package-smoke `tar -v` text parsing with a structured Node ustar/PAX reader (node:zlib + 512-byte
  header parsing, checksum verification, GNU longname/longlink and PAX paths; regular files/directories only;
  rejects links/special/absolute/traversal/backslash/outside-package/duplicate/truncated/bad-checksum members), read
  `package/package.json` from the parsed archive before installing, and cover it with JS-built GNU/BSD/PAX fixture
  archives — Ubuntu GNU tar/`LC_ALL` differences no longer affect parsing, and both normal and exact-artifact smoke
  pass on the real final tarball.
- Centralize unknown-outcome classification for edit and bootstrap replay: every UNAVAILABLE result (including a
  detached source or an `ok:false` UNAVAILABLE reply) and every transport throw become `unknown`; the
  attempt-clearing audit guarantees generation/lifecycle/source changes preserve the exact mutationId/base/ops and
  that views can no longer drop a replayable attempt. The Pane now has one `syncView` effect backed by one store
  method (bind lifecycle → ensure bootstrap → reconcile reviewed draft atomically), so a bootstrap Apply in flight
  or replay-pending can never end invisible; `ensureBootstrap` only starts extraction and all dismissal/cleanup is
  owned by the atomic reconcile path (Retry/Abandon stay visible; ordinary dismiss stays locked while unknown).
- Release prerequisites/known limitations documented accurately: public repo + remote, restored metadata, verified
  private security reporting, public Node 22.19/24 CI (check + normal smoke only), one final tarball build,
  exact-artifact smoke + SHA + fresh-profile UI check on that same file, final annotated tag, then GitHub Release
  and `npm publish --tag next` reusing that tarball; accepted non-blocking limitations are disclosed in
  verification §9.
