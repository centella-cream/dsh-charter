# `dsh-charter` 0.1.0-rc.3 Upgrade Plan

English | [中文](rc3-recovery-plan.zh.md)

Plan date: 2026-10-26.

Target release: `0.1.0-rc.3`.

## 0. Implementation status (2026-10-26)

All required §3.1 features and §4–§11 contracts are implemented in the uncommitted rc.3 worktree, including the six
Remote methods, structured record state, source-aware initialization, per-Session mutation queue, write-uncertain
fencing, bounded maintenance receipts, the Storage & recovery UI, the scripted fault harness, and the packed-artifact
recovery smoke. Phase A (pure contracts) → Phase B (Host boundary) → Phase C (Remote/client/UI) → Phase D (docs,
version, final-artifact verification) were implemented in order. §3.3 deferred items remain excluded. The RC3-01…13
acceptance matrix and exact evidence live in [verification §8.6](../verification.md). Manual release actions (tag,
push, publish, fresh-profile UI check, CI) remain for the release operator; rc.3 uses one local tarball+SHA and
`scripts/verify/recovery-smoke.mjs` for the packed-artifact evidence.

## 1. Decision

rc.3 has one focus: **prevent silent replacement of the Charter authority after Session restoration or storage failure, and give the user a verifiable backup and recovery path.**

The current release already proves that a Charter survives context compaction. The next release should address authority failure handling rather than improve compaction summaries:

1. When an existing Session is resumed and storage reports an absent record, the Host no longer creates an empty record or re-forks from the parent automatically.
2. Views and Remote contracts expose a structured record state; the client no longer infers failure classes from English messages.
3. Users can export the complete record, including identity, the current snapshot, bounded history, and idempotency receipts.
4. Users can restore a valid archive to the same Session lifecycle; the product exposes no healthy-record overwrite, cross-Session rebind, or ignore-lifecycle path.
5. Initialization, ordinary edits, and recovery share one per-Session mutation queue, and recovery re-reads the target inside that queue.
6. A controllable storage fault harness and final-tarball recovery smoke become release gates.

rc.3 does not add an automatic shadow authority, create `dsh_charter_v2`, or grant model write access. `CharterRecord` remains version 1 and gains only optional bounded maintenance receipts, so valid records need no migration or startup rewrite.

## 2. Current Constraints

### 2.1 Existing guarantees

The current implementation already provides:

- one authority at `dsh_charter_v1/sessions/<sessionId>`;
- atomic Apply through storage-domain `update()`;
- deterministic snapshot, prompt, and digest reconstruction;
- per-Session isolation of inner schema or consistency failures;
- lifecycle identity fencing;
- exact mutation replay after an unknown Apply outcome;
- reconstruction of `charter:standing` from storage after compaction.

These guarantees remain unchanged.

### 2.2 Gap to close

The per-record reader in `@deepseek-ai/dsh-storage-json` folds all of these cases into absent:

- a genuinely missing file;
- truncated or malformed JSON;
- an invalid wrapper;
- a rejected wrapper version;
- a file-read failure.

`dsh-storage-domain` consequently exposes only `table.get(key) === undefined`. Its public API has no raw file, path, read issue, or presence probe, so the plugin cannot distinguish a genuinely missing record from an unreadable document.

The current `CharterService` treats that `undefined` as first initialization and writes an empty or newly forked record. Because the JSON backend publishes with an atomic rename, the new record completely replaces the prior file. rc.3 must stop this failure path.

### 2.3 What rc.3 can guarantee

rc.3 can guarantee that:

- ambiguous absence during `resume`, `clear`, `compact`, or plugin reattachment does not trigger an automatic write;
- the plugin does not overwrite the key before explicit initialization or recovery;
- a healthy export can be validated and restored to the same Session lifecycle;
- inner schema/consistency failures remain isolated and their visible raw JSON value can be exported for diagnosis;
- a rejected storage write never publishes the proposed content to the view, prompt, or tool; the Session enters `write-uncertain` and stops further reads and writes until a Host restart reloads the medium.

rc.3 cannot guarantee that it can:

- identify whether an outer JSON document is missing, malformed, version-incompatible, or unreadable;
- retrieve bytes already discarded by the backend reader;
- repair damaged data without a backup;
- coordinate multiple Host processes writing the same JSON storage;
- survive loss of both the storage root and the user's archive.

A rejected storage Promise does not prove that the medium stayed unchanged. The JSON backend renames first and then fsyncs the parent directory; if rename succeeds and fsync fails, the call rejects even though the target may already contain the new value. rc.3 therefore treats every storage-write rejection as an unknown outcome and never promises that disk bytes remain old.

The UI and documentation must say "missing or unreadable; cannot be distinguished automatically", not claim that outer corruption was identified.

## 3. Release Scope

### 3.1 Required in rc.3

