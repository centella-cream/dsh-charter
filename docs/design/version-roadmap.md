# `dsh-charter` Version Roadmap: 0.1 Stabilization and the 0.2 Product Upgrade

English | [中文](version-roadmap.zh.md)

> This English file is a non-normative summary. The Chinese roadmap is normative when details differ.

Baseline date: 2026-10-27.

## 1. Decision

The release path is:

```text
0.1.0-rc.4 (published compatibility patch)
  → 0.1.0-rc.5
  → 0.1.0 stable
  → 0.1.1 only if stable needs a compatible patch
  → 0.2.0-alpha.1 ... 0.2.0-rc.1 → 0.2.0
```

The next development release is **`0.1.0-rc.5`**, not `0.1.1-rc.1`. rc.4 is already public as a DSH `0.2.1-rc.3`/`rc.4` compatibility-only patch and cannot receive more content.

The reason is a correctness defect inside the promised 0.1 workflow: every compaction-history candidate starts selected, the UI initially renders only 40, and Apply includes selected candidates that the user has not seen. This conflicts with the README statement that human review is mandatory. It must be fixed before `0.1.0` becomes stable.

`0.1.1-rc.1` only makes sense after `0.1.0` stable exists and a compatible patch set needs candidate testing. It is not another spelling of `0.1.0-rc.5`.

`0.2.0` is not a bucket for isolated improvements. It is a complete Charter workflow upgrade spanning existing-feature improvements, new capabilities, information architecture and interaction redesign, data-model evolution, query APIs, and client architecture.

## 2. Current Release State

- Source version is `0.1.0-rc.4`; its Git tag, GitHub Release, and npm package are public.
- The rc.4 artifact digest is `40a9e195d9e4d20861edbe07adce9c53ea685fc3deabee0d1aab0e98af11b70d`, matching tracked `SHA256SUMS`.
- rc.4 is a compatibility-only patch adding exact support claims for DSH `0.2.1-rc.3` and `rc.4` without runtime behavior changes.
- npm `latest` and `next` both point to rc.4.

The Git tag, GitHub assets, and npm version are immutable. rc.5 uses a new version and artifact. Dynamic README/verification/releasing status is corrected during rc.5 convergence without rewriting rc.4 history.

## 3. Why rc.5

SemVer precedence is:

```text
0.1.0-rc.4 < 0.1.0-rc.5 < 0.1.0 < 0.1.1-rc.1 < 0.1.1
```

The confirmed review defect is in the `0.1.0` candidate scope, so it belongs in rc.5. Major zero does not make version semantics optional.

## 4. `0.1.0-rc.5` Scope

rc.5 is limited to review correctness, forward-schema safety, interaction safety, and stable-release evidence. It adds no domain capability. See [rc5-stabilization-plan.md](rc5-stabilization-plan.md) for the implementation plan.

### 4.1 Mandatory review of history candidates

- Candidates start unselected; hidden candidates can never be applied.
- “Select all” becomes “Select the N currently shown” and never changes hidden rows.
- Show total, visible, and selected counts at all times.
- Group invariants and deliverables with headings and counts.
- Apply submits only explicit selections. Success closes this review; unselected candidates are neither written nor converted to pending and are discarded with review cleanup. Retaining them across commits belongs to the 0.2 Proposal Inbox.
- Checkbox and textarea use separate labels instead of nested interactive controls.

Tests cover 41, 80, and 100 candidates, first-page-only selection, expansion, ordering, budget overflow, pending fallback, and unknown-outcome replay.

### 4.2 Forward-schema read-only fence

To let stable 0.1 safely encounter future 0.2 records, rc.5 tightens schema-invalid recovery:

- If raw data has an integer `recordSchemaVersion` greater than the supported version, classify it as written by a newer release and force `recoverable: false` even when loose identity matches.
- Permit diagnostic export, but reject ordinary edit, explicit initialization, and restore overwrite.
- Tell the user to upgrade rather than calling it generic corruption.
- Keep rc.3 controlled recovery only for schema-invalid values that are not recognized as a future version and whose identity can be proven.
- A same-lifecycle v2 record cannot be overwritten by an old v1 archive; downgrade leaves bytes unchanged and re-upgrade restores access.

