# `dsh-charter` Research Notes

English | [中文](charter-research.zh.md)

Research baseline: 2026-10-19. DSH and external products continue to change; this document records only facts
verified in this round. Product decisions are in [charter-design.md](../design/charter-design.md).

## 1. Question and source levels

How can an external DSH plugin persist and inject the user's standing goals and constraints so they do not
depend on a compaction summary, without promoting user content above its permission layer?

Source levels:

- `[source]`: reference project or published npm package implementation;
- `[official]`: vendor documentation and DSH package READMEs;
- `[paper]`: paper text;
- `[community]`: public engineering practice or author article, not a platform contract.

Versions checked:

- `dsh-context-enhancement@0.2.2`, pinned to DSH `0.1.5-rc.1`;
- `dsh-ontology@0.2.1`, developed against DSH `0.1.5-rc.2`;
- DSH `0.2.1-rc.2` published packages, with a re-check of `0.2.1-alpha.5` restrictions.

Both reference projects target older DSH versions. They prove engineering patterns and failure modes; they do
not replace contract verification against the target version.

## 2. Reference projects

### 2.1 [`dsh-context-enhancement`](https://github.com/chuxindd/dsh-context-enhancement)

`[source]` Two chains:

1. custom compaction: three-zone maintenance, tool-group summaries, deterministic trimming, overflow recovery;
2. independent task state: filter Session events, call an auxiliary model to rewrite state, validate in Host,
   write to a storage domain, then read synchronously during prompt assembly.

Reusable practices:

- `per-record` storage layout avoids rewriting an append-heavy audit on every update;
- publish the in-memory pointer only after durable success;
- bind the record to `sessionId + createdAt + cwd` to avoid Session-id reuse;
- background updates and manual edits share one Session worker and check revision in the queue;
- explicit `agent/created`, `session/event`, and dispose lifecycle handling;
- prompt assembly performs synchronous memory reads only, never storage I/O;
- real failure-path tests for open/commit/finish/repair.

Not to copy:

- the model rewrites the whole state on every output, so output grows with state;
- task state and Session log are two facts that cannot be automatically reconciled;
- `sessions + audit` has no cross-table transaction and needs repair;
- a large custom client baseline/delta/generation/reconnect/backoff layer;
- the old `systemPrompt.context()` accumulation behavior was not re-verified for current versions;
- task-state and compaction are locked to old DSH interfaces.

### 2.2 [`dsh-ontology`](https://www.npmjs.com/package/dsh-ontology)

`[source]` Pure rule layer, storage adapter, tool layer, and prompt layer:

- `GraphView` is a read-only kernel boundary; rules do not depend on Cordis or storage;
- validation before write returns stable `Violation { code, message }`;
- schema redefinition builds an overlay and checks whether historical facts become invalid;
- derived facts are computed on read, not written as a second fact;
- tools return canonical JSON and render model text separately;
- prompt holds a small vocabulary index; instances are queried on demand;
- smoke installs the real tarball, starts twice, and verifies persistence.

Not to copy:

- multi-tool writes are not transactional; partial success is not rolled back;
- no revision, CAS, or concurrent-write protection;
- `strict:false` allows invalid state to persist;
- model tools can directly perform effective writes;
- TBox/ABox, inference closure, and graph queries are outside the charter problem;
- term comments enter the system prompt, promoting ordinary data to system instructions.

### 2.3 Shared conclusion

Rules and rendering should be pure; storage and tools should be thin adapters; writes should be fully validated
on a draft first; model output should be a candidate, never directly effective; prompt should load only a hard
bounded working set; restart, uninstall, failure, and real-host tests matter more than mock registration tests.

## 3. DSH `0.2.1-rc.2` contracts

### 3.1 Session plugin records

`[official]` `@deepseek-ai/dsh-session@0.2.1-rc.2/README.md` states that `appendPluginRecord()` is only for
production code under `packages/experimental/`; external plugins must not call it. Records are `ignorable`,
do not enter the surface, are carried by resume/fork, and are preserved best-effort during format migration.
After reading, `data` is still `unknown`; the owner must re-validate.