| Feature | Outcome |
| --- | --- |
| Source-aware initialization | `startup` may create; restoration sources stop on absence |
| Structured record state | Host, wire, watch, and Pane use one discriminated union |
| Explicit initialization | A confirmed action creates an empty record for ambiguous absence |
| Complete-record export | Healthy records are restorable; inner-invalid records are diagnostic exports |
| Controlled recovery | Same Session, same lifecycle, non-healthy target only |
| Per-Session mutation queue | Initialization, edit, and restore cannot overwrite one another |
| Bounded maintenance receipts | initialize/restore persist request digests for exact unknown-outcome replay |
| Uncertain-write fencing | A storage rejection stops injection, tool reads, and later writes for that Session |
| Unknown-outcome replay | initialize/restore share the edit/bootstrap attempt rules and Remote error classifier |
| Fault injection | Automated backend open/load/write/pending/close failures |
| Final artifact verification | The same `.tgz` passes export/restore and storage-fault smoke |

### 3.2 If capacity remains

- Run real profile smoke for the lowest and highest supported DSH versions in the release workflow.
- Generate a machine-readable release acceptance report.
- Submit an upstream proposal for issue-aware per-record reads.
- Add a friendlier field-level view for diagnostic exports.

### 3.3 Explicitly deferred

- An automatic recovery domain or backup write on every Apply.
- Arbitrary rollback of a healthy record.
- Cross-Session or cross-lifecycle rebind/import.
- `dsh_charter_v2` or a migration runner without a real target schema.
- Permanent audit history.
- `charter_propose`, validators, or new card kinds.
- Model writes, automatic acceptance, or automatic archival.
- Direct reads from JSON paths under `$DSH_HOME`.
- Reliance on `DomainImpl`, private JSON backend fields, or unexported classes.
- Archive signing or cross-device key management; rc.3 digests check integrity, not provenance.

An automatic shadow backup would introduce two writes across domains without a transaction. It needs a prepared/committed recovery protocol and new authority-selection rules, which should not be mixed into this repair release. Side-by-side copy belongs to the first incompatible record v2, not to a speculative format.

## 4. User-Visible Behavior

### 4.1 New Session

After `agent/created(source: "startup")`:

- a root Session creates an empty revision-0 record as it does today;
- a new fork creates one fork record only when the parent record is healthy;
- a write failure shows storage unavailable and never publishes ready early;
- a rejected write enters `write-uncertain` rather than guessing whether the empty record landed;
- `session/created` no longer writes storage. It only tracks a pending Session until `agent/created` provides the authoritative source.

### 4.2 Restored Session

After `resume`, `clear`, or `compact`:

- a healthy, identity-matching record becomes ready;
- an inner-invalid record stops injection and writes and exposes a structured failure state;
- an identity mismatch remains fenced and is never overwritten;
- an absent table key becomes `absent-unconfirmed`, with no empty-record write;
- a missing fork child is never reconstructed from the parent's current state.

Agents already present when the plugin mounts have no replayable start source. They are treated as `reattach`: existing records can open, but absence does not create a record.

Inferred and authoritative sources for one Agent lifecycle must be coalesced. `reattach`/`unknown` are weak intents; the source delivered by `agent/created` is authoritative. A later authoritative `startup` must trigger another inspection rather than reuse an earlier `reattach` result.

### 4.3 `absent-unconfirmed`

The Pane states:

> No Charter record was loaded. It may never have existed, or storage may be unable to read it. The plugin has not written to this location.

The user can:

1. select and validate an export file;
2. restore it to the current Session;
3. stop the Host and back up or repair the source file first;
4. explicitly confirm creation of an empty Charter.

Creating an empty Charter may replace an unreadable document and therefore requires a second confirmation. For a restored fork, this action creates an empty record rather than copying the current parent, because the original fork point cannot be reconstructed safely.

### 4.4 Inner-invalid record

When a table value exists but fails strict schema or consistency validation:

- preserve the raw value;
- inject no prompt;
- reject ordinary edits;
- let an owner download a diagnostic export;
- let an owner replace it with a healthy archive for the same lifecycle;
- require the current raw record digest in the restore request.

### 4.5 Healthy record

A healthy record may be exported but cannot be overwritten through restore. Normal Charter operations and revision conflict rules remain the only way to modify it.

This prevents recovery from becoming a whole-record write bypass, prevents revision rollback from violating the client's monotonic view, and prevents an older archive from overwriting an Apply that committed while its response was lost.

### 4.6 Uncertain write outcome

A backend rejection after `put()` passes preflight, or after an `update()` callback successfully produces its next value, immediately puts the target Session in `write-uncertain`. Deterministic business errors from the callback do not fence it:

- do not publish the proposed content;
- stop prompt injection and `charter_read`;
- reject edit, initialize, restore, and export;
- publish one structured watch demotion rather than keep presenting the old record as editable;
- do not repair or overwrite that key again in the same Host lifetime;
- after Host restart, reload the medium, recognize a landed operation by its idempotency receipt, or safely retry an operation that did not land.

Other Sessions may continue. If the backend remains unhealthy, each is fenced after its first failed write. rc.3 does not perform a runtime domain close/reopen because that would disrupt every Session and substantially expand the service lifecycle.

