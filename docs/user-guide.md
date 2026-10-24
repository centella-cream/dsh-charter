# `dsh-charter` User and Operations Guide

English | [中文](user-guide.zh.md)

This guide is for installing and using the plugin. For design constraints see the
[design specification](design/charter-design.md); for version differences see the
[compatibility matrix](design/compatibility.md).

## 1. Before installing

```bash
dsh --version                  # >= 0.1.7-rc.2; 0.2.0-rc.1+ recommended
node --version                 # ^22.19.0 || >=24.0.0
dsh --profile web --dump-config | grep -n "charter" || true
```

For a Web or Desktop profile the plugin registers:

- Host service `charter`;
- Remote service `charterRemote` (namespace `charter`);
- read-only tool `charter_read`;
- browser entry `dsh-charter/client.js` and the **Charter / 会话契约** tab in the conversation header.

## 2. Install

> **Install channels.** Once the maintainer publishes the `next` dist-tag, install by exact version or tag; if the
> tag is not listed in your registry yet, use the verified local tarball built from this checkout.

### 2.1 Requirements

- DSH: only the versions listed in the [compatibility matrix](design/compatibility.md) are supported
  (`0.1.7-rc.2`, `0.2.0-rc.1`/`rc.2`, `0.2.1-rc.1`/`rc.2`); newer stable/RC versions are not claimed until the
  matrix is extended. `0.2.1+` is required for per-Peer Remote resource authorization.
- Node.js **`^22.19.0 || >=24.0.0`**.
- A Web or Desktop profile.

### 2.2 Offline / local tarball fallback

```bash
npm install
npm run build
npm pack
dsh plugin --profile web add ./dsh-charter-0.1.0-rc.2.tgz
```

For Desktop, use the Plugins page if local import is available; otherwise install the tarball through the Desktop
profile's own package manager (`dsh plugin --profile desktop` is refused by the Electron app). The profile
dependency is a local `file:` path. Prefer npm install in §2.3 when the registry is reachable.

### 2.3 npm / Registry install (recommended) — Web profile by version or tag

```bash
dsh plugin --profile web add dsh-charter@0.1.0-rc.2   # exact version: reproducible
dsh plugin --profile web add dsh-charter@next         # newest pre-release
```

`0.1.0-rc.2` is the current pre-release under the `next` dist-tag. Under our channel policy `latest` also points
at the newest RC until a stable release exists (npm keeps a `latest` tag and we choose where it points; this is
our policy, not an npm requirement). Use the exact version or `@next` for pre-release installs, and use the
offline tarball fallback above only when the registry is unreachable. Pin an explicit version for reproducible
profiles.

Restart `dsh web`, or let profile HMR recompose, then refresh the page. The profile's `package.json` gains the
dependency and bundle selection:

```json
{
  "dependencies": { "dsh-charter": "0.1.0-rc.2" },
  "dsh": { "profile": { "bundles": ["...", "dsh-charter"] } }
}
```

pnpm may warn about missing `@deepseek-ai/dsh-*` peers. The DSH runtime supplies those packages; do not install
them into the profile. Trust DSH's peer compatibility check.

### 2.4 Registry channel — Desktop Plugins

If your Desktop build exposes the public catalog and the package is published there, open **Desktop → Plugins**,
search for **`dsh-charter`**, and click **Install**. When already installed, click **Update**; Desktop owns the
plugin lifecycle and hot-applies the new bundle. Otherwise use the tarball path.

### 2.5 Source development

For source changes, link the checkout and rebuild:

```bash
dsh plugin --profile web add "$(pwd)"
npm run build
```

The browser entry is a build artifact; it cannot run TypeScript source directly. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the development workflow. Do not use source linking as the normal
installation path for users.

## 3. First use

A new Session starts with an **empty** charter. The plugin never writes goals or constraints into the effective
record automatically; until you set an objective or add an item, the model sees no charter context. This is
intentional: only user-confirmed content becomes effective.

If an existing Session has a compaction summary and its charter is empty, the Charter tab automatically shows a
**history draft** extracted from the latest summary. Review/edit the draft and click **Apply draft** to make it
effective. The draft itself never enters the prompt, and no model call is made. Sessions without a compaction
summary keep the normal empty state.

