# `dsh-charter` v1 Design Review

English | [中文](charter-design-review.zh.md)

Research baseline: 2026-10-19.

Reviewed: the original v1 design draft (Chinese, archived locally and intentionally not tracked by git). The
revised implementation specification is [charter-design.md](charter-design.md); factual research is in
[charter-research.md](../research/charter-research.md).

> Post-implementation update (2026-10-20): the minimum supported version is DSH `0.1.7-rc.2`; product
> priority is `0.2.0-rc.1+`. `0.1.7` / `0.2.0` Gateways have no `@Remote.resources` / `Principal`; per-Peer
> resource authorization starts at `0.2.1`. See [compatibility.md](compatibility.md). `0.1.5-rc.1` and earlier
> are incompatible because of breaking Remote codec, event-payload, and sidebar-API changes.

## 1. Conclusion

The product direction is sound, but the original draft cannot be used directly as an implementation spec.

Four things are right:

1. Persistent user constraints must not be entrusted to a compaction summary.
2. The charter must be visible, editable, and traceable; the model cannot be the final writer.
3. Every-turn injected content needs a hard limit; full history is read on demand.
4. Stable text should stay deterministic to avoid needlessly breaking the prompt prefix cache.

The technical landing points need to be replaced. The draft treated an experimental interface unavailable to
external plugins as the authority channel, put user-editable content into the system role, and collapsed
lifecycle, evidence state, and progress into one state machine. Continuing on that path would leave structural
problems in compatibility, permission boundaries, and concurrency.

Overall: **the product definition is reasonable; persistence and injection need replacement; first-version
scope must shrink.**

## 2. Blocking issues

### P0-1: `appendPluginRecord()` is not an external-plugin API

The draft made `plugin:charter/*` session records the sole authority. The target release documentation for
`@deepseek-ai/dsh-session@0.2.1-rc.2` states:

- `appendPluginRecord()` is only for `packages/experimental/` inside the repository;
- external plugins must not call it;
- during format migration such records are best-effort and may be dropped without affecting Session
  interpretation.

It can prove the upstream architecture exists, but it is not a product contract for an external plugin.

**Fix:** use one `dsh-storage-domain` record per Session. Re-evaluate migration only if upstream publishes a
supported external Session-extension record.

### P0-2: user body text was promoted to system role

The draft injected editable goals and constraints with `systemPrompt.section()`, putting ordinary user input
in the same role layer as Host policy, tool rules, and deployment instructions. Reordering, labels, or escaping
cannot restore the permission boundary.

**Fix:** inject body text with `systemPrompt.context()` so it stays user role. A fixed protocol note could be a
system section but is unnecessary for MVP. Enforcement belongs in permissions, hooks, or tool guards.

### P0-3: the write protocol did not define atomicity

The draft proposed `baseRevision` but did not say whether user edits, model proposals, evidence
reconciliation, imports, and admission share one linearization point. Two callers could read the same revision
and both commit.

The reference project `dsh-context-enhancement` gets concurrency correctness from a per-session serial worker,
not only a revision check. `dsh-storage-domain` provides a more direct mechanism: writes to a domain are
serial, and single-record `update()` performs an atomic read-modify-write in its queue slot.

**Fix:** keep current state, revision, idempotency receipts, and recent changes in one Session record; check
`baseRevision`, idempotency key, transitions, and quotas inside the synchronous transform of
`update(sessionId, fn)`.

### P0-4: remote reads/writes had no explicit resource authorization

The draft described one `edit` RPC without binding non-owner clients to a Session. A Host-wide baseline would
send every Session's state at once, making authorization scope hard to constrain.

**Fix:** every read/write endpoint requires `sessionId` and declares a Session resource through
`@Remote({ resources: { session: ... } })`. The UI creates one snapshot stream per Session; no cross-Session
full stream.

## 3. Design corrections

### P1-1: one `status` mixed three dimensions

`proposed`, `active`, `archived`, `unverified`, and `rejected` mixed approval, lifecycle, and evidence state;
deliverables had a separate completion state. Legal combinations such as "current but unverifiable" and
"done but unverified" could not be expressed.

**Fix:** split into orthogonal dimensions:

- `review`: `pending | accepted | rejected`;
- `lifecycle`: `current | superseded | archived`;
- `verification`: `unchecked | verified | failed | unavailable`;
- `deliverable.progress` is independent.

### P1-2: evidence integrity was confused with factual validity

Session logs are append-only. Compaction changes the surface but does not invalidate event digests; conversely,
a matching digest does not prove that files, ports, or external state are unchanged.

