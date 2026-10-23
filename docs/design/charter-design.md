# `dsh-charter` Design Specification

English | [中文](charter-design.zh.md)

> Position: keep the goals, hard constraints, and deliverables the user explicitly confirmed for the current
> session, and deterministically rebuild them from an independent authoritative record before every model
> request. Compaction may rewrite history summaries; it is never a writer or recovery source for the charter.

Research baseline: 2026-10-20. Target contract baseline: DSH `0.2.1-rc.2`; minimum supported version:
`0.1.7-rc.2`.

Related documents:

- [v1 review](charter-design-review.md)
- [Research notes](../research/charter-research.md)
- [Compatibility matrix](compatibility.md)
- [Verification record](../verification.md)

The English and Chinese specifications ([charter-design.zh.md](charter-design.zh.md)) are maintained together.
The Chinese document contains additional implementation detail; this English document mirrors every normative
decision.

## 1. Product definition

`dsh-charter` is a **session charter**, not a general memory, task summary, knowledge graph, or permission
system. It answers:

1. What must this task ultimately accomplish?
2. Which user constraints must remain visible while it is executed?
3. Which deliverables are still outstanding?

Five requirements define the product:

| Requirement | Verifiable behavior |
| --- | --- |
| Fidelity | The current charter is rebuilt from an independent authoritative record, not a compaction summary |
| Bounded | The model-visible slice and the durable record have hard byte/item limits; overflow is rejected, never silently truncated or evicted |
| User-owned | Only the user can accept, supersede, archive, restore, or purge; the model cannot modify effective entries |
| Atomic | One Apply commits all operations or none |
| Degradable | A UI, model, or injection failure must not break the Session; the authoritative record is untouched |

A charter is a declaration, not an enforcement policy. Limits that need machine enforcement belong in Host
permissions, hooks, sandbox policy, or tool-execution guards.

## 2. Scope

### 2.1 MVP

- Original objective and current objective;
- `invariant`: user-confirmed standing constraints;
- `deliverable`: deliverable and progress;
- Persistence per session;
- A conversation-view tab in the main conversation header;
- A review-only bootstrap draft from an existing Session's latest usable compaction summary (with fallback to older usable summaries);
- One atomic write Remote;
- One per-Session snapshot stream;
- One read-only `charter_read` tool;
- user-role runtime context injection;
- Revision conflicts, idempotent retries, quotas, and lifecycle isolation.

### 2.2 Later work

1. `decision` and `environment` items;
2. Creating proposals from a message;
3. `charter_propose` for the agent;
4. Source binding and dedicated validators;
5. A recent-revision history panel;
6. Explicit import/export;
7. Cache and runtime-context diagnostics.

### 2.3 Explicit non-goals

- Replacing the compaction backend;
- Cross-session long-term memory;
- Letting an auxiliary model maintain the whole charter;
- TTLs on user-authored entries;
- Automatic archive/delete based on `lastUsed`;
- `appendPluginRecord()`, which is not available to external plugins;
- Putting user-editable body text into the system prompt;
- Bidirectional real-time storage ↔ `CHARTER.md` sync;
- A promise of a permanent, unprunable audit history.

## 3. Core invariants

### 3.1 Permission

1. User-editable bytes never enter a system-role message.
2. Host policy, tool permission, and execution guards outrank the charter.
3. The model cannot make entries effective, archive, restore, purge, or change progress.
4. Every Remote endpoint declares a Session resource; it must not degrade to a global resource.

### 3.2 Authority

1. A Session record in `dsh-storage-domain` is the only authority.
2. Prompt snapshots, tool results, UI stores, compaction summaries, and history receipts are not recovery
   sources.
3. The same record revision and renderer version must produce byte-identical model-visible text.
4. Records with the same Session ID but a different lifecycle identity must not be read, overwritten, or
   injected.

### 3.3 Writes

1. One user Apply performs exactly one atomic single-record `update()`.
2. `baseRevision` is checked inside the `update()` write-chain slot.
3. The same `mutationId + requestDigest` returns the original result within the idempotency window.
4. If any operation fails, no operation in the batch becomes visible.
5. Quota admission is relative to the previous snapshot: growth beyond a limit rejects the batch, while an
   already-over-budget record may shrink toward the limit. It never auto-deletes or auto-edits existing entries.