1. Open a started Session. The header shows Chat, Trajectory, then Charter. If Charter is missing, confirm the
   profile boot graph contains `dsh-charter/client.js` and that the Session is not blank (a blank Session hides
   the View tab bar). The Charter tab is registered once at a stable high order, so it follows Chat, Trajectory, and
   common plugin tabs without re-registering itself.
2. Use the left section navigation: **Overview / Objective / Invariants / Deliverables / History draft /
   Context**. History is always available: it shows the current bootstrap phase and offers **Check again**.
   Narrow windows turn this navigation into a horizontal tab strip.
3. In **Objective**, set the objective. The original objective is written once and is immutable.
4. In **Invariants**, add constraints that must remain visible, for example:
   - `Do not modify migrations/`
   - `Run pnpm test before delivery`
   - `Keep the public API backward compatible`
5. In **Deliverables**, add outcomes with `not-started` / `in-progress` / `blocked` / `done` / `cancelled`.
   The tab label and every pane string follow the active DSH language: **Charter** in English, **会话契约** in Chinese.
6. Every change first enters a draft, and the list itself renders the projected result immediately. **Preview
   context** shows the exact user-role text and byte count the model will see after Apply.
7. **Apply** commits atomically. On success the revision increases and the next request sees it. A network
   failure keeps the same mutation id so Retry can safely replay an unknown-outcome write.
8. If another tab or process commits first, the pane keeps the draft and offers **Apply draft to revision N**;
   choose it to re-target the same changes, or discard the draft to start over.
9. Staged edits, an open inline editor, and a reviewed history draft belong to the Session, not to the mounted
   tab: switching to Chat and back restores them. Only Apply, explicit Discard, or a Session change clears them.

### 3.1 Item actions and replacement chains

Item actions live in an **Actions** menu on each row (only while the row is editable), so a long charter does
not create thousands of tab stops. A replacement successor cannot be archived or replaced again: purge its
superseded predecessor first, which detaches the successor and makes it an ordinary item again. Historical rows
are collapsed by default; use **Show N historical items** to inspect and restore/purge them.

Verification is a human mark: **Mark verified** records `verified (marked)`. A validator-produced
`failed`/`unavailable` state is read-only and its reason is shown; the UI cannot create those states.

### 3.2 State dimensions

| Dimension | Values | Notes |
| --- | --- | --- |
| `review` | `pending` / `accepted` / `rejected` | user-created items are accepted; history-overflow imports and explicit client `item.propose` operations are pending; the model has no write tool |
| `lifecycle` | `current` / `superseded` / `archived` | archived can be restored; superseded is not revived |
| `verification` | `unchecked` / `verified` / `failed` / `unavailable` | independent of lifecycle |
| `progress` | deliverable only | independent of verification |

Only `accepted + current` enters the standing working set and model-visible context. `done` does not imply
verified, and `verification.failed` does not archive automatically. The MVP UI only toggles
`unchecked`/`verified`; `failed`/`unavailable` are accepted read-only record states reserved for a future
validator integration, not states you can create from this UI.

### 3.3 Permanent purge

Archived, rejected, and superseded items still count toward the all-items quota. **Purge** is owner-only, asks
for confirmation, and in one atomic record update:

- removes the item;
- clears replacement links that can be safely cleared;
- scrubs body text from recent history and mutation receipts.

Active accepted/pending items are rejected by the core; only archived, rejected, or superseded chain entries
can be purged. If a later item still references it, Purge is rejected; handle the referrer first.

### 3.4 Read-only tool views

`charter_read` defaults to `standing`, which returns the complete current working set (the objective plus every
accepted/current item, bounded by the record quotas). The `all` view is a **bounded debugging view**, not the
current working set: it includes rejected, archived, and superseded items, returns at most 64 items / 32 KiB, and reports the
omitted count as `truncated`. It is not a substitute for the standing charter and should not be used
routinely.

### 3.5 Actor policy

- `owner`: all charter edits, including irreversible purge.
- `user`: ordinary objective/item/progress/verification edits, but **not** `item.purge`.
- `host`: never accepted through the Remote edit path; internal initialization/fork uses dedicated code.
- agent/model: no write tool or edit API is exposed.

### 3.6 Non-live Sessions