This fence adds no record field or Remote method. Same-domain v2 in 0.2 may claim safe downgrade only to the `0.1.0` stable baseline containing this fence, not to rc.3.

### 4.3 Safe discard and staging

- Cancel editor, clear one composer, discard staged operations, and discard everything become distinct actions.
- Discarding staged operations does not clear editor/composer text.
- Full discard confirms and enumerates affected local work.
- Objective changes have their own unstage action.
- Successful discard uses the existing discarded feedback path.
- Unknown-outcome evidence remains removable only through explicit Abandon.

### 4.4 Correct committed/projected presentation

- Revision displays committed state only and no longer doubles as health color.
- Stored count comes from committed `view.items`; projected count is labeled separately.
- Staged work and staged objective changes are explicit.
- Apply always exposes its primary disabled reason.
- Empty-Charter CTAs remain available after no-summary, not-live, or bootstrap failure.

### 4.5 Recovery and accessibility fixes

- File, client preview, and Host request admission all use UTF-8 byte units but inspect different payloads and may differ; Host request admission is authoritative.
- Errors can wrap and expose accessible details rather than relying on `title`.
- Connection timeout, disconnect, unsupported runtime, missing Host service, and storage failure are distinct.
- Add field-specific accessible names, `aria-invalid`, `aria-describedby`, and meter semantics.
- Raise mobile touch targets and make the primary action explicit rather than relying on `:last-child` layout.

### 4.6 Real security and browser evidence

- Exercise owner, user, and a malformed missing-principal Peer through a real DSH 0.2.1 Gateway; valid modern Peers require a principal.
- Verify all three maintenance methods, cross-Session resource rejection, and no pre-authorization storage access.
- Run real-browser export, file selection, WebCrypto validation, restore, reload, Host restart, and healthy-target refusal.
- Complete the stable-gate Desktop restart and tab/tool ABI check.

### 4.7 DSH compatibility and artifact workflow

- rc.4 already added DSH `0.2.1-rc.3` and `rc.4` to engines and peer ranges. rc.5 completes the compatibility map, adds a reproducible matrix runner, and revalidates all seven releases.
- Retain full coverage for the minimum release, the old resource-boundary release, and the current recommended release.
- Add a pack-once release workflow: source gates do not run normal package smoke; one producer packs, and later jobs run exact-artifact package/recovery/profile smoke on that tarball.

### 4.8 Explicit exclusions

rc.5 adds no `CharterOp`, record field, persistent schema version, Remote method, model tool, provenance, validator, query plane, or new domain. Search, pagination, bulk review, and full information-architecture restructuring belong to 0.2.0.

## 5. Stable and `0.1.1`

After rc.5, enter feature freeze and publish `0.1.0` only after data-safety, authorization, review, browser, Desktop ABI, compatibility, documentation, and final-artifact gates pass.

Any runtime, wire, storage, or recovery change found during stable preparation requires another `0.1.0-rc.N`.

Do not pre-plan a `0.1.1` feature bundle. After stable, `0.1.1` is limited to compatible bug fixes, security updates, exact DSH compatibility, and contract-preserving performance/accessibility/copy or release fixes. Use `0.1.1-rc.1` only when such a patch needs candidate testing. If no patch is needed, skip it and start `0.2.0-alpha.1`.

## 6. `0.2.0` Product Definition

The theme is:

> Move from editing Charter rows to a complete workflow for capturing sources, reviewing proposals, committing a Change Set, validating facts, and diagnosing the authority.

It has four product pillars.

## 7. Pillar One: Workspace and Explicit Change Sets

Replace seven peer-level technical sections with:

| Area | Responsibility |
| --- | --- |
| Workspace | Current objective, standing invariants, standing deliverables, and progress |
| Review Center | Pending proposals, bootstrap candidates, inactive rows, and recent changes |
| Diagnostics & Maintenance | Context budget, source integrity, validators, record health, export and restore |

The current `mutationId + baseRevision + ops` becomes a user-visible Change Set:

- Group before/after by objective or item.
- Distinguish prompt-affecting changes from metadata-only changes.
- Show prompt bytes, record bytes, and active/pending/stored deltas.
- Support per-change undo and retain destructive changes in the review panel until Apply.
- Re-plan after revision conflict without losing intent.
- Bind unknown outcomes and exact replay to the Change Set id.
- Project committed receipts into Recent Changes without copying historical user text.

