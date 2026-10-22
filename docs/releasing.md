# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles.

## 1. External prerequisite — the remaining release blocker

The public GitHub repository does not exist yet, this checkout has no `git remote`, and `package.json`
`repository`, `homepage`, and `bugs` are intentionally absent. Create and push the repository first:

1. create the public repository (owner/name agreed by the maintainer);
2. `git remote add origin <url>` and `git push -u origin main --follow-tags` (this also pushes the
   `v0.1.0-rc.1` tag);
3. restore `repository`, `homepage`, and `bugs` in `package.json` to that URL and commit;
4. confirm `.github/workflows/ci.yml` is green on the pushed commit (Node 22.19.0 and 24 matrix).

Only after these steps should `npm publish --tag next` run. The same prerequisite applies to the README links,
which reference the repository only through its normal package metadata.

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
the packed Host import, and the packed client bundle. CI is configured to run both once the public repository
exists. The recorded real-model compaction `PASS`
(verification §8.4) is the acceptance evidence for the compaction-resilience claim; the manual command below is
kept for a fresh target-profile re-run.

Install the packed tarball into a fresh profile and verify:

```bash
npm pack
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add ./dsh-charter-0.1.0-rc.1.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

Open the printed URL, start a Session, and check the Charter tab and English/Chinese switching.

Real-model compaction acceptance is manual: apply a charter, run `/compact`, send one message, then run
`npm run verify:compaction -- --session <id> --home <DSH_HOME>` and record the `PASS` evidence in the
verification record (section 8). This check needs a model and is never part of `npm run check`. The recorded
`PASS` means the compaction-resilience claim is accepted; if the Desktop process that served it was not restarted
after the final package update, restart it once and reopen the Charter tab before publishing a stable `latest`
(not before this `next` pre-release; see §8.4).

## 4. Tag and publish

```bash
git tag -a v0.1.0-rc.1 -m "dsh-charter 0.1.0-rc.1"
npm pack
mkdir -p dist && mv dsh-charter-0.1.0-rc.1.tgz dist/
(cd dist && shasum -a 256 dsh-charter-0.1.0-rc.1.tgz > SHA256SUMS)
```

Pack on the tagged tree so the archive matches the committed source. Write the digest to `dist/SHA256SUMS` and
to the tracked root `SHA256SUMS` (the root file is intentionally outside the npm `files` whitelist, so it does not
change the packed artifact). Commit that root file, then move the `v0.1.0-rc.1` tag to the resulting HEAD.
Verification §8.4 records the gated source commit and points to the tracked shipped-artifact digest; the tracked
root `SHA256SUMS` and `dist/SHA256SUMS` pin the archive built from the tagged tree. `dist/` is gitignored; attach
the `.tgz` and `SHA256SUMS` to the GitHub release but never commit the tarball.

1. Create a GitHub release; attach the `.tgz`, `SHA256SUMS`, and concise highlights.
2. npm publish the pre-release with a non-latest dist-tag:

```bash
npm publish --access public --tag next
```

Publish a stable `latest` version only after the public repository links are in place, the post-restart check in
verification §8.4 is recorded, and `npm run check`/`smoke:package` pass on the tagged tree. Until then,
`dsh-charter@latest` does not exist: install `@0.1.0-rc.1` or `@next`.

Do not publish API keys, profile data, or local screenshots containing private content.

## 5. Post-release

- Verify the README install command against the published artifact.
- Update the compatibility matrix if a new DSH release was tested.
- Leave `docs/archive/` untracked; it contains local historical design material only and is outside the npm
  `files` whitelist, so GitHub and npm stay consistent.