## 5. State Model

### 5.1 `CharterRecordState`

Add a structured state to `CharterView`:

```ts
type CharterRecordState =
  | {
      readonly kind: 'healthy'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'absent-unconfirmed'
      readonly source: 'resume' | 'clear' | 'compact' | 'reattach' | 'unknown'
    }
  | {
      readonly kind: 'invalid'
      readonly reason: 'schema' | 'consistency'
      readonly recordDigest: `sha256:${string}`
      readonly observedRevision?: number
      readonly recoverable: boolean
    }
  | {
      readonly kind: 'lifecycle-mismatch'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'unknown'
      readonly reason: 'initializing' | 'storage-unavailable' | 'legacy-host'
    }
  | {
      readonly kind: 'write-uncertain'
      readonly operation: 'startup' | 'edit' | 'initialize' | 'restore'
      readonly lastKnownRecordDigest?: `sha256:${string}`
    }
```

Rules:

- `recordDigest = sha256Json(rawStoredValue)` covers the complete raw record, including identity, current, history, recent mutations, and optional recent maintenance.
- The existing `stateDigest` still covers only the current snapshot; the digests are not interchangeable.
- `overBudget` stays orthogonal and does not indicate corruption.
- `recordState` is a Host-derived value and is never persisted in `CharterRecord`.
- `message` remains optional diagnostic detail, not a UI protocol.

### 5.2 View status

Keep the top-level `ready | initializing | unavailable` status to limit client churn:

| Record state | View status | Model injection | Ordinary edit |
| --- | --- | --- | --- |
| healthy and live | ready | when in budget | allowed |
| healthy and non-live | unavailable | no | no |
| absent-unconfirmed | unavailable | no | no |
| invalid | unavailable | no | no |
| lifecycle-mismatch | unavailable | no | no |
| unknown/initializing | initializing | no | no |
| unknown/storage-unavailable | unavailable | no | no |
| write-uncertain | unavailable | no | no; restart required |

When a new client reads an old Host frame, the wire schema defaults `recordState` to `{ kind: 'unknown', reason: 'legacy-host' }`. The project continues to ship matching Host/client bundles rather than maintain a second protocol.

### 5.3 Central inspection

Add one internal `inspectStoredRecord(raw, session?)` operation that:

1. computes the raw record digest;
2. applies strict `charterRecordSchema.safeParse()`;
3. calls `assertRecordConsistency()`;
4. optionally checks lifecycle identity;
5. returns a discriminated result and parsed record.

For schema-invalid input, inspection also attempts a loose `identity` projection. Set `recoverable: true` only when identity can be proven to match the live Session. Missing or malformed identity remains available for diagnostic export but cannot be overwritten online. A loose identity that clearly differs is classified as lifecycle-mismatch. A consistency-invalid record already has strict identity and must also match before recovery.

The current message map and invalid-record set must no longer define business behavior. View, edit, export, and restore all consume this one inspection result.

## 6. Initialization and Write Ordering

### 6.1 Source-aware initialization

`ensureSession()` must use `SessionStartSource`:

```text
stored healthy                    -> load
stored invalid/mismatch           -> fail closed
absent + startup                  -> create root/fork
absent + resume/clear/compact     -> absent-unconfirmed
absent + reattach/unknown         -> absent-unconfirmed
```

Required event changes:

- `session/created` does not call initialization with a fabricated `startup` source.
- `agent/created` is authoritative for new Agent lifecycles.
- Agents already in `ctx.agents.list()` at plugin mount use `reattach`.
- Child retries caused by `domain/changed` retain the child's known source, or use unknown.
- `edit()` removes its implicit startup initialization branch and returns `INITIALIZATION_REQUIRED`.

Initialization intent is tracked by exact Session object and Agent generation, not only by a cached `Promise<void>`:

- `session/created` enters a pending set; the post-open `agents.list()` scan skips that set and waits for the serial `agent/created` event;
- only Agents that predate the mount and are not pending are marked `reattach`;
- if authoritative `agent/created` arrives during an inferred initialization, it advances the intent generation and the latest authoritative source runs again after the current inspection;
- reattach/unknown can never downgrade an authoritative source;
- replacing a Session object under the same id invalidates the old intent and controller.

### 6.2 Per-Session mutation queue

Add one Host queue for every path that can write `sessions[sessionId]`:

- startup initialization;
- explicit empty initialization;
- ordinary edit;
- restore.

Each queue slot re-reads the table and validates the target before `put()` or `update()`. This supplies the missing conditional-create behavior within the supported single-Host deployment.

Constraints:

- initialize the parent before entering the child queue; never hold a child queue while waiting for its parent;
- never enter the same Session queue recursively;
- a business-validation failure does not poison the queue; a rejected storage write intentionally fences that Session and later queue entries return `UNAVAILABLE`;
- shutdown closes admission, drains initialization and mutation queues, then closes the domain;
- `table.update()` remains the final storage linearization point for ordinary edits;
- cross-process JSON storage coordination remains unsupported.

## 7. Export Format