### 3.4 Model context

1. Every request sees a complete snapshot, not a patch.
2. If the joined runtime-context text is unchanged and the retained snapshot is still on the surface, no new
   snapshot is appended.
3. If the retained snapshot is compacted or replaced, the next request re-materializes from the authority.
4. Time, revision, hash, source, read state, and last-verified time never enter the model-visible body.
5. UI-only metadata changes must not change the Charter contribution hash.

## 4. Architecture

```text
                        dsh-charter core
             types / validation / applyOps / render
                           ▲           ▲
                           │           │
UI edit Remote ── auth ── service ── storage-domain
                           │              │
                           │              ├── sessions[sessionId] sole authority
                           │              └── domain/changed
                           │                         │
                           ├── prompt context        └── watch Remote
                           │                              │
                           └── charter_read               ▼
                                                 RemoteSnapshotStream
                                                          │
                                                          ▼
                                                    Charter tab UI
```

Key choices:

- The Host service (Cordis Service) owns initialization, Session lifecycle, the domain, edit admission,
  prompt reads, tool reads, and UI subscriptions.
- The pure core owns schemas, normalization, state validation, atomic operation application, deterministic
  rendering, digests, record commit, and fork copying.
- The Remote service exposes `charter.watch`, `charter.bootstrap`, and `charter.edit`, each bound to a Session
  resource.
- The client stores one stream per Session and renders a `conversation.view` tab.
- Storage failures are isolated; ordinary conversation continues.

## 5. Data model

### 5.1 Session record

```ts
interface CharterRecord {
  recordSchemaVersion: 1
  identity: { createdAt: number; cwd?: string; parentSession?: string }
  forkedFrom?: { sessionId: string; revision: number }
  current: CharterSnapshot
  history: CharterReceipt[]
  recentMutations: MutationReceipt[]
}

interface CharterSnapshot {
  revision: number
  objective?: CharterObjective
  items: CharterItem[]
  promptText: string
  promptDigest: `sha256:${string}`
  stateDigest: `sha256:${string}`
}
```

`identity.createdAt + cwd + parentSession` is the lifecycle fence. A record may only be used by a Session with
the same identity.

### 5.2 Items

```ts
type CharterItem = InvariantItem | DeliverableItem

interface InvariantItem {
  kind: 'invariant'
  id: string
  text: string
  review: 'pending' | 'accepted' | 'rejected'
  lifecycle: 'current' | 'superseded' | 'archived'
  verification:
    | { state: 'unchecked' }
    | { state: 'verified'; by: 'user' | 'validator' }
    | { state: 'failed'; reason: string }
    | { state: 'unavailable'; reason: string }
  origin: 'user' | 'agent' | 'fork'
  order: number
  createdRevision: number
  supersedes?: string
  supersededBy?: string
}

interface DeliverableItem extends InvariantItem {
  kind: 'deliverable'
  progress: 'not-started' | 'in-progress' | 'blocked' | 'done' | 'cancelled'
}
```

State dimensions are orthogonal:

| Dimension | Values | Notes |
| --- | --- | --- |
| `review` | pending / accepted / rejected | user-created items are accepted; history-overflow imports are pending; model proposals are reserved |
| `lifecycle` | current / superseded / archived | archived can be restored; superseded cannot be revived |
| `verification` | unchecked / verified / failed / unavailable | does not change lifecycle |
| `progress` | deliverable only | does not imply verification |

Only `accepted + current` participates in the standing working set and model-visible context. `done` does not
automatically verify; a failed verification does not automatically archive.

### 5.3 Objective

`objective.original` is written once by `objective.initialize`. `objective.redirect` changes only
`objective.current` and records a non-empty reason. Ordinary edits cannot rewrite the original.

## 6. Lifecycle and initialization

