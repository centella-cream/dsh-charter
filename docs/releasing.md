# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles. The order is
deliberate: repository metadata and CI come first, then the verified artifact, then the tag, then publish. Never
move a tag that has already been pushed and never re-pack the archive after tagging.

## 1. External prerequisite — public repository setup

The public GitHub repository is <https://github.com/centella-cream/dsh-charter> (created). This tree restores
`package.json` `repository`, `homepage`, and `bugs` for that repository; configure `origin` to it if the checkout
does not already have one. Release state below is dynamic and must be re-checked before every release. If a
provisional local `v0.1.0-rc.5` tag still exists from staging, delete it before the metadata/CI commit — no tag may
survive unless it was created after the public gates:

```bash
git tag -d v0.1.0-rc.5   # only if it exists; it was never pushed
git remote -v            # origin must point at the public repository
```

A local-only marker such as `v0.1.0-rc.5-build` may be used for internal traceability; it is never pushed and is
not the release tag.

Prepare the repository and public gates first:

1. verify `origin` points at `https://github.com/centella-cream/dsh-charter` (public repository already created);
2. confirm `repository`, `homepage`, and `bugs` in `package.json` point at that URL (restored in this tree);
3. enable and verify **private security reporting** for the repository (security advisories/private reporting
   must work before publishing);
4. update every mutable release-state statement that changed (repository metadata, public CI status, release
   prerequisites), rerun `npm run check` and the normal `npm run smoke:package`, and commit the documentation
   refresh in the same metadata/CI-status/documentation-update commit;
5. push `main` only — do not push tags yet (`git push origin main`; do not use `--follow-tags`);
6. wait for the public CI in `.github/workflows/ci.yml` to be green on Node `22.19.0` and `24` for that commit
   (CI runs `npm run check` and the normal `npm run smoke:package` only; exact-artifact mode is not a CI job).

Then, in order: build the release tarball **once** from that final source, run the exact-artifact smoke
(`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.5.tgz --sha256 SHA256SUMS`, which also verifies the
SHA-256), the **packed-artifact recovery smoke**
(`node scripts/verify/recovery-smoke.mjs --artifact dist/dsh-charter-0.1.0-rc.5.tgz --sha256 SHA256SUMS`, covering
export → remove target → restore → two restarts with digest/projection comparison → healthy-target refusal and the
storage-fault matrix against the packed Host), and a fresh-profile UI check on that same file, then create the final
annotated `v0.1.0-rc.5` tag, and make
the GitHub Release and `npm publish --tag next` reuse that same verified tarball. The tag is created only after the
digest commit is on `main` and green in public CI; pushing it before verification would make the release archive
depend on a tree that has not been gated.

Accepted non-blocking limitations (legacy transcript strictness, compaction sequence edge cases, WAIT diagnostic
wording, artifact-smoke hardening residuals, outer-JSON platform risk, mutation-receipt retention, doc count
drift) are disclosed in verification §6 and are not release blockers; do not claim them closed.

## 2. Preconditions

- The version is bumped consistently (`package.json` + `CHANGELOG.md` / `CHANGELOG.zh.md`). This tree is a
  pre-release (`0.1.0-rc.5`); do not publish it without a dist-tag.
- The profile compatibility matrix has been re-checked for any newly supported DSH prerelease. Record maintenance
  (export/initialize/restore) is owner-only and enabled only on DSH `0.2.1+`; `0.1.7`/`0.2.0` fail closed with
  `RECOVERY_UNSUPPORTED`. Verify the Gateway HTTP body limit exceeds `maxRecoveryBytes` for the target deployment.
- The working tree contains no secrets, private transcripts, or `.tmp` artifacts.

## 3. Verify

```bash
npm ci
npm run check
npm run smoke:package
```