### 7.1 Archive envelope

Add a strict, versioned JSON format:

```ts
interface CharterRecordArchiveV1 {
  readonly format: 'dsh-charter-record'
  readonly formatVersion: 1
  readonly exportedAt: number
  readonly source: {
    readonly domain: 'dsh_charter_v1'
    readonly domainVersion: 1
    readonly sessionId: string
    readonly lifecycle: string | null
    readonly health:
      | 'healthy'
      | 'schema-invalid'
      | 'consistency-invalid'
      | 'lifecycle-mismatch'
    readonly revision: number | null
    readonly recordDigest: `sha256:${string}`
  }
  readonly record: unknown
  readonly payloadDigest: `sha256:${string}`
}
```

`payloadDigest` covers the complete envelope except itself. It detects transfer errors, truncation, and casual edits. It is not a signature and does not authenticate the source.

The Host recomputes `source.recordDigest`, `source.revision`, and `source.lifecycle` from `record`, and requires `source.health === 'healthy'` for a restorable archive. These envelope fields are redundant checks, not independent facts.

The archive threat model covers accidental wrong-file selection, transfer corruption, and unintended edits. It does not resist an owner who deliberately rewrites a record and recomputes public SHA-256 values. The owner is a trusted maintainer; authenticated exchange would require a separate signing, key-rotation, and disaster-recovery design.

### 7.2 Export rules

- Export one Session at a time; no cross-Session bulk endpoint.
- Only an owner on a runtime with modern principal/resource enforcement.
- Export any visible raw value classified as healthy, schema-invalid, consistency-invalid, or lifecycle-mismatch.
- Restore only archives that independently pass strict schema, consistency, and lifecycle checks.
- There is no raw value to export for absent-unconfirmed; direct the user to stop the Host and back up the storage file.
- The Host returns JSON but never writes a path; the browser performs the local download.
- Use `dsh-charter-<safe-session>-r<revision>-<timestamp>.json` as the suggested filename.
- The archive contains user text and bounded receipts; the UI must label it sensitive.
- Logs contain only the Session id, revision, digest prefix, and result, never archive content.

### 7.3 Size limit

Add `maxRecoveryBytes`, defaulting to 4 MiB, at least `maxRecordBytes + 64 KiB`, with a product hard ceiling of 16 MiB. The 4 MiB default is a starting point based on the default 1 MiB record budget, not a DSH transport contract. `CharterViewLimits` exposes the effective value. The client checks file size before reading; the Host checks the complete archive and serialized request again.

If a profile configures `maxRecordBytes` too high to fit a complete envelope under 16 MiB, ordinary Charter behavior continues but `capabilities.recordMaintenance` is false with reason `record-limit`; offline backup after stopping the Host is required. Never silently lower the existing record limit.

Recovery uses a separate `assertRestoreAdmission()` and does not call `assertRecordAdmission(undefined, ...)`, so it may accept a valid old record above current `maxRecordBytes`. The Host validates the archive, trims old maintenance receipts, appends the current receipt, then requires the **final serialized record** to fit `maxRecoveryBytes`. The resulting view is over budget and is not injected until the user trims it or adjusts configuration. Lowering normal write limits later must not make an existing backup unreadable forever.

A unary Remote request is fully buffered and decoded before the method runs, so `maxRecoveryBytes` is business admission and memory budgeting, not a transport DoS boundary. The 0.2.1-rc.2 Web carrier defaults to a 300 MiB complete HTTP request limit, which deployments may lower. Profile acceptance must verify that the Gateway body limit exceeds the actual recovery envelope; otherwise the carrier rejects first. No public upstream response limit is documented, so final-tarball tests cover the largest allowed export.

## 8. Explicit Initialization and Recovery

### 8.1 New Remote methods

Expand the namespace from three to six methods:

```ts
charter.watch(sessionId, signal)
charter.bootstrap(sessionId)
charter.edit(request)
charter.exportRecord(sessionId)
charter.initializeRecord(request)
charter.restoreRecord(request)
```

All new methods declare a Session resource. Export, initialize, and restore are enabled only when DSH 0.2.1+ resource scopes and Peer principals are available, and require an owner principal.

DSH 0.1.7/0.2.0 retain trusted-single-operator behavior for existing Charter features, but these three maintenance endpoints fail closed with `RECOVERY_UNSUPPORTED` before deep archive parsing or storage access. `CharterView.capabilities.recordMaintenance` lets the UI say that DSH 0.2.1+ is required rather than render enabled controls.

Wire compatibility rules:

- Missing `capabilities.recordMaintenance` defaults to false for old Host frames.
- The `restoreRecord` descriptor strictly checks only the small outer fields and that `archive` exists; archive is `unknown` at the Gateway boundary.
- The method checks runtime capability and owner before strict archive parsing, size checks, or storage access.
- Old DSH still receives and JSON-decodes the whole HTTP body, and a malformed outer request may fail with `gateway/input-invalid` before `RECOVERY_UNSUPPORTED`; this design does not claim pre-allocation transport rejection.

