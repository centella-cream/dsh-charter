# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles. The order is
deliberate: repository metadata and CI come first, then the verified artifact, then the tag, then publish. Never
move a tag that has already been pushed and never re-pack the archive after tagging.

## 1. External prerequisite — public repository setup

The public GitHub repository is <https://github.com/centella-cream/dsh-charter> (created). This tree restores
`package.json` `repository`, `homepage`, and `bugs` for that repository; configure `origin` to it if the checkout
does not already have one. Release state below is dynamic and must be re-checked before every release. If a
provisional local `v0.1.0-rc.2` tag still exists from staging, delete it before the metadata/CI commit — no tag may
survive unless it was created after the public gates:

```bash
git tag -d v0.1.0-rc.2   # only if it exists; it was never pushed
git remote -v            # origin must point at the public repository
```

A local-only marker such as `v0.1.0-rc.2-build` may be used for internal traceability; it is never pushed and is
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
(`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.2.tgz --sha256 SHA256SUMS`, which also verifies the
SHA-256) and a fresh-profile UI check on that same file, then create the final annotated `v0.1.0-rc.2` tag, and make
the GitHub Release and `npm publish --tag next` reuse that same verified tarball. The tag is created only after the
digest commit is on `main` and green in public CI; pushing it before verification would make the release archive
depend on a tree that has not been gated.

Accepted non-blocking limitations (legacy transcript strictness, compaction sequence edge cases, WAIT diagnostic
wording, artifact-smoke hardening residuals, outer-JSON platform risk, mutation-receipt retention, doc count
drift) are disclosed in verification §9 and are not release blockers; do not claim them closed.

## 2. Preconditions

- The version is bumped consistently (`package.json` + `CHANGELOG.md` / `CHANGELOG.zh.md`). This tree is a
  pre-release (`0.1.0-rc.2`); do not publish it without a dist-tag.
- The profile compatibility matrix has been re-checked for any newly supported DSH prerelease.
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
`npm run smoke:package -- --artifact dist/dsh-charter-0.1.0-rc.2.tgz --sha256 SHA256SUMS`. It validates the
artifact's SHA-256 against the supplied sums file, validates every tar member and the packed manifest, then runs
the same manifest/files/modes/exports, empty-consumer install, packed `core` import, and client-bundle checks on
that file; it never builds or packs. If exact-artifact verification is wanted in CI, add a separate release
workflow that consumes the published artifact — the current CI does not. The recorded real-model compaction `PASS`
(verification §8.4) is the acceptance evidence for the compaction-resilience claim; the manual command below is
kept for a fresh target-profile re-run.

Real-model compaction acceptance is manual: apply a charter, run `/compact`, send one message, then run
`npm run verify:compaction -- --session <id> --home <DSH_HOME>` and record the `PASS` evidence in the
verification record (section 8). This check needs a model and is never part of `npm run check`. The recorded
`PASS` means the compaction-resilience claim is accepted; if the Desktop process that served it was not restarted
after the final package update, restart it once and reopen the Charter tab before publishing a stable `latest`
(not before this `next` pre-release; see §8.4).

## 4. Build the verified artifact, tag, push, publish

On the final verified commit (metadata restored, documentation refreshed, CI green, all gates passing):

```bash
npm pack
mkdir -p dist && mv dsh-charter-0.1.0-rc.2.tgz dist/
(cd dist && shasum -a 256 dsh-charter-0.1.0-rc.2.tgz > SHA256SUMS)
```

Write the same digest into the tracked repository-root `SHA256SUMS`. The root file is intentionally outside the
npm `files` whitelist, so committing it does not change the packed archive bytes. Commit it, then **push `main`
again** with that final digest commit and wait for public CI to be green on it:

```bash
git push origin main
# wait for the public CI run on this exact commit to pass
```

Never create the release tag on a commit that is not reachable from the pushed, CI-green `main` (no
tag-only/unpushed commits). Run the exact-artifact check above on the final `dist/` file before tagging; the
GitHub release asset, the npm publish input, and the checksum file must all point at that same verified tarball —
never rebuild after this point. `dist/` is gitignored and is never committed.

Install that exact tarball into a fresh profile and verify it:

```bash
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add dist/dsh-charter-0.1.0-rc.2.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

Open the printed URL, start a Session, and check the Charter tab and English/Chinese switching. Only now — with
the final digest commit pushed to `main` and public CI green on it — create the final annotated tag on that exact
commit and push it once:

```bash
git tag -a v0.1.0-rc.2 -m "dsh-charter 0.1.0-rc.2"
git push origin v0.1.0-rc.2
```

Never move a pushed tag; if the tag is wrong, bump the version instead. Create the GitHub release from that tag
and attach the **already-built and verified** `dist/dsh-charter-0.1.0-rc.2.tgz` plus `dist/SHA256SUMS` — do not
run `npm pack` again after tagging, and publish the already-built file directly:

```bash
npm publish dist/dsh-charter-0.1.0-rc.2.tgz --access public --tag next
```

**Channel policy (deliberate):** publish under `next`, then also move `latest` to the newest RC until a stable
release exists. npm keeps a `latest` tag and we choose where it points; this is our current policy, not an npm
requirement:

```bash
npm dist-tag add dsh-charter@0.1.0-rc.2 latest
```

Verification §8.4 records the gated source commit and points to the tracked shipped-artifact digest; the tracked
root `SHA256SUMS` and `dist/SHA256SUMS` pin the archive built from the tagged tree.

Publish a stable `latest` version only after the public repository links are in place, the post-restart check in
verification §8.4 is recorded, and `npm run check`/`smoke:package` pass on the tagged tree. Do not publish API
keys, profile data, or local screenshots containing private content.

## 5. Post-release

- Verify the README install command against the published artifact.
- Channel policy (current, deliberate): pre-releases are published under `next`, and `latest` is also moved to the
  newest RC until a stable release exists. npm keeps a `latest` tag and we choose its target; do not describe this
  as an npm requirement. `@next` and the exact version remain the pre-release channels. The rc.2 tarball ships
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