**Fix:** distinguish:

- `sourceIntegrity`: whether the source is readable and its content digest matches;
- `verification`: whether the item holds now, decided by the user or a dedicated validator.

Compaction must not automatically downgrade user constraints.

### P1-3: `unverified` conflicts with prompt stability

The draft wanted `unverified` to show a warning in the injected surface, and also wanted metadata changes not
to change the prompt. Both cannot hold.

**Fix:** show verification state only in UI and tool results; it does not change standing context. Model-visible
bytes change only when the user explicitly edits body text, the objective, or deliverable progress.

### P1-4: quotas contradicted each other

The draft allowed 24 items × 160 bytes while requiring the whole injected surface ≤ 1.5 KB. Body text alone
could reach 3.75 KB.

**Fix:** rendered UTF-8 bytes are the primary hard limit; item counts and per-item limits prevent extreme
shapes and must not be described as simultaneously exhaustible. Initial values need M0 samples and real-route
measurement.

### P1-5: cache cost was written as a deterministic guarantee

DeepSeek only hits when the complete prefix unit already exists; cache creation and retention are best-effort.
Request-level hit/miss tokens cannot be precisely attributed to one Charter edit.

**Fix:** guarantee byte stability and controllable change location. Show provider raw usage and the Charter
text hash; do not claim exact "misses caused by Charter". Measure with controlled A/B, not a single request.

### P1-6: first-version scope was too large

The draft included event sourcing, checkpoints, automatic evidence reconciliation, background model proposals,
import/export, a four-module UI, cache attribution, and a complex review queue. Each adds its own state and
failure surface.

**Fix:** MVP only has user-maintained objective, invariants, and deliverables; one atomic write endpoint, one
read-only tool, one conversation-view tab, deterministic runtime context. Proposals, validators, decision
history, import/export, and diagnostics come later.

## 4. Reference-project tradeoffs

| Source | Take | Do not take |
| --- | --- | --- |
| [`dsh-context-enhancement`](https://github.com/chuxindd/dsh-context-enhancement) | per-record persistence; Session lifecycle fence; publish after durable write; synchronous prompt read; revision conflict; failure isolation | auxiliary model rewriting the whole record; two-table `sessions + audit` protocol; Host-wide baseline; custom client reconnect layer; dynamic full task-state injection |
| [`dsh-ontology`](https://www.npmjs.com/package/dsh-ontology) | pure domain kernel; stable error codes; validate before write; overlay/draft validation; separate JSON and text tool rendering; real-host smoke | non-transactional batch; `strict:false`; model executing effective writes; graph reasoning/TBox/ABox; arbitrary comments in system prompt |

## 5. Revised decisions

| Topic | Original | Current decision | Status |
| --- | --- | --- | --- |
| Authority | Session `plugin:` log | `dsh-storage-domain` one record per Session | Decided, constrained by public API |
| Injection | `systemPrompt.section` | `systemPrompt.context` | Decided, constrained by permission boundary |
| Write | multiple revision ops | single-record atomic `update()` | Decided, constrained by storage transaction granularity |
| UI read | `sessionProjections.wire` | per-Session Remote snapshot stream | Decided; an independent domain cannot be folded by Session projection |
| State | one `CharterStatus` | separate review/lifecycle/verification/progress | Decided |
| Model permission | ambiguous | read-only MVP; proposals only later | Decided |
| Audit | permanent append log | bounded recent receipts in the same record | Decided; permanent audit is not MVP |
| Post-compaction recovery | uncompressible node | re-materialize user-role snapshot from storage | Decided |

## 6. Open questions for M0

1. **Exact fork boundary:** the public API does not put the parent Charter revision in the Session fork
   transaction. MVP copies the parent's latest committed revision at child `agent/created` and records it; this
   is not a strict fork-boundary snapshot.
2. **Global runtime-context write amplification:** any context contribution change appends the whole joint
   snapshot. Charter controls its own ~2 KB budget but cannot guarantee global snapshot size or change rate.
3. **Storage migration:** `dsh-storage-domain` has no automatic migration. Incompatible versions need a new
   domain name and an explicit side-by-side copy.
4. **Target-version stability:** this round targets `0.2.1-rc.2`; release tags and external-extension policy
   may still change. M0 must test recovery, uninstall, fork, permissions, and prompt behavior on a packaged
   real Profile.
5. **Quota calibration:** model-visible bytes, per-item length, and inactive-item limits are product initial
   values, not measured conclusions.

These do not block the pure kernel or single-record write chain, but they do block claiming compatibility,
fork precision, or cost numbers as guaranteed behavior.