1. `CharterService.init()` registers Session and Agent lifecycle listeners before opening the domain.
2. `openDomain()` opens `dsh_charter_v1` with a `sessions` table (`layout: per-record`), validates all records,
   and marks semantically inconsistent records unavailable.
3. On `session/created`, the service initializes the Session in the background.
4. On `agent/created` (serial and awaitable), the listener awaits initialization before the first prompt can be
   assembled.
5. Parent ancestry is checked for self/multi-node cycles and a depth bound. A cycle is marked `CORRUPT_STATE`;
   it never leaves two initialization promises waiting on each other.
6. If a child Session appears before its parent record is durable, the child waits for `domain/changed` and
   retries.
7. `session/disposed` aborts in-flight initialization and removes UI listeners. The durable record is not
   deleted.
8. On plugin unload, new edits are blocked, in-flight writes are awaited, listeners and domain are released.

Session disposal closes every open watch subscription (listeners receive `null` and the stream generator exits),
so a same-id recreated Session starts from a fresh stream rather than a detached listener. Records are validated
one by one at the service boundary, and every runtime read and write path re-parses the
stored document with the strict schema (`recordFor`, read-only views, parent/fork reads, and the
`table.update` transform). The domain keeps raw per-record documents, so a corrupt or forward-skewed record
marks only that Session unavailable; it never prevents the domain from opening for every other Session, is
never overwritten, and the raw document is preserved for diagnosis. **Scope of this guarantee:** it applies when
the stored document loads and fails the inner record schema or consistency checks. It does **not** cover an outer
JSON document that the JSON storage backend cannot read (or whose outer version stamp it rejects): that backend
treats such a file as an absent record, and the plugin-side KvTable API exposes no read-error signal, so the
plugin cannot distinguish it from a missing record (documented residual risk, verification §4.5). A failed
initialization is cleared
before the durable write publishes, then a final authoritative view is published; transient initialization
failures are retried instead of being sticky.

A non-live Session (for example one persisted by the Desktop process and viewed in a separate Web process)
does not fail the stream. It returns a read-only stored view with an explanation and upgrades in place when the
Session becomes live in the current Host.

## 7. Edit protocol

### 7.1 Operations

- `objective.initialize`
- `objective.redirect` (the reason is optional; clients render a localized fallback instead of persisting UI copy)
- `item.add`
- `item.propose` (client history-import operation within `charter.edit`: always creates a pending proposal;
  same `clientRef`/id minting as `item.add`; never enters the model context until accepted; counts toward
  `maxPendingItems`)
- `item.edit`
- `item.accept` / `item.reject`
- `item.supersede`
- `item.archive` / `item.restore`
- `item.purge` (requires confirmation; current actor policy is owner-only)
- `item.verification.set`
- `deliverable.progress`

A batch contains 1..`maxOps` operations. Every operation is validated against a draft copy; the entire batch is
rejected on any failure. `item.propose` is emitted by the reviewed history-draft import and travels in the same `charter.edit` request
so the import is atomic. Any authorized client may send it in an ordinary edit; the same actor policy applies
and pending proposals count against `maxPendingItems`. It is not exposed as a model-facing write tool, and it is
not a privilege escalation: pending items never enter the prompt until accepted.

### 7.2 Actor policy

- `owner`: all operations, including irreversible `item.purge`.
- `user`: ordinary objective/item/progress/verification operations, but not `item.purge`.
- `host`: rejected on the Remote edit path; initialization and fork use dedicated internal code.
- agent/model: no edit API or write tool is exposed.

The service checks the policy before opening a storage transaction; `commitRecord()` repeats the check so a
future caller cannot bypass it. `FORBIDDEN` leaves revision, storage, and published views unchanged.

### 7.3 Revision and idempotency

- Client sends `baseRevision`.
- Host mints item ids for new `clientRef`s before the atomic update.
- Inside `update()`, the Host re-checks lifecycle identity, revision, mutation id idempotency, transitions, and
  quotas.
- A stale base revision returns `REVISION_CONFLICT` with the current view and preserves the draft.
- A replay with the same mutation id and digest returns the stored ids and revision.
- Reusing a mutation id for different content returns `MUTATION_ID_REUSED`.