### 8.2 Bounded maintenance receipts

Add optional `recentMaintenance` to `CharterRecord` while retaining `recordSchemaVersion: 1`:

```ts
interface CharterMaintenanceReceipt {
  readonly operationId: string
  readonly kind: 'initialize' | 'restore'
  readonly requestDigest: `sha256:${string}`
  readonly resultRevision: number
  readonly resultStateDigest: `sha256:${string}`
  readonly sourceRecordDigest?: `sha256:${string}`
  readonly at: number
}
```

- Old records without the field stay valid and are not rewritten on startup.
- `maintenanceLimit` is a `CharterLimits` field, default 16 and minimum 1. Initialize/restore retain the latest `maintenanceLimit - 1` old receipts and append the current receipt, ensuring the current operation survives until the 16th subsequent maintenance operation at defaults.
- The request digest binds operation kind, Session, lifecycle, actor, expected target, and archive record digest, excluding the operation id itself.
- The same operation id and request digest returns the original result as replayed.
- Reuse with a different digest returns `OPERATION_ID_REUSED`.
- Ordinary edits preserve receipts, so a restore can still be confirmed after a later edit while its receipt remains.
- `assertRecordConsistency()` validates unique ids, revision ranges, digest shapes, and locally provable semantics: initialize has revision 0, the deterministic empty-state digest, and no sourceRecordDigest; restore requires sourceRecordDigest; when current or bounded history still contains the result revision, its digest must match the receipt.
- The window is bounded like `recentMutations`; no replay guarantee exists after eviction.

The current operation receives stronger checks: initialize must match the generated empty record; restore sourceRecordDigest, resultRevision, and resultStateDigest must match the validated archive's record digest, current revision, and state digest. If the archive itself already contains the current operation id but the target has no replay receipt, return `OPERATION_ID_REUSED` rather than importing ambiguous evidence.

Recovery stores the archived record plus the new maintenance receipt, so the resulting full `recordDigest` differs from the archive's `source.recordDigest`. Evidence consists of the receipt's `sourceRecordDigest`, restored current/history/recent-mutation content, and matching state/prompt digests.

### 8.3 Explicit initialization

```ts
interface CharterInitializeRequest {
  readonly sessionId: string
  readonly operationId: string
  readonly expectedLifecycle: string
}
```

Inside the per-Session queue, the Host:

1. verifies the live Session and expected lifecycle;
2. re-reads the table;
3. creates an empty revision-0 record only if it remains absent;
4. returns `replayed: true` when the record contains the same operation id and request digest receipt;
5. treats a healthy empty record without that receipt as another record and returns `RECORD_CONFLICT`;
6. publishes ready only after durability.

This is not purge or reset and cannot overwrite a healthy, inner-invalid, or lifecycle-mismatched record. Because an outer unreadable document still appears absent, the UI requires destructive confirmation before sending the request.

### 8.4 Restore request

```ts
interface CharterRestoreRequest {
  readonly sessionId: string
  readonly operationId: string
  readonly expectedLifecycle: string
  readonly expectedTarget:
    | { readonly kind: 'absent-unconfirmed' }
    | {
        readonly kind: 'invalid'
        readonly reason: 'schema' | 'consistency'
        readonly recordDigest: `sha256:${string}`
      }
  readonly archive: CharterRecordArchiveV1
}
```

### 8.5 Archive validation

The Host repeats every validation regardless of client preview:

1. strict archive schema and format version;
2. `payloadDigest`;
3. `source.sessionId === request.sessionId`;
4. record-derived digest, revision, and lifecycle equal `source`, and source health is healthy;
5. `charterRecordSchema`;
6. `assertRecordConsistency()`;
7. exact identity match with the live Session;
8. archive and request size within `maxRecoveryBytes`;
9. coherent revision, history, recent mutations, recent maintenance, and both snapshot digests.

There is no ignore-lifecycle, import-into-current-Session, or force option.

### 8.6 Target CAS and write

After entering the per-Session queue, inspect the target again:

- absent target plus expected absence permits `put()`;
- invalid target with the same reason and raw digest permits replacement only when `recoverable: true`;
- a current record containing the same operation id and request digest receipt returns `ok: true, replayed: true`, even after a later ordinary edit;
- a healthy target, changed digest, changed lifecycle, or changed classification returns `RECORD_CONFLICT`;
- schema-invalid targets use the full raw digest, not revision alone;
- preserve archived current revision, history, and mutation receipts without incrementing the revision or fabricating Charter history; append only the separate maintenance receipt;
- update memory and publish a view only after durable success.

Because recovery cannot target a healthy record, it cannot roll a ready revision backwards. The client can retain monotonic revision filtering; only view deduplication must include `recordState`.

### 8.7 Error codes

Add five deterministic business codes:

```text
INITIALIZATION_REQUIRED
INVALID_ARCHIVE
RECORD_CONFLICT
OPERATION_ID_REUSED
RECOVERY_UNSUPPORTED
```

