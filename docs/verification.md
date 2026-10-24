# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

Verification date: 2026-10-20; re-run after the second and third readiness reviews: 2026-10-21; final-tree rerun
for the local `0.1.0-rc.1` RC build and tracked artifact digest: 2026-10-22.
Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`; current Desktop runtime DSH `0.2.0-rc.2`.
Local development dependency baseline: DSH `0.2.1-rc.2`.

This document records reproducible commands and results. Temporary directories, profiles, tarballs, and fetched
HTML live under `.tmp/` and are excluded from the published package.

## 1. Conclusion

| Item | Result |
| --- | --- |
| Strict TypeScript check (5 DSH versions) | Pass |
| Vitest (5 locally available versions × 263 tests) | Pass |
| Host ESM build + browser single-file bundle | Pass |
| Remote decorator/resource smoke | Pass (0.1.7/0.2.0 have no resource declaration, as expected) |
| Browser factory-bundle materialization and `apply` smoke | Pass |
| Real DSH profile install/compose/start (0.1.7-rc.2 / 0.2.0-rc.2) | Pass |
| Web boot graph and `/plugins` serving | Pass |
| Real browser UI (0.2.0-rc.2 Web profile) | Pass: tab order, zh/en switch, objective/invariant editing, preview, Apply, reload persistence; section 7 |
| Read-only stored view for a non-live Session | Pass: composition test covers stored view and live upgrade |
| History draft from a compaction summary | Pass: core parser (including real bullet-only summary format) + composition test on a real Session event; section 4.4 |
| Per-record storage isolation | Pass for a schema-invalid **inner** record (disables only its own Session, preserved); unreadable outer JSON is a documented residual risk, not covered; section 4.5 |
| Budget degradation and convergence | Pass: lowered budgets become `overBudget`, injection stops, shrinking edits converge; non-viable config is clamped; section 4.5 |
| Pane rendering across connection states | Pass: replay predicates and the `confirmAbandon` reset effect run above every early return, so hook order is invariant across connecting/null → ready and error/null → retry → ready; real `react-test-renderer` tests reproduce exactly the pre-fix "Rendered more hooks than during the previous render" failure and pass on the fix; section 2 |
| Session-owned client drafts | Pass: draft survival across bindings; ONE persisted attempt type `{request, sourceGeneration, status: in-flight|unknown}` shared by edit and bootstrap, where transport failures and every UNAVAILABLE (including source-not-attached/remote unavailable) become `unknown` without clearing mutationId/baseRevision/ops and only success or a deterministic business code resolves; while unknown ALL request-changing actions (edit/lock + objective/candidate/selection edits + rebase + ordinary discard/dismiss) are no-ops, the Pane enables **Retry last Apply** despite conflict/fresh admission and offers a separate confirmed **Abandon unknown request** that alone clears the attempt; stream frames never half-clean (needs-stale marker + visible replayable payload, explicit abandon/dismiss is the only full cleanup); Rebase blocked while any attempt is unresolved or an editor/history draft owns another baseline; frozen editor revision baseline; extraction-revision-gated history drafts; atomic lifecycle-bind-then-extract; shared `draftAdmission` and bootstrap store preflight; single projected display order; lifecycle-fingerprint transition; bootstrap section ownership; section 4.5 |
| Client source recovery and retry | Pass: a retry that delivers the identical revision recovers `ready` and clears the watchdog; a terminal snapshot stream advances the connection epoch before publishing its error, so in-flight drafts are invalidated (ops/mutation-id preserved) and a late success cannot clear them; Retry recreates the stream (before/after the first snapshot); section 4.5 |
| Runtime schema revalidation | Pass: a record mutated to an invalid schema after mount isolates only its Session and is preserved; section 4.6 |
| Packed artifact installability | Pass: local `npm run smoke:package` (tarball contents, exports/files, packed `core` import, client bundle; Host/Remote runtime imports are covered by the workspace build smoke), plus the exact-artifact `--artifact/--sha256` mode that validates the supplied tarball's SHA-256, parses the archive with a structured Node ustar/PAX reader (checksum verification; GNU longname/longlink; regular files/dirs only; rejects links/special/absolute/traversal/backslash/duplicates/truncation/out-of-bounds), validates the manifest stored inside the tarball, then runs the same consumer checks on exactly those bytes without building or packing; section 2 |
| Compaction checker exit criteria | Pass: pure event-array fixtures cover the strict start→summary→end lifecycle state machine, modern `charter_read` producing-call authentication where `sourceEventSeqs` must identify exactly one earlier charter call and toolCallId/turn/step must all be present and exactly equal (missing/mismatched/malformed rejected with no legacy or wildcard fallback), strict arguments, post-compaction activity gating, ALL later attempts after the successful evidence (any landed-failed attempt ⇒ FAIL even if masked by a newer unlanded one; any open attempt ⇒ WAIT), same-id retry checkpoint association by attempt seq interval, transcript envelope validation (shape/type/seq/time/data/strict ordering) with line-numbered corruption, WAIT internal consistency (pending gates set `verification.evaluated=false` with no failures and no FAIL lines; only evaluated active evidence may FAIL), OPEN attempt rendering, lost snapshot, and leak warning; section 4.7 |
| Stale async draft results | Pass: edit/bootstrap results are fenced by source/generation/request identity; empty and idle drafts are reclaimed; section 4.7 |
| Real model + compaction end-to-end | **PASS recorded 2026-10-22** on an anonymized evaluation Session: 326 shadowed messages / ~228k tokens, revision-1 charter survived, post-compaction snapshot + `charter_read` verified (section 8.4) |

## 2. Local baseline

```bash
npm run typecheck
npm test
```

Results:

- typecheck passes;
- build passes;
- 20 test files, 263 tests pass (from `npm test`, which builds and then runs `vitest run`);
- `remote-smoke` asserts `watch,bootstrap,edit`, stream mode, and Session resource;
- `client-smoke` asserts the single-file factory bundle, external-dependency allowlist, no Node-only `Buffer`
  reference, and `apply` registering the tab/pane/Remote contribution;
- `smoke:package` builds, packs the tarball, verifies required files/modes and every `exports` target, rejects
  leaked workspace files, installs the tarball into an **empty consumer project** with only its declared
  dependencies, and loads the packed `dsh-charter/core` entry plus the client bundle. In exact-artifact mode
  (`--artifact <tgz> --sha256 <sums>`) it never builds or packs: it validates the supplied archive's SHA-256 against
  the sums file, parses the gzipped archive with a structured Node ustar/PAX reader (512-byte headers,
  checksum verification, GNU longname/longlink, PAX paths; regular files/directories only; rejects symlink/
  hardlink/character/block/fifo members, absolute/traversal/backslash/outside-`package/` paths, duplicates,
  truncated/out-of-bounds data and bad checksums) and validates the manifest stored inside the archive (identity
  plus files/exports/dependencies/peers/engines must agree with the working tree; the packed manifest is the source
  for export/dependency checks), then runs the same consumer checks on exactly those bytes. No platform `tar`
  text output is parsed (so Ubuntu GNU tar/`LC_ALL` differences are irrelevant to parsing), and the release asset
  and the `npm publish` input are the verified file. The `npm pack --json` parser handles the object,
  package-name-keyed object, and one-element array forms emitted across npm 10/11/12.

CI (`.github/workflows/ci.yml`) runs `npm run check` and `npm run smoke:package` for Node `22.19.0` and
Node `24`; the local gates recorded in this document ran on Node `v22.23.1`.

Key test files:

| File | Coverage |
| --- | --- |
| `tests/core/commands.spec.ts` | objective, items, supersede, transitions, purge lifecycle guard, `item.propose` clientRef minting, whole-batch rollback |
| `tests/core/record.spec.ts` | atomic commit, idempotency, revision, history pruning, tamper detection |
| `tests/core/prompt.spec.ts` | deterministic rendering, `{{` escaping, UI preview/Host render parity |
| `tests/core/normalize-render.spec.ts` | NFC, control characters, byte limits, 100-render stability |
| `tests/core/state.spec.ts` | supersede chain must point at a current successor |
| `tests/core/fork.spec.ts` | fork id re-minting and supersede remapping |
| `tests/core/bootstrap.spec.ts` | section extraction, latest objective, UTF-8 split/no truncation, latest/broken summary, fallback to an older usable summary |
| `tests/host/composition.spec.ts` | real Cordis/Storage/SystemPrompt/Tools composition, user-role boundary, actor policy, mixed `item.add` + `item.propose` atomic Apply, user-actor proposals, complete standing view vs bounded `all`, one schema-invalid record isolated from other Sessions, lowered-budget over-budget convergence, non-viable config clamp, successful child-retry ready frame, fork, idempotency, quota, parent-cycle rejection, lifecycle, non-live stored view + live upgrade, draft from a real `compaction/summary` event |
| `tests/host/watch.spec.ts` | opening snapshot, race, dedupe, abort, decorator compatibility, resource-scope capability detection |
| `tests/host/actor.spec.ts` | principal-aware policy: modern missing-principal denial, legacy-only owner fallback, non-owner recording, generation-aware `resolveRemoteActor` |
| `tests/host/remote.spec.ts` | Remote descriptor, wire schema, legacy Host view snapshot, zero pending limit |
| `tests/client/store.spec.ts` | accept committed view immediately, ignore stale/duplicate revisions, monotonic opening snapshot, authoritative availability demotion, attach retry, identical-snapshot retry recovery and watchdog clearing, terminal stream recreation on Retry (before/after first snapshot), terminal-failure connection-epoch advance with a late Apply success rejected and mutation-id-preserving retry, real-controller unknown-outcome edit recovery (committed-but-lost M1 → detached source → UNAVAILABLE keeps the exact request and locks edits → reattach replays the same mutation id with exactly one committed item), pending-attach cancellation before its stream starts, shared source lease/ref count, stale-lease no-op, foreign-Session stream frames ignored |
| `tests/client/bootstrap-plan.spec.ts` | overflow candidates stay in one plan; O(1) incremental byte accounting with 3,000 all-active, mixed, and 2,000 CRLF/NFD cases; over-budget base objective returns an all-pending plan without the quadratic fallback (`usedExactFallback`/`exactRenders` diagnostics); per-candidate outcomes; bootstrap outcome classifier (draft/discard/stale/unavailable) |
| `tests/client/draft.spec.ts` / `tests/client/draft-store.spec.ts` | Session-scoped request guard (Session A ops never build a request for Session B); draft survival across binding unmount/remount; unified `{request, sourceGeneration, status}` attempt lifecycle: transport/UNAVAILABLE transitions to unknown without clearing mutationId/baseRevision/ops, all request-changing actions locked, exact replay before admission, deterministic business error resolves/unlocks, explicit abandon is the only clear path (dismiss/discard locked while unknown), bootstrap stream-first + transport error keeps a visible replayable payload and retries the exact request (success feedback from the retained request); Rebase blocked while an attempt is unresolved; conflict rebase blocked while an editor is open; frozen editor revision baseline; extraction-revision-gated history draft; atomic A→B lifecycle switch; unknown→defined lifecycle invalidation/re-extraction; bootstrap store preflight; shared `draftAdmission`; normalized admission limits; order allocation after unstage; lifecycle null→fingerprint transition; stale async results cannot overwrite newer draft/source/lifecycle; bootstrap does not steal the section |
| `tests/client/pane-hooks.spec.tsx` | REAL `react-test-renderer` rendering of the exported `CharterPane` (no DOM/testing-library): connecting + null view → ready snapshot, error + null view → retry → ready, and ready → revision updates; the pre-fix hook placement fails the first two with React's "Rendered more hooks than during the previous render", the fixed Pane renders all transitions |
| `tests/client/preview.spec.ts` | projected draft rows for add/edit/accept/progress/supersede/purge; purge detaches the successor's supersedes link; committed-fixture purge ordering keeps a directly staged successor's Unstage and hides it only for a derived-only row; renderer parity and pending exclusion; single projected display order for pending/active rows (stable after acceptance); order-based (not Host-id) rendering; prompt-budget Apply admission (shrinking, same-size, growing, and within-budget renders) |
| `tests/verify/compaction-checks.spec.ts` | compaction checker fixtures: strict lifecycle state machine (valid, failed end, end-before-start, summary-before-start, same-id retry); modern `charter_read` producing-call authentication (valid; malformed/absent-vs-present `sourceEventSeqs` including dual mismatch, other-tool reference, toolCallId/turn/step mismatch, non-finite or ≥result source seq, ambiguous/non-charter call) and legacy duplicate-callId pairing; strict arguments (missing/plain-object/standing valid, every malformed shape rejected); activity gating (no activity = WAIT exit 3 with `verification.ok` and no failures; execution without snapshot = FAIL); later attempts (open attempt WAIT, landed failed attempt FAIL, unlanded failed attempt keeps the earlier PASS); checkpoint association by `compactionId` (other-id never associated, id-less fallback warned); dirty system prompt; commit-between-start/end re-compaction; exit code/JSON verdict/text/warnings assertions; exact compact standing projection |
| `tests/verify/transcript-parser.spec.ts` | CLI fixtures: a torn final line (incomplete append) is ignored, while a malformed middle line and a malformed complete final line both fail with line numbers and never PASS; a start-only compaction attempt renders OPEN without a RangeError and returns WAIT |
| `tests/verify/package-smoke.spec.ts` | pack JSON parsing for object/keyed-object/array npm output (full-output parse), SHA sums resolution and exact-artifact digest verification (match + mismatch + missing entry), structured Node tar parsing of JS-built GNU/BSD ustar, PAX long-path and GNU longname archives plus rejections (symlink/hardlink/fifo, duplicates, traversal, absolute, outside-package, corrupt checksum, truncated data), packed-manifest identity/files/exports/dependencies/peers/engines validation against the working tree, and artifact-mode argument pairing |

## 3. Cross-version matrix

Each version uses its own directory and `node_modules`:

```text
.tmp/compat/017rc2/proj
.tmp/compat/020rc1/proj
.tmp/compat/020rc2/proj
.tmp/compat/021rc1/proj
.tmp/compat/021rc2/proj
```

Copy source (excluding `node_modules`, `lib`, `.build-ts`, `.tmp`), link the version's `node_modules` into
`proj`, then run:

```bash
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

Results:

| Version | typecheck | build | Vitest | remote smoke | client smoke |
| --- | --- | --- | --- | --- | --- |
| `0.1.7-rc.2` | Pass | Pass | 260/260 | Pass (no-resources warning) | Pass |
| `0.2.0-rc.1` | Pass | Pass | 260/260 | Pass (no-resources warning) | Pass |
| `0.2.0-rc.2` | Pass | Pass | 260/260 | Pass (no-resources warning) | Pass |
| `0.2.1-rc.1` | Pass | Pass | 260/260 | Pass | Pass |
| `0.2.1-rc.2` | Pass | Pass | 260/260 | Pass | Pass |

Re-run on the final `0.1.0-rc.1` tree on 2026-10-22: each version reports 19 test files / 260 tests, and build
includes the remote/client smoke assertions.

This five-version matrix is **local evidence**: its version directories and driver script live in the gitignored
`.tmp/`, so the public CI does not reproduce it. CI (`.github/workflows/ci.yml`) runs the committed gates
(`npm run check` + `npm run smoke:package`) on Node `22.19.0` and Node `24`.

`0.1.7-rc.2` and `0.2.0` remote smoke prints:

```text
remote-smoke: this DSH generation has no @Remote resources; per-Peer Session authorization is unavailable (expected on 0.1.7/0.2.0).
```

`0.2.1` prints no warning and asserts `resources.session` on both methods.

Reproduce a version directory (example):

```bash
mkdir -p .tmp/compat/020rc2
cd .tmp/compat/020rc2
printf '{"name":"compat-020rc2","private":true,"type":"module"}\n' > package.json
pnpm add --store-dir ../../pnpm-store \
  @deepseek-ai/cordis@4.0.4 \
  @deepseek-ai/dsh-agent@0.2.0-rc.2 \
  @deepseek-ai/dsh-agent-loop@0.2.0-rc.2 \
  @deepseek-ai/dsh-api-gateway@0.2.0-rc.2 \
  ... # remaining dsh-* packages at the same version
cd ../..
rsync -a --exclude node_modules --exclude lib --exclude .build-ts --exclude .tmp ../../ ./proj/
ln -sfn ../node_modules ./proj/node_modules
```

The full package list is in `.tmp/compat/020rc2/package.json`, or replace versions in the root `devDependencies`.

## 4. Prompt boundary and compaction recovery

### 4.1 user-role boundary

`tests/host/composition.spec.ts` verifies against a real `SystemPrompt` assembly:

- `assembly.contexts` contains `charter:standing`;
- `renderContextSnapshot(assembly)` contains the charter body;
- `renderPrompt(assembly)` and `assembly.sections` do not contain it;
- re-assembly produces identical bytes;
- after an edit, re-assembly reads the new objective and no longer contains the old one.

User body enters runtime context (user role) only, never the system-role prompt.

### 4.2 `{{...}}` interpolation safety

The same test writes `Mention {{name}} and {{unknown}} literally in the docs`, then assembles on
`0.1.7-rc.2` and `0.2.0-rc.2` `SystemPrompt`. Results:

- assembly does not throw an unknown prompt variable;
- rendered text contains no `{{name}}`;
- JSON contains `\u007b{name}`;
- `JSON.parse` restores the original text.

`0.2.1+` additionally sets `interpolate:false`; escaping makes both versions behave identically.

### 4.3 Re-materialization after compaction

Every assembly's `text` provider calls `charter.promptText(session)`, which synchronously reads the storage
authority and validates the derived digest; it reads no Session summary or retained-snapshot cache. DSH
`0.2.0-rc.2` `RuntimeContextProjection` clears retained when the retained snapshot is shadowed by
replacement/compaction, and the next `project()` regenerates text from current providers.

Therefore:

- unit/composition level verifies "every assembly reads authority" and "re-assembly is byte-stable";
- platform level verifies the runtime-context re-materialization path;
- the runtime check (`npm run verify:compaction`) is defined in section 8; a real-model compaction **PASS is recorded in §8.4 (2026-10-22)** and the manual command is retained for a fresh target-profile re-run.

### 4.4 History draft from a compaction summary

`tests/core/bootstrap.spec.ts` uses a representative summary to verify:

- `Latest correction` is preferred as the objective, then `Original`, then the first primary bullet (the real
  DSH summary format), then the first paragraph;
- Primary Request user-want bullets and requirement-like Critical Context lines become candidate invariants;
- Pending Jobs / Next Step bullets become candidate deliverables;
- text over the per-item byte limit is split into multiple candidates at sentence/clause/code-point boundaries without dropping content;
- malformed/empty summaries are skipped and the latest usable summary wins;
- unstructured text can still be an objective, but no items are fabricated.

`tests/host/composition.spec.ts` appends a `compaction/summary` event to a real Session, calls
`service.bootstrap()`, and verifies the objective/deliverables and `shadowedTokenCount` source metadata. It also
confirms the call itself does not change the revision or write storage; only a user Apply turns the draft into
revision 1 through the normal atomic edit.

The UI auto-draft panel depends on a client `useEffect` and the Remote bootstrap method. §8.4 records that
panel's draft being reviewed and applied as revision 1 in a real compacted Session; the genuine remaining gap is
that no browser screenshot of the auto-draft panel itself was captured, and the client path is covered by
typecheck/build plus Remote contract tests.

### 4.5 Record isolation, budget degradation, and client draft ownership

The third readiness review added platform-level regression coverage for degradation paths that previously had
only static review:

- **Invalid record isolation.** A persisted record document with an unexpected field is written directly under
  `storages/dsh_charter_v1/sessions/<id>.json`. After remounting, that Session is `unavailable` and its raw file is
  unchanged, while an unrelated Session still reads, injects, and edits its charter.
- **Residual risk: unreadable outer JSON.** The JSON storage backend deliberately reads a malformed or
  version-rejected per-record document as **absent** (`readRecord` catches every read/parse error), and the
  plugin-side `KvTable` exposes no read-error signal or raw-file view. Without a path-specific hack or a layout
  switch, the plugin cannot distinguish an unreadable record from a missing one, so service initialization would
  create a fresh empty record on the next write instead of preserving the unreadable bytes. The "raw document is
  preserved" guarantee therefore applies **only** to an inner schema/consistency-invalid record, not to unreadable
  outer JSON. This is a known residual risk, not a closed issue; it is also recorded in
  `docs/releasing.md` release-state checks. Operational recovery for the outer-unreadable case: stop the Host
  before it initializes that Session, back up and repair the record file, then restart — the plugin itself cannot
  detect or prevent the overwrite.
- **Lowered budgets.** A charter created with the default 8 KiB budget is remounted with `maxPromptBytes: 300`.
  The view is `ready` + `overBudget`, `promptText()` returns `''` (no injection), adding content returns
  `QUOTA_EXCEEDED`, and archiving the items is admitted because the prompt shrinks; the view then leaves
  `overBudget`.
- **Non-viable configuration.** `maxPromptBytes`, `maxRecordBytes`, and `maxHistoryBytes` set to `1` are clamped
  to documented minimums with a Host warning, so the Session is not ready-but-permanently-uneditable.
- **Initialization retry.** A child Session created before its parent record is durable first reports
  `unavailable`; after the parent appears, the transcript snapshot race is fixed (transient failure is cleared
  before `put` publishes and a ready frame is published afterwards).
- **Client ownership.** Unit tests cover: a draft survives unmount/remount; an unknown-outcome retry reuses the
  mutation id; a conflict rebase mints a fresh id; a bootstrap response never steals the section while an editor
  is open; projected items render the staged state before Apply.
- **Connection recovery and terminal retry.** `publishIfNewer` separates connection readiness from business-data
  dedupe: a retry/reattach that delivers the identical revision publishes `ready` and clears the first-frame
  watchdog, while an identical revision on an already-ready pane stays deduped. A snapshot stream that ends or
  fails is terminal: it is disposed and cleared, so Retry recreates the Remote watch instead of restarting an
  aborted lifetime (tested before and after the first snapshot, with no timeout after the new snapshot).
- **Draft revision baseline and admission.** The editor captures `editorBaseRevision` at open time (an existing
  staged batch's baseline, else the view revision); saving an objective/item edit stages against that frozen
  baseline, so an unrelated remote commit cannot silently retarget the edit, and only an explicit rebase advances
  it. Byte budgets, unchanged checks, reasons, candidate limits, and generated op text all use
  `inspectUserText(...).value`, so CRLF/NFD input cannot bypass or waste the limit (contraction and expansion
  fixtures), and a normalization-only edit counts as unchanged while other valid ops still stage.
- **Order allocation and purge derivation.** The next staged order is committed max + 1 + the max effective order
  among current staged add/propose/supersede/order-edit ops, so an add/unstage/add sequence never reuses an order;
  projected rows derive `staged`/`unstageTarget` from the actual op-target rules, so a purge-detached successor
  that is also directly edited/verified keeps its Unstage (which removes only its own ops), while a purely derived
  link detach hides Unstage.
- **Rebase restriction and bootstrap baseline.** `rebase()` (and the Pane action via the shared
  `rebaseAvailable` predicate) refuses while an editor is open or a reviewed history draft owns its own baseline;
  saving the old editor then applying still yields the revision conflict until an explicit rebase after closing
  it. A history draft captures `bootstrapBaseRevision` when accepted; Apply sends that revision and admission
  requires the live view to still match it with an empty objective/items, otherwise the draft becomes stale and
  must be re-extracted (`Re-extract`) instead of silently using the current revision. Rebase never advances the
  bootstrap baseline.
- **Shared admission and display order.** One pure `draftAdmission(view, ops)` preflight (maxOps, projected
  maxItems/maxPendingItems with the Host's stepwise rule, prompt-budget growth/shrink rule) drives both the Pane
  Apply button/notice and `applyDraft()`, which refuses an inadmissible batch without any Remote call. The Pane
  renders the single sorted projected list (`visibleItems`) rather than active-then-pending groups, so a
  pending order-1 row stays above an active order-2 row and accepting it does not reorder the list.
- **Lifecycle fingerprint transition.** A draft bound to an older Host with no fingerprint that receives its
  first fingerprint while non-empty is reset (section preserved) instead of claiming dirty work into the new
  lifecycle; an empty draft simply binds the fingerprint.
- **Unified unknown-outcome attempt state machine (edit + bootstrap).** One persisted attempt type
  `{request, sourceGeneration, status: 'in-flight' | 'unknown'}` is shared by edit Apply and bootstrap Apply (no
  inference from feedback strings). A transport throw or any `UNAVAILABLE` result — including a detached source or
  an unavailable Remote — transitions in-flight→unknown and never clears the mutationId/baseRevision/ops; only a
  success or a definitive business code (REVISION_CONFLICT, QUOTA_EXCEEDED, INVALID_ARGUMENT, …) resolves/clears it.
  While unknown, EVERY request-changing action is locked: edit stage/unstage/add/save-editor/open-editor/text
  setters, bootstrap objective/candidate/selection edits, Rebase, ordinary Discard and ordinary Dismiss. The Pane
  derives its controls from the same exported `editReplayPending`/`bootstrapReplayPending`/`unknownAttempt`
  predicates: **Retry last Apply** stays enabled despite revision conflict or fresh admission failure and always
  resends the exact retained request before checks; a separate **Abandon unknown request** action with a
  confirmation step is the only path that clears the unknown attempt (keeping staged ops / the reviewed bootstrap
  payload). Stream frames never half-clean: a non-empty frame during an in-flight/unknown bootstrap Apply only sets
  a needs-stale marker and keeps the payload, attempt and base visible; success does the full cleanup; an unknown
  error leaves the reviewable/replayable draft; explicit abandon/dismiss is the only full cleanup and advances the
  generation. Tests use the real controller/store paths: committed-but-lost M1 + detached source + replay
  UNAVAILABLE keeps the exact request and locks every edit; reattach replays the same mutation id and the Host
  receipt applies exactly once; a deterministic conflict resolves and unlocks; bootstrap stream-first + transport
  error stays visible/replayable and retries the exact request. Classification is centralized: every UNAVAILABLE
  result (including a detached source or an ok:false UNAVAILABLE reply) and every transport throw become unknown;
  the attempt-clearing audit guarantees that generation/lifecycle/source changes update only attempts matching the
  request's mutationId and never drop the credentials. Only the Pane's single `syncView` effect (store-side
  bindLifecycle → ensure bootstrap → reconcileBootstrapView) reacts to views; `ensureBootstrap` only starts
  extraction and every reactive dismissal/cleanup is atomic, so a replay lock can never become invisible.
- **Bootstrap lifecycle, cleanup, preflight, replay, and atomic state.** The Pane binds the lifecycle before
  calling `ensureBootstrap` (one effect), a first real fingerprint invalidates an extraction started under the
  unknown lifecycle and starts a new one for the defined lifecycle, and a lifecycle switch discards the previous
  extraction (only the new lifecycle's result can be accepted). A reviewed draft whose live view turns non-empty
  goes through a single stale/dismiss cleanup that clears objective/items/base/attempt/generation and leaves
  `isEmpty` true — except while an Apply is in flight or replay-pending, where the change only marks
  `bootstrapNeedsStale` and the reviewed payload and attempt stay visible. Before any fresh Remote call,
  `applyBootstrap` runs the same text validation and extended admission as the Pane. When a bootstrap Apply has an
  unknown outcome, the shared unknown-attempt state locks objective/candidate/selection edits and applies the same
  replay-before-stale/admission rule: Retry resends the exact retained request (same mutationId/baseRevision/ops),
  success feedback counts come from the retained request (never a fresh re-plan), transport/UNAVAILABLE keeps the
  visible replayable draft, ordinary Dismiss is locked, and the confirmed **Abandon unknown request** decision (or
  a resolved attempt, then Dismiss) is the only path to clear the attempt and perform the one full cleanup.
- **Field budgets.** Shared admission also mirrors the Host `maxObjectiveBytes`/`maxItemBytes` rules: an unchanged
  or strictly shorter over-limit value is admitted, while a new, grown, or equal-byte-different value is rejected
  (`max-objective`/`max-item` reasons); `applyDraft` refuses such a batch without any Remote call.
- **Planning scale.** The bootstrap planner uses O(1) incremental byte accounting that mirrors the exact prompt
  renderer: it is tested with 2,000 mixed candidates and 3,000 all-active candidates, reports per-candidate
  active/pending outcomes, and keeps a final exact render as verification/fallback for the budget.

### 4.6 Runtime integrity, permission fail-closed, and client state boundaries

The fourth readiness review targeted failure paths that only appear after startup or under a broken runtime:

- **Runtime schema revalidation.** After the service mounts normally, a test writes a record with
  `recordSchemaVersion: 2` directly into the table. `recordFor()` and the edit transform re-parse every
  stored document; only that Session becomes `unavailable`, its prompt is empty, an edit returns
  `UNAVAILABLE`, and an unrelated Session still reads and writes.
- **Remote decorator fail-closed.** The compatibility layer only falls back when the modern factory throws
  the documented unsupported-options error; an arbitrary modern-factory exception now propagates and leaves
  `resourceScopes` unset, so missing principals cannot be downgraded to the owner fallback.
- **Draft lifecycle and memory bound.** Drafts carry the Host-provided Session lifecycle fingerprint and reset
  staged work/editors/history when it changes; released drafts are evicted by a bounded LRU so long browsing
  cannot grow the map without limit.
- **Shared text validation.** `inspectUserText()` is used by both Host normalization and the client editor
  (`\u0000` / unpaired surrogate are rejected at stage time with localized feedback) and by reviewed history
  candidates before Apply.
- **Pending vs active.** Active UI counts and Overview cards only include `accepted + current`; pending
  proposals remain visible as their own rows, and the reconnect banner explains the temporary read-only state.
- **Debug projection and envelope.** `charter_read all` now carries origin/order/createdRevision/supersede
  chain/verification provenance, and its 32 KiB cap is measured against the final tool envelope (tested with
  30 large archived items). `overBudget` also reflects lowered history/mutation count limits.
- **Accessibility and alert hygiene.** At most one over-budget alert renders (blocking staged draft > stored
  over-budget record > admitted over-budget render) with one remedy; `status`/`alert` roles wrap only message
  text so action buttons are never nested in a live region; the item action menu is a plain `<details>`
  disclosure with normal buttons (no menu-button ARIA contract), purge confirmation autofocuses its confirm
  button, cancellation returns focus to the summary, and focus never falls to `<body>` after row actions.
  Replacement/verification reasons are visible text instead of title attributes; the idle history phase has a
  dedicated no-draft message.
- **Packaged artifact gate.** The local `npm run smoke:package` gate packs the tarball and verifies required
  files, every `exports` target, no workspace leakage, the packed `core` import, and the packed client bundle;
  Host/Remote runtime imports need the Host peer graph and are covered by the workspace `remote-smoke` /
  `client-smoke`, not by the empty consumer. CI runs the same gate (`.github/workflows/ci.yml`).

### 4.7 Checker exit criteria, draft async fencing, and online repair

- **Compaction checker (fixtures).** The event→report decision is a pure function in
  `scripts/verify/compaction-checks.mjs`; `tests/verify/compaction-checks.spec.ts` feeds it plain event arrays and
  asserts exit code, JSON verdicts, text verdict lines, and warnings. Covered: the strict seq-ordered compaction
  attempt state machine (a successful attempt needs start < summary < end with the same id and no end error;
  end-before-start / summary-before-start never PASS; same-id retries are independent); modern `charter_read`
  authentication via a *present* `sourceEventSeqs` requiring exactly one earlier producing `charter_read` call
  whose callId/turn/step are all present and exactly equal to the result's message `toolCallId`/turn/step
  (missing identity fields, malformed values and a mismatched top-level/data pair are rejected without any legacy
  or wildcard fallback; other-tool references, ambiguities and non-earlier seqs are rejected; an absent field uses
  legacy turn/step/callId pairing) plus strict argument parsing (only missing, a plain object, or `view:"standing"`
  is valid) and non-error/standing evidence; post-compaction activity gating (no request activity at all is WAIT
  with no false evidence failures; execution without a runtime snapshot is FAIL); EVERY later compaction attempt
  after the successful evidence (any open attempt = WAIT; any failed attempt that landed a checkpoint = FAIL even
  when a newer unlanded attempt follows; failed without a checkpoint keeps the earlier PASS; a later successful
  attempt needs new post-compaction evidence); WAIT internal consistency (pending gates set
  `verification.evaluated=false` with empty failures and no FAIL verdict lines; only evaluated active evidence may
  FAIL); checkpoint association by the attempt's seq interval plus id (so same-id retries never inherit an older
  attempt's checkpoint) with an id-less-only positional fallback; an OPEN attempt renders without formatting a
  missing end time; leak warnings; and a pure transcript parser that validates each event envelope (plain object,
  non-empty type, non-negative safe integer seq, finite time, object data, strictly increasing unique seqs) and
  refuses middle corruption/envelope violations with line numbers instead of skipping lines. The transcript reader
  builds the same compact standing projection as the Host (`kind`/`text`/`verification`/`progress`) and all
  required evidence participates in the exit code; only a WAIT/BLOCKED state short-circuits before evaluation.
- **Draft async fencing.** Edit and bootstrap Apply capture `asyncGeneration`, the source instance and its monotonic
  connection epoch, lifecycle, and request ops identity; a late result from a destroyed source or from a
  detach/reattach cycle cannot clear or overwrite a newer draft. Source invalidation preserves the mutation id for
  an idempotent retry, and attach/detach/retry each invalidate in-flight results.
- **Draft reclamation.** The last lease release drops an empty draft immediately; released drafts have an idle TTL
  and an LRU bound, so tab switching does not retain unbounded text while active work survives.
- **Online repair.** After a runtime-invalid record is repaired in place, the next view/initialize re-parses it and
  the Session becomes editable again without a Host restart; a still-invalid document remains isolated and its raw
  bytes are preserved.

Additional round-out coverage:

- **Session disposal.** `session/disposed` now closes every open watch subscription (listeners receive `null`),
  so a blocked `charter watch` generator ends instead of waiting on a queue whose listener was removed; a
  dispose/close fixture covers this path.
- **Lifecycle replacement.** Host frame deduplication compares `lifecycle`, and the client accepts a new
  lifecycle even when its revision restarts at 0 or its digest repeats; a same-ID new lifecycle therefore reaches
  the Pane and clears the old draft.
- **Saving locks.** Unstage is rejected (and disabled) while an Apply is in flight; all bootstrap objective,
  candidate, checkbox, and select-all controls are disabled while the save request runs, and setters reject edits.
- **History draft retention.** `isEmpty` treats a reviewed bootstrap draft as dirty, so the lease-release cleanup
  no longer deletes it on a Chat/Charter switch.
- **Stepwise shrinking.** An already over-budget objective or item may be shortened even while it is still over
  the limit; tests shorten objective and item in two steps and leave `overBudget` in the end.
- **Oversized objective in `all`.** If the objective alone cannot fit the 32 KiB debug envelope, the `all` view
  returns `objective: null` with `objectiveTruncated: true` instead of exceeding the response cap; standing still
  carries the complete objective.
- **Bootstrap metadata.** `shadowedTokenCount` is validated as a non-negative integer on the Host side too, so
  negative values are skipped before they can reach the strict Remote codec.
- **Consumer install.** `smoke:package` now performs a real empty-project install using only the tarball and its
  declared dependencies, checks public file modes, and loads the packed `core` entry (root/Remote runtime imports
  are covered by the workspace build smoke); it no longer symlinks the workspace `node_modules`.
- **Watch/stream generation races.** The service's unsubscribe removes a Map entry only when it still owns the
  captured listener Set (a disposed generation cannot delete a same-id replacement watch); duplicate attach of a
  live stream is a no-op, and old stream `replace`/`update` frames are dropped by their attach generation.
- **Pending attach cancellation.** `attach(B)` while the previous stream is still disposing, then `detach(B)`
  before the new attach owns the remote: the pending generation is cancelled, so the late resolution never creates
  the `B` stream and the source reports itself detached (test in `tests/client/store.spec.ts`).
- **Prompt-budget Apply gate.** The Pane's Apply button now uses the Host's exact `overLimitGrowth` rule: an
  over-budget rendered prompt is blocked only when the edit makes it grow, so a shrinking or unchanged over-budget
  render is admitted; unit tests cover shrinking, same-size, growing, and within-budget renders.
- **Saving locks and export guards.** Rebase is disabled/rejected while Apply or bootstrap saving runs; bootstrap
  extraction is fenced by source instance + connection generation; dirty drafts are never removed by idle TTL or
  LRU; the editor accepts a stepwise over-budget shrink for objective and same-id item edits.
- **Config-frame delivery.** The first lifecycle fingerprint is accepted even at a lower revision, and client
  dedupe now compares `overBudget` and every limit so tightened-budget snapshots reach the Pane.

## 5. Browser bundle verification

The DSH Web module loader requires:

- a single file;
- `window.__ModuleLoader__.load({ id, factory })`;
- `require()` inside the factory for the baseline (React) and `dsh.client.external` dynamic modules;
- no relative chunks or standalone CSS import.

Post-build checks:

```bash
head -3 lib/client.js
grep -n "^import\|require(\"" lib/client.js | head
ls lib/*.css
```

Results:

- `lib/client.js` starts with `window.__ModuleLoader__.load({ id: 'dsh-charter', factory: (require) => {`;
- only `react`, `react/jsx-runtime`, and `@deepseek-ai/dsh-api-gateway/client` are required;
- zod is bundled; no `require("zod")`;
- no relative `require`;
- `lib/client.css` is inlined and removed;
- CSS is injected inside the factory with `data-plugin-css="dsh-charter/charter.css"`; repeated materialization
  does not insert it twice.

`scripts/verify/client-smoke.mjs` executes the real bundle with a fake module loader and fake client context:

- `registration.id === 'dsh-charter'`;
- the factory requests only allowlisted modules;
- exports `apply` and `inject`;
- `apply` registers exactly one `conversation.view` `charter` entry, pane component, and Remote contribution;
- with existing tabs chat 0 / trajectory 10 / context 20, `charter` registers once at the stable order 1000 and is
  last;
- a simulated later `fleet` tab and a higher-order `future-plugin` tab neither duplicate nor reorder `charter`,
  and the bundle neither queries nor subscribes to the slot roster;
- Chinese label is `会话契约`; English label is `Charter`.

The pane's full dictionary is typed against `LocaleNamespaceMap`; TypeScript rejects a missing key in either
language.

## 6. Real profile smoke

### 6.1 Create an isolated profile

```bash
mkdir -p .tmp/smoke/home
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --from-default-profile web --dump-config > /dev/null
```

The generated `profiles/smoke/package.json` contains `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`.

### 6.2 Install the tarball

```bash
npm pack --pack-destination .tmp/smoke
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh plugin --profile smoke add "$PWD/.tmp/smoke/dsh-charter-0.1.0-rc.1.tgz"
```

Install succeeds; the profile `bundles` gains `dsh-charter`; DSH compatibility accepts the peer range.

### 6.3 Composition check

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --dump-config | grep -A 20 'id: charter'
```

Output contains:

```yaml
- id: charter
  name: dsh-charter
  config: { ... }
- id: charter-remote
  name: dsh-charter/remote
```

### 6.4 Startup and HTTP

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --no-open --port 19388
```

The log prints a token URL. After opening it:

- `/` returns 200;
- the `__DSH_BOOT__` entries contain:

```json
{
  "id": "dsh-charter",
  "url": "plugins/??dsh-charter/client.js&rev=...",
  "inject": [
    "@deepseek-ai/dsh-api-gateway",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-session",
    "@deepseek-ai/dsh-client-ui-slots"
  ],
  "external": ["@deepseek-ai/dsh-api-gateway/client"]
}
```

- `plugins/??dsh-charter/client.js&rev=...` returns 200 and starts with `window.__ModuleLoader__.load`.

This proves Host composition, client-bundle publishing, boot graph, and external dependency declarations.

### 6.5 Two starts and uninstall recovery

Start the same profile twice: the `dsh-charter` `rev` is unchanged, both `/` return 200, and both client
entries return 200 with the loader prefix.

Then:

```bash
dsh plugin --profile smoke remove dsh-charter
```

Profile `bundles` returns to `dsh-base` + `dsh-web-app`; restarting `dsh web` still returns 200 and the boot
graph contains zero `"id":"dsh-charter"` entries. Uninstall does not break profile startup.

Finally reinstall from `dist/dsh-charter-0.1.0-rc.1.tgz` and start once: `/` returns 200, the boot graph contains the
`inject`/`external` entries, and the client entry returns 200 with the inline CSS marker
`data-plugin-css="dsh-charter/charter.css"`.

### 6.6 DSH 0.1.7-rc.2 profile

Install the matching CLI:

```bash
mkdir -p .tmp/dsh017
cd .tmp/dsh017
pnpm add --store-dir ../pnpm-store --config.dangerously-allow-all-builds=true @deepseek-ai/dsh@0.1.7-rc.2
./node_modules/.bin/dsh --version   # 0.1.7-rc.2
```

Create an isolated profile and install the tarball:

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --from-default-profile web --dump-config > /dev/null
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  plugin --profile smoke017b add "$PWD/dist/dsh-charter-0.1.0-rc.1.tgz"
```

The first attempt with an older tarball was rejected because its peer range only covered 0.2.x. After adding
`0.1.7-rc.2` to `peerDependencies` and repacking, the new profile installs successfully. This confirms DSH's
compatibility check runs before install.

Start:

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --no-open --port 19389
```

Results: `/` returns 200; the boot graph contains `dsh-charter` `inject` and
`external:["@deepseek-ai/dsh-api-gateway/client"]`; the client entry returns 200 and starts with
`window.__ModuleLoader__.load`. Remote smoke prints the expected no-resource warning.

After adding the `conversation.view` tab, a new profile `smoke017c` installed the final tarball: the boot graph
`inject` contains `@deepseek-ai/dsh-client-locale` and `@deepseek-ai/dsh-client-ui-conversation`, the client
bundle registers the view once at stable order 1000 (no `ensureLast` loop), and `/` plus the client entry both
return 200.

## 7. Browser UI (0.2.0-rc.2 Web profile)

With user-approved out-of-sandbox access, a local Chrome instance was driven with headless CDP against an
isolated Web profile:

```bash
# Chrome at desktop size, CDP port 9223
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --disable-crash-reporter \
  --window-size=1440,900 --remote-debugging-port=9223 \
  --user-data-dir="$PWD/.tmp/webview/chrome-desktop" about:blank

# Web profile on 19391, opening the existing test Session
DSH_HOME="$PWD/.tmp/webview/home" dsh --profile charterweb2 --no-open --port 19391
```

CDP performed real mouse, keyboard, and navigation actions.

### 7.1 Tab placement and names

Actual tab-bar text:

```text
Chat    Trajectory    Charter
```

- Charter follows Chat and Trajectory;
- after installing `dsh-context@0.73.3`, the actual order becomes
  `Chat / Trajectory / Context / Fleet / Charter`, with Charter still last;
- Chinese label is `会话契约`; English label is `Charter`; both come from `dsh-client-locale`;
- `client-smoke` registers a later tab and a higher-order tab: the single Charter registration keeps its stable
  order with no duplicate entry, roster query, or slot subscription;
- a blank Session hides the View tab bar; it appears after the first message.

Screenshots: [Chinese pane](assets/charter-pane.png), [English pane](assets/charter-pane.en.png).

### 7.2 Objective editing, preview, and Apply

> The 191 B / 220 B values below are from the pre-redesign functional run; the 7.6 screenshots use a later
> 47 B objective and 240 B context.

In the Charter tab:

1. click **Set objective**, enter `Ship the charter tab safely`, click **Stage**;
2. the pane shows `1 staged change`;
3. click **Preview context**: `191 bytes`, body
   `{"objective":"Ship the charter tab safely","invariants":[],"deliverables":[]}`;
4. click **Apply**: revision `0` → `1`, objective shown as current, message `Saved revision 1.`;
5. header stats change from `0 B context` to `191 B context`.

### 7.3 Add an invariant and persist across reload

1. enter `Do not break the public API` under **Invariants**, click **Stage item**;
2. click **Apply**: revision becomes `2`, showing `1 active / 1 stored`, `220 B context`;
3. reload the page and reopen the same Session: still `rev 2`, objective `Ship the charter tab safely`, and
   invariant `Do not break the public API`;
4. tab order is still Chat / Trajectory / Charter.

This proves the browser UI → Remote → Host service → storage domain → re-assembly/UI chain.

### 7.4 Chinese/English switch

Switch DSH from Chinese to English in the same Web profile (Settings → Language → English) without reloading:

- tab changes from `会话契约` to `Charter`;
- pane labels change from `概览 / 目标 / 硬约束 / 预览上下文 / 应用` to
  `Overview / Objective / Invariants / Preview context / Apply` (redesigned pane, see §7.5);
- stats, statuses, buttons, placeholders, and error-code messages all come from the same `dsh-charter` locale
  namespace;
- after a page reload the preference remains English and the tab/pane stay English.

Chinese screenshot: [charter-pane.png](assets/charter-pane.png). English screenshot:
[charter-pane.en.png](assets/charter-pane.en.png). User-entered objective/constraint body is data and is not
translated.

### 7.5 Redesigned UI and budget verification

The screenshots in this section were regenerated against the final `0.1.0-rc.1` build (2026-10-22) from an isolated
demo-only profile whose sidebar contains a single synthetic `Create a UI test session` session and no private
workspace or Session titles: the pane shows the
advisory-context disclaimer, an always-available **History draft** section, the record ceiling in **Context**,
projected draft rows, and per-row action menus.

The redesigned pane was exercised in the same Web profile at 1440×757 in both light and dark appearance, and in
Chinese and English:

- branded page header (mark, `Charter`, slogan) with revision/active/stored chips and a live
  `240 B / 8.0 KiB context` meter;
- sticky Preview/Discard/Apply toolbar visible above the scrolling content;
- left section navigation: Overview / Objective / Invariants / Deliverables / History / Context (History is
  always present; a draft is shown only when the bootstrap phase is `draft`);
- an Overview dashboard with objective, invariant/deliverable cards, and a budget breakdown, so a large history
  draft no longer pushes the working sections down;
- focused Objective and item tabs with inline add composers and `0 B / 1.0 KiB` counters;
- hover/focus-revealed item actions (Edit / Replace / Archive / Verify);
- while Charter is active the chat composer is hidden, and an unsent draft survives switching back to Chat;
- light/dark themes driven entirely by DSH semantic tokens.

Screenshots: [Chinese light](assets/charter-pane.png), [English light](assets/charter-pane.en.png),
[dark](assets/charter-pane.dark.png), [narrow](assets/charter-pane.narrow.png).

Budget behavior beyond the parser split is enforced in the client: over-limit fields are marked, the draft preview
is rendered through the same prompt renderer, and Apply is blocked only when the rendered prompt would grow and
remain over budget; shrinking or unchanged over-budget renders are admitted. Field editors likewise admit a
strictly shrinking objective or same-id item even while it is over its limit. The automated coverage for the
split/whole-objective policy is in `tests/core/bootstrap.spec.ts`; the over-limit UI itself was not driven through
a browser in this round.

### 7.6 Notes

- The test used a syntactically valid but uncredited API key, so Chat shows a model-request failure; this is a
  model-call issue and does not affect Charter editing/Apply.
- Not yet automated in the browser: concurrent conflict in two tabs, two-Session isolation, and per-version
  interaction on 0.1.7/0.2.1. Host/Remote tests cover the logic; a manual pass in the target profile is still
  recommended.

## 8. Real compaction end-to-end

Status: **PASS recorded 2026-10-22** on a real DSH Session (an anonymized evaluation Session): `/compact`
shadowed 326 messages (~228k tokens) and the next request carried the byte-identical `charter:standing` snapshot
and matching `promptDigest`. `npm run check` never runs a model and
therefore never runs this check; section 8.4 records the evidence.

### 8.1 What is already proven

- DSH persists each assembled runtime context as a `user/message` event with
  `source.kind === "runtime-context"` and a `sections` array. In a real Web-profile Session (an anonymized
  evaluation Session, revision 6, 245 B charter), seven such snapshots contain a `charter:standing` section
  whose bytes equal the storage record's `promptText` and whose SHA-256 equals `promptDigest`. This proves the
  user-role injection path on a real DSH runtime, including UI-driven edits.
- Composition tests prove the provider re-assembles from the storage authority on every request; the platform's
  `RuntimeContextProjection` clears retained state when a replacement/compaction shadows it.

### 8.2 Manual acceptance check

`npm run verify:compaction` is a transcript-evidence checker, not an automated end-to-end test: the runtime
context assertion is exact byte/digest equality, while the system-prompt leak check is signal-based (prefix,
rendered body, objective, long item text). It is not part of `npm run check`, it is not included in the npm
package (`scripts/` is outside the `files` allowlist), it reads the local DSH transcript, and it needs the `zstd`
binary. It supports the JSON storage backend layout
`$DSH_HOME/storages/<domain>/sessions/<sessionId>.json`; pass `--store <file>` for another layout.

```bash
npm run verify:compaction                          # current Session: DSH_SESSION_ID + DSH_HOME
npm run verify:compaction -- --session <id> --json # another Session / machine-readable
```

The command reads the Session transcript and the charter storage record, then requires all of:

1. the current revision's commit time is earlier than the latest `compaction/end` (a charter created after the
   compaction cannot prove survival);
2. the latest runtime-context snapshot sits after that compaction;
3. that snapshot contains `charter:standing`, its text is byte-identical to `promptText`, and its SHA-256 equals
   `promptDigest`;
4. no system-prompt snapshot contains the charter prefix, body, objective, or a long item text;
5. a `charter_read` standing result **recorded after the latest compaction** is **required** and equals the
   Host's compact standing projection (`kind`/`text`/`verification`/`progress`) for the current revision, not only
   revision/objective. The producing **tool call itself must be authenticated**: with top-level
   `sourceEventSeqs`, the referenced seqs must be finite integers earlier than the result and must identify
   **exactly one** producing `charter_read` call (no other tool call referenced, no ambiguity), with matching
   message `toolCallId`, turn, and step; legacy transcripts without that field fall back to (turn, step, callId)
   plus event order. The call seq must follow the latest successful compaction **and** the latest post-compaction
   runtime-context snapshot, its arguments must be absent/a plain object/`view:"standing"` (malformed shapes and
   an explicit `all` are rejected), and the result must be non-error and later than its call. A missing result, an
   unauthenticated/ambiguous/mismatched call, a pre-compaction read, an `all` read, or an error result all fail the
   PASS. A legacy debug-shaped tool result (extra id/review/lifecycle fields) is normalized to the same projection,
   so a Host that has not been restarted after a package update still yields comparable working-set evidence;
6. compaction evidence requires a strict seq-ordered attempt lifecycle for the same `compactionId`: a start
   opens the attempt, a summary may only attach to the open attempt, and an end may only close it; a successful
   attempt needs start.seq < summary.seq < end.seq and no end error. A later failed end is ignored as evidence and
   same-id retries are independent attempts; end-before-start or a summary before the start can never PASS. The
   charter must be committed before the compaction **start** (a commit between start and end cannot prove survival
   and requires re-compaction); a request executing after the end without a new runtime-context snapshot is a
   **FAIL**, while the complete absence of post-compaction request activity is `WAIT` (exit 3);
7. the checkpoint associated with that `compactionId` does not carry the rendered body (a warning: it would
   weaken the proof, not silently pass it); a checkpoint explicitly belonging to another compaction id is never
   associated, and the positional fallback applies only to id-less legacy checkpoints;
8. the transcript parser rejects middle corruption with the line number instead of skipping it (only a torn final
   line of an incomplete append is tolerated), so evaluated evidence cannot silently omit transcript lines.

Procedure in a real profile:

1. open the Charter tab in the target Session, review the history draft, click Apply (or set an objective
   manually), then send one message so the runtime context is persisted in the transcript;
2. run `npm run verify:compaction`: expect `charter established`, injection, digest, and system-prompt checks to
   pass, with the compaction step in `WAIT`;
3. run `/compact` in the same Session, send one message, then have the model call `charter_read` once
   (default/standing view, no error) so an authenticated post-compaction result exists;
4. run the command again: expect `PASS` with the compaction seq, post-compaction snapshot seq, post-compaction
   `charter_read` seq, and digest.

The checker fails closed as `BLOCKED` (no charter yet) or `WAIT` (no post-compaction request yet); once a
post-compaction request exists, `survivesCompaction`, a clean system prompt, and an authenticated matching
post-compaction `charter_read` standing result all participate in the exit code, so a missing, unauthenticated, or
mismatched read is a FAIL. A leaking summary is a recorded warning, not a silent pass.
`tests/verify/compaction-checks.spec.ts` exercises these success/failure fixtures without a live model.

### 8.3 Platform basis

`@deepseek-ai/dsh-agent-loop@0.2.1-rc.2` `RuntimeContextProjection` clears retained state after a
replacement/compaction shadows the snapshot and regenerates it on the next request; this plugin's context
provider calls `charter.promptText(session)`, which synchronously reads the storage authority and validates the
derived digest.

### 8.4 Recorded real-model run (2026-10-22)

Target: an anonymized evaluation Session. The Session's history
draft from its previous compaction summary was reviewed and applied as **revision 1** (13 active items, 5,081 B,
`promptDigest sha256:4dd9e615…`). `/compact` then completed as compaction seq **31801** (source
`cmd-635e3d77-2`), shadowing 326 messages (~228,181 tokens). The next request after compaction persisted
runtime-context snapshot seq **31810**, carrying `sections [sandbox:policy, approval:policy, charter:standing]`
with a 5,081 B charter whose bytes/digest match storage; a subsequent `charter_read` call (call seq **31824**,
authenticated via top-level `sourceEventSeqs`; after compaction seq 31801 and runtime snapshot seq 31810;
`view: standing`; non-error) returned the same revision/objective/working set as result seq **31825**. Full
checker output:

```text
$ npm run verify:compaction -- --session "$SESSION_ID" \
    --home "$DSH_HOME" \
    --store "$DSH_HOME/storages/dsh_charter_v1/sessions/$SESSION_ID.json"
  PASS  charter established
  PASS  latest runtime context carries charter:standing
  PASS  injected text matches storage authority and promptDigest
  PASS  system prompt carries no charter body
  PASS  authenticated post-compaction charter_read standing view matches the storage revision/objective
  PASS  charter survives compaction — snapshot seq 31810 > compaction end seq 31801
  PASS  compaction summary does not carry the charter text
result: PASS
```

Note: the running Desktop process had loaded a pre-restart Host bundle, so its `charter_read` result still
carried legacy debug fields; the checker normalized them to the current compact projection. Restarting the
Desktop app is still required to load the current package in memory for UI/tool ABI parity.

Re-check on the current tree: the stricter checker (a required matching `charter_read` standing result whose
call is authenticated and ordered after the latest compaction and runtime-context snapshot) was re-run against
this recorded transcript and still returns `PASS`; the unique call is seq **31824** with result seq **31825**,
after compaction seq 31801 and runtime snapshot seq 31810.

Evidence timeline for this pre-release:

- Recorded real-model run: 2026-10-22 on the Desktop/Web runtime DSH `0.2.0-rc.2` (`dsh` CLI `0.2.0-rc.2`).
  The run happened **before** the full Desktop restart described above; the process that served it was still
  running the pre-restart Host bundle, which is why the `charter_read` result carried legacy debug fields.
- Compiled-bundle build commit: `0d9af924bdddeaa88b6c2400978866afdbc93e5d` — the gated source tree whose Host ESM and browser
  bundles were built. Gates on that tree: `npm run check` (typecheck + build + 19 test files / 260 tests),
  `npm run smoke:package`, and the local five-version matrix (19 files / 260 tests on every version); the
  compaction checker was also re-run against the recorded real transcript (PASS).
- Archive/evidence-tree commit: the direct child of the build commit that adds this evidence record and the
  refreshed tracked digest. The packed `dsh-charter-0.1.0-rc.1.tgz` contains both the bundles built from the build
  commit **and** the package-visible documentation of this evidence tree, so the archive must not be attributed to
  the build commit alone; the same gates were re-run on the evidence tree. The local `v0.1.0-rc.1-build` marker
  annotation records this evidence commit and the archive digest.
- Shipped artifact digest: the tracked repository-root `SHA256SUMS` (refreshed by the final evidence-tree commit,
  which updates only that file and this record) pins the digest of the `.tgz` built from the evidence tree;
  `dist/SHA256SUMS` carries the same value. **No release tag exists for this local build**: the provisional local
  tag was deleted, and the final annotated `v0.1.0-rc.1` tag is created only at publish time on the
  metadata/documentation/CI-gated commit (docs/releasing.md).
- Remaining manual check: restart the Desktop app and reopen the Charter tab once to confirm the current
  bundle/tool ABI — this post-restart re-check is **not** part of the recording above and is required before a
  stable `latest` release, not before publishing this pre-release under `next`.


### 8.5 `0.1.0-rc.2` candidate evidence (2026-10-24)

- Compiled-bundle build commit: `993623de57b413bf313313bd81e4de952ef70daf`; the artifact digest is recorded in the
  tracked repository-root `SHA256SUMS` (outside the npm `files` whitelist) and `dist/SHA256SUMS`.
- `npm test`: 20 test files / 263 tests pass; `npm run check` passes; normal `npm run smoke:package` passes.
- `zod` is exactly `4.6.7` (direct dependency; the dev tree dedupes to one zod via `overrides` so typecheck/audit are
  clean); `npm audit --omit=dev` reports 0 vulnerabilities and the full `npm audit` also reports 0 with the deduped
  dev tree.
- Final artifact: `dist/dsh-charter-0.1.0-rc.2.tgz`; its SHA-256 is recorded in the tracked repository-root
  `SHA256SUMS` and `dist/SHA256SUMS` (the root file is outside the npm `files` whitelist, so the digest does not
  change the packed bytes). Exact-artifact smoke (`--artifact ... --sha256 SHA256SUMS`) passes on those bytes
  without rebuilding; the five-version DSH matrix passes with the upgraded build; the recorded real-model
  compaction transcript re-runs PASS.
- This candidate is not tagged or published in this preparation pass; the release tag and npm channel moves happen
  only in the release run after the gates above.

## 9. Unsupported verification and accepted non-blocking limitations

- Multi-process live storage sync: `domain/changed` is process-local; the plugin is designed for one Host
  process.
- Whether the real model obeys the charter: the charter is a declaration, not a behavior guarantee.
- Permanent audit: bounded history/mutation receipts are not an audit log.
- Real-sample quota calibration: defaults are product initial values.

Accepted non-blocking limitations (reviewed and deliberately not re-fixed in this RC; none is claimed closed):

- **Legacy transcript strictness.** Legacy (pre-`sourceEventSeqs`) transcripts fall back to turn/step/callId plus
  event order; an adversarial legacy transcript that reuses identities in unusual ways is not fully authenticated,
  unlike the modern path.
- **Compaction sequence edge cases.** Seq gaps are tolerated, overlapping compaction starts with different ids are
  not modeled as one chain, and id-less checkpoints use a positional fallback whose attribution is inherently
  best-effort.
- **WAIT diagnostic wording.** WAIT verdict details are advisory strings for humans; they are not a machine
  protocol and may be coarse for combined gate conditions.
- **Artifact-smoke hardening residuals.** The structured tar reader validates headers/paths/types/checksums and the
  packed manifest against the working tree, but does not canonicalize exotic path encodings beyond the checks
  listed, does not inspect `.env`-style runtime files, and its manifest comparison is a JSON deep-equality of the
  selected fields rather than a full semver-aware audit.
- **Outer-JSON platform risk.** An unreadable/malformed outer JSON record (or rejected outer version) is read as
  absent by the JSON storage backend; the plugin cannot distinguish it from a missing record and a later
  initialization could overwrite it (operational recovery: stop the Host and restore from backup). Inner
  schema/consistency-invalid records remain isolated and preserved.
- **Mutation receipt retention.** Idempotent replay depends on the bounded recent-mutation receipt window; a replay
  after that window is evicted cannot be recognized by id and is treated as a fresh request.
- **Doc count drift.** Verification/locale text counts are manually synchronized; a future test added without
  updating the narrative would leave a small drift (the suite itself is the source of truth).

## 10. Cleanup

```bash
rm -rf .tmp
```

`.tmp/` is excluded from git and the npm package.
