# Releasing dsh-charter

English | [中文](releasing.zh.md)

This is the current release checklist. It replaces the older per-rc staging notes. Published tags, GitHub
Releases, and npm versions are immutable: never move a tag, delete a published release, or rebuild bytes after
tagging.

## Current state (2026-10-29)

- **Published:** `0.1.0-rc.4` — npm `latest`/`next`, GitHub Release, immutable tag.
- **Finalized candidate:** `0.1.0-rc.5` — implemented and frozen. Candidate workflow run `40864078201` is green;
  exact artifact SHA-256 is `94e27acf8851ad5423defd06a41253171317f4e805af809fe8e8e7a9ce83a939`; root
  `SHA256SUMS` records it. Tag `v0.1.0-rc.5` points at the checksum-only C+1 commit `0a6ccc5`.
- **Active source:** `0.1.0-rc.6`, unreleased and untagged; documentation/version activation only so far.
- **Not yet published:** rc.5 has no npm version and no GitHub Release. Protected browser evidence and
  Promotion are still pending. `main` includes the repository-token publish workflow.
- Do not create a second rc.5 tag or publish a rebuilt tarball. If a future Promotion expects to create the
  tag, reconcile that with the already-pushed tag before running it.

## 1. Prepare the source

1. Confirm the scope matches [the version roadmap](design/version-roadmap.md) and the active stabilization
   plan. No unplanned feature should enter a release candidate.
2. Update every metadata site in one change: `package.json` version, `engines.dsh`, peer ranges,
   `dsh.compatibility.dshReleases`, `package-lock.json`, README/README.zh, compatibility docs,
   verification, CHANGELOGs, release notes, and root `SHA256SUMS`.
3. Run `npm ci`, `npm run check`, and the normal `npm run smoke:package`.
4. Run the compatibility regression over every declared DSH version and probe untracked `next`/`latest`
   versions. A missing, peer-drifted, or untested version blocks release.
5. Push only `main`; keep the worktree free of secrets, user records, and `.tmp` artifacts.

## 2. Build the candidate bytes once

`release-candidate.yml` is the only producer of release bytes. It runs source gates, compatibility, one
`npm pack`, exact-artifact package smoke, packed-recovery smoke, Gateway acceptance on the exact artifact, and
fresh Web profile install/startup evidence. Every downstream consumer must download that same artifact and
pass `--artifact`/`--sha256`; no downstream job may rebuild or repack.

After the candidate is green, create the checksum-only `C+1` commit on top of candidate `C`:

- `git diff --name-only C C+1` is exactly `SHA256SUMS`;
- `C+1` is a direct child of `C`;
- public CI is green on the exact `C+1` commit;
- the tag targets `C+1`, not `C`.

For rc.5 this is already done: `C=d138d65`, `C+1/tag=0a6ccc5`. Do not re-tag it.

## 3. Browser evidence

Real browser recovery evidence is a protected manual gate. A human must run the documented Web-profile flow
against the exact candidate tarball:

```text
fresh profile → export → archive select → restore → reload → Host restart
→ healthy-target refusal → UTF-8 + error-detail + viewport/accessibility checks
```

Record the required machine-verifiable JSON through `browser-evidence.yml` under the protected `release`
environment. The evidence must bind the candidate run, head SHA, artifact SHA-256, and restore digests. A local
fixture, a source-only smoke, or a green candidate does not replace this gate.

## 4. Promotion

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

Run `release-promote.yml` from the protected `release` environment with:

```text
candidate_run_id, candidate_commit=C, release_commit=C+1,
candidate_sha256, version, browser_evidence_run_id
```

The workflow validates the candidate/browser evidence and main-push CI, publishes the exact tarball under a
temporary non-channel tag, verifies the registry bytes, moves `next`/`latest` with pre-write regression checks,
creates or validates the GitHub Release, attaches `release-evidence.json`, and only then makes the prerelease
public.

Do not run manual `npm publish`, `npm dist-tag`, or `gh release` commands for a release. They bypass environment
approval, token scope, browser evidence, and release evidence.

## 5. Post-release

- Verify the README install commands against the artifact actually published.
- Confirm npm `version`, `dist-tags`, and tarball digest match the candidate.
- Update the compatibility matrix only after a new DSH version passes the full regression.
- Keep the residual outer-JSON risk disclosed: a completely unreadable outer JSON record is treated as absent
  by the JSON backend and cannot be distinguished by the plugin; stop the Host and restore from backup. This is
  different from an inner schema/consistency-invalid record, which is isolated and preserved.
- Leave `docs/archive/` untracked; it is local historical material and outside the npm `files` whitelist.

## 6. Channel policy

RCs are published under `next`; until a stable release exists, `latest` deliberately also points at the newest
RC. npm retains a `latest` tag and the project chooses its target; this is project policy, not an npm
requirement. Exact versions remain the reproducible install path.

Pinned installs should use an exact version together with pnpm's release-age awareness. A freshly published RC
may be invisible to unversioned resolution until the release-age window elapses; do not bypass the compatibility
gate or use an undeclared older release.
