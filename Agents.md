# Agents.md — working notes for agents in `dsh-charter`

Read this before changing code, release metadata, install docs, or user state in this repository. If a user
instruction conflicts with this file, the user wins. If this file conflicts with `docs/releasing.md`,
`docs/verification.md`, the active version plan, or an explicit approval boundary, those win — fix this file
instead.

## What this repository is

`dsh-charter` is a DSH plugin: a Host service plus `@Remote` methods, a React Pane, a pure core, and verification
scripts. Records live in the `dsh_charter_v1` storage domain and must survive compaction. Product invariants that
every change must preserve (see `docs/design/charter-design.md`, `CONTRIBUTING.md`): user-authored text stays
user-role; the model has no write capability; one Apply is one atomic record update; overflow is visible, never
silently truncated; the browser bundle stays a single self-contained factory; the compatibility layer stays small.

## Version line — read these before assuming a version or scope

- `docs/design/version-roadmap.md` (Chinese `version-roadmap.zh.md` is normative when details differ) owns the
  version line and scope boundaries. Current line: published `0.1.0-rc.4` → `0.1.0-rc.5` (candidate green and tagged; npm/GitHub Release pending) → `0.1.0` stable →
  `0.1.1` only if a compatible patch is needed → the `0.2.0` line. `0.1.1-rc.1` is not another spelling of rc.5.
- `docs/design/rc5-stabilization-plan.md` owns rc.5 implementation and acceptance. rc.5 is product-correctness
  and release hardening; it adds no 0.2 capability.
- The published rc.4 Git tag, GitHub Release assets, and npm version are immutable. Fix forward with a new
  version; never move, retag, or republish a published version.
- Version numbers, dates, test counts, digests, and "current release" statements are dynamic. Re-read them from
  the tree and the actual test output before writing them anywhere.

## Sources of truth — reach for these before the matching task

| Task involves | Read first |
| --- | --- |
| Version choice, scope, what belongs in a release | `docs/design/version-roadmap.md` + `rc5-stabilization-plan.md` |
| Tagging, CI-green ordering, npm publish, channels | `docs/releasing.md` |
| Claims about tests, hashes, coverage, compatibility evidence | `docs/verification.md` |
| Adding or removing a supported DSH version | `docs/design/compatibility.md` + `package.json` |
| User install/update instructions (Web, Desktop, tarball) | `README.md` §Install/§Update and `README.zh.md` |
| Design constraints on schema, prompt, storage, client | `docs/design/charter-design.md` |
| Dev commands, PR expectations, commit style | `CONTRIBUTING.md` |

## Lessons from this project's recent releases

### 1. An exact-version install does not prove the user's install path works

A release was treated as installable because exact-version CLI install passed. The actual user path differs:
the Desktop Plugin UI accepts no exact npm version and resolves through its catalog; pnpm 11+ defaults to
`minimumReleaseAge=1440` (24 hours), so a freshly published RC is invisible to unversioned resolution
(`dsh-charter`, `@next`, `@latest`, and the Desktop catalog). The resolver can then pick an older release whose
exact `engines.dsh`/peer ranges the DSH compatibility gate correctly rejects.

**Rule:** verify both real paths before calling a release installable: (a) the exact CLI path
`dsh plugin --profile web add dsh-charter@<version>`, and (b) the unversioned Desktop Plugins **Install**/
**Update** path. Inside the maturity window, wait it out or verify the exact local tarball fallback
(`dsh plugin --profile web add ./dsh-charter-<version>.tgz`). Never instruct users to disable the policy or grant
an exact-version exemption to force an older, undeclared release.

### 2. Diagnose product bug vs resolver/policy before announcing or taking action

An update failure was treated as a product regression before the cause was classified. Resolver policies,
compatibility declarations, and plugin defects produce different fixes and different user advice.

**Rule:** collect evidence first — `dsh --version`, the actually resolved package version in the profile
`package.json`, registry dist-tags, the exact error/gate message, publish timestamp vs the 24-hour maturity
window, and the declared `engines.dsh`/peer ranges. Classify it as product defect, resolver/policy behavior, or
declaration drift. Then fix forward (usually a new RC with corrected declarations), and only then announce.
Announcements, publishes, and destructive actions wait for the classification.

### 3. Destructive recovery and debugging need explicit user consent

During debugging, actions reached for the user's Desktop Electron app and profile. Desktop owns the plugin
lifecycle; force-stopping it or editing profile state can lose work and hide the real evidence.

