# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles. The order is
deliberate: repository metadata and CI come first, then the verified artifact, then the tag, then publish. Never
move a tag that has already been pushed and never re-pack the archive after tagging.

## 1. External prerequisite — public repository setup

Release state is dynamic; this checklist is the only place that records it. At the time of writing the public
GitHub repository may not exist yet, `package.json` `repository`, `homepage`, and `bugs` are intentionally absent,
and nothing may have been pushed or published. Before starting, **delete any provisional local release tag**
created while staging the RC — a tag created before repository metadata and public CI must not survive:

```bash
git tag -d v0.1.0-rc.1   # only if it exists; it was never pushed (confirm: no matching remote tag)
git remote -v            # must be empty or must not contain this repository yet
```

A local-only marker such as `v0.1.0-rc.1-build` may be used for internal traceability; it is never pushed and is
not the release tag.

Prepare the repository first:

1. create the public repository (owner/name agreed by the maintainer) and add it as `origin`;
2. restore `repository`, `homepage`, and `bugs` in `package.json` to that URL and commit the metadata change;
3. update every mutable release-state statement that changed (repository metadata, public CI status, release
   prerequisites), rerun `npm run check` and `npm run smoke:package`, and commit the documentation refresh in the
   same metadata/CI-status/documentation-update commit;
4. push `main` only — do not push tags yet (`git push origin main`; do not use `--follow-tags`);
5. wait for the public CI in `.github/workflows/ci.yml` to be green on that commit (Node 22.19.0 and 24 matrix).

The tag is created later, on the final verified commit (§4), only after the digest commit is on `main` and green
in public CI; pushing it before verification would make the release archive depend on a tree that has not been
gated.

## 2. Preconditions

- The version is bumped consistently (`package.json` + `CHANGELOG.md` / `CHANGELOG.zh.md`). This tree is a
  pre-release (`0.1.0-rc.1`); do not publish it without a dist-tag.
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
build smokes). CI runs both on the pushed metadata commit. The recorded real-model compaction `PASS`
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
mkdir -p dist && mv dsh-charter-0.1.0-rc.1.tgz dist/
(cd dist && shasum -a 256 dsh-charter-0.1.0-rc.1.tgz > SHA256SUMS)
```

Write the same digest into the tracked repository-root `SHA256SUMS`. The root file is intentionally outside the
npm `files` whitelist, so committing it does not change the packed archive bytes. Commit it, then **push `main`
again** with that final digest commit and wait for public CI to be green on it:

```bash
git push origin main
# wait for the public CI run on this exact commit to pass
```

Never create the release tag on a commit that is not reachable from the pushed, CI-green `main` (no
tag-only/unpushed commits). `dist/` is gitignored and is never committed.

Install that exact tarball into a fresh profile and verify it:

```bash
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add dist/dsh-charter-0.1.0-rc.1.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

Open the printed URL, start a Session, and check the Charter tab and English/Chinese switching. Only now — with
the final digest commit pushed to `main` and public CI green on it — create the final annotated tag on that exact
commit and push it once:

```bash
git tag -a v0.1.0-rc.1 -m "dsh-charter 0.1.0-rc.1"
git push origin v0.1.0-rc.1
```

Never move a pushed tag; if the tag is wrong, bump the version instead. Create the GitHub release from that tag
and attach the **already-built and verified** `dist/dsh-charter-0.1.0-rc.1.tgz` plus `dist/SHA256SUMS` — do not
run `npm pack` again after tagging, and publish the already-built file directly:

```bash
npm publish dist/dsh-charter-0.1.0-rc.1.tgz --access public --tag next
```

Verification §8.4 records the gated source commit and points to the tracked shipped-artifact digest; the tracked
root `SHA256SUMS` and `dist/SHA256SUMS` pin the archive built from the tagged tree.

Publish a stable `latest` version only after the public repository links are in place, the post-restart check in
verification §8.4 is recorded, and `npm run check`/`smoke:package` pass on the tagged tree. Do not publish API
keys, profile data, or local screenshots containing private content.

## 5. Post-release

- Verify the README install command against the published artifact.
- Remember the recorded residual risk (verification §4.5): an **unreadable outer JSON** charter record is treated
  as absent by the JSON storage backend and cannot be distinguished from a missing record through the plugin-side
  API. Do not claim "corrupt data is always preserved": the guarantee splits into an inner schema/consistency
  invalid record (isolated and preserved by the plugin) versus an unreadable/malformed outer JSON document or
  rejected outer version (known overwrite risk — stop the Host and restore from a backup). Before a tag, re-read
  the immutable docs and keep this limitation stated there.
- Update the compatibility matrix if a new DSH release was tested.
- Leave `docs/archive/` untracked; it contains local historical design material only and is outside the npm
  `files` whitelist, so GitHub and npm stay consistent.