- `INITIALIZATION_REQUIRED`: an ordinary edit encounters absent-unconfirmed.
- `INVALID_ARCHIVE`: format, digest, consistency, or identity validation fails.
- `RECORD_CONFLICT`: the target changed after preview or is now healthy.
- `OPERATION_ID_REUSED`: one operation id names different maintenance requests.
- `RECOVERY_UNSUPPORTED`: the DSH runtime lacks principal/resource enforcement required for maintenance Remote calls.

These business outcomes resolve and clear the attempt. A storage rejection returns `UNAVAILABLE` with a `write-uncertain` view and is treated as unknown. Replay success returns the receipt's original result revision/state digest plus the current authoritative view, matching ordinary edit replay semantics.

## 9. Client State and UI

### 9.1 Shared attempt state machine

Extend `DraftAttempt` into:

```ts
type DraftAttempt =
  | EditAttempt
  | BootstrapAttempt
  | InitializeAttempt
  | RestoreAttempt
```

Rules remain uniform:

- at most one durable request per Session;
- unresolved edit/bootstrap disables initialize/restore;
- unresolved initialize/restore locks all request-changing actions;
- Retry resends the exact operation id, lifecycle, target digest, and archive;
- a success view arriving before the RPC response does not clear the attempt;
- the Host recognizes replay from a maintenance receipt in the record;
- only success, deterministic failure, or explicit Abandon clears it;
- lifecycle changes never rewrite an old request; an exact retry receives deterministic `LIFECYCLE_MISMATCH` and ends the attempt.

The client must not classify every thrown Remote failure as unknown. It uses `remoteErrorOf()` and stable RemoteError codes:

- Charter success or deterministic business code: known outcome.
- `remote-access/denied`, `gateway/arguments-invalid`, `gateway/input-invalid`, and method/service/definition unavailable failures documented before business dispatch: definitely not executed; end the attempt.
- `gateway/internal`, `gateway/cancelled`, `gateway/result-invalid`, carrier loss, connection-generation change, and unclassified assembly failures: possibly executed; retain the exact request.
- `UNAVAILABLE`: conservatively possibly executed.

The exact allowlist follows the public error contract of each supported DSH version and is locked by compatibility tests; never classify by message or `instanceof`.

### 9.2 New section

Add a Storage & Recovery section after Context. It contains:

1. **Record state:** health, revision, lifecycle, short record digest, and over-budget state.
2. **Export:** download the current raw-record archive with a sensitive-data notice.
3. **Recovery:** choose JSON, preview it, confirm target state, then restore or explicitly initialize empty.

`statusMessage()` becomes an exhaustive switch over `recordState`; it no longer searches `view.message` for `read-only`, `corrupt`, or `storage`.

### 9.3 Archive preview

The client provides early feedback for:

- JSON and archive schema parsing;
- source Session, revision, export time, health, and digest;
- obvious Session/lifecycle mismatches;
- `maxRecoveryBytes`.

These checks never replace Host validation. File name, content preview, expansion state, and first confirmation stay local to the Pane. Once the second confirmation sends a request, the exact request enters the persistent attempt state.

### 9.4 Admission

Initialize/restore is enabled only when:

- the source is attached;
- the current Session is live;
- no request is in flight or unknown;
- there are no staged ops, open editor, or reviewed history draft;
- view and request lifecycles match;
- the target record state permits the operation;
- archive preview passes.

The store and Pane use one shared pure predicate.

## 10. Compatibility and Upgrade

### 10.1 Persistent records

- Keep `recordSchemaVersion: 1` and add optional `recentMaintenance`.
- Keep `dsh_charter_v1`.
- Do not rewrite healthy records on startup.
- Do not bulk-canonicalize.
- Do not create v2 or dual-write.

This is forward-readable upgrade compatibility, not rc.2 rollback compatibility. rc.2 uses a strict top-level record schema. Once rc.3 writes `recentMaintenance` for a Session, rc.2 isolates that Session as schema-invalid and stops injection/editing while preserving the raw record; upgrading back to rc.3 restores access. Records without a maintenance operation remain readable by rc.2. Release notes and the first initialize/restore confirmation must disclose this. If continued operation after downgrade becomes a requirement, the correct design is a new domain and side-by-side copy, not a version bump in place.

### 10.2 Upgrade from rc.2

| rc.2 state | rc.3 behavior |
| --- | --- |
| Healthy record | Read unchanged and derive a record digest; write the optional receipt only on maintenance |
| Inner schema-invalid record | Keep isolated; diagnostic export or controlled recovery |
| Consistency-invalid record | Keep isolated; diagnostic export or controlled recovery |
| Resumed Session without a record | Show absent-unconfirmed; do not initialize automatically |
| New startup Session without a record | Create an empty root or fork under the source contract |
| Resumed fork child without a record | Do not re-fork; require recovery or explicit empty initialization |
| Outer unreadable file | Backend still reports absence, but rc.3 does not overwrite it on resume |

No migration CLI is required. The archive is a backup protocol, not a second authority.

### 10.3 DSH versions