### 7.4 Error codes

`INVALID_ARGUMENT`, `FORBIDDEN`, `NOT_FOUND`, `LIFECYCLE_MISMATCH`, `REVISION_CONFLICT`,
`MUTATION_ID_REUSED`, `INVALID_REFERENCE`, `INVALID_TRANSITION`, `IMMUTABLE_FIELD`, `QUOTA_EXCEEDED`,
`CORRUPT_STATE`, `UNAVAILABLE`.

These codes are part of the public contract. Messages are diagnostic only; the client localizes user-facing
text by code.

## 8. Prompt injection

The charter registers a `systemPrompt.context()` contribution, not a system section:

```ts
{
  name: 'charter:standing',
  order: 130,
  interpolate: false, // DSH 0.2.1+
  required: true,     // DSH 0.2.1+
  text: context => session === undefined ? '' : promptText(session),
}
```

The rendered text is:

```text
Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.
{"objective":"...","invariants":["..."],"deliverables":[{"text":"...","progress":"in-progress"}]}
```

Rules:

- Only the current objective plus accepted/current invariants and deliverables participate.
- Metadata such as ids, revision, timestamps, verification, review, origin, and evidence is excluded.
- Text is NFC-normalized; unsafe controls and lone surrogates are rejected.
- Rendering is deterministic; ordering is `order` then code-unit id.
- Runs of `{{` are JSON-escaped as `\u007b` so the DSH 0.1.7/0.2.0 prompt-variable interpolator cannot rewrite
  user text. DSH 0.2.1+ also sets `interpolate: false`.
- The final UTF-8 byte budget, per-item budget, item counts, and record size are hard limits.
- Every assembly reads the authoritative record synchronously; no storage I/O occurs in the prompt path.
- After compaction replaces the retained runtime snapshot, the next assembly re-materializes the same text
  from the authority.

## 9. UI and Remote

### 9.1 Conversation-view tab

The client registers a `conversation.view` list entry:

```ts
ctx.slots.register({
  name: 'conversation.view',
  id: 'charter',
  order: nextViewOrder(ctx),
  locale: 'dsh-charter',
  label: () => t('tab'), // 会话契约 / Charter
  inject: sessionId => {
    const lease = controller.acquire(sessionId)
    return { source: lease.source, draft: lease.draft, release: lease.release }
  },
}, CharterPane)
```

- Chat uses order 0, Trajectory 10, and other plugins commonly use 20/30.
- The client registers the Charter tab exactly once at a stable high order (`CHARTER_VIEW_ORDER = 1000`), so it
  follows those tabs. It never re-registers or subscribes to the slot roster, so two plugins that both want to
  stay "last" cannot reorder each other forever; a plugin with a higher order (for example 2000) simply follows
  Charter.
- Labels are supplied by `dsh-client-locale`: `会话契约` in Chinese, `Charter` in English. All pane strings use the
  same namespace, so the whole panel follows the active DSH language.
- A blank Session hides the View tab bar; the tab appears once the Session starts.
- The pane scrolls in the main content area; its footer actions sit at the end of the content.

A lifecycle change is authoritative on both sides: Host frame dedupe compares `lifecycle`, and the client accepts
it even if the new revision restarts at 0. While an Apply/bootstrap request is in flight, mutating draft controls
are locked; a reviewed history draft counts as dirty and survives tab switches. Remounting the pane body (tab
switches, view re-creation) does not lose the draft store because drafts are owned per
Session and only the source lease is released; if a new lifecycle is observed, the draft is reset. The
released-draft map is bounded by an LRU, and client/Host share one text-inspection function so control characters
and unpaired surrogates are rejected before Apply.

### 9.2 MVP page

The pane follows the DSH semantic-token visual language used by high-density plugins such as `dsh-context`:

```text
SESSION CHARTER                                  rev 7   1 active   1 stored
Charter                                          240 B / 8.0 KiB context
Goals, constraints, and deliverables that survive compaction.
[ No staged changes ]                [Preview context] [Discard] [Apply]   <- sticky toolbar
SECTIONS              OVERVIEW
Overview  (active)    OBJECTIVE    Ship the redesign ...          [Open]
Objective             INVARIANTS 1        DELIVERABLES 0
Invariants  1           Do not break ...    No deliverables yet.
Deliverables 0        BUDGET       240 B / 8.0 KiB; 1 / 24; 0 / 16
Context
History draft (always available; apply only in draft phase)
```