This is a future direction, not an external-plugin authority channel today.

### 3.2 Storage domain

`[official]` `@deepseek-ai/dsh-storage-domain@0.2.1-rc.2` provides one write chain per domain, memory and
`domain/changed` only after backend durability, `KvTable.update()` atomic read-modify-write in the queue slot,
synchronous in-memory reads, `per-record` layout, and schema validation of all authoritative records on open.

Limitations: no cross-table/cross-record transaction, no secondary index, `domain/changed` is process-local,
no automatic migration, and `compatibleVersions` only permits direct reads of old formats.

Therefore one Apply must modify exactly one Session record.

### 3.3 Prompt injection

`[official]` `@deepseek-ai/dsh-system-prompt@0.2.1-rc.2` distinguishes `section()` (system role) from
`context()` (durable user-role runtime snapshot). Both support `interpolate:false`; the provider evaluates on
every assembly; all context contributions merge into one snapshot.

`[source]` `@deepseek-ai/dsh-agent-loop@0.2.1-rc.2` `RuntimeContextProjection` creates a new snapshot only when
the joint text changes. It watches surface replacement; when the retained snapshot is replaced or shadowed,
retained is cleared and the next request can re-materialize the same text from current context.

So an independent storage authority plus `context()` gives "current user-level charter on every request"
without promoting user body to system role. The cost: any context contribution change appends the whole joint
snapshot.

### 3.4 Session projection

`[official]` `@deepseek-ai/dsh-session-projection@0.2.1-rc.2` folds only committed Session events:
`apply` must be synchronous; unrelated events must return the same reference; `wire` provides a schema-validated
client value and `asOfSeq`; framework checkpoints can speed cold reads; state-carrying log events must carry
the full post-state, not a bare delta.

Because Charter's authority is an independent storage domain, Session projection cannot drive it automatically.
Forcing that would create a second synchronization chain.

### 3.5 Gateway and client stream

`[official]` `@deepseek-ai/dsh-api-gateway@0.2.1-rc.2` provides Remote argument validation,
`@Remote({ resources })` resource declarations and non-owner access decisions, `RemoteSnapshotStream` with one
opening snapshot per physical generation, and retention of the last accepted state across carrier reconnects.

It does not solve the snapshot/listener race or business revision dedupe. Host must attach the listener before
reading initial state; the client must ignore duplicate revisions.

### 3.6 UI surfaces (historical note)

`[official]` `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.1-rc.2` used two-stage tab registration. This
research round originally targeted a right sidebar. The implementation now uses the `conversation.view` tab
slot in the main conversation header and a `dsh-client-locale` namespace for labels; the sidebar notes are kept
only as historical evidence. `conversation.session.header.actions` exists as an optional entry; the proposed
`conversation.chat.assistant-actions` was not found.

`@deepseek-ai/dsh-settings@0.2.1-rc.2` is an abstract form service. Its published docs say no client
auto-generates pages from schema, so MVP does not assume `settings.plugins.tab`; configuration stays in plugin
Config and diagnostics stay in the Charter tab.

## 4. External evidence

### 4.1 Compaction loses standing constraints

`[paper]` *Lost in Context Compaction* (arXiv:2608.11242v2) reports that in its controlled email experiment
unapproved deletions were 0/100 before compaction and 30/100 after; tested compactors retained 17% of injected
side constraints on average; independently extracting, maintaining, and appending constraints exceeded 90%
semantic retention in three controlled scenarios.

These numbers apply only to that paper's models, data, compactors, and evaluation. They do not prove that
verbatim preservation is necessary. Verbatim freezing is this project's additional choice for review and
deterministic rendering.

Source: https://arxiv.org/abs/2608.11242

### 4.2 External authority re-injected after compaction

`[official]` Claude Code memory docs confirm that project-root `CLAUDE.md` is re-read from disk and injected
after `/compact`, rather than relying on the summarizer. They also say these files are context, not enforced
configuration; hard blocks belong in hooks or permissions.