Keep the current five exact peers initially. Existing Charter features retain the current matrix; record maintenance is enabled only on `0.2.1-rc.1`/`rc.2`. Older versions expose capability unavailable and prove that maintenance fails before archive or storage access. If a release cannot satisfy the base source or wire contract, remove it rather than maintain a second implementation.

## 11. Security and Privacy

- Export, initialize, and restore are never model tools.
- All three operations are owner-only on DSH 0.2.1+ and disabled on older DSH releases.
- Every Remote method declares a Session resource.
- Archives contain user text and must be treated as sensitive files.
- Host and client logs never contain archive, objective, item, or history text.
- The payload digest checks integrity but not source authenticity.
- The owner is the trust boundary: an owner who deliberately constructs a record and recomputes public digests can produce a valid archive; rc.3 does not treat archives as signed credentials.
- Restore accepts a user-selected local JSON file, never a URL or Host path.
- Cross-lifecycle force import is unsupported.
- Empty initialization and invalid-target restore both require a second confirmation.
- Before replacing an outer unreadable target, the UI directs users who need forensic bytes to stop the Host and back up the file first.

## 12. Automated Verification

### 12.1 Core

Add tests for:

- strict archive schema and version;
- payload digest round-trip and mutation rejection;
- healthy export parse and consistency validation;
- diagnostic-only inner-invalid archives;
- Session/lifecycle/identity mismatch;
- archive size limits;
- raw record digest coverage of identity, history, recent mutations, and recent maintenance, not only current;
- rejection when envelope-derived fields disagree with the record even after payload digest recomputation;
- maintenance receipt replay, id reuse, trimming, and restore followed by edit.
- rc.2 safely isolates a receipt-bearing record and rc.3 reads it again after re-upgrade;
- View limits carry maxRecoveryBytes, and a final record that exceeds it after receipt append is rejected.

### 12.2 Host with real JSON storage

Add scenarios for:

1. `resume + absent` performs no write and reports absent-unconfirmed;
2. malformed outer JSON bytes and hash remain unchanged after resume;
3. a rejected wrapper version remains unchanged;
4. a new startup Session still initializes;
5. a resumed missing fork child is not rebuilt from its parent;
6. explicit initialization applies only to absence;
7. an invalid target can be restored from a healthy archive;
8. a healthy target rejects restore without file changes;
9. lifecycle mismatch rejects restore;
10. a repeated restore after a lost response replays through the maintenance receipt;
11. restore commits, its response is lost, an ordinary edit lands, and retry still confirms the original operation within the receipt window;
12. concurrent restore/edit/initialize has one legal queue order;
13. restored prompt, `charter_read`, watch, and storage digests agree;
14. an over-budget archive restores but is not injected;
15. a new Agent created while domain open is delayed cannot have authoritative startup swallowed by reattach/unknown.

### 12.3 Scripted storage fault backend

Add a test-only backend with ordered controls:

```text
open: pass | reject | defer
loadAll: pass | reject | defer
putRecord[n]: pass | reject | defer | commit-then-reject
deleteRecord[n]: pass | reject | defer
close: pass | defer
```

It must prove that:

- open/load failure creates no empty record;
- a rejected startup write never publishes ready;
- `CharterError`, `MutationReplay`, `RevisionConflict`, and `DomainError(missing-key|closed)` raised before a durable backend call are known outcomes and do not fence the Session;
- a backend rejection after the update callback produced a next value publishes no proposed content and marks the Session write-uncertain; `put()` follows the same rule except for known preflight DomainError;
- commit-then-reject models rename followed by fsync failure: domain memory remains old, medium may be new, the Session is fenced, and restart converges from the medium;
- deferred writes publish nothing before resolution;
- close drains admitted writes and rejects new ones;
- one Session's uncertain write does not disable reads/prompts for other Sessions;
- Remote/client separately model a successful business commit followed by response loss and verify maintenance-receipt replay.

### 12.4 Remote and watch

- Descriptor count grows from three to six.
- Strict codecs and Session resources cover all new methods.
- Owner enforcement is tested on 0.2.1; maintenance fails closed on 0.1.7/0.2.0; real Gateway tests cover outer-codec versus deep-archive parsing order.
- A record-state or record-digest change emits changed even at the same revision/prompt digest.
- A change only to recentMaintenance or capability also emits and is accepted at the same revision/prompt digest.
- Legacy Host frames default to unknown/legacy-host.
- Unknown archive/request fields are rejected.
- New error codes round-trip through wire codecs.

### 12.5 Client

- UI status never depends on message substrings.
- Unknown edit/bootstrap disables recovery.
- Unknown restore retains the exact request.
- Stream-first success does not half-clear the attempt.
- Repeated UNAVAILABLE keeps the request.
- Pre-dispatch RemoteError codes resolve the attempt; possibly post-dispatch codes retain it.
- Replay success clears the attempt.
- INVALID_ARCHIVE/RECORD_CONFLICT resolve and unlock it.
- Lifecycle changes never retarget an archive.
- The new section works on narrow screens, both themes, and keyboard navigation.
- Diagnostic export, healthy export, explicit initialization, and restore confirmation have component tests.

