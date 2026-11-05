# dsh-charter

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-centella--cream%2Fdsh--charter-181717?logo=github)](https://github.com/centella-cream/dsh-charter)
[![DSH](https://img.shields.io/badge/DSH-9%20verified%20versions-4b6bfb)](docs/design/compatibility.md)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](package.json)
[![Status: preview](https://img.shields.io/badge/status-preview-orange)](#status)

English | [中文](README.zh.md)

> **Compaction rewrites history. Your commitments don't.**

`dsh-charter` is a durable, user-owned session contract for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Goals, hard constraints,
deliverables, evidence, and dependency state survive compaction and remain visible and editable.

## Status

- **Published release:** `0.1.0-rc.6` is the latest public npm release.
- **Release candidate:** `0.2.0` is on `main`; publication runs through the protected release workflow.
- **Primary DSH baseline:** `0.2.2-rc.1`; nine declared DSH versions are source-matrix verified.
- Versioning from `0.2.0` onward uses plain increments (`0.2.0`, `0.2.1`, ...), never an `rc` suffix.

## What it does

Compaction can summarize away standing constraints such as *“run tests before delivery”* or *“keep the
API backward compatible”*. `dsh-charter` keeps them in a separate, user-owned record and rebuilds the
model-visible context deterministically on every request.

- **Independent authority.** One `dsh-storage-domain` record per Session is the only authority.
  Compaction summaries and UI caches never write or recover it.
- **User role by construction.** Charter text enters user-role runtime context, never a system-role message.
  The model can read the charter; it cannot write it.
- **Atomic Apply.** One Change Set commits completely or not at all, with revision conflict, idempotent retry,
  and Host-canonical preview digest.
- **Safe onboarding.** A compacted Session can produce a review-only draft from its latest summary. Nothing
  becomes effective until the user accepts it.
- **Bounded and recoverable.** Prompt/record budgets are explicit; overflow is surfaced or rejected, never
  silently dropped. Export/restore and write-uncertain fencing protect the stored record.

## 0.2 headline: constraint relationships

The defining change in 0.2.0 is that deliverables are no longer an independent, ordered checklist. A
deliverable can declare **prerequisites** on other deliverables, and those relationships become part of the
stored contract, the validation boundary, the UI plan, and the model-visible prompt.

```text
Tests (D1) ───────────┐
Migration (D2) ───────┴──> Release (D3)
```

- **Typed, validated edges.** Each deliverable may carry `requires: [id…]`. The Host rejects self-edges,
  duplicate prerequisites, dangling references, inactive endpoints, and cycles. The whole Change Set fails
  atomically; no partial graph is written.
- **Deterministic dependency projection.** Standing deliverables receive stable `D<n>` keys in canonical
  topological order. The prompt renders prerequisites before dependents, so the model knows which commitments
  are executable and what must happen first.
- **Derived readiness, not a second status field.** Readiness is computed from acceptance, lifecycle,
  prerequisite readiness, and progress: `ready`, `waiting`, `blocked`, `dependency-conflict`,
  `in-progress`, or `terminal`. This avoids storing a stale duplicate of dependency state.
- **Visible and editable in the Pane.** Workspace shows a dependency plan with prerequisite selectors and
  status. An invalid graph is surfaced instead of crashing the Pane, and Apply is disabled while the plan is
  inconsistent.
- **Lifecycle-safe.** Archive, restore, supersede, fork, and proposal acceptance validate or remap the graph.
  `proposedRequires` lets a pending deliverable reference candidates that become formal requirements on
  acceptance.
- **Bounded and safe.** The relation set lives inside the same record budget and prompt budget as the rest of
  the charter; there is no separate graph authority.

This is a deliberate boundary: dependencies are a user-authored **execution constraint**, not an enforced
sandbox or permission system.

## Other 0.2 capabilities

- Three primary areas: **Workspace**, **Review Center**, and **Diagnostics & Maintenance**.
- Record schema v2 with in-memory v1 migration, proposal batches, typed provenance, and objective proposals.
- `summary`/`watchSummary` plus paged item/proposal/change queries; the Pane uses summary + queries and keeps
  the full-watch stream only as a compatibility fallback.
- Pending-only `charter_propose` tool and user-triggered message proposals with selection and kind.
- Evidence Integrity and Fact Validity, including owner-only registered validators:
  `workspace.path-exists`, `workspace.file-digest`, and `workspace.file-contains`.
- Source-integrity projection checks for message, compaction-summary, and agent-tool batches; fork projections
  are explicitly reported as `unsupported`.
- Fork with item/validity/evidence/dependency remapping; Recovery Center export/initialize/restore.

A charter is a declaration, not an enforcement policy. Use Host permissions, sandbox policy, hooks, or
execution guards for restrictions that must be machine-enforced.

## Install

The last public release is `0.1.0-rc.6`. The 0.2.0 release candidate is installed from the candidate tarball
until publication completes:

```bash
npm pack
dsh plugin --profile web add ./dsh-charter-0.2.0.tgz
```

After publication, install the exact release with:

```bash
dsh plugin --profile web add dsh-charter@0.2.0
```

For Desktop, use **Desktop → Plugins → Install/Update**, or import the same local tarball if your Desktop build
supports local plugin installs. `dsh plugin --profile desktop` is refused by the Electron application that owns
that profile.

The plugin must run on a declared DSH version:

| DSH version | Status |
| --- | --- |
| `0.1.7-rc.2` | Supported (minimum) |
| `0.2.0-rc.1` / `0.2.0-rc.2` | Supported |
| `0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.1-rc.5` | Supported |
| `0.2.2-rc.1` | Supported (primary baseline) |
| `0.3.x` | Not declared until verified |

See the full [compatibility matrix](docs/design/compatibility.md) for evidence and degradation notes.
Node.js `^22.19.0 || >=24.0.0` is required.

## Quick start

1. Open a live Session and select the **Charter** tab.
2. Set the objective, add invariants and deliverables, and configure `requires` where needed.
3. Inspect the exact model-visible preview and click **Apply**.
4. In Review Center, accept or reject pending proposals; diagnostics shows source integrity, validator actions,
   record health, export, and restore.

For a previously compacted Session, Review Center offers a draft extracted from the latest usable compaction
summary. Review, edit, and apply only what should become effective.

## Configuration

Override defaults in the profile patch:

```yaml
- id: charter
  config:
    maxPromptBytes: 8192
    maxObjectiveBytes: 4096
    maxItemBytes: 1024
    contextOrder: 130
```

All limits are documented in the [user guide](docs/user-guide.md). The only model-visible capacity is
`maxPromptBytes`; `maxItems` and `maxPendingItems` bound stored records.

## Security

- User-authored text never enters a system-role message.
- The model has no write capability; `charter_read` is read-only.
- `owner` may perform all edits including purge; `user` may perform ordinary edits but not purge; host-only
  validator results cannot be forged through the client edit path.
- Registered validators are owner-only, read only within the Session workspace, enforce file/byte/deadline
  bounds, and never execute arbitrary shell commands.
- Ordinary logs contain ids, kinds, revisions, and error codes, not user body text.

See [SECURITY.md](SECURITY.md) for the threat model and reporting path.

## Development

```bash
npm run check             # typecheck + build + remote/client smoke + Vitest
npm run smoke:package     # packed tarball installability
npm run verify:compaction # manual real-model compaction check
node scripts/verify/compat-matrix.mjs --versions all --allow-new-release
```

Current source evidence: 36 test files / 434 tests; nine-version DSH matrix 9/9 at 434/434. The version matrix
and profile checks are separate from real Gateway, Electron, accessibility, and 512-item performance gates.

Documentation:

- [User guide](docs/user-guide.md)
- [Compatibility](docs/design/compatibility.md)
- [Verification record](docs/verification.md)
- [Charter design](docs/design/charter-design-v1.md)
- [0.2 workspace design](docs/design/charter-workspace-v2.zh.md)
- [Releasing](docs/releasing.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing code, release metadata, or user state. Do not push,
tag, or publish without explicit approval.

## License

MIT. See [LICENSE](LICENSE).
