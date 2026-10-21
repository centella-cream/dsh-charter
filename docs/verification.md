# `dsh-charter` Verification Record

English | [中文](verification.zh.md)

Verification date: 2026-10-20.
Environment: macOS, Node `v22.23.1`, npm `12.0.2`, pnpm `12.3.4`; current Desktop runtime DSH `0.2.0-rc.2`.
Local development dependency baseline: DSH `0.2.1-rc.2`.

This document records reproducible commands and results. Temporary directories, profiles, tarballs, and fetched
HTML live under `.tmp/` and are excluded from the published package.

## 1. Conclusion

| Item | Result |
| --- | --- |
| Strict TypeScript check (5 DSH versions) | Pass |
| Vitest (5 locally available versions × 78 tests) | Pass |
| Host ESM build + browser single-file bundle | Pass |
| Remote decorator/resource smoke | Pass (0.1.7/0.2.0 have no resource declaration, as expected) |
| Browser factory-bundle materialization and `apply` smoke | Pass |
| Real DSH profile install/compose/start (0.1.7-rc.2 / 0.2.0-rc.2) | Pass |
| Web boot graph and `/plugins` serving | Pass |
| Real browser UI (0.2.0-rc.2 Web profile) | Pass: tab order, zh/en switch, objective/invariant editing, preview, Apply, reload persistence; section 7 |
| Read-only stored view for a non-live Session | Pass: composition test covers stored view and live upgrade |
| History draft from a compaction summary | Pass: core parser + composition test on a real Session event; section 4.4 |
| Real model + compaction end-to-end | **Not completed**; requires a working model session; section 8 |

## 2. Local baseline

```bash
npm run typecheck
npm test
```

Results:

- typecheck passes;
- build passes;
- 13 test files, 78 tests pass;
- `remote-smoke` asserts `watch,bootstrap,edit`, stream mode, and Session resource;
- `client-smoke` asserts the single-file factory bundle, external-dependency allowlist, no Node-only `Buffer`
  reference, and `apply` registering the tab/pane/Remote contribution.

Key test files:

| File | Coverage |
| --- | --- |
| `tests/core/commands.spec.ts` | objective, items, supersede, transitions, purge lifecycle guard, whole-batch rollback |
| `tests/core/record.spec.ts` | atomic commit, idempotency, revision, history pruning, tamper detection |
| `tests/core/prompt.spec.ts` | deterministic rendering, `{{` escaping, UI preview/Host render parity |
| `tests/core/normalize-render.spec.ts` | NFC, control characters, byte limits, 100-render stability |
| `tests/core/state.spec.ts` | supersede chain must point at a current successor |
| `tests/core/fork.spec.ts` | fork id re-minting and supersede remapping |
| `tests/core/bootstrap.spec.ts` | section extraction, latest objective, UTF-8 split/no truncation, latest/broken summary, fallback to an older usable summary |
| `tests/host/composition.spec.ts` | real Cordis/Storage/SystemPrompt/Tools composition, user-role boundary, actor policy, fork, idempotency, quota, parent-cycle rejection, lifecycle, non-live stored view + live upgrade, draft from a real `compaction/summary` event, bounded `charter_read` |
| `tests/host/watch.spec.ts` | opening snapshot, race, dedupe, abort, decorator compatibility |
| `tests/host/actor.spec.ts` | 0.1.7/0.2.0 no-principal fallback, non-owner recording |
| `tests/host/remote.spec.ts` | Remote descriptor, wire schema, and a legacy Host view snapshot |
| `tests/client/store.spec.ts` | accept committed view immediately, ignore stale/duplicate revisions, release a Session source |
| `tests/client/bootstrap-plan.spec.ts` | overflow candidates stay in one plan; active prefix fits the byte budget |

## 3. Cross-version matrix

Each version uses its own directory and `node_modules`:

```text
.tmp/compat/017rc2/proj
.tmp/compat/020rc1/proj
.tmp/compat/020rc2/proj
.tmp/compat/021rc1/proj
.tmp/compat/021rc2/proj
```

Copy source (excluding `node_modules`, `lib`, `.build-ts`, `.tmp`), link the version's `node_modules` into
`proj`, then run:

```bash
./node_modules/.bin/tsc --noEmit
npm run build
./node_modules/.bin/vitest run
```

Results:

| Version | typecheck | build | Vitest | remote smoke | client smoke |
| --- | --- | --- | --- | --- | --- |
| `0.1.7-rc.2` | Pass | Pass | 78/78 | Pass (no-resources warning) | Pass |
| `0.2.0-rc.1` | Pass | Pass | 78/78 | Pass (no-resources warning) | Pass |
| `0.2.0-rc.2` | Pass | Pass | 78/78 | Pass (no-resources warning) | Pass |
| `0.2.1-rc.1` | Pass | Pass | 78/78 | Pass | Pass |
| `0.2.1-rc.2` | Pass | Pass | 78/78 | Pass | Pass |

`0.1.7-rc.2` and `0.2.0` remote smoke prints:

```text
remote-smoke: this DSH generation has no @Remote resources; per-Peer Session authorization is unavailable (expected on 0.1.7/0.2.0).
```

`0.2.1` prints no warning and asserts `resources.session` on both methods.

Reproduce a version directory (example):

```bash
mkdir -p .tmp/compat/020rc2
cd .tmp/compat/020rc2
printf '{"name":"compat-020rc2","private":true,"type":"module"}\n' > package.json
pnpm add --store-dir ../../pnpm-store \
  @deepseek-ai/cordis@4.0.4 \
  @deepseek-ai/dsh-agent@0.2.0-rc.2 \
  @deepseek-ai/dsh-agent-loop@0.2.0-rc.2 \
  @deepseek-ai/dsh-api-gateway@0.2.0-rc.2 \
  ... # remaining dsh-* packages at the same version
cd ../..
rsync -a --exclude node_modules --exclude lib --exclude .build-ts --exclude .tmp ../../ ./proj/
ln -sfn ../node_modules ./proj/node_modules
```

The full package list is in `.tmp/compat/020rc2/package.json`, or replace versions in the root `devDependencies`.

## 4. Prompt boundary and compaction recovery

### 4.1 user-role boundary

`tests/host/composition.spec.ts` verifies against a real `SystemPrompt` assembly:

- `assembly.contexts` contains `charter:standing`;
- `renderContextSnapshot(assembly)` contains the charter body;
- `renderPrompt(assembly)` and `assembly.sections` do not contain it;
- re-assembly produces identical bytes;
- after an edit, re-assembly reads the new objective and no longer contains the old one.

User body enters runtime context (user role) only, never the system-role prompt.

### 4.2 `{{...}}` interpolation safety

The same test writes `Mention {{name}} and {{unknown}} literally in the docs`, then assembles on
`0.1.7-rc.2` and `0.2.0-rc.2` `SystemPrompt`. Results:

- assembly does not throw an unknown prompt variable;
- rendered text contains no `{{name}}`;
- JSON contains `\u007b{name}`;
- `JSON.parse` restores the original text.

`0.2.1+` additionally sets `interpolate:false`; escaping makes both versions behave identically.

### 4.3 Re-materialization after compaction

Every assembly's `text` provider calls `charter.promptText(session)`, which synchronously reads the storage
authority and validates the derived digest; it reads no Session summary or retained-snapshot cache. DSH
`0.2.0-rc.2` `RuntimeContextProjection` clears retained when the retained snapshot is shadowed by
replacement/compaction, and the next `project()` regenerates text from current providers.

Therefore:

- unit/composition level verifies "every assembly reads authority" and "re-assembly is byte-stable";
- platform level verifies the runtime-context re-materialization path;
- **not yet** executed: a full compaction on a real model session, followed by observing subsequent requests.

### 4.4 History draft from a compaction summary

`tests/core/bootstrap.spec.ts` uses a representative summary to verify:

- `Latest correction` is preferred as the objective, then `Original`, then the first paragraph;
- Primary Request user-want bullets and requirement-like Critical Context lines become candidate invariants;
- Pending Jobs / Next Step bullets become candidate deliverables;
- text over the per-item byte limit is split into multiple candidates at sentence/clause/code-point boundaries without dropping content;
- malformed/empty summaries are skipped and the latest usable summary wins;
- unstructured text can still be an objective, but no items are fabricated.