Layout and interaction principles:

- A left section navigation (Overview / Objective / Invariants / Deliverables / Context, plus History when a
  draft exists) keeps each module focused. It becomes a horizontal tab strip on narrow containers.
- A branded page header (mark, title, one-line slogan) carries revision/active/stored chips and a context-budget
  meter: *Compaction rewrites history. Your commitments don't.*
- A sticky action toolbar keeps Preview/Discard/Apply visible while the pane scrolls.
- While the view is active it owns the reading surface: the composer seat is hidden via a plugin-scoped `:has()`
  rule, while the draft remains mounted and reappears on Chat. Approval/question/plan-review seats stay visible.
- Overview is a dashboard: objective summary, invariant/deliverable cards, and budget breakdown. A large history
  draft gets its own tab, so it never pushes the working modules below the fold.
- Objective and item tabs are focused editors; add composers live inside their section instead of a generic type
  switch. Enter adds, Shift+Enter inserts a newline.
- Item actions appear on hover/focus on pointer devices and stay visible on touch.
- Typography uses the DSH text/code tokens; spacing is an 8px scale; borders, surfaces, brand, warning, danger,
  and success colors are semantic tokens, so light/dark themes both work.
- Empty sections use a compact dashed placeholder; the pane keeps a dense, scannable rhythm.

The page supports objective/invariant/deliverable editing, archive/restore/supersede, progress, verification,
pending accept/reject, purge confirmation, a preview of the exact user-role context and byte count, conflict
preservation, and explicit degraded states.

### 9.3 Remote endpoints

- `charter.watch(sessionId, signal)`: one opening `snapshot`, then `changed` frames with the full view.
- `charter.bootstrap(sessionId)`: a read-only draft extracted from the latest compaction summary that actually yields candidates (older usable
summaries are tried if the newest is valid but empty).
- `charter.edit(request)`: one atomic Apply, returning the current view on failure.
- Each endpoint declares `resources.session`.
- DSH 0.2.1+ enforces per-Peer resource authorization.
- DSH 0.1.7/0.2.0 has no `@Remote.resources` or `Principal`; the Host still checks live Session and lifecycle,
  but per-Peer Remote authorization is unavailable. Use those versions only on a trusted single-operator host.

### 9.4 Bootstrap from compaction history

Existing users should not start from an empty panel. When the Charter tab opens on a **live** Session whose
charter is empty, the client asks `charter.bootstrap(sessionId)` once. The Host reads the latest
`compaction/summary` event from that Session's log and deterministically extracts:

- **Objective:** the latest correction, else the original request, else the first paragraph;
- **Invariants:** user-want bullets from the primary request plus requirement-like lines from Critical Context;
- **Deliverables:** bullets from Pending Jobs / Next Step / Current Work.

The extractor removes markdown punctuation, splits long candidates at sentence/clause/code-point boundaries
into multiple items instead of truncating them, keeps the objective whole, and skips malformed or empty
summaries. It imposes no hidden candidate cap. It makes no model call and writes no storage record.

The result is a **review-only proposal** with the summary sequence, timestamp, and shadowed-token count. The UI
shows it in a draft panel; the user edits text, unchecks items, and clicks Apply. Apply maps the reviewed fields to one atomic edit: candidates that fit the context budget become
`item.add` (user origin, accepted) and candidates that do not fit become `item.propose` (always pending,
agent origin). The Host mints ids for both kinds, no candidate is dropped, and pending proposals never enter
the prompt until accepted. A new Session without a compaction summary still gets the normal empty state; a
non-live Session has no bootstrap.

The deterministic parser is intentionally conservative about cost and privacy, not about perfect semantics. It
may include stale or noisy items from the summary; the review step is mandatory. Model-assisted refinement is
future work.

## 10. Fork

