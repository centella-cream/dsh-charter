# Documentation index and conventions

This index is the entry point for repository documentation. It defines the file naming and document-status rules
that every plan, design, review, and release note must follow.

## Status vocabulary

Every design/plan/review document starts with a status block using exactly these statuses:

| Status | Meaning |
| --- | --- |
| `Proposed` | A design proposal that is **not implemented and not authoritative**. It records an option under consideration; it never describes existing behaviour and must not be cited as the current contract. Entering scope requires a roadmap decision first. |
| `Active` | Current authority or current operating guide; kept up to date. |
| `Implemented — pending release acceptance` | Source implementation exists and passes source gates, but the release/manual gates are not complete. |
| `Historical` | Frozen record of a completed or abandoned decision; read-only and not current guidance. |
| `Superseded` | Replaced by a named document; keep only as history. |
| `Archived (local)` | Local/ignored scratch or investigation material; never authoritative and not part of the shipped docs. |
| `Development candidate` | Release-note-only: implemented but unpublished; no tag/Release/npm artifact exists. |

A status block has this shape:

```text
> **Status:** Active
> **Version scope:** 0.2.2
> **Baseline:** 2026-11-06
> **Authority:** docs/design/version-roadmap.zh.md
> **Supersedes / Superseded by:** none / <path or none>
```

Status changes are documentation changes: update this index, the document header, and every inbound link in the
same commit. Do not delete a historical decision just because it is inactive; move it under `docs/history/`.

## Naming rules

- Active product design: `docs/design/<product>-v<major>.md` (Chinese: `.zh.md`), for example
  [charter-design-v1.md](design/charter-design-v1.md).
- Active topic design: `docs/design/<topic>-v<major>.zh.md` when the topic is intentionally Chinese-only, for
  example [charter-workspace-v2.zh.md](design/charter-workspace-v2.zh.md).
- Cross-version roadmap: `docs/design/version-roadmap.md` (`.zh.md` is normative for scope).
- Compatibility matrix: `docs/design/compatibility.md` (`.zh.md` is normative for compatibility claims).
- Historical material: `docs/history/YYYY-MM-DD-<slug>.md` (`.zh.md` for the Chinese version). Never use a
  bare `*-plan.md` or `*-review.md` in `docs/design/`.
- Release notes: `docs/release-notes/<semver>.md`; unpublished development candidates must say so in the header.
- Local ignored scratch: `docs/archive/` (git-ignored). Do not link shipped docs to it.
- English is the default filename language; append `.zh.md` for Chinese. A pair that declares one side normative
  must say so in the header and must stay link-consistent.

## Current map

| Document | Status | Version scope | Notes |
| --- | --- | --- | --- |
| [design/charter-design-v1.md](design/charter-design-v1.md) | Active | 0.1 core; invariants apply to 0.2 | Core Charter invariants and v1 product baseline. |
| [design/charter-workspace-v2.zh.md](design/charter-workspace-v2.zh.md) | Implemented — pending release acceptance | 0.2.0 | Workspace, proposal timeline, dependencies; topic-scoped. |
| [design/charter-dependency-graph-v1.zh.md](design/charter-dependency-graph-v1.zh.md) | Active | 0.2.2 | Client-side dependency graph view. Source implementation lands on the 0.2.2 line; real browser/AT and W0-1/2/3 gate evidence remains pending. |
| [design/charter-gui-v1.zh.md](design/charter-gui-v1.zh.md) | Active | 0.3.0 (in development, unreleased) | All-section GUI refactor: design system, IA/routing, Change Set contract, Pane/store split, evidence gates. Frozen visual language (document-feel): [design/mockups/](design/mockups/README.md). 0.3.0 is not released; no availability claims before manual acceptance. |
| [design/version-roadmap.md](design/version-roadmap.md) | Active | whole line | Scope/version authority; Chinese is normative. |
| [design/compatibility.md](design/compatibility.md) | Active | declared DSH versions | Compatibility claims and matrix. |
| [history/2026-10-19-charter-design-v1-review.md](history/2026-10-19-charter-design-v1-review.md) | Historical | 0.1 | Frozen v1 design review. |
| [history/2026-10-27-release-0.1.0-rc.5-plan.md](history/2026-10-27-release-0.1.0-rc.5-plan.md) | Historical | 0.1.0-rc.5 | Complete/frozen rc.5 stabilization plan. |
| [research/charter-research.md](research/charter-research.md) | Historical | research snapshot | Facts captured for v1; not current decisions. |
| [verification.md](verification.md) | Active | current tree | Evidence record; counts and matrix results. |
| [releasing.md](releasing.md) | Active | current line | Release/publish process. |
| [user-guide.md](user-guide.md) | Active | current line | Installation and usage guide. |
| [release-notes/0.1.0-rc.5.md](release-notes/0.1.0-rc.5.md) | Historical | 0.1.0-rc.5 | Published npm release note. |
| [release-notes/0.1.0-rc.6.md](release-notes/0.1.0-rc.6.md) | Historical | 0.1.0-rc.6 | Published/accepted release note. |
| [release-notes/0.2.0.md](release-notes/0.2.0.md) | Historical | 0.2.0 | Published npm release and GitHub Release. |
| [release-notes/0.2.2.md](release-notes/0.2.2.md) | Historical | 0.2.2 | Published npm release and GitHub Release; dependency graph and conflict confirmation. |
| [release-notes/0.2.1.md](release-notes/0.2.1.md) | Historical | 0.2.1 | Published npm release and GitHub Release. |

## Maintenance rules

- Add or rename a document only with a matching index update and link repair.
- Historical documents are frozen; correct links/status only, not conclusions.
- Prefer relative links inside `docs/`; keep `docs/archive/` out of shipped documentation.
- When a plan is complete, move it from `docs/design/` to `docs/history/` with its date prefix.
- When a design is replaced, mark the old one `Superseded` and link the replacement before implementing the
  replacement.
