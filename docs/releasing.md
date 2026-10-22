# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles.

## 1. Preconditions

- A **public** GitHub repository exists and is reachable; `package.json` `repository`, `homepage`, and `bugs` are
  restored to that URL (they are intentionally absent while no public repo exists).
- The version is bumped consistently (`package.json` + `CHANGELOG.md` / `CHANGELOG.zh.md`). This tree is a
  pre-release (`0.1.0-rc.1`); do not publish it without a dist-tag.
- The profile compatibility matrix has been re-checked for any newly supported DSH prerelease.
- The working tree contains no secrets, private transcripts, or `.tmp` artifacts.

## 2. Verify

```bash
npm ci
npm run check
npm run smoke:package
npm pack
```

`npm run check` must pass typecheck, build, Remote smoke, client smoke, and the full Vitest suite;
`npm run smoke:package` additionally packs the tarball and verifies its required files, every `exports` target,
the packed Host import, and the packed client bundle. CI runs both. The compaction checker has fixture tests for
its success/failure exit criteria, but the real-model run remains the manual gate described below.

Install the packed tarball into a fresh profile and verify:

```bash
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
verification record (section 8). This check needs a model and is never part of `npm run check`.

Do not label the build a release candidate for the compaction-resilience claim until that `PASS` evidence is
recorded; light, dark, bilingual, and narrow-layout screenshots are now part of the verification record.

## 3. Publish

1. Commit and tag `vX.Y.Z`.
2. Create a GitHub release; attach the `.tgz`, `SHA256SUMS`, and concise highlights.
3. npm publish the pre-release with a non-latest dist-tag:

```bash
npm publish --access public --tag next
```

The real-model compaction `PASS` is recorded in verification §8.4 (2026-10-22). Publish a stable `latest` version
only after the public repository links are in place and `npm run check`/`smoke:package` pass on the tagged tree.

Do not publish API keys, profile data, or local screenshots containing private content.

## 4. Post-release

- Verify the README install command against the published artifact.
- Update the compatibility matrix if a new DSH release was tested.
- Leave `docs/archive/` untracked; it contains local historical design material only and is outside the npm
  `files` whitelist, so GitHub and npm stay consistent.
