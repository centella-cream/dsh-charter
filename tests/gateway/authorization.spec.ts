import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
import { CharterService } from '../../src/host/service.js'
import { charterRemoteContribution } from '../../src/remote/contribution.js'
import { resolveRemoteActor } from '../../src/remote/actor.js'
import { TypertRemoteService, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import type { CharterEditRequest } from '../../src/core/schemas.js'

class GatewayCharterRemote extends TypertRemoteService {
  static inject = ['charter']

  constructor(ctx: Context) {
    super(ctx, 'charterRemote', { namespace: 'charter' })
  }

  private actor(): import('../../src/core/schemas.js').CharterActor | { readonly error: true } {
    try {
      return resolveRemoteActor(this.ctx)
    } catch {
      return { error: true }
    }
  }

  edit(request: CharterEditRequest): Promise<unknown> {
    const actor = this.actor()
    if ('error' in actor) return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'missing principal' })
    return this.ctx.charter.edit(request, actor)
  }

  bootstrap(sessionId: string): Promise<unknown> {
    return Promise.resolve(this.ctx.charter.bootstrap(sessionId as never))
  }

  exportRecord(sessionId: string): Promise<unknown> {
    const actor = this.actor()
    if ('error' in actor) return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'missing principal' })
    return Promise.resolve(this.ctx.charter.exportRecord(sessionId as never, actor))
  }

  initializeRecord(request: unknown): Promise<unknown> {
    const actor = this.actor()
    if ('error' in actor) return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'missing principal' })
    return Promise.resolve(this.ctx.charter.initializeRecord(request as never, actor))
  }

  restoreRecord(request: unknown): Promise<unknown> {
    const actor = this.actor()
    if ('error' in actor) return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'missing principal' })
    return Promise.resolve(this.ctx.charter.restoreRecord(request as never, actor))
  }

  watch(): AsyncIterable<never> {
    return (async function* () {})()
  }
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function identityMeta(createdAt: number) {
  return { meta: { cwd: '/work', createdAt } }
}

async function mount() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-auth-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CharterService)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(GatewayCharterRemote)
  ctx.typert.register({
    package: 'dsh-charter',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: charterRemoteContribution.descriptors,
  } as never)
  await ctx.plugin(TypertGatewayService)
  const service = ctx.charter as CharterService
  const session = ctx.sessions.create(SessionId('gateway-auth'), identityMeta(1_700_000_010_000))
  ctx.emit('agent/created', {
    agent: { id: session.id, session } as never,
    source: 'startup',
    signal: new AbortController().signal,
  } as never)
  const started = Date.now()
  while (service.view(session).status !== 'ready') {
    if (Date.now() - started > 2_000) throw new Error(`timeout: ${JSON.stringify(service.view(session))}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return { ctx, service, session }
}

function peer(principal: unknown, ctx: Context): PeerScope {
  return {
    id: 'peer-test' as never,
    ctx,
    principal: principal as never,
    signal: new AbortController().signal,
    interactions: 'answer',
    dispose: async () => undefined,
  } as PeerScope
}

function request(sessionId: string, revision = 0, text = 'Gateway invariant'): CharterEditRequest {
  return {
    sessionId,
    mutationId: `gateway-${Date.now()}`,
    baseRevision: revision,
    ops: [{ type: 'item.add', item: { clientRef: 'gateway-item', kind: 'invariant', text, order: 0 } }],
  }
}

describe('real TypertGatewayService authorization', () => {
  it('dispatches an owner edit through the real Gateway', async () => {
    const { ctx, session, service } = await mount()
    const result = await ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'edit',
      args: { request: request(session.id, 0) },
      peer: peer({ kind: 'owner' }, ctx),
    })
    expect(result).toMatchObject({ ok: true })
    expect(service.view(session).revision).toBe(1)
  })
  it('allows a guest edit only on the global policy action, and denies owner-only maintenance in the business layer', async () => {
    const { ctx, session, service } = await mount()
    ;(ctx.remoteAccess as unknown as { registerPolicy: (kind: string, policy: unknown) => () => void }).registerPolicy('guest', {
      bindings: () => [{
        role: {
          name: 'editor',
          resource: 'global',
          actions: ['charter/edit', 'charter/exportRecord', 'charter/initializeRecord', 'charter/restoreRecord'],
        },
        resource: { kind: 'global' },
      }],
    } as never)
    const result = await ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'edit',
      args: { request: request(session.id, 0) },
      peer: peer({ kind: 'guest' }, ctx),
    })
    expect(result).toMatchObject({ ok: true })
    expect(service.view(session).revision).toBe(1)
    const exported = await ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'exportRecord',
      args: { sessionId: session.id },
      peer: peer({ kind: 'guest' }, ctx),
    })
    expect(exported).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const initialized = await ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'initializeRecord',
      args: {
        request: {
          sessionId: session.id,
          operationId: 'gateway-init-guest',
          expectedLifecycle: service.view(session).lifecycle,
        },
      },
      peer: peer({ kind: 'guest' }, ctx),
    })
    expect(initialized).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const item = service.view(session).items[0]!
    const purged = await ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'edit',
      args: {
        request: {
          sessionId: session.id,
          mutationId: 'gateway-guest-purge',
          baseRevision: service.view(session).revision,
          ops: [{ type: 'item.purge', itemId: item.id, confirmed: true }],
        },
      },
      peer: peer({ kind: 'guest' }, ctx),
    })
    expect(purged).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('denies a guest call in the real remote-access policy before the business method runs', async () => {
    const { ctx, session, service } = await mount()
    ;(ctx.remoteAccess as unknown as { registerPolicy: (kind: string, policy: unknown) => () => void }).registerPolicy('guest', {
      bindings: () => [],
      explain: () => 'no-guest-edit',
    } as never)
    await expect(ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'edit',
      args: { request: request(session.id, 0) },
      peer: peer({ kind: 'guest' }, ctx),
    })).rejects.toMatchObject({ code: 'remote-access/denied' })
    expect(service.view(session).revision).toBe(0)
  })

  it('fails closed for a missing or malformed principal', async () => {
    const { ctx, session, service } = await mount()
    await expect(ctx.typertGateway.invoke({
      namespace: 'charter',
      method: 'edit',
      args: { request: request(session.id, 0) },
      peer: peer({}, ctx),
    })).rejects.toBeDefined()
    expect(service.view(session).revision).toBe(0)
  })


})