This supports two facts: critical content should have an authority outside compacted history; prompt
constraints cannot replace execution-layer enforcement.

Source: https://code.claude.com/docs/en/memory

### 4.3 Superseded records remain

`[community]` Michael Nygard's ADR practice keeps old decisions and marks them superseded because the fact
that they were once effective still matters. It supports explicit replacement links; it does not imply that all
data must be permanent.

Source: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

### 4.4 DeepSeek cache

`[official]` DeepSeek Context Caching: enabled by default; a hit requires a complete match with an already
persisted cache prefix unit; units may be created at request boundaries, when a common prefix is detected, and
at fixed intervals in long sequences; usage reports `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`;
caching is best-effort, and build/eviction timing is not guaranteed.

`[official]` The Anthropic compatibility table marks `cache_control` on tools, text, tool_use, and tool_result
as ignored. Callers cannot choose Anthropic-style cache breakpoints; they can keep the prefix stable and
observe usage.

Sources:

- https://api-docs.deepseek.com/guides/kv_cache
- https://api-docs.deepseek.com/guides/anthropic_api

## 5. What the evidence supports

Supported:

1. Constraints should be maintained independently of compaction summaries.
2. External DSH plugins should use a storage domain, not the experimental Session plugin record.
3. User-editable charter body should stay user role; system role belongs to Host policy.
4. One Apply should converge on a single-record atomic update.
5. UI should authorize per Session and use a snapshot stream, not a Host-wide baseline.
6. Model-visible text must be deterministic, bounded, and re-materialized from authority.

Not supported:

1. That the model will obey the charter.
2. That DeepSeek will hit the cache at a particular token boundary.
3. That 2 KB, 16 items, or any quota is optimal.
4. That an external plugin can exactly inherit the parent Charter at the fork boundary.
5. That the target DSH version's extension policy will never change.

## 6. Acknowledgements

The comparisons above are based on the public repositories/packages linked in sections 2.1 and 2.2. They are
independent projects; this project does not include their source code, and they do not endorse `dsh-charter`.

## 7. Local fact index

| Fact | Local location |
| --- | --- |
| task-state uses `per-record`; authority and audit are separate | `../../references/dsh-context-enhancement/src/internal/task-state/basic/domain.ts:1-55` |
| lifecycle fence; publish after durable put | `../../references/dsh-context-enhancement/src/internal/task-state/basic/service.ts:520-637` |
| manual edits enter the worker queue and check revision | `../../references/dsh-context-enhancement/src/internal/task-state/basic/service.ts:712-769` |
| old client builds a Host-wide baseline stream | `../../references/dsh-context-enhancement/src/internal/task-state/control/service.ts:71-157` |
| prompt assembly reads the committed pointer synchronously | `../../references/dsh-context-enhancement/src/task-state-prompt.ts:58-76` |
| ontology's pure `GraphView` boundary | `../../references/dsh-ontology/src/types.ts:124-150` |
| schema redefinition validates historical facts with an overlay | `../../references/dsh-ontology/src/ontology.ts:455-500` |
| ontology tool/storage/prompt assembly boundary | `../../references/dsh-ontology/src/index.ts:73-107` |
| plugin-record external-plugin prohibition | `@deepseek-ai/dsh-session@0.2.1-rc.2/README.md`, Write experimental plugin records |
| storage single write chain, single-record atomic update, no cross-table transaction | `@deepseek-ai/dsh-storage-domain@0.2.1-rc.2/README.md`, Design concept / Known Limitations |
| runtime context re-materializes same value after shadowing | `@deepseek-ai/dsh-agent-loop@0.2.1-rc.2/lib/index.js`, RuntimeContextProjection |
| historical sidebar two-stage registration | `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.1-rc.2/README.md`, tab registration |

Published npm packages were used only for contract verification and are not copied into the project.
Implementation-phase M0 contract tests should become the durable evidence instead of relying on package line
numbers.
