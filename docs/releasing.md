# Releasing dsh-charter

English | [中文](releasing.zh.md)

This checklist keeps a GitHub/npm release reproducible and avoids shipping stale client bundles.

## 1. Preconditions

- `package.json` `repository`, `homepage`, and `bugs` point at the real GitHub repository.
- The version is bumped consistently (`package.json` + `CHANGELOG.md` / `CHANGELOG.zh.md`).
- The profile compatibility matrix has been re-checked for any newly supported DSH prerelease.
- The working tree contains no secrets, private transcripts, or `.tmp` artifacts.

## 2. Verify

```bash
npm ci
npm run check
npm pack
```

`npm run check` must pass typecheck, build, Remote smoke, client smoke, and the full Vitest suite.

Install the packed tarball into a fresh profile and verify:

```bash
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --from-default-profile web --dump-config >/dev/null
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh plugin --profile release-smoke add ./dsh-charter-0.1.0.tgz
DSH_HOME=/tmp/dsh-charter-release-home \
  dsh --profile release-smoke --no-open --port 19399
```

Open the printed URL, start a Session, and check the Charter tab and English/Chinese switching.

## 3. Publish

1. Commit and tag `vX.Y.Z`.
2. Create a GitHub release; attach the `.tgz`, `SHA256SUMS`, and concise highlights.
3. Optional npm publish:

```bash
npm publish --access public
```

Do not publish API keys, profile data, or local screenshots containing private content.

## 4. Post-release

- Verify the README install command against the published artifact.
- Update the compatibility matrix if a new DSH release was tested.
- Leave `docs/archive/` untracked; it contains local historical design material only and is outside the npm
  `files` whitelist, so GitHub and npm stay consistent.