`tests/host/composition.spec.ts` appends a `compaction/summary` event to a real Session, calls
`service.bootstrap()`, and verifies the objective/deliverables and `shadowedTokenCount` source metadata. It also
confirms the call itself does not change the revision or write storage; only a user Apply turns the draft into
revision 1 through the normal atomic edit.

The UI auto-draft panel depends on a client `useEffect` and the Remote bootstrap method. This round did not build a
live, already-compacted Session for a browser screenshot; the client passes typecheck/build and the Remote
passes contract tests. The UI behavior on a real compacted Session still needs a manual pass in the target
profile.

## 5. Browser bundle verification

The DSH Web module loader requires:

- a single file;
- `window.__ModuleLoader__.load({ id, factory })`;
- `require()` inside the factory for the baseline (React) and `dsh.client.external` dynamic modules;
- no relative chunks or standalone CSS import.

Post-build checks:

```bash
head -3 lib/client.js
grep -n "^import\|require(\"" lib/client.js | head
ls lib/*.css
```

Results:

- `lib/client.js` starts with `window.__ModuleLoader__.load({ id: 'dsh-charter', factory: (require) => {`;
- only `react`, `react/jsx-runtime`, and `@deepseek-ai/dsh-api-gateway/client` are required;
- zod is bundled; no `require("zod")`;
- no relative `require`;
- `lib/client.css` is inlined and removed;
- CSS is injected inside the factory with `data-plugin-css="dsh-charter/charter.css"`; repeated materialization
  does not insert it twice.

`scripts/verify/client-smoke.mjs` executes the real bundle with a fake module loader and fake client context:

- `registration.id === 'dsh-charter'`;
- the factory requests only allowlisted modules;
- exports `apply` and `inject`;
- `apply` registers the `conversation.view` `charter` entry, pane component, and Remote contribution;
- with existing tabs chat 0 / trajectory 10 / context 20, `charter` is last;
- after a simulated later `fleet` tab, `charter` re-registers last and does not duplicate;
- Chinese label is `会话契约`; English label is `Charter`.

The pane's full dictionary is typed against `LocaleNamespaceMap`; TypeScript rejects a missing key in either
language.

## 6. Real profile smoke

### 6.1 Create an isolated profile

```bash
mkdir -p .tmp/smoke/home
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --from-default-profile web --dump-config > /dev/null
```

The generated `profiles/smoke/package.json` contains `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`.

### 6.2 Install the tarball

```bash
npm pack --pack-destination .tmp/smoke
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh plugin --profile smoke add "$PWD/.tmp/smoke/dsh-charter-0.1.0.tgz"
```

Install succeeds; the profile `bundles` gains `dsh-charter`; DSH compatibility accepts the peer range.

### 6.3 Composition check

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --dump-config | grep -A 20 'id: charter'
```

Output contains:

```yaml
- id: charter
  name: dsh-charter
  config: { ... }
- id: charter-remote
  name: dsh-charter/remote
```

### 6.4 Startup and HTTP

```bash
env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_WEB_URL \
  DSH_HOME="$PWD/.tmp/smoke/home" \
  dsh --profile smoke --no-open --port 19388