**Rule:** ask before touching the user's running app or profile. Back up the profile directory and the affected
Session record JSON first. Stop the Host cleanly; prefer export → repair → restore. No `kill -9`, no profile
edits, no deleting plugin bundles or records without explicit approval. `dsh plugin --profile desktop` is refused
by the Electron app on purpose — use Desktop Plugins or the local tarball. For an unreadable outer JSON record the
plugin cannot distinguish absent from corrupt: stop the Host before any re-initialization can overwrite it, back
up, then repair.

### 4. Release metadata is one atomic unit

`0.1.0-rc.3` declared only five DSH versions, so the hardened Desktop gate correctly refused installation on DSH
`0.2.1-rc.3`; that defect forced a compatibility-only `0.1.0-rc.4`. In the same patch, `engines.dsh` and peer
ranges moved to seven versions while `dsh.compatibility.dshReleases` and the docs lagged. Artifact digests were
re-recorded across many separate commits because the tree changed after evidence was written.

**Rule:** update every declaration in the same change: `package.json` `version`, `engines.dsh`, every
`@deepseek-ai/dsh-*` peer range, `dsh.compatibility.dshReleases`, `package-lock.json`, `README.md`/`README.zh.md`
(requirements, matrix, install/update snippets), `docs/design/compatibility.md`, `docs/verification.md`,
`CHANGELOG.md`/`CHANGELOG.zh.md`, `docs/release-notes/<version>.md`, and the tracked root `SHA256SUMS`. Only then
build the artifact, and only after that tag, release, and publish. The tag, GitHub assets, and npm version are
immutable once public.

### 5. Evidence must match the actual tree, and coverage claims must match what actually ran

Test counts, artifact hashes, and coverage claims drifted from the tree across release passes (rc.1/rc.2/rc.3
each needed digest refreshes and a count correction). Claims also outran evidence: the seven-version DSH matrix
is local `.tmp/` evidence that public CI does not reproduce; the packed recovery smoke covers the packed subset,
not the complete source fault matrix; real Gateway/browser/Desktop-ABI checks and the real-model compaction run
are manual.

**Rule:** take counts from the actual `npm test` output and hashes from the actual artifact; update every doc
that quotes them in the same change. Say what ran and where: "packed recovery smoke" means the packed subset,
"source fault matrix" means Host tests, "CI" means `npm run check` + `npm run smoke:package` on Node 22.19.0/24,
"manual" means recorded by a human, and the 7-version matrix is local evidence only. Never claim exact-artifact
mode runs in CI — it does not.

### 6. Verify the real path, not a stand-in

Code-level tests are necessary but not sufficient. Release failures came from paths that were assumed rather
than exercised: the artifact itself, an unversioned install, a fresh profile, the Desktop/Web UI, update from an
older version, old-record compatibility, and generated metadata agreeing with the tree.

**Rule:** walk the path list before shipping: exact artifact (bytes, not a rebuild), exact CLI install,
unversioned Desktop Plugins path, fresh isolated profile, Web and Desktop UI, update from the previous version,
rollback/old-record behavior (rc.2 isolation, rc.3 re-read, forward-schema fence), and generated metadata tests
(packed manifest vs working tree, compatibility declarations identical in all sites).

### 7. Branch and commit discipline

The worktree may hold uncommitted user-authored plan/docs/source changes (currently the rc.5 plan, version
roadmap, README updates, and source edits). Those are user property, not scratch work.

**Rule:** never revert, stash, clean, or rewrite uncommitted user work without explicit consent (no
`git checkout -- .`, `git reset --hard`, `git clean`). Do release work on the release branch, keep commits
single-purpose with conventional prefixes, and leave `dist/`, `*.tgz`, `.tmp/`, `node_modules/`, `lib/`,
`.build-ts/`, and `docs/archive/` untracked. Do not rewrite published history; do not push tags before the gates;
do not commit, tag, or publish without an explicit request.

### 8. RC release workflow

**Rule:** pin exact versions in install docs; use the local tarball fallback when registry resolution is blocked;
wait out the pnpm maturity window or verify the exact artifact; write versioned release notes
(`docs/release-notes/<version>.md`) and add the evidence to `docs/verification.md`. Pack once, verify those exact
bytes (`npm run smoke:package -- --artifact … --sha256 SHA256SUMS` and `scripts/verify/recovery-smoke.mjs …
--artifact … --sha256 SHA256SUMS`), install into a fresh profile, then tag. Create the tag only after the digest
commit is pushed and public CI is green on that commit. Publish the verified tarball under `next`; moving
`latest` to the newest RC is deliberate project policy until a stable release exists — do not describe it as an
npm requirement. Never rebuild after tagging.

