/**
 * Isolated Gateway worker. This file is copied into a consumer directory that
 * has the candidate tarball and one exact DSH dependency graph installed. It
 * imports only bare package specifiers, so it cannot accidentally use the
 * checkout's DSH runtime.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { CharterService } from 'dsh-charter'
import { CharterRemoteService, charterRemoteContribution } from 'dsh-charter/remote'

const version = process.env.DSH_VERSION
if (version === undefined) throw new Error('DSH_VERSION is required')
const evidence = { dshVersion: version, checks: [] }
const check = (name, condition) => {
  assert.ok(condition, name)
  evidence.checks.push(name)
}

function identityMeta(createdAt) {
  return { meta: { cwd: '/work', createdAt } }
}

function peer(ctx, principal, signal = new AbortController().signal) {
  const scope = {
    id: 'gateway-peer',
    ctx,
    signal,
    interactions: 'answer',
    dispose: async () => undefined,
  }
  if (principal !== undefined) scope.principal = principal
  return scope
}

function editRequest(sessionId, revision, text, mutationId) {
  return {
    sessionId,
    mutationId,
    baseRevision: revision,
    ops: [{ type: 'item.add', item: { clientRef: mutationId, kind: 'invariant', text, order: revision } }],
  }
}

const ctx = new Context()
await ctx.plugin(AgentRegistry)
await ctx.plugin(SessionStore)
await ctx.plugin(Storage)
await ctx.plugin(StorageJson, { root: join(process.cwd(), 'storage') })
await ctx.plugin(StorageDomain, { backend: 'json' })
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(CharterService)
await ctx.plugin(TypertRegistry)
await ctx.plugin(RemoteAccessService)
await ctx.plugin(CharterRemoteService)
ctx.typert.register({
  package: 'dsh-charter',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: charterRemoteContribution.descriptors,
})
await ctx.plugin(TypertGatewayService)
const service = ctx.charter
const sessionA = ctx.sessions.create(SessionId('gateway-a'), identityMeta(1_700_000_020_000))
const sessionB = ctx.sessions.create(SessionId('gateway-b'), identityMeta(1_700_000_020_001))
for (const session of [sessionA, sessionB]) {
  ctx.emit('agent/created', {
    agent: { id: session.id, session },
    source: 'startup',
    signal: new AbortController().signal,
  })
}
const started = Date.now()
while (service.view(sessionA).status !== 'ready' || service.view(sessionB).status !== 'ready') {
  if (Date.now() - started > 5_000) throw new Error('timeout waiting for Sessions')
  await new Promise(resolveWait => setTimeout(resolveWait, 5))
}

let receiverCalls = 0
const originalResolveReceiver = ctx.typertGateway.resolveReceiverContext.bind(ctx.typertGateway)
ctx.typertGateway.resolveReceiverContext = (...args) => {
  receiverCalls += 1
  return originalResolveReceiver(...args)
}
let hostProbes = 0
const originalView = service.view.bind(service)
// A direct business probe after the policy would indicate a pre-policy dispatch.
service.view = (...args) => {
  hostProbes += 1
  return originalView(...args)
}
const invoke = (method, argsValue, peerValue) =>
  ctx.typertGateway.invoke({ namespace: 'charter', method, args: argsValue, peer: peerValue })

const owner = peer(ctx, { kind: 'owner' })
const guest = peer(ctx, { kind: 'guest' })
const ownerEdit = await invoke('edit', { request: editRequest(sessionA.id, 0, 'Owner invariant', 'gw-owner') }, owner)
check('owner edit through production Remote', ownerEdit?.ok === true && service.view(sessionA).revision === 1)

ctx.remoteAccess.registerPolicy('guest', {
  bindings: () => [{
    role: {
      name: 'session-editor',
      resource: 'session',
      actions: ['charter/edit', 'charter/exportRecord', 'charter/initializeRecord', 'charter/restoreRecord'],
    },
    resource: { kind: 'session', id: sessionA.id },
  }, {
    role: {
      name: 'restore-probe',
      resource: 'session',
      actions: ['charter/restoreRecord'],
    },
    resource: { kind: 'session', id: sessionB.id },
  }],
  explain: () => 'session-a-only',
})

const guestA = await invoke('edit', { request: editRequest(sessionA.id, 1, 'Guest A invariant', 'gw-guest-a') }, guest)
check('guest edit on authorized Session A', guestA?.ok === true && service.view(sessionA).revision === 2)

const beforeB = { receiver: receiverCalls, host: hostProbes }
const guestBError = await invoke('edit', { request: editRequest(sessionB.id, 0, 'Guest B invariant', 'gw-guest-b') }, guest)
  .then(() => undefined, error => error)
check('guest Session B denied', guestBError?.code === 'remote-access/denied')
check('Session B denial precedes receiver activation', receiverCalls === beforeB.receiver)
check('Session B denial precedes business/storage probe', hostProbes === beforeB.host)
check('Session B stayed unmodified', service.view(sessionB).revision === 0)

const guestExport = await invoke('exportRecord', { sessionId: sessionA.id }, guest)
check('guest export denied in business layer', guestExport?.ok === false && guestExport.code === 'FORBIDDEN')
const guestInitialize = await invoke('initializeRecord', {
  request: {
    sessionId: sessionA.id,
    operationId: 'gw-guest-init',
    expectedLifecycle: service.view(sessionA).lifecycle,
  },
}, guest)
check('guest initialize denied in business layer', guestInitialize?.ok === false && guestInitialize.code === 'FORBIDDEN')
const ownerExport = await invoke('exportRecord', { sessionId: sessionA.id }, owner)
check('owner diagnostic export', ownerExport?.ok === true && ownerExport.archive?.source?.health === 'healthy')

const item = service.view(sessionA).items[0]
const guestPurge = await invoke('edit', {
  request: {
    sessionId: sessionA.id,
    mutationId: 'gw-guest-purge',
    baseRevision: service.view(sessionA).revision,
    ops: [{ type: 'item.purge', itemId: item.id, confirmed: true }],
  },
}, guest)
check('guest purge denied in business layer', guestPurge?.ok === false && guestPurge.code === 'FORBIDDEN')

// A structurally valid archive reaches the business authorization path; the
// guest must be refused there instead of deep-parsing or writing the target.
const guestRestore = await invoke('restoreRecord', {
  request: {
    sessionId: sessionB.id,
    operationId: 'gw-guest-restore',
    expectedLifecycle: service.view(sessionB).lifecycle,
    expectedTarget: { kind: 'absent-unconfirmed' },
    archive: ownerExport.archive,
  },
}, guest)
check('guest restore denied in business layer', guestRestore?.ok === false && guestRestore.code === 'FORBIDDEN')

const aborted = new AbortController()
aborted.abort(new Error('cancelled before dispatch'))
const cancelled = await invoke('edit', {
  request: editRequest(sessionA.id, service.view(sessionA).revision, 'Late write', 'gw-cancelled'),
}, peer(ctx, { kind: 'owner' }, aborted.signal)).then(() => undefined, error => error)
check('cancelled call fails', cancelled !== undefined)
check('cancelled call writes nothing', service.view(sessionA).revision === 2)

const missing = await invoke('edit', {
  request: editRequest(sessionA.id, 2, 'Missing principal', 'gw-missing'),
}, peer(ctx, undefined)).then(() => undefined, error => error)
check('missing principal fails closed', missing instanceof Error)
check('missing principal writes nothing', service.view(sessionA).revision === 2)

// Production Remote results are already the wire projection returned by a
// strict descriptor; inspect the result shape rather than only success.
check('result is a complete unary result', ownerEdit.ok === true && typeof ownerEdit.committedRevision === 'number' && ownerEdit.view !== undefined)

mkdirSync('.', { recursive: true })
writeFileSync('gateway-worker-evidence.json', JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, dshVersion: version, checks: evidence.checks.length }))