```

The log prints a token URL. After opening it:

- `/` returns 200;
- the `__DSH_BOOT__` entries contain:

```json
{
  "id": "dsh-charter",
  "url": "plugins/??dsh-charter/client.js&rev=...",
  "inject": [
    "@deepseek-ai/dsh-api-gateway",
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-conversation",
    "@deepseek-ai/dsh-client-ui-renderer",
    "@deepseek-ai/dsh-client-ui-session",
    "@deepseek-ai/dsh-client-ui-slots"
  ],
  "external": ["@deepseek-ai/dsh-api-gateway/client"]
}
```

- `plugins/??dsh-charter/client.js&rev=...` returns 200 and starts with `window.__ModuleLoader__.load`.

This proves Host composition, client-bundle publishing, boot graph, and external dependency declarations.

### 6.5 Two starts and uninstall recovery

Start the same profile twice: the `dsh-charter` `rev` is unchanged, both `/` return 200, and both client
entries return 200 with the loader prefix.

Then:

```bash
dsh plugin --profile smoke remove dsh-charter
```

Profile `bundles` returns to `dsh-base` + `dsh-web-app`; restarting `dsh web` still returns 200 and the boot
graph contains zero `"id":"dsh-charter"` entries. Uninstall does not break profile startup.

Finally reinstall from `dist/dsh-charter-0.1.0.tgz` and start once: `/` returns 200, the boot graph contains the
`inject`/`external` entries, and the client entry returns 200 with the inline CSS marker
`data-plugin-css="dsh-charter/charter.css"`.

### 6.6 DSH 0.1.7-rc.2 profile

Install the matching CLI:

```bash
mkdir -p .tmp/dsh017
cd .tmp/dsh017
pnpm add --store-dir ../pnpm-store --config.dangerously-allow-all-builds=true @deepseek-ai/dsh@0.1.7-rc.2
./node_modules/.bin/dsh --version   # 0.1.7-rc.2
```

Create an isolated profile and install the tarball:

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --from-default-profile web --dump-config > /dev/null
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  plugin --profile smoke017b add "$PWD/dist/dsh-charter-0.1.0.tgz"
```

The first attempt with an older tarball was rejected because its peer range only covered 0.2.x. After adding
`0.1.7-rc.2` to `peerDependencies` and repacking, the new profile installs successfully. This confirms DSH's
compatibility check runs before install.

Start:

```bash
DSH_HOME="$PWD/.tmp/smoke017/home" .tmp/dsh017/node_modules/.bin/dsh \
  --profile smoke017b --no-open --port 19389
```

Results: `/` returns 200; the boot graph contains `dsh-charter` `inject` and
`external:["@deepseek-ai/dsh-api-gateway/client"]`; the client entry returns 200 and starts with
`window.__ModuleLoader__.load`. Remote smoke prints the expected no-resource warning.

After adding the `conversation.view` tab, a new profile `smoke017c` installed the final tarball: the boot graph
`inject` contains `@deepseek-ai/dsh-client-locale` and `@deepseek-ai/dsh-client-ui-conversation`, the client
bundle contains dynamic reordering (`ensureLast`), and `/` plus the client entry both return 200.

## 7. Browser UI (0.2.0-rc.2 Web profile)

With user-approved out-of-sandbox access, a local Chrome instance was driven with headless CDP against an
isolated Web profile:

```bash
# Chrome at desktop size, CDP port 9223
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --disable-crash-reporter \
  --window-size=1440,900 --remote-debugging-port=9223 \
  --user-data-dir="$PWD/.tmp/webview/chrome-desktop" about:blank

# Web profile on 19391, opening the existing test Session
DSH_HOME="$PWD/.tmp/webview/home" dsh --profile charterweb2 --no-open --port 19391
```

CDP performed real mouse, keyboard, and navigation actions.

### 7.1 Tab placement and names

Actual tab-bar text:

```text
Chat    Trajectory    Charter
```

- Charter follows Chat and Trajectory;
- after installing `dsh-context@0.73.3`, the actual order becomes
  `Chat / Trajectory / Context / Fleet / Charter`, with Charter still last;
- Chinese label is `会话契约`; English label is `Charter`; both come from `dsh-client-locale`;
- `client-smoke` also simulates a later tab: the plugin disposes and re-registers to become last again with no
  duplicate entry;
- a blank Session hides the View tab bar; it appears after the first message.

Screenshots: [Chinese pane](assets/charter-pane.png), [English pane](assets/charter-pane.en.png).

### 7.2 Objective editing, preview, and Apply

> The 191 B / 220 B values below are from the pre-redesign functional run; the 7.6 screenshots use a later
> 47 B objective and 240 B context.

In the Charter tab:

1. click **Set objective**, enter `Ship the charter tab safely`, click **Stage**;
2. the pane shows `1 staged change`;
3. click **Preview context**: `191 bytes`, body
   `{"objective":"Ship the charter tab safely","invariants":[],"deliverables":[]}`;
4. click **Apply**: revision `0` → `1`, objective shown as current, message `Saved revision 1.`;
5. header stats change from `0 B context` to `191 B context`.

### 7.3 Add an invariant and persist across reload

