# Security policy

English | [中文](SECURITY.zh.md)

## Supported versions

Security fixes target the current `0.1.x` line. DSH `0.2.1+` is the recommended runtime because it provides
per-Peer Remote resource authorization. DSH `0.1.7` / `0.2.0` can only check that a Session is live and that its
lifecycle identity matches; run them in a trusted single-operator environment.

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability.**

Report through the repository's private security advisory channel: <https://github.com/centella-cream/dsh-charter/security/advisories/new>
with:

- affected version/commit;
- DSH version and profile type;
- reproduction steps or a proof of concept;
- impact assessment;
- any suggested fix.

Please allow reasonable time for triage and a coordinated disclosure. Do not include real API keys, credentials,
or private user content in a report.

## Threat model

`dsh-charter` treats user-authored charter text as **untrusted user content**:

- It is injected through `systemPrompt.context()` (user role), never as a system message.
- It must not override Host policy, tool permissions, sandbox rules, or execution guards.
- The model only has `charter_read`; no write tool or Remote method is exposed to it.
- The Host enforces an actor policy: `owner` may perform all edits including purge; `user` may make ordinary edits
  but not purge; `host` is rejected on the Remote edit path.
- Core also rejects purging active accepted or pending items, so a direct API caller cannot bypass the UI guard.
- Storage records are bound to Session lifecycle identity; a reused Session id with different `createdAt`,
  `cwd`, or `parentSession` is rejected.
- UI text is localised; raw storage errors are not rendered as instruction-like content.
- Ordinary logs omit user body text and evidence excerpts.

## Out of scope

- The model choosing not to follow the charter. A charter is a declaration, not an enforcement mechanism.
- Prompt-injection content inside a user-authored charter that the model chooses to follow. Use Host policy,
  sandboxing, approvals, and tool guards for hard limits.
- Multi-process live `domain/changed` synchronization; the plugin is designed for one Host process.
- Data loss caused by deleting a profile, domain, or storage directory outside the plugin.