### 12.6 Final tarball

The release workflow packs once and all later jobs download the same artifact:

1. verify SHA-256;
2. run existing exact-artifact package smoke;
3. install packed Host/Remote/client;
4. run the storage fault smoke against packed `CharterService`;
5. create a record with Unicode, pending, archived, superseded, and history data;
6. export, remove the test target, and restore under the same Session identity;
7. restart twice and compare record, state, prompt, and tool digests/projections;
8. prove that an old archive cannot overwrite a healthy target;
9. run fresh-profile smoke on at least the lowest and highest supported DSH versions;
10. publish the exact same tarball to GitHub Releases and npm.

Real-model compaction remains a manual release artifact, not a normal PR CI job.

## 13. Blocking Acceptance Criteria

All criteria must pass before rc.3 is published:

| ID | Criterion |
| --- | --- |
| RC3-01 | Resume/reattach absence performs no `put()` |
| RC3-02 | Malformed/version-rejected files remain byte-identical after Host start, view, and edit attempts |
| RC3-03 | A resumed missing fork child is not reconstructed from its parent |
| RC3-04 | Export contains the full record; restore receipt binds the archive digest and restored current/history/mutations match |
| RC3-05 | Restore accepts only same-Session, same-lifecycle, structurally consistent archives |
| RC3-06 | Healthy targets, changed invalid targets, and lifecycle mismatches reject overwrite |
| RC3-07 | Unknown initialize/restore outcomes replay exactly within the bounded receipt window, including restore followed by edit |
| RC3-08 | Storage rejection publishes no proposed content, fences the target as write-uncertain, and converges after commit-then-reject restart |
| RC3-09 | Watch/client preserve same-revision record-state and digest changes |
| RC3-10 | Node 22.19/24 and all five base DSH checks pass; maintenance is enabled on 0.2.1 and fails closed on older releases |
| RC3-11 | Final `.tgz` export/restore/fault smoke passes |
| RC3-12 | English and Chinese README, design, guide, verification, changelog, and release docs agree |
| RC3-13 | A receipt-bearing record safely isolates under rc.2 without overwrite and becomes readable again after re-upgrade |

## 14. Implementation Order

### Phase A: pure contracts

- Extract `charterIdentitySchema` and add the optional maintenance-receipt schema.
- Add record digest, `CharterRecordState`, and archive schema.
- Define maintenanceLimit, independent restore admission, and receipt consistency.
- Add pure archive validation and restore-planning functions.
- Complete core tests.

### Phase B: Host boundary

- Restore the sessions-table type to `KvTable<SessionId, unknown>`.
- Centralize stored-record inspection.
- Implement source-aware initialization.
- Implement source-intent coalescing for the startup/reattach race.
- Add the per-Session mutation queue.
- Add the write-uncertain Session fence.
- Remove implicit startup initialization from edit.
- Add export/initialize/restore service methods.
- Complete real-JSON and fault-backend tests.

### Phase C: Remote and client

- Extend wire and contribution to six methods.
- Include record state in watch/client deduplication.
- Add initialize/restore to the attempt union.
- Add the Storage & Recovery section, localized copy, and responsive styles.
- Complete Remote, store, draft, and Pane tests.

### Phase D: artifact and release

- Update Remote/client/package smoke.
- Add a final-artifact release workflow.
- Run the five-version compatibility matrix.
- Update user guide, verification record, changelog, and release notes.
- Produce one tarball and SHA-256.
- Complete manual profile and compaction checks.

## 15. Expected Change Surface

Expected modifications:

```text
src/core/schemas.ts
src/core/errors.ts
src/core/digest.ts
src/core/record.ts
src/host/types.ts
src/host/service.ts
src/remote/wire.ts
src/remote/service.ts
src/remote/contribution.ts
src/remote/watch.ts
src/client/store.ts
src/client/draft-store.ts
src/client/CharterPane.tsx
src/client/locales.ts
src/client/charter.css
tests/core/*
tests/host/*
tests/client/*
scripts/verify/*
.github/workflows/*
```

Unchanged:

- `charter:standing` prompt format;
- `charter_read` model-tool semantics;
- item/review/lifecycle/progress data model;
- compaction-summary bootstrap parsing;
- Existing `dsh_charter_v1` fields; rc.3 only adds optional `recentMaintenance`.

## 16. Product Boundary After rc.3

After rc.3, the project can accurately promise:

> When an existing Session is restored and its Charter record is not loaded successfully, the plugin does not automatically replace it with an empty record or the parent's current state. Users can export the complete record and restore a valid archive to the same Session lifecycle. A successful response follows durable completion; an uncertain lower-level write fences the Session and requires a restart to inspect the medium.

The following limitation remains explicit:

> The current DSH per-record storage API does not expose outer-document read errors. The plugin can report only “missing or unreadable” and cannot retrieve the original bytes automatically. Without an archive, stop the Host and repair or restore the storage file according to the operator guide.