`npm run check` must pass typecheck, build, Remote smoke, client smoke, and the full Vitest suite;
`npm run smoke:package` additionally packs the tarball and verifies its required files, every `exports` target,
the packed `core` import, and the packed client bundle (Host/Remote runtime imports are covered by the workspace
build smokes). CI runs `npm run check` plus the normal `npm run smoke:package` on the pushed metadata commit; it
does not run exact-artifact mode. The exact-artifact check is the **local release gate after building the final
tarball** and before the tag/push/publish step: once the release artifact exists, verify those exact bytes without
rebuilding with
`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.5.tgz --sha256 SHA256SUMS`. It validates the
artifact's SHA-256 against the supplied sums file, validates every tar member and the packed manifest, then runs
the same manifest/files/modes/exports, empty-consumer install, packed `core` import, and client-bundle checks on
that file; it never builds or packs. If exact-artifact verification is wanted in CI, add a separate release
workflow that consumes the published artifact — the current CI does not. The recorded real-model compaction `PASS`
(immutable [v0.1.0-rc.4 verification §8.4](https://github.com/centella-cream/dsh-charter/blob/v0.1.0-rc.4/docs/verification.md#84-recorded-real-model-run-2026-10-22)) is the acceptance evidence for the compaction-resilience claim; the manual command below is
kept for a fresh target-profile re-run.

Real-model compaction acceptance is manual: apply a charter, run `/compact`, send one message, then run
`npm run verify:compaction -- --session <id> --home <DSH_HOME>` and record the `PASS` evidence in the
verification record (section 8). This check needs a model and is never part of `npm run check`. The recorded
`PASS` means the compaction-resilience claim is accepted; if the Desktop process that served it was not restarted
after the final package update, restart it once and reopen the Charter tab before publishing a stable `latest`
(not before this `next` pre-release; see the immutable [v0.1.0-rc.4 verification §8.4](https://github.com/centella-cream/dsh-charter/blob/v0.1.0-rc.4/docs/verification.md#84-recorded-real-model-run-2026-10-22)).

## 4. Single promotion path

`release-candidate.yml` is the only producer of the release tarball and all release evidence. After it is green,
create the checksum-only release commit `C+1` on top of candidate `C`:

- `git diff --name-only C C+1` must be exactly `SHA256SUMS`;
- `C+1` must be a direct child of `C`;
- public CI must be green on the exact `C+1` commit.

Then run `release-promote.yml` from the protected `release` environment. It is the **only** path allowed to
create the tag, GitHub Release, and npm channels. Do not run manual `git tag`, `gh release`, `npm publish`, or
`npm dist-tag` commands for a release; they bypass environment approval, OIDC, browser evidence, and release
evidence.

The workflow consumes the downloaded candidate artifact, verifies the candidate/browser evidence and main-push CI,
publishes under a temporary non-channel tag, verifies the registry tarball, moves `next`/`latest` with immediate
rollback checks, creates/validates the Release as a draft, attaches `release-evidence.json`, and only then makes
the GitHub prerelease public.

A fresh isolated profile check remains a manual acceptance step, but it does not authorize a separate manual
publish path. Never rebuild the tarball after the candidate workflow has packed it.
## 5. Post-release

- Verify the README install command against the published artifact.
- Channel policy (current, deliberate): pre-releases are published under `next`, and `latest` is also moved to the
  newest RC until a stable release exists. npm keeps a `latest` tag and we choose its target; do not describe this
  as an npm requirement. `@next` and the exact version remain the pre-release channels. The rc.3 tarball ships
  this wording in its README/user-guide/release docs.
- Remember the recorded residual risk (verification §4.5): an **unreadable outer JSON** charter record is treated
  as absent by the JSON storage backend and cannot be distinguished from a missing record through the plugin-side
  API. Do not claim "corrupt data is always preserved": the guarantee splits into an inner schema/consistency
  invalid record (isolated and preserved by the plugin) versus an unreadable/malformed outer JSON document or
  rejected outer version (known overwrite risk — stop the Host and restore from a backup). Before a tag, re-read
  the immutable docs and keep this limitation stated there.
- Update the compatibility matrix if a new DSH release was tested.
- Leave `docs/archive/` untracked; it contains local historical design material only and is outside the npm
  `files` whitelist, so GitHub and npm stay consistent.

## rc.5 one-artifact automation

`.github/workflows/release-candidate.yml` is the only producer of an rc.5 tarball. It runs source gates, the
compatibility sentinels, one `npm pack`, then exact-artifact package smoke, packed recovery smoke, and the
the Gateway job and the separate protected manual browser-evidence workflow. The Gateway job runs the exact artifact on isolated rc.3/rc.4 graphs. Browser recovery is a protected manual
environment gate; promotion requires its successful, SHA-bound evidence run. Do not treat a source-only run as release evidence. Every consumer downloads the same `release-candidate` artifact and must use
`--artifact`/`--sha256`; no consumer may pack again.

`.github/workflows/release-promote.yml` is protected by the `release` environment and is the only promotion path.
It requires candidate run id, source commit C, artifact SHA-256, and exact version; verifies C→C+1 changes only
the root `SHA256SUMS`, reruns exact-artifact smoke without build/pack, tags C+1, creates the GitHub Release, and
publishes the exact tarball under `next`. Do not run it until the candidate is green and the release is explicitly
approved.
