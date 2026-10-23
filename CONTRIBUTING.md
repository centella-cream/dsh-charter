# Contributing to dsh-charter

English | [中文](CONTRIBUTING.zh.md)

Thanks for taking the time to improve `dsh-charter`. This project is intentionally small; the most valuable
contributions are focused bug reports, compatibility data, and changes that preserve the design invariants.

## Before you start

Read the [design specification](docs/design/charter-design.md), especially:

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