1. enter `Do not break the public API` under **Invariants**, click **Stage item**;
2. click **Apply**: revision becomes `2`, showing `1 active / 1 stored`, `220 B context`;
3. reload the page and reopen the same Session: still `rev 2`, objective `Ship the charter tab safely`, and
   invariant `Do not break the public API`;
4. tab order is still Chat / Trajectory / Charter.

This proves the browser UI → Remote → Host service → storage domain → re-assembly/UI chain.

### 7.4 Chinese/English switch

Switch DSH from Chinese to English in the same Web profile (Settings → Language → English) without reloading:

- tab changes from `会话契约` to `Charter`;
- pane changes from `会话会话契约 / 目标 / 硬约束 / 1 条约束 / 预览上下文 / 应用` to
  `SESSION CHARTER / OBJECTIVE / INVARIANTS / 1 constraint / Preview context / Apply`;
- stats, statuses, buttons, placeholders, and error-code messages all come from the same `dsh-charter` locale
  namespace;
- after a page reload the preference remains English and the tab/pane stay English.

Chinese screenshot: [charter-pane.png](assets/charter-pane.png). English screenshot:
[charter-pane.en.png](assets/charter-pane.en.png). User-entered objective/constraint body is data and is not
translated.

### 7.6 Redesigned UI and budget verification

The redesigned pane was exercised in the same Web profile at 1440×757 in both light and dark appearance, and in
Chinese and English:

- branded page header (mark, `Charter`, slogan) with revision/active/stored chips and a live
  `240 B / 8.0 KiB context` meter;
- sticky Preview/Discard/Apply toolbar visible above the scrolling content;
- left section navigation: Overview / Objective / Invariants / Deliverables / Context, plus History only when a
  draft exists;
- an Overview dashboard with objective, invariant/deliverable cards, and a budget breakdown, so a large history
  draft no longer pushes the working sections down;
- focused Objective and item tabs with inline add composers and `0 B / 1.0 KiB` counters;
- hover/focus-revealed item actions (Edit / Replace / Archive / Verify);
- while Charter is active the chat composer is hidden, and an unsent draft survives switching back to Chat;
- light/dark themes driven entirely by DSH semantic tokens.

Screenshots: [Chinese light](assets/charter-pane.png), [English light](assets/charter-pane.en.png).

Budget behavior beyond the parser split is enforced in the client: over-limit fields are marked, the draft
preview is rendered through the same prompt renderer, and Apply is disabled while an item, the objective, the
selected draft, or the projected context exceeds its budget. The automated coverage for the split/whole-objective
policy is in `tests/core/bootstrap.spec.ts`; the over-limit UI itself was not driven through a browser in this
round.

### 7.5 Notes

- The test used a syntactically valid but uncredited API key, so Chat shows a model-request failure; this is a
  model-call issue and does not affect Charter editing/Apply.
- Not yet automated in the browser: concurrent conflict in two tabs, two-Session isolation, and per-version
  interaction on 0.1.7/0.2.1. Host/Remote tests cover the logic; a manual pass in the target profile is still
  recommended.

## 8. Unfinished compaction end-to-end

A full compaction needs a working model provider and a long enough conversation. This round made no model
requests. Suggested flow:

1. set an objective and 2-3 invariants in a test Session;
2. continue the conversation and run `/compact` (or let automatic compaction trigger);
3. after compaction check:
   - the Charter pane still shows the same revision/body;
   - `charter_read` returns standing content;
   - the system prompt contains no charter body;
   - the next request's runtime context contains the full charter;
4. restart DSH, reopen the Session, and re-check revision and body.

Platform basis: `@deepseek-ai/dsh-agent-loop@0.2.0-rc.2` `RuntimeContextProjection` clears retained after a
replacement/compaction shadows the snapshot and regenerates on the next request; this plugin reads the storage
authority on every provider call.

## 9. Unsupported verification

- Multi-process live storage sync: `domain/changed` is process-local; the plugin is designed for one Host
  process.
- Whether the real model obeys the charter: the charter is a declaration, not a behavior guarantee.
- Permanent audit: bounded history/mutation receipts are not an audit log.
- Real-sample quota calibration: defaults are product initial values.

## 10. Cleanup

```bash
rm -rf .tmp
```

`.tmp/` is excluded from git and the npm package.