A Web process can show the stored charter of a Session that is live in another process as a read-only view.
Editing and history-draft extraction require the Session to be live in the current process; reconnecting the
Session upgrades the tab to editable. `charter.bootstrap` therefore returns `not-live` rather than reading
another process's event log.

## 4. Configuration

Defaults live in `cordis.patch.yml`. Override the same keys in the profile's `cordis.patch.yml`:

```yaml
- id: charter
  config:
    maxPromptBytes: 8192
    maxObjectiveBytes: 4096
    maxItemBytes: 1024
    contextOrder: 130
```

| Field | Default | Meaning |
| --- | ---: | --- |
| `maxPromptBytes` | 8192 | UTF-8 budget for the charter contribution only (excludes history, system, tools, and other contexts) |
| `maxObjectiveBytes` | 4096 | UTF-8 budget for the objective |
| `maxItemBytes` | 1024 | per-item text budget |
| `maxItems` | 512 | all-items storage limit |
| `maxPendingItems` | 512 | pending-items limit; `0` disables new proposals |
| `maxRecordBytes` | 1048576 | one Session record including bounded history/receipts; shown in the pane |
| `maxOps` | 1024 | operations per Apply |
| `historyLimit` | 64 | recent history receipts |
| `maxHistoryBytes` | 131072 | recent history bytes |
| `mutationLimit` | 128 | recent mutation receipts |
| `contextOrder` | 130 | runtime-context order; after sandbox/approval/subagent by default |

The only model-visible capacity is `maxPromptBytes`; active item counts are not capped separately. Storage is
bounded by `maxItems`, `maxPendingItems`, and `maxRecordBytes`. Values that would make a Session ready but
permanently uneditable are raised to documented minimums with a Host warning.

### 4.1 Budgets and overflow

While the Charter tab is active it owns the reading surface: the chat composer is hidden and its unsent draft is
preserved; switching back to **Chat** restores the composer and the draft. Approval, question, and plan-review
seats remain visible.

The tab shows a live context meter and per-field byte counters. Nothing is silently truncated:

- Long history-draft items are split into multiple candidates at sentence/clause boundaries; every candidate is
  preserved. An over-limit candidate is highlighted and Apply stays disabled until you shorten it.
- The objective is kept whole. If it exceeds `maxObjectiveBytes`, the draft shows the full text and an over-limit
  message; shorten it before applying.
- If candidates do not fit the context budget, the candidates that fit become active and the rest are saved as
  **pending proposals**. Apply remains available; nothing is rejected, truncated, dropped, or re-summarized.
  Review and accept the proposals when you have context room.
- The objective, per-item byte limits, and storage/atomic limits remain hard gates; the UI shows the exact
  problem and Apply stays disabled only for those real limits.

Raise the budgets in the profile when your charter needs more room.

### 4.2 Over-budget records

Budgets are admission policy, not record validity. If a profile lowers a limit after records exist, the
affected Session shows an **over-budget** state: its view remains readable, the Host does not inject the
charter into the prompt, and the Pane explains the state. Adding content is rejected, while archive, purge, and
shorten operations are admitted until the record fits again. The editor compares against the previous value, so
an objective or same-id item may be submitted while still above the limit as long as it strictly shrinks. The
record ceiling is shown in **Context**.

## 5. Data and privacy

- Authority: the `sessions` table in the `dsh_charter_v1` domain, one record per Session.
- The record contains the objective, items, derived `promptText`/digest, recent history, and mutation receipts.
- The record is bound to `createdAt`, `cwd`, and `parentSession`; reusing a Session id with a different
  lifecycle rejects reads and overwrites.
- Ordinary logs contain stable ids, kinds, revisions, and error codes only; never user body text.
- Model-visible context excludes revision, time, verification, origin, evidence, and counts.