When a child Session is created with `parentSession`:

1. Read the parent record (live parent first, otherwise the durable record).
2. Re-mint every item id; remap `supersedes` / `supersededBy`.
3. Set `origin: 'fork'`, `createdRevision: 1`, sequential order.
4. Copy the objective with revision markers set to 1.
5. Verify the child `promptText` / `promptDigest` equals the parent.
6. Write a `forked` history receipt and record the parent Session/revision in `forkedFrom`.

This is a copy at child `agent/created`, not a strict fork-boundary snapshot. Later parent edits do not flow to
the child; later child edits do not flow back.

## 11. Limits and failure behavior

Default limits:

| Object | Default |
| --- | ---: |
| Charter contribution context | 8 KiB UTF-8 |
| Objective | 4 KiB UTF-8 |
| One model-visible item text | 1 KiB UTF-8 |
| All items | 512 |
| Pending items | 512 |
| Ops per edit | 1024 |
| One Session record | 1 MiB |
| Recent history | 64 receipts or 128 KiB |
| Recent mutation receipts | 128 |

`charter_read` returns the complete standing working set (objective plus every accepted/current item; bounded by
the record quotas) in a compact projection that omits debug-only ids, review, and lifecycle fields. Its `all`
debugging view carries full item metadata (id, origin, order, createdRevision, review/lifecycle, supersede chain,
verification provenance) and is capped at 64 items and a 32 KiB **final tool envelope**; it reports the omitted
count in `truncated`.

The only model-visible capacity is the final prompt byte budget. Active item counts are not capped separately;
`maxItems`, `maxPendingItems`, `maxOps`, and `maxRecordBytes` remain storage/batch bounds. An over-limit edit
is rejected as a whole.

**Overflow policy.** No path silently truncates user-visible content:

- The UI shows a context-budget meter and per-field byte counters; an over-limit field is highlighted and Apply is disabled until the user shortens or deselects it.
- Manual edits are validated by the Host; an over-limit batch returns `QUOTA_EXCEEDED` and leaves the record unchanged.
- History-draft items are split at sentence, clause, and finally code-point boundaries into multiple candidates, so text is preserved rather than cut with an ellipsis. Candidates that still exceed an item limit remain visible and marked; the user must shorten them before Apply.
- The objective is kept whole. If it exceeds the objective budget, the draft shows the full text and an over-limit message; Apply is disabled until the user edits it. This is a deliberate user decision point, not a silent cut.
- If a history draft does not fit the total context budget, the candidates that fit become active; every other
  candidate is imported as a **pending proposal** in the same atomic edit. Nothing is automatically dropped,
  reordered, or summarized away, and Apply is not blocked by an arbitrary per-kind count cap.
- Only real limits — objective/item bytes, `maxPromptBytes`, `maxItems`, `maxPendingItems`, `maxOps`, and record
  bytes — can block Apply; the UI identifies the exact limit and highlights the affected field.
- The parser returns all candidates from the selected sections; it does not impose a hidden candidate cap.

**Choosing defaults.** 8 KiB of charter-contribution context is roughly 2k tokens; the objective can be 4 KiB and an item 1 KiB. These are deliberately larger than the original MVP values while still bounded. They are defaults, not universal optima: profiles can raise them when a team's charter is longer, at the cost of extra prompt bytes per request.

**Stepwise shrinking.** An already over-budget objective or item may be shortened even while it is still above its
limit; admission compares against the previous text (and the same item id) so a tightened budget can converge over
several edits. The `all` tool view omits an objective that alone cannot fit its 32 KiB envelope and reports
`objectiveTruncated: true`.

**Budget changes and degradation.** Structural validation is independent of admission policy. `overBudget`
covers byte budgets, item counts, and history/mutation count limits. Lowering a limit after records exist marks
the view `overBudget` instead of corrupt: the charter is not injected, the UI explains
the state, and shrinking edits (archive, purge, shorten) are admitted until the record fits again. Non-viable
configurations are clamped to documented minimums with a warning so a profile cannot produce a ready but
permanently uneditable Session. The view reports `maxRecordBytes` so the record ceiling is visible.