One core `planChangeSet()` powers both browser preview and Host commit; the Host returns a canonical summary for client verification.

## 8. Pillar Two: Provenance-Aware Proposal Inbox

The Review Center unifies compaction bootstrap, message-created proposals, agent-tool proposals, existing pending rows, and stale/conflicted Change Sets.

Every new proposal has immutable provenance distinguishing manual, message, compaction-summary, agent-tool, and fork sources.

Existing v1 pending rows cannot reliably recover an original message or compaction-summary reference. Migration gives them explicit `legacy-unknown` provenance and retains v1 `origin` only as a hint; it never fabricates a source kind, event sequence, or digest. They remain reviewable and appear in an “unknown legacy source” facet.

### Message proposal

Because current DSH exposes no public message-row action slot, the baseline UI provides a paged message picker inside Review Center. The Host binds lifecycle, event sequence, role, and content digest. A future public message action slot may add a shortcut; DOM injection and private Conversation stores are forbidden.

### `charter_propose`

- Creates invariant/deliverable pending proposals only.
- Cannot change objective, active items, review, lifecycle, verification, or progress.
- Host derives provenance from tool-call context.
- Enforces item/count/byte quotas and duplicate detection.
- Reports “queued for review”, never “effective”.
- Does not enter standing context before user acceptance.

## 9. Pillar Three: Evidence Integrity and Fact Validity

Split current verification into orthogonal dimensions:

| Dimension | Question |
| --- | --- |
| Review | Did the user accept the item into the Charter? |
| Source Integrity | Is the source still readable and digest-identical? |
| Fact Validity | Is the asserted fact currently true? |

Evidence stores a source reference, projection version, digest, and optional excerpt. Source integrity is derived on read and never acts as a second authority. Missing evidence does not automatically reject, archive, or remove a standing item.

0.2.0 supports only registered, structured, user-triggered validators such as `workspace.path-exists`, `workspace.file-digest`, and `workspace.file-contains`. Arbitrary shell execution is forbidden. Timeout, missing permission, and unreadable dependencies produce `unknown`; changed input makes old results stale; validator metadata never enters standing prompt.

## 10. Pillar Four: Scale and Client Architecture

Add a v2 read plane:

```text
charter.watchSummary
charter.queryItems
charter.queryChanges
charter.applyChangeSet
charter.runValidators
```

Queries support search, facets, revision-bound cursors, and bounded limits. Bulk writes always carry explicit item ids, never a mutable “all current filter results” predicate.

`charter_read all` gains cursor/limit/nextCursor while retaining its 32 KiB envelope; `standing` remains complete and is never silently paged.

### Authorization and execution boundary

M0 freezes a method-level matrix:

| Entry | Caller | Boundary |
| --- | --- | --- |
| summary watch and item/change queries | owner or Session-authorized user | Gateway Session resource decision precedes storage reads |
| apply Change Set | owner/user | Existing op-level authorization remains; destructive purge stays owner-only |
| run validators | owner-only | Principal, Session resource, validator capability, and workspace permission checks precede file/storage reads |
| `charter_propose` | agent tool call for the current live Session | Dedicated pending-only handler, never owner edit authority |

New 0.2 endpoints require modern DSH principal/resource enforcement; no new degraded write path is added for DSH 0.1.7/0.2.0. Queries and validators have page, byte, timeout, and per-Session concurrency limits. Real Gateway tests cover owner, user, missing principal, cross-Session access, denied workspace permission, cancellation, and unknown outcomes.

The 0.2 UI uses summary watch plus paged queries. Existing `watch/edit` stays as a 0.1 compatibility adapter throughout 0.2.x so Host/client skew does not blank the Pane.

Split the monolithic Pane and draft state into Workspace, Review Center, Diagnostics, Change Set, and Recovery components/stores. One operation coordinator remains the sole durable-request state machine for in-flight, known failure, unknown outcome, retry, and abandon.

Long-list acceptance covers 512 items, search/facets, paging or windowing, bulk review, mobile sheets, 40–44px touch targets, keyboard/focus, screen readers, forced colors, reduced motion, 200% text, and Chinese/English copy.

## 11. Data and Migration

The default design uses `recordSchemaVersion: 2` in the existing `dsh_charter_v1` domain because authority, per-Session single-record layout, and storage ownership do not change.