## 6. Degradation and troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| Pane stays at `Loading charter...` | Session not initialized or initialization blocked | Check `charter:` lines in Host logs; confirm the Session is alive |
| Charter pane is blank after a plugin update | Browser bundle and Host bundle are from different revisions (especially after a manual profile install) | Fully restart `dsh web` / DeepSeek Harness so the new Host loads; refreshing only the browser may not restart it |
| `unavailable` + lifecycle mismatch | Same id, different Session lifecycle | Old record is not read; the new Session uses a new record |
| Pane says the Session is not live / read-only | The Session belongs to another DSH process (for example Desktop) and is not loaded in this Web process | Create or start a Session in Web; the tab upgrades to editable automatically |
| `unavailable` + inner schema/consistency-invalid record | The stored wrapper is readable, but its inner record has unknown fields, a wrong shape, or derived digest/history/state inconsistency | No injection. While the inner record stays invalid it is isolated and its raw bytes are preserved (never overwritten by this plugin). After repairing it, the next view/initialize re-parses it and the Session recovers without a Host restart |
| `unavailable` or silently empty after an outer record error | The storage file itself is malformed/truncated or its outer version stamp is rejected (the JSON backend cannot read the wrapper at all) | **Known overwrite risk, not repaired by this plugin**: the backend reads the file as absent and a later initialization can write a fresh record over it. Stop the Host immediately, back up `storages/dsh_charter_v1/sessions/<id>.json`, repair it from the backup, then restart. Do not keep running and letting the plugin initialize that Session |
| `unavailable` + semantic corruption | Derived digest/history/state inconsistency inside an otherwise schema-valid record | Reparse cannot repair this. Inspect storage and repair the record manually, then restart the Host if the in-memory Session still holds the bad revision; no injection in the meantime |
| `unavailable` + lifecycle mismatch | Same Session id with a different `createdAt`/`cwd`/parent identity | This is not corruption and must not be overwritten. The old record is not read; the new lifecycle gets its own record |
| Apply returns `REVISION_CONFLICT` | Another commit happened first | Draft is preserved. Close the open editor first — while it is open the **Apply draft to revision N** action is hidden because the editor keeps the revision you reviewed. Then re-target the same ops at the latest revision. A reviewed history draft is not rebased: it becomes stale and must be re-extracted at the new revision. An unknown-outcome retry keeps the same mutation id, so it cannot duplicate items |
| Apply returns `QUOTA_EXCEEDED` | Prompt, per-item, or storage/batch limit exceeded | Check the highlighted field; reduce candidates or raise the relevant limit. Active item counts are not capped |
| `charter_read` returns `UNAVAILABLE` | Storage not ready or record unavailable | The Session remains usable; retry after repair |
| No Charter tab | Client bundle not loaded/injected, or blank Session | Check `dsh --profile web --dump-config` for `charter`; send a message to start the Session; refresh |
| Authorization concern on 0.1.7-rc.2 / 0.2.0 | Gateway has no `@Remote.resources` | Upgrade to 0.2.1+, or use a trusted single-operator environment |

Startup or write failures never roll back Session creation and never block ordinary conversation. When Charter
is unavailable the Host injects no context and the UI shows an explicit state.

## 7. Verify it works

1. Set an objective in the **Charter** tab and Apply.
2. Continue the Session for several turns to trigger compaction.
3. Reopen the Charter tab and confirm the objective/invariants are still present.
4. Ask the model to call `charter_read` (or ask "what is the current charter?"); confirm standing content is
   visible.
5. Confirm Host logs contain no `charter:` errors.
6. For transcript-level evidence, run `npm run verify:compaction` after the first post-compaction message. It
   compares the persisted runtime-context snapshot with the storage authority (see the verification record,
   section 8).
7. Restart DSH, reopen the same Session, and confirm the revision and body are unchanged.

Re-materialization after compaction is performed by DSH's runtime-context projection. The plugin guarantees
that every assembly reads the storage authority and that the UI preview uses the same renderer.

## 8. Uninstall

```bash
dsh plugin --profile web remove dsh-charter
```

After uninstalling:

- the durable record remains in storage and is not deleted;
- open Sessions still resume and continue normally;
- reinstalling reads the same record for the same Session.

UI Purge is **per-item only**: it cannot remove the objective, the record identity/revision, or a whole Session
record. To delete charter data permanently, stop DSH and remove the corresponding `dsh_charter_v1` domain
record (or the whole profile storage directory) after verifying the path.

## 9. Development

```bash
npm run typecheck
npm test
npm run build
```

- Core logic must not depend on Cordis, Session, storage, React, or LLM;
- inject time, UUID, actor, and Session lookup at the boundary;
- new UI styles use the `charter-` prefix and DSH semantic tokens;
- never put user body text into the system prompt;
- do not add write capability for the model without redesigning approval and resource authorization.
