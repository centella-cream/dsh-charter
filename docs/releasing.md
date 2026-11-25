# Releasing dsh-charter

English | [中文](releasing.zh.md)

> **Status:** Active — current operating record.
> **Version scope:** current development line.
> **Baseline:** 2026-11-03

This is the current release checklist. It replaces the older per-rc staging notes. Published tags, GitHub
Releases, and npm versions are immutable: never move a tag, delete a published release, or rebuild bytes after
tagging.

## Current state (2026-11-25)

- **Released:** `0.3.4` — opt-in draft calibration; npm `latest`/`next` and GitHub Release `v0.3.4` published 2026-11-25. Exact npm tarball SHA-256 `954efd67…`; tag `v0.3.4`; Release candidate run `45582847333`; Promotion run `45584815676`.
- **Previous release:** `0.3.3` — structured draft extraction + non-blocking zh/en language following; published 2026-11-24.
- **Published:** `0.3.2` — npm `latest`/`next`, GitHub Release `v0.3.2`; exact artifact
  `dsh-charter-0.3.2.tgz`, SHA-256 `9dcb82ae34eaaeb6d266bb98f3e1f92f3a0798042ce3dc282abe9173ff79e056`.
- **Previous release:** `0.3.1` — GitHub Release `v0.3.1`.
- **Earlier release:** `0.3.0` — GitHub Release `v0.3.0`.
- **Earlier release:** `0.2.1`.
- **Post-release diagnostics:** real-model compaction and 512-item core performance both passed.
- Do not manually publish or bypass the protected gates.

## 1. Prepare the source

1. Confirm the scope matches [the version roadmap](design/version-roadmap.md) and the active stabilization
   plan. No unplanned feature should enter a release candidate.
2. Update every metadata site in one change: `package.json` version, `engines.dsh`, peer ranges,
   `dsh.compatibility.dshReleases`, `package-lock.json`, README/README.zh, compatibility docs,
   verification, CHANGELOGs, release notes, and root `SHA256SUMS`. Before the candidate is built, refresh
   README/README.zh with the latest capabilities and the current Pane screenshots from the accepted build; stale
   README copy or screenshots block the release. Screenshot work must follow
   [CONTRIBUTING.md §README screenshot refresh](CONTRIBUTING.md#readme-screenshot-refresh): use the Web profile
   current build, the previous accepted demo session's contract content (or an exact synthetic copy), matching
   README language for UI and contract text, Follow-system appearance, and a right-hand `.charter-root` crop.
3. Run `npm ci`, `npm run check`, and the normal `npm run smoke:package`.
4. Run the compatibility regression over every declared DSH version and probe untracked `next`/`latest`
   versions. A missing, peer-drifted, or untested version blocks release.
5. Run the local gates on a local non-`main` branch and build the acceptance tarball/profile. Perform local human
   acceptance against that exact build. For Desktop, install/update through the Desktop **Plugins** flow and
   use its reload/hot-update action; do not terminate or signal the Desktop app/Host, and do not edit the
   Desktop profile to force an install or acceptance. An agent may prepare the artifact and verify profile/
   logs read-only after the human acts; an uninstalled candidate is a blocked gate, not a pass. Only after
   acceptance, merge into local `main` linearly, then push `main`. Do not push development branches; the
   remote keeps only `main`. Keep the worktree free of secrets, user records, test Sessions, and `.tmp`
   artifacts.

## 2. Build the candidate bytes once

`release-candidate.yml` is the only producer of release bytes. It runs source gates, compatibility, one
`npm pack`, exact-artifact package smoke, packed-recovery smoke, Gateway acceptance on the exact artifact, and
fresh Web profile install/startup evidence. Every downstream consumer must download that same artifact and
pass `--artifact`/`--sha256`; no downstream job may rebuild or repack.

After the candidate is green, create the checksum-only `C+1` commit on top of candidate `C`:

- `git diff --name-only C C+1` is exactly `SHA256SUMS`;
- `C+1` is a direct child of `C`; commit only `SHA256SUMS` on local `main` and push it directly.
- public CI is green on the exact `C+1` commit;
- the tag targets `C+1`, not `C`.

For a stable release the same C/C+1 ordering applies; `C+1` is the checksum-only commit and the tag target.

## 3. Promotion

Promotion is the only path allowed to create the GitHub Release and move npm channels.

### Repository token

The promotion workflow uses a protected repository secret:

```text
secret: NPM_TOKEN
scope: package write
package: dsh-charter
2FA: bypass enabled
expiry: tracked and rotated before expiry
```

It does not use OIDC or generate a provenance attestation. A missing, expired, or under-scoped token blocks
publication. Rotate the token before expiry and update the secret in the same maintenance window.

### Run

Run `release-promote.yml` from the `release` environment with:

```text
candidate_run_id, candidate_commit=C, release_commit=C+1,
candidate_sha256, version=0.2.0
```

The workflow validates the candidate and main-push CI, publishes the exact tarball under a
temporary non-channel tag, verifies the registry bytes, moves `next`/`latest` with pre-write regression checks,
creates or validates the GitHub Release, attaches `release-evidence.json`, and only then makes the release
public (prerelease only when the version itself is a prerelease).

Do not run manual `npm publish`, `npm dist-tag`, or `gh release` commands for a release. They bypass the repository release workflow, token scope, and release evidence.

## 4. Post-release

- Verify the README install commands against the artifact actually published.
- Confirm npm `version`, `dist-tags`, and tarball digest match the candidate.
- Update the compatibility matrix only after a new DSH version passes the full regression.
- Keep the residual outer-JSON risk disclosed: a completely unreadable outer JSON record is treated as absent
  by the JSON backend and cannot be distinguished by the plugin; stop the Host and restore from backup. This is
  different from an inner schema/consistency-invalid record, which is isolated and preserved.
- Leave `docs/archive/` untracked; it is local historical material and outside the npm `files` whitelist.

## 5. Channel policy

Prerelease candidates use `next`; the stable `0.2.0` promotion moves both `next` and `latest` after registry bytes
and tarball integrity are verified. Exact versions remain the reproducible install path.

Pinned installs should use an exact version together with pnpm's release-age awareness. A freshly published RC
may be invisible to unversioned resolution until the release-age window elapses; do not bypass the compatibility
gate or use an undeclared older release.