This requires an ADR before implementation and must prove:

- deterministic, pure v1→v2 conversion;
- zero-write v1 reads;
- byte-identical standing prompt without a business change;
- first successful Change Set atomically combines mutation and v2 write;
- `0.1.0` stable and later 0.1.x releases containing the forward-schema fence safely isolate v2 and forbid restore overwrite; rc.3 is not a safe downgrade target;
- v1 archives restore as v1 and migrate only on a later normal mutation;
- fork remints item ids while preserving provenance/evidence references.

If M0 proves that independent item/evidence/validation tables or indexes are required, switch to a new domain with side-by-side copy. Do not create a second authority or long-term dual write merely to make the release look larger.

Map v1 verification into v2 validity as unassessed, user-attested, legacy-validator valid, legacy-validator invalid, or legacy-validator unknown. Evidence integrity never substitutes for fact validity.

For v1 item provenance, preserve provable fork references; map every other existing item/proposal to `legacy-unknown` plus its old `origin` hint. Never infer compaction-summary or agent-tool provenance from `origin: agent`.

## 12. Milestones

| Milestone | Scope | Exit condition |
| --- | --- | --- |
| M0 probes + ADR | Message/tool sources, cursors, record v2, downgrade, authorization matrix, UI slots | Freeze schema, compatibility, authorization, and migration decisions |
| `0.2.0-alpha.1` | Core v2, Change Set planner, v1/v2 parser | Prompt equivalence and atomic first-mutation migration |
| `0.2.0-alpha.2` | Review Center, query API, search/filter/page, message and tool proposals | Every new proposal has provenance; 512-item flow works |
| `0.2.0-beta.1` | Validators, integrity/validity, three-area UI, Pane/store refactor | Feature complete; feature freeze begins |
| `0.2.0-rc.1` | Migration, downgrade, accessibility, performance, real profiles, artifact gates | Release blockers only |
| `0.2.0` | Stable artifact | All acceptance evidence and documentation complete |

Alpha milestones may change the schema, but every change must ship fixture migrations. Beta freezes the persistent schema and primary Remote contracts; RC freezes features.

## 13. Non-Goals

- No new decision/environment item kinds.
- No cross-Session memory or global proposal inbox.
- No model acceptance, rejection, editing, archival, or validator execution.
- No background validator polling or arbitrary shell commands.
- No permanent-audit claim or predicate-based bulk writes.
- No DOM-injected message actions.
- No multi-Host JSON-storage synchronization.
- No attempt to bypass the upstream missing/unreadable outer-JSON limitation.
- No unnecessary new domain.

## 14. Release Acceptance

0.2.0 requires:

- zero-write v1 reads, atomic first-mutation migration, prompt equivalence, safe downgrade isolation, and v1/v2 archive/fork coverage;
- Change Set preview equal to canonical Host result, atomic multi-operation commit, conflict retention, and exact unknown-outcome replay;
- schema-valid provenance for every new proposal, Host-verified message sources, and strict `charter_propose` boundaries;
- `legacy-unknown` provenance for v1 pending rows with no fabricated source;
- independent integrity/validity combinations, stale validator results, safe `unknown` failures, and no executable validators;
- real-Gateway authorization and quota coverage for query, apply, validator, and tool entry points;
- 512-item summary-watch/query performance, cursor correctness, desktop/mobile review and Apply, accessibility matrix, and no regression in rc.3 recovery/fencing;
- full check, migration smoke, packed recovery smoke, final-artifact smoke, and the target DSH matrix.

## 15. Version Boundary

| Version | Allowed | Excluded |
| --- | --- | --- |
| `0.1.0-rc.4` | Published DSH rc.3/rc.4 compatibility-only patch | Any additional content |
| `0.1.0-rc.5` | Review correctness, forward-schema fence, interaction safety, UTF-8 admission, real Gateway/UI evidence, release gates | New schema/API/tool/provenance/validator/query plane/IA refactor |
| `0.1.0` | rc.5 stabilization | New features |
| `0.1.1` | Compatible stable bug/security/DSH/accessibility patches | New persistent state, API, or workflow |
| `0.2.0` | Four product pillars, record v2, query plane, three-area UI, architecture refactor | General memory, execution policy, arbitrary validators, unnecessary domain migration |
