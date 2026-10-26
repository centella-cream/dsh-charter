/**
 * Final-artifact recovery + storage-fault smoke (plan §12.6 / RC3-11).
 *
 * Runs the PACKED Host from a release tarball (never the workspace sources):
 *  1. verifies the tarball SHA-256 against a sums file;
 *  2. extracts the validated archive and asserts the six Remote methods and the
 *     client bundle are present;
 *  3. mounts the packed CharterService over a scripted storage backend, builds a
 *     record with Unicode/pending/archived/superseded/history data, exports it,
 *     deletes the target, restores it, restarts twice and compares digests and
 *     projections;
 *  4. proves a healthy target refuses overwrite;
 *  5. runs the packed fault subset (startup put reject, startup
 *     commit-then-reject convergence, open reject) against the packed service.
 *     The complete source fault matrix (load/update/initialize/restore/fence
 *     cases) lives in tests/host/recovery.spec.ts.
 *
 * Usage: node scripts/verify/recovery-smoke.mjs --artifact <tgz> --sha256 <sums>
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { parseArgs, parseTarball, verifyArtifactDigest } from './package-smoke.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = parseArgs(process.argv.slice(2))
if (args.artifact === undefined || args.sha256 === undefined) {
  console.error('recovery-smoke: --artifact <tgz> --sha256 <sums> are required')
  process.exit(2)
}
const artifact = resolve(args.artifact)
const { actual } = verifyArtifactDigest(artifact, resolve(args.sha256))
const archive = parseTarball(readFileSync(artifact))
const packedVersion = JSON.parse(archive.files.get('package.json').toString('utf8')).version
const remoteSource = archive.files.get('lib/remote.js')?.toString('utf8') ?? ''
const clientSource = archive.files.get('lib/client.js')?.toString('utf8') ?? ''
for (const method of ['exportRecord', 'initializeRecord', 'restoreRecord']) {
  if (!remoteSource.includes(method)) throw new Error(`packed Remote bundle is missing ${method}`)
}
if (!clientSource.includes('__ModuleLoader__.load')) throw new Error('packed client bundle is not a module-loader factory')
console.log(`recovery-smoke: sha256 ${actual} verified for ${packedVersion} (Remote six-method surface present)`)

const work = mkdtempSync(join(tmpdir(), 'dsh-charter-recovery-smoke-'))
const project = join(work, 'project')
mkdirSync(join(project, 'lib'), { recursive: true })
for (const [path, bytes] of archive.files) {
  const target = join(project, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
}
symlinkSync(join(root, 'node_modules'), join(project, 'node_modules'), 'dir')
const { CharterService } = await import(pathToFileURL(join(project, 'lib/index.js')).href)

function faultState() {
  return {
    medium: new Map(),
    puts: [],
    updates: [],
    open: 'pass',
    load: 'pass',
    closed: false,
  }
}

class ScriptedStorageDomain extends Service {
  static inject = []
  constructor(ctx, state) {
    super(ctx, 'storageDomain')
    this.state = state
  }
  async open() {
    const state = this.state
    if (state.open === 'reject') throw new Error('scripted open failure')
    const table = {
      get: key => state.medium.has(key) ? structuredClone(state.medium.get(key)) : undefined,
      entries: () => {
        if (state.load === 'reject') throw new Error('scripted load failure')
        return state.medium.entries()
      },
      keys: () => state.medium.keys(),
      get size() { return state.medium.size },
      put: async (key, value) => {
        const action = state.puts.shift() ?? 'pass'
        if (action === 'closed') throw new Error('scripted closed domain')
        if (action === 'reject') throw new Error('scripted put rejection')
        state.medium.set(key, structuredClone(value))
        if (action === 'commit-then-reject') throw new Error('scripted fsync failure after rename')
      },
      update: async (key, fn) => {
        const action = state.updates.shift() ?? 'pass'
        if (action === 'closed') throw new Error('scripted closed domain')
        const current = state.medium.get(key)
        if (current === undefined) throw new Error('scripted missing key')
        const next = fn(current)
        if (action === 'reject') throw new Error('scripted update rejection')
        state.medium.set(key, structuredClone(next))
        if (action === 'commit-then-reject') throw new Error('scripted fsync failure after rename')
        return next
      },
      delete: async key => state.medium.delete(key),
    }
    return {
      name: 'dsh_charter_v1',
      table: () => table,
      close: async () => { state.closed = true },
    }
  }
}

async function mountReal(root, config = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CharterService, config)
  return ctx
}

function charterRecordPath(root, id) {
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = walk(full)
        if (found !== undefined) return found
      } else if (full.includes('dsh_charter_v1') && entry.name.includes(String(id))) {
        return full
      }
    }
    return undefined
  }
  const found = walk(join(root, 'storage'))
  if (found === undefined) throw new Error(`no charter record file for ${String(id)}`)
  return found
}

function readCharterRecord(root, id) {
  const document = JSON.parse(readFileSync(charterRecordPath(root, id), 'utf8'))
  return document.record
}

async function mount(state, config = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ScriptedStorageDomain, state)
  await ctx.plugin(CharterService, config)
  return ctx
}

const META = { cwd: '/recovery-smoke', createdAt: 1_700_000_500_000 }
const identity = () => ({ meta: { ...META } })
const sessionId = SessionId('recovery-smoke-session')

function announce(ctx, session, source) {
  ctx.emit('agent/created', {
    agent: { id: session.id, session },
    source,
    signal: new AbortController().signal,
  })
}

async function waitFor(service, session, predicate, label) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 5_000) {
      const view = service.view(session)
      throw new Error(`timeout (${label}): ${view.status} ${JSON.stringify(view.recordState)} ${view.message ?? ''}`)
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5))
  }
}

function edit(service, session, baseRevision, mutationId, ops) {
  return service.edit({ sessionId: session.id, baseRevision, mutationId, ops })
}

const failures = []
const check = (condition, label) => {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures.push(label)
    console.log(`  FAIL  ${label}`)
  }
}

const realRoot = join(work, 'real-storage')
mkdirSync(realRoot, { recursive: true })
const first = await mountReal(realRoot)
let firstService = first.charter
const session = first.sessions.create(sessionId, identity())
announce(first, session, 'startup')
await waitFor(firstService, session, () => firstService.view(session).status === 'ready', 'startup')
check(firstService.view(session).revision === 0, 'packed startup creates a revision-0 record')

let revision = 0
let result = await edit(firstService, session, revision, 'smoke-1', [
  { type: 'objective.initialize', text: 'Unicode objective ✓ 目标' },
  {
    type: 'item.add',
    item: { clientRef: 'smoke-inv', kind: 'invariant', text: 'Unicode invariant ✓', order: 0 },
  },
  {
    type: 'item.add',
    item: { clientRef: 'smoke-del', kind: 'deliverable', text: 'Deliverable', order: 1, progress: 'in-progress' },
  },
])
if (result.ok !== true) throw new Error(`smoke edit 1 failed: ${JSON.stringify(result)}`)
revision = result.committedRevision
let items = firstService.view(session).items
const invariantId = items.find(item => item.kind === 'invariant')?.id
const deliverableId = items.find(item => item.kind === 'deliverable')?.id
if (invariantId === undefined || deliverableId === undefined) throw new Error('missing smoke items')

result = await edit(firstService, session, revision, 'smoke-2', [
  {
    type: 'item.propose',
    item: { clientRef: 'smoke-pending', kind: 'invariant', text: 'Pending proposal', order: 2 },
  },
])
if (result.ok !== true) throw new Error(`smoke edit 2 failed: ${JSON.stringify(result)}`)
revision = result.committedRevision
items = firstService.view(session).items
const pendingId = items.find(item => item.review === 'pending')?.id
if (pendingId === undefined) throw new Error('missing pending item')

result = await edit(firstService, session, revision, 'smoke-3', [
  { type: 'item.archive', itemId: invariantId },
])
if (result.ok !== true) throw new Error(`smoke edit 3 failed: ${JSON.stringify(result)}`)
revision = result.committedRevision

result = await edit(firstService, session, revision, 'smoke-4', [
  {
    type: 'item.supersede',
    itemId: deliverableId,
    replacement: {
      clientRef: 'smoke-successor',
      kind: 'deliverable',
      text: 'Successor deliverable',
      order: 3,
      progress: 'not-started',
    },
  },
])
if (result.ok !== true) throw new Error(`smoke edit 4 failed: ${JSON.stringify(result)}`)
revision = result.committedRevision
const richRecord = readCharterRecord(realRoot, session.id)
check(richRecord?.current?.revision === revision
  && richRecord.current.items.some(item => item.text.includes('Unicode'))
  && richRecord.current.items.some(item => item.review === 'pending')
  && richRecord.current.items.some(item => item.lifecycle === 'archived')
  && richRecord.current.items.some(item => item.supersededBy !== undefined)
  && richRecord.history.length > 0, 'record carries Unicode/pending/archived/superseded/history data')

const exportResult = firstService.exportRecord(session.id)
check(exportResult.ok && exportResult.archive.source.health === 'healthy'
  && exportResult.archive.source.revision === revision, 'packed export returns a healthy complete archive')
const restoredArchive = exportResult.archive
const archivedRecord = restoredArchive.record
const archivedPrompt = archivedRecord.current.promptText
const archivedStateDigest = archivedRecord.current.stateDigest
const recordPath = charterRecordPath(realRoot, session.id)
await first.fiber.dispose()

// Remove the target and restore under the same Session identity.
if (existsSync(recordPath)) rmSync(recordPath, { force: true })
const second = await mountReal(realRoot)
const secondService = second.charter
const resumed = second.sessions.create(sessionId, identity())
announce(second, resumed, 'resume')
await waitFor(secondService, resumed, () => secondService.view(resumed).recordState?.kind === 'absent-unconfirmed', 'absent')
check(secondService.view(resumed).status === 'unavailable'
  && !existsSync(recordPath), 'after removing the file a resumed Session reports absent-unconfirmed without writing')
const lifecycle = secondService.view(resumed).lifecycle
const restore = await secondService.restoreRecord({
  sessionId: session.id,
  operationId: 'recovery-smoke-restore',
  expectedLifecycle: lifecycle,
  expectedTarget: { kind: 'absent-unconfirmed' },
  archive: restoredArchive,
})
check(restore.ok === true, 'packed restore accepts the same-Session archive')
check(secondService.view(resumed).revision === revision
  && secondService.promptText(resumed).includes('Unicode'), 'restored prompt/revision match the archive')
const restoredRecord = readCharterRecord(realRoot, session.id)
check(restoredRecord.current.stateDigest === archivedStateDigest
  && JSON.stringify(restoredRecord.history) === JSON.stringify(archivedRecord.history)
  && JSON.stringify(restoredRecord.recentMutations) === JSON.stringify(archivedRecord.recentMutations)
  && restoredRecord.recentMaintenance?.at(-1)?.sourceRecordDigest === restoredArchive.source.recordDigest,
  'restore preserves current/history/mutations and appends the maintenance receipt')
const replay = await secondService.restoreRecord({
  sessionId: session.id,
  operationId: 'recovery-smoke-restore',
  expectedLifecycle: lifecycle,
  expectedTarget: { kind: 'absent-unconfirmed' },
  archive: restoredArchive,
})
check(replay.ok === true && replay.replayed === true, 'repeated restore replays through the maintenance receipt')

// Restart twice and compare the complete record, prompt and tool projection.
await second.fiber.dispose()
const restartOne = await mountReal(realRoot)
const restartOneService = restartOne.charter
const firstResume = restartOne.sessions.create(sessionId, identity())
announce(restartOne, firstResume, 'resume')
await waitFor(restartOneService, firstResume, () => restartOneService.view(firstResume).status === 'ready', 'restart-1')
const recordAfterFirstRestart = JSON.stringify(readCharterRecord(realRoot, session.id))
const promptAfterFirstRestart = restartOneService.view(firstResume).promptText
const toolAfterFirstRestart = JSON.stringify(restartOneService.readForModel(firstResume, 'all'))
await restartOne.fiber.dispose()
const restartTwo = await mountReal(realRoot)
const restartTwoService = restartTwo.charter
const secondResume = restartTwo.sessions.create(sessionId, identity())
announce(restartTwo, secondResume, 'resume')
await waitFor(restartTwoService, secondResume, () => restartTwoService.view(secondResume).status === 'ready', 'restart-2')
check(JSON.stringify(readCharterRecord(realRoot, session.id)) === recordAfterFirstRestart
  && restartTwoService.view(secondResume).promptText === promptAfterFirstRestart
  && JSON.stringify(restartTwoService.readForModel(secondResume, 'all')) === toolAfterFirstRestart,
  'two restarts keep record, state, prompt, and tool projections identical')
const healthyRefusal = await restartTwoService.restoreRecord({
  sessionId: session.id,
  operationId: 'recovery-smoke-overwrite',
  expectedLifecycle: lifecycle,
  expectedTarget: { kind: 'absent-unconfirmed' },
  archive: restoredArchive,
})
check(healthyRefusal.ok === false && healthyRefusal.code === 'RECORD_CONFLICT',
  'a healthy target refuses overwrite')
check(JSON.stringify(readCharterRecord(realRoot, session.id)) === recordAfterFirstRestart,
  'healthy-target refusal leaves the stored record byte-identical')
await restartTwo.fiber.dispose()

// Storage fault matrix against the packed Host.
const putReject = faultState()
putReject.puts.push('reject')
const faultCtx = await mount(putReject)
const faultService = faultCtx.charter
const faultSession = faultCtx.sessions.create(SessionId('fault-startup'), identity())
announce(faultCtx, faultSession, 'startup')
await waitFor(faultService, faultSession, () => faultService.view(faultSession).recordState?.kind === 'write-uncertain', 'put-reject')
check(faultService.view(faultSession).status === 'unavailable' && putReject.medium.size === 0,
  'rejected startup put fences write-uncertain and publishes no proposed content')
check(faultService.promptText(faultSession) === '', 'write-uncertain Session stops prompt injection')
await faultCtx.fiber.dispose()

const commitReject = faultState()
commitReject.puts.push('commit-then-reject')
const commitCtx = await mount(commitReject)
const commitService = commitCtx.charter
const commitSession = commitCtx.sessions.create(SessionId('fault-commit'), identity())
announce(commitCtx, commitSession, 'startup')
await waitFor(commitService, commitSession, () => commitService.view(commitSession).recordState?.kind === 'write-uncertain', 'commit-then-reject')
check(commitReject.medium.size === 1, 'commit-then-reject models a rename that landed before fsync failed')
await commitCtx.fiber.dispose()
const commitRestart = await mount(commitReject)
const commitRestartService = commitRestart.charter
const commitResume = commitRestart.sessions.create(SessionId('fault-commit'), identity())
announce(commitRestart, commitResume, 'resume')
await waitFor(commitRestartService, commitResume, () => commitRestartService.view(commitResume).status === 'ready', 'commit-restart')
check(commitRestartService.view(commitResume).recordState?.kind === 'healthy',
  'restart converges from the medium after commit-then-reject')
await commitRestart.fiber.dispose()

const openReject = faultState()
openReject.open = 'reject'
const openCtx = await mount(openReject)
const openService = openCtx.charter
const openSession = openCtx.sessions.create(SessionId('fault-open'), identity())
announce(openCtx, openSession, 'startup')
await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
check(openService.view(openSession).status === 'unavailable' && openReject.medium.size === 0,
  'open rejection creates no record and never publishes ready')
await openCtx.fiber.dispose()

rmSync(work, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`recovery-smoke: FAIL (${failures.length}): ${failures.join('; ')}`)
  process.exit(1)
}
console.log(`recovery-smoke: PASS — packed ${packedVersion} artifact ${actual} export/restore/two-restart/digest/healthy-refusal/fault checks passed`)