Failure behavior:

| Failure | Behavior |
| --- | --- |
| Domain open fails | Host returns unavailable views; ordinary conversation continues |
| Record is semantically inconsistent | That Session is marked unavailable; no injection or editing |
| One stored record fails the schema | Only that Session is unavailable; the domain opens, the raw document is kept |
| Charter exceeds a tightened budget | View is `overBudget`, no injection, shrinking edits converge |
| Lifecycle identity mismatch | No read, overwrite, or injection |
| Storage write fails | Memory/store/prompt keep the old revision |
| UI bundle fails | Host service, prompt, storage, and tool remain usable |
| Session is not live in this Host | Stored read-only view; auto-upgrade when live |
| Plugin unload | Block new edits, await in-flight writes, release domain/listeners |

## 12. Module structure

```text
src/core/
  errors.ts limits.ts digest.ts schemas.ts normalize.ts
  items.ts prompt.ts state.ts commands.ts record.ts fork.ts bootstrap.ts authorization.ts
src/host/
  domain.ts service.ts session-events.ts tool.ts types.ts
src/remote/
  compat.ts watch.ts service.ts wire.ts contribution.ts
src/client/
  store.ts draft.ts draft-store.ts preview.ts bootstrap-plan.ts
  CharterPane.tsx charter.css locales.ts
tests/core tests/host tests/client
scripts/build scripts/verify
```

Build rules:

- Host entries are ESM and may share chunks under `lib/`.
- The browser entry is a separate CJS factory bundle wrapped in
  `window.__ModuleLoader__.load({ id, factory })`; CSS is inlined, zod is bundled, and no relative chunks are
  allowed.
- TypeScript declarations are emitted by `tsc` and copied; tsdown does not duplicate them.

## 13. Implementation status

M0–M3 are implemented. M4 is not implemented. M5 has tarball install, real profile startup, two-start and
uninstall smoke; fault injection and side-by-side domain migration remain open.

Current evidence:

- The Vitest suite across core, host, client, and verification-helper test files (current counts and commands are
  in the verification record, which is the source of truth);
- Typecheck, build, and tests pass on DSH `0.1.7-rc.2`, `0.2.0-rc.1`, `0.2.0-rc.2`, `0.2.1-rc.1`, and
  `0.2.1-rc.2`;
- Real profile install/boot on `0.1.7-rc.2` and `0.2.0-rc.2`;
- Real Web UI verified on `0.2.0-rc.2`: stable-order tab placement (with `dsh-context` installed), localization,
  objective/invariant editing, preview, Apply, and reload persistence.

## 14. Testing and acceptance

### 14.1 Core

1. 100 renders of the same input are byte/digest identical.
2. Original objective cannot be rewritten by an ordinary edit.
3. `done` does not change verification; verification failure does not change lifecycle.
4. Supersede creates a bidirectional link in one batch; any invalid end fails the whole batch.
5. Non-deliverable progress is rejected.
6. Unicode limits count UTF-8 bytes without truncating code points.
7. Any failing operation leaves no partial state.

### 14.2 Persistence and concurrency

Regression coverage additionally requires: one **inner** schema/consistency-invalid record degrades only its own
Session and is never overwritten by the plugin; initialization retry publishes a final ready frame; lowering a
budget yields an over-budget view whose shrinking edits converge; non-viable limits are clamped. The
"never overwritten" clause explicitly does **not** cover an unreadable/malformed **outer** JSON document or an
outer version stamp the storage backend rejects: that backend reads the file as absent, so the plugin cannot
distinguish it from a missing record and a later initialization may overwrite it. That is a known residual risk
(operational recovery: stop the Host and restore the file from a backup), documented in verification §4.5 and the
user guide troubleshooting table.

1. Two edits with the same baseRevision: exactly one succeeds.
2. A successful write with a lost response replays by mutation id.
3. Same mutation id + different digest is rejected.
4. Backend failure keeps memory, stream, and prompt at the old revision.
5. Lifecycle identity mismatch reads, overwrites, and injects nothing.
6. Corrupt schedule schema fails domain open instead of silently returning an empty charter.
7. History pruning does not change current state or prompt digest.

