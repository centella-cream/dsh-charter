# Contributing to dsh-charter

English | [中文](CONTRIBUTING.zh.md)

Thanks for taking the time to improve `dsh-charter`. This project is intentionally small; the most valuable
contributions are focused bug reports, compatibility data, and changes that preserve the design invariants.

## Before you start

Read the [design specification](docs/design/charter-design-v1.md), especially:

- user-authored text must remain **user role**;
- the model must not gain write capability;
- one Apply is one atomic storage-domain record update;
- overflow must be visible, never silently truncated;
- browser output must remain a single self-contained factory bundle.

If a change touches the Host contract, prompt boundary, storage schema, or client bundle format, open an issue
first so the compatibility and migration impact can be discussed.

## Development setup

```bash
git clone https://github.com/centella-cream/dsh-charter.git
cd dsh-charter
npm install
npm run check
```

The relevant commands:

```bash
npm run typecheck
npm test
npm run build
npm run check
```

`npm run build` also runs the Remote and client smoke checks.

## Branch workflow (solo maintainer)

The remote keeps only `main`. Do development on local non-`main` branches; do not push those branches.

Fixed path for every change:

1. Create a local non-`main` branch from local `main`.
2. Implement and run the local gates there.
3. Build an acceptance tarball/profile and perform **local human acceptance** against the exact build.
4. Only after acceptance: merge the branch into local `main` linearly.
5. Push `main` only. Protected actions on `main` are force-pushes, deletion, and non-linear merges, not a
   PR review requirement.

No release, tag, or remote branch is created before local acceptance. Record the acceptance result in the
release verification notes.

External contributors may still open PRs from forks. The maintainer reviews and merges them locally under
the same main-only policy.

## Pull requests

A good pull request:

- explains the user-visible problem and the chosen tradeoff;
- keeps the change scoped;
- adds or updates a test for behaviour changes;
- keeps code comments and log messages in English;
- updates both English and Chinese docs when a public contract changes;
- runs `npm run check` locally;
- does not add a second Remote codec, a second session protocol, or a system-role injection path.

For UI changes, include a screenshot or a short screen recording and verify light/dark and a narrow container.

### README screenshot refresh

README and its screenshots are release evidence, not mockups. Refresh both `README.md` and `README.zh.md`
whenever a user-visible capability or the Pane layout changes, and before every candidate/release build:

1. Install or run the exact current build in a **Web profile** and capture the real UI. Do not build HTML
   mockups, hand-compose screenshots, or reuse an older version's images.
2. Use a synthetic demo session for the screenshots. Prefer the contract from the session that was active
   during the previous accepted release (for `0.3.3` this is `为 dsh-charter 插件优化 GUI 设计`: three
   Chinese deliverables D1/D2/D3). If that session is live in another Host and cannot be opened safely,
   recreate exactly its contract text in a synthetic session; never expose a user's live contract.
3. Match the README language to the captured UI **and contract text**:
   - English README: English DSH locale, English contract content.
   - Chinese README: Chinese DSH locale, Chinese contract content from the previous accepted demo
     (do not screenshot an English contract for the Chinese README).
4. Set DSH appearance to **Follow system**. Do not force dark or light; if the OS theme changes, recapture.
   Capture light and dark state tests separately if the UI change touches both, but the README image follows
   the system theme.
5. Crop to the product surface: Pane screenshots must contain only the right-hand `.charter-root` (no left
   navigation, no session title bar); graph screenshots crop `.charter-graph` with a small padding. Label
   synthetic content in the image caption/prose.
6. Use a 1440px Web viewport (device scale factor 2) for the Pane; use a taller viewport only when a graph
   would otherwise be clipped. The version chip must show the current package version.
7. Save as `docs/assets/charter-pane-<version>.png` / `.zh.png` and
   `docs/assets/charter-graph-<version>.png` / `.zh.png`; do not overwrite historical versioned assets.
8. Verify both READMEs' install/update/config/compatibility snippets and links, the plugin-detail locale
   metadata, and the image language/content. Record the capture conditions in `docs/verification.md`.

The graph is optional when it is unchanged; if included, keep the same crop and language rules.

## Commit style

Conventional prefixes are welcome but not required:

```text
feat: add history draft review
fix: preserve draft on revision conflict
docs: clarify budget overflow
```

## Reporting bugs

Include:

- DSH version (`dsh --version`);
- Node version;
- profile type (Web/Desktop) and host OS;
- whether the Session was live in this process;
- the exact error code or UI state;
- a minimal reproduction when possible.

Never paste API keys, credentials, full private transcripts, or production file contents. Use redacted excerpts.

## Security

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the MIT License.

Documentation changes must follow [docs/README.md](docs/README.md) (naming, status blocks, and link updates).