## Compatibility regression is a push/release gate

Every version push or release must run a compatibility regression across **all declared DSH versions and every new DSH
version that is not yet tracked**. This is a release requirement, not optional evidence.

- Declared versions are the exact set repeated in `package.json` `engines.dsh`, every
  `@deepseek-ai/dsh-*` peer range, and `dsh.compatibility.dshReleases`. Run typecheck, build, and the full test suite
  against each one in an isolated dependency graph.
- Before the run, discover the current untracked DSH surface: npm `dist-tags` (`latest`, `next`), the newest published
  versions, and any new release that appeared since the last matrix. Probe those versions with typecheck/build/tests
  even when they are not declared yet.
- Use the candidate/version artifact where the gate is about release bytes; use the source tree for development-branch
  pushes. Record the exact Node/npm versions and every resolved `@deepseek-ai/dsh-*` version in the evidence.
- Any missing package, peer drift, silent drop, or version auto-resolution is a failure. Do not hide it with
  `--legacy-peer-deps`, `--force`, by deleting dependencies, or by declaring a matrix PASS from stale `.tmp/` data.
- If a new DSH version passes, add it to all declaration sites and docs in one change. If it fails, either fix the
  adapter or keep it explicitly unsupported in the release notes; never silently claim compatibility.
- The compatibility result is a pre-push/pre-release gate: a failing minimum or current version blocks the branch push
  for a release candidate, PR approval, tag, and npm publish.
- Gateway and browser acceptance remain separate gates; a green source matrix does not replace exact-artifact,
  production-Remote, or real-profile evidence.

## Diagnosing an install/update failure — runbook

1. Record `dsh --version`, OS, profile type (Desktop/Web), and the exact UI/CLI error code or gate message.
2. Find what was actually resolved: the profile `package.json` plugin version and the registry dist-tags.
3. Compare publish time to the pnpm 24-hour `minimumReleaseAge` window and check whether the path was versioned or
   unversioned.
4. Check the release's `engines.dsh`/peer ranges against the installed DSH version.
5. Classify: product bug → new RC; resolver/policy → wait or use the exact artifact; declaration drift → fix
   metadata sites; profile damage → stop, back up, recover with consent. Then announce, publish, or repair.

## Pre-ship checklist

- [ ] Scope matches the version boundary in the roadmap; rc.5 contains no 0.2 capability.
- [ ] `npm ci && npm run check` passes on the final tree (typecheck, build, remote/client smoke, Vitest).
- [ ] Compatibility regression covers every declared DSH version **and** the current untracked npm `latest`/`next`
      versions; evidence records Node/npm and every resolved DSH package; a failing minimum/current version blocks push.
- [ ] `npm pack` was run once; `SHA256SUMS` matches the artifact; exact-artifact and packed recovery smokes pass
      on those bytes without rebuilding.
- [ ] Exact CLI install verified; unversioned Desktop Plugins path verified or explicitly blocked by the maturity
      window; tarball fallback documented and tested.
- [ ] Fresh profile: Web start, Charter tab, zh/en switch; update/rollback and old-record behavior checked.
- [ ] Every metadata site in the Lesson 4 list is consistent (package version, engines, peers, `dshReleases`,
      lockfile, README, compatibility, verification, CHANGELOG, release notes, `SHA256SUMS`).
- [ ] Test counts, digests, and coverage claims match the current tree; manual vs CI vs local-matrix evidence is
      labeled honestly.
- [ ] English and Chinese long-form docs updated together; Chinese normative plan updated when details changed.
- [ ] User uncommitted work untouched; release branch clean of unrelated edits; commits single-purpose.
- [ ] Explicit approval obtained before tagging, publishing, or touching the user's Desktop app/profile.

## Quick commands

```bash
npm ci
npm run check                                 # typecheck + build + remote/client smoke + Vitest
npm run smoke:package                         # packs, verifies tarball, consumer install
npm run smoke:package -- --artifact dist/dsh-charter-<version>.tgz --sha256 SHA256SUMS  # exact bytes, no rebuild
node scripts/verify/recovery-smoke.mjs --artifact dist/dsh-charter-<version>.tgz --sha256 SHA256SUMS
npm run verify:compaction -- --session <id> --home <DSH_HOME>   # manual, needs a model
node scripts/verify/compat-matrix.mjs --versions all            # declared versions; add new/untracked versions too
```

Public CI (`.github/workflows/ci.yml`) runs `npm run check` and `npm run smoke:package` on Node `22.19.0` and
`24`; it does not run exact-artifact mode, the version matrix, Gateway/browser checks, or the real-model
compaction run.