### 14.3 Prompt and compaction

1. Charter text appears only in user role.
2. The system prompt contains no storage-derived charter body.
3. 100 requests with unchanged body produce an unchanged contribution hash.
4. One body Apply produces at most one own-text change.
5. Verification/source/UI-only changes do not change the contribution.
6. Retained snapshot shadowing by replace, range shadow, or compaction re-materializes on the next request.
7. Whether a compaction summary mentions the charter does not affect the recovered body.
8. Hostile `{{...}}`, JSON quotes, newlines, and pseudo-tags remain user-role and canonical-JSON parseable.

### 14.4 Remote and UI

Regression coverage additionally requires: a staged draft survives a Pane unmount/remount in the same Session;
an unknown-outcome retry reuses its mutation id; a conflict exposes apply-to-latest; bootstrap phases render on
Overview and History without stealing the user's section; the projected draft is what the lists and preview
render.

1. Unauthorized watch/edit is rejected before business execution.
2. Each stream generation starts with a full snapshot.
3. A write racing with baseline read does not lose the latest revision; repeats dedupe.
4. Conflict preserves the draft and shows the server revision.
5. A tab crash or mount failure leaves Host service, Session, and settings usable.
6. A view binding holds an instance-bound source lease; several bindings share one source and only the last
   lease disposes it. An older detach cannot overwrite a newer attach.
7. 360px container and mobile full-screen can add/edit/apply.
8. Keyboard reachable, focus restoration, and non-color-only state.

### 14.5 Lifecycle and compatibility

Regression coverage additionally requires: child-before-parent retries converge on the ready view; the Pane menu
never offers archive/replace on a replacement; purging a superseded predecessor detaches its successor.

1. Resume creates no new revision and calls no model.
2. Fork copies once and records parent revision; later parent edits do not penetrate.
3. A child Agent without parentSession is not inferred by cwd.
4. Disable/uninstall keeps existing Sessions recoverable.
5. Restart shows the same revision in prompt, UI, and `charter_read`.
6. Real tarball two-start smoke on the minimum and next versions.

## 15. Observability and privacy

Record: commit success/conflict/rejected/error; current record bytes, prompt bytes, active item count; stream
reconnect and baseline failure; prompt digest changed/unchanged; runtime snapshot rematerialization; lifecycle
mismatch, corrupt record, migration failure; provider raw cache hit/miss tokens.

Logs contain stable ids, kinds, revisions, and error codes only. Evidence excerpts, objectives, constraints,
paths, URLs, and command arguments are sensitive and do not enter ordinary logs or analytics.

## 16. Open items

1. Watch/edit frames carry the full item set for a maximum-size charter; moving historical items to a paged
   Remote endpoint is a protocol follow-up. The Pane already collapses history and reduces render/tab cost,
   but the wire payload is unchanged in this round.

2. Final ordering of `order:130` against every target Profile runtime context.
3. Whether every compaction path clears all retained runtime snapshots (the recorded real-model compaction E2E
   PASS in verification §8.4 covers the main path).
4. Whether fork initialization listeners precede the first prompt assembly on every entry point.
5. Real sample distribution for the 8 KiB prompt and 512 KiB record budgets.
6. Domain migration entry for incompatible upgrades.
7. Whether a legal-grade permanent audit is needed; it would be a separate project, not a bounded history.
8. DSH 0.1.7/0.2.0 have no per-Peer resource authorization.
9. `charter_read` `standing` is the complete working set with no fixed byte cap; a maximum-size charter can
   produce a large tool result. Paging or an explicit response cap is a follow-up.

## 17. Decision status

**Decided:** storage-domain authority, user-role context, single-record atomic update, orthogonal state
dimensions, model read-only MVP, minimum DSH `0.1.7-rc.2`, 0.2.1+ uses `@Remote.resources`, 0.1.7/0.2.0
degrade to live-Session + lifecycle checks.

**Still needs M0 data:** exact quotas, context order, fork product wording. They require real Profile samples
and are not fixed by this document.
