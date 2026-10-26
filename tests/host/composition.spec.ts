import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CharterService } from '../../src/host/service.js'
import { watchCharter } from '../../src/remote/watch.js'
import type { CharterEditRequest } from '../../src/core/schemas.js'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mount(
  root: string,
  config: Partial<Record<string, number>> = {},
  options: { readonly autoStartup?: boolean } = {},
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CharterService, config as never)
  // Test harness convenience: `sessions.create` stands for the DSH lifecycle
  // that authoritatively reports a new Agent. Real Host code never infers a
  // startup source from a read; the audit regression probes create raw
  // sessions through `mount(..., { autoStartup: false })` instead.
  if (options.autoStartup === false) return ctx
  const originalCreate = ctx.sessions.create.bind(ctx.sessions)
  ctx.sessions.create = ((id: never, options: never) => {
    const session = originalCreate(id, options)
    ctx.emit('agent/created', {
      agent: { id: session.id, session } as never,
      source: 'startup',
      signal: new AbortController().signal,
    } as never)
    return session
  }) as never
  return ctx
}

async function waitForReady(
  service: CharterService,
  session: ReturnType<Context['sessions']['create']>,
): Promise<void> {
  const started = Date.now()
  while (service.view(session).status !== 'ready') {
    if (Date.now() - started > 2_000) throw new Error('Charter did not initialize')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function addInvariant(
  sessionId: string,
  baseRevision: number,
  mutationId: string,
  text: string,
): CharterEditRequest {
  return {
    sessionId,
    baseRevision,
    mutationId,
    ops: [{
      type: 'item.add',
      item: {
        clientRef: mutationId,
        kind: 'invariant',
        text,
        order: baseRevision,
      },
    }],
  }
}

async function waitForStatus(
  service: CharterService,
  session: ReturnType<Context['sessions']['create']>,
  status: 'ready' | 'initializing' | 'unavailable',
): Promise<void> {
  const started = Date.now()
  while (service.view(session).status !== status) {
    if (Date.now() - started > 2_000) {
      throw new Error(`Charter did not reach ${status}: ${service.view(session).status}`)
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('dsh-charter host composition', () => {
  it('persists, edits, exposes prompt context, and registers the read tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-composition-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('composition'), {
      meta: { cwd: root, createdAt: 1_700_000_000_000 },
    })
    await waitForReady(service, session)

    expect(ctx.tools.get('charter_read')?.name).toBe('charter_read')
    expect(ctx.tools.schemas().some(tool => tool.name === 'charter_read')).toBe(true)

    const first = await service.edit(addInvariant(session.id, 0, 'mutation-1', 'Run the test suite'))
    expect(first).toMatchObject({ ok: true, committedRevision: 1 })
    expect(service.view(session).promptText).toContain('Run the test suite')

    const agent = { id: session.id, session } as Agent
    const assembly = await ctx.systemPrompt.assemble({
      agent,
      scope: agent as never,
    })
    expect(assembly.contexts.some(context => context.name === 'charter:standing')).toBe(true)
    expect(renderContextSnapshot(assembly)).toContain('Run the test suite')

    const left = service.edit(addInvariant(session.id, 1, 'mutation-2', 'Do not edit migrations'))
    const right = service.edit(addInvariant(session.id, 1, 'mutation-3', 'Keep the API backward compatible'))
    const results = await Promise.all([left, right])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.code === 'REVISION_CONFLICT')).toHaveLength(1)
    expect(service.view(session).revision).toBe(2)
  })

  it('enforces owner/user/host edit policies and owner-only purge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-actors-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('actors'), {
      meta: { cwd: root, createdAt: 1_700_000_000_700 },
    })
    await waitForReady(service, session)

    const added = await service.edit(addInvariant(session.id, 0, 'actor-add', 'Owner edit'), { kind: 'user' })
    expect(added).toMatchObject({ ok: true })
    if (!added.ok) throw new Error('expected user edit to succeed')
    const itemId = added.ids['actor-add']
    if (itemId === undefined) throw new Error('expected item id')

    const archived = await service.edit({
      sessionId: session.id,
      baseRevision: 1,
      mutationId: 'actor-archive',
      ops: [{ type: 'item.archive', itemId }],
    }, { kind: 'owner' })
    expect(archived).toMatchObject({ ok: true })

    let published = 0
    const unsubscribe = service.subscribe(session.id, () => { published += 1 })
    const userPurge = await service.edit({
      sessionId: session.id,
      baseRevision: 2,
      mutationId: 'actor-purge',
      ops: [{ type: 'item.purge', itemId, confirmed: true }],
    }, { kind: 'user' })
    expect(userPurge).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(service.view(session).revision).toBe(2)

    const hostEdit = await service.edit(addInvariant(session.id, 2, 'actor-host', 'Host edit'), { kind: 'host' })
    expect(hostEdit).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(service.view(session).revision).toBe(2)
    expect(published).toBe(0)
    unsubscribe()

    const ownerPurge = await service.edit({
      sessionId: session.id,
      baseRevision: 2,
      mutationId: 'actor-owner-purge',
      ops: [{ type: 'item.purge', itemId, confirmed: true }],
    }, { kind: 'owner' })
    expect(ownerPurge).toMatchObject({ ok: true })
    expect(service.view(session).items).toHaveLength(0)
  })

  it('commits active items and history proposals in one atomic edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-proposals-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('proposals'), {
      meta: { cwd: root, createdAt: 1_700_000_000_900 },
    })
    await waitForReady(service, session)

    const result = await service.edit({
      sessionId: session.id,
      mutationId: 'mixed-propose',
      baseRevision: 0,
      ops: [
        { type: 'item.add', item: { clientRef: 'active', kind: 'invariant', text: 'Active constraint', order: 1 } },
        {
          type: 'item.add',
          item: {
            clientRef: 'deliverable',
            kind: 'deliverable',
            text: 'Active deliverable',
            order: 2,
            progress: 'not-started',
          },
        },
        {
          type: 'item.propose',
          item: { clientRef: 'pending', kind: 'invariant', text: 'Deferred proposal', order: 3 },
        },
      ],
    })
    expect(result).toMatchObject({ ok: true, committedRevision: 1 })
    if (!result.ok) throw new Error('expected the mixed batch to commit')
    expect(result.ids['active']).toBeDefined()
    expect(result.ids['deliverable']).toBeDefined()
    expect(result.ids['pending']).toBeDefined()
    expect(new Set(Object.values(result.ids)).size).toBe(3)

    const view = service.view(session)
    expect(view.revision).toBe(1)
    expect(view.items).toHaveLength(3)
    expect(view.items.find(item => item.text === 'Active constraint')).toMatchObject({
      review: 'accepted',
      origin: 'user',
    })
    expect(view.items.find(item => item.text === 'Deferred proposal')).toMatchObject({
      review: 'pending',
      lifecycle: 'current',
      origin: 'agent',
    })
    expect(view.promptText).toContain('Active constraint')
    expect(view.promptText).toContain('Active deliverable')
    expect(view.promptText).not.toContain('Deferred proposal')
    expect(view.promptDigest).toMatch(/^sha256:/u)
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('accepts item.propose from a user actor as a documented client operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-user-propose-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('user-propose'), {
      meta: { cwd: root, createdAt: 1_700_000_001_000 },
    })
    await waitForReady(service, session)

    const request = {
      sessionId: session.id,
      mutationId: 'user-propose',
      baseRevision: 0,
      ops: [{
        type: 'item.propose' as const,
        item: { clientRef: 'pending', kind: 'invariant' as const, text: 'Review later', order: 0 },
      }],
    }
    const proposed = await service.edit(request, { kind: 'user' })
    expect(proposed).toMatchObject({ ok: true, committedRevision: 1 })
    const view = service.view(session)
    expect(view.items).toHaveLength(1)
    expect(view.items[0]).toMatchObject({ review: 'pending', origin: 'agent' })
    expect(view.promptText).toBe('')

    // The host actor is still rejected on the Remote edit path.
    const hostProposal = await service.edit({
      ...request,
      mutationId: 'host-propose',
      baseRevision: 1,
    }, { kind: 'host' })
    expect(hostProposal).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(service.view(session).revision).toBe(1)
  })

  it('reopens the same durable record only for the matching Session lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-reopen-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const firstSession = first.sessions.create(SessionId('reopen'), {
      meta: { cwd: root, createdAt: 1_700_000_000_001 },
    })
    await waitForReady(firstService, firstSession)
    await firstService.edit(addInvariant(firstSession.id, 0, 'mutation-reopen', 'Keep this after restart'))
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const secondSession = second.sessions.create(SessionId('reopen'), {
      meta: { cwd: root, createdAt: 1_700_000_000_001 },
    })
    await waitForReady(secondService, secondSession)
    expect(secondService.view(secondSession)).toMatchObject({
      status: 'ready',
      revision: 1,
    })
    expect(secondService.view(secondSession).promptText).toContain('Keep this after restart')

    const mismatched = second.sessions.create(SessionId('different'), {
      meta: { cwd: root, createdAt: 1_700_000_000_002 },
    })
    await waitForReady(secondService, mismatched)
    expect(secondService.view(mismatched).status).toBe('ready')
  })

  it('keeps charter text in user-role context and rebuilds it from the record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-prompt-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('prompt'), {
      meta: { cwd: root, createdAt: 1_700_000_000_020 },
    })
    await waitForReady(service, session)
    const agent = { id: session.id, session } as Agent
    const assemble = async (): Promise<Awaited<ReturnType<Context['systemPrompt']['assemble']>>> =>
      ctx.systemPrompt.assemble({ agent, scope: agent as never })

    const empty = await assemble()
    expect(renderContextSnapshot(empty)).toBe('')

    await service.edit({
      sessionId: session.id,
      mutationId: 'prompt-mutation-1',
      baseRevision: 0,
      ops: [
        { type: 'objective.initialize', text: 'Ship a stable public API' },
        { type: 'item.add', item: { clientRef: 'prompt-invariant', kind: 'invariant', text: 'Keep the public API stable', order: 1 } },
      ],
    })
    const first = await assemble()
    expect(first.contexts.find(context => context.name === 'charter:standing')?.text)
      .toContain('Keep the public API stable')
    expect(renderContextSnapshot(first)).toContain('Keep the public API stable')
    expect(renderContextSnapshot(first).match(/Keep the public API stable/gu)).toHaveLength(1)
    expect(renderPrompt(first)).not.toContain('Keep the public API stable')
    expect(first.sections.some(section => section.text.includes('Keep the public API stable'))).toBe(false)

    await service.edit({
      sessionId: session.id,
      mutationId: 'prompt-mutation-2',
      baseRevision: 1,
      ops: [{ type: 'objective.redirect', text: 'Document the public API before release', reason: 'Scope expanded' }],
    })
    const second = await assemble()
    expect(renderContextSnapshot(second)).toContain('Document the public API before release')
    expect(renderContextSnapshot(second)).not.toContain('Ship a stable public API')
    expect(renderPrompt(second)).not.toContain('Document the public API before release')

    // Reassembling with no new commit must produce exactly the same bytes.
    let bytes: string | undefined
    for (let index = 0; index < 20; index += 1) {
      const assembly = await assemble()
      const snapshot = renderContextSnapshot(assembly)
      if (bytes === undefined) bytes = snapshot
      else expect(snapshot).toBe(bytes)
    }
  })

  it('survives prompt-variable-looking user text on every supported DSH version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-interpolation-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('interpolation'), {
      meta: { cwd: root, createdAt: 1_700_000_000_070 },
    })
    await waitForReady(service, session)
    await service.edit(addInvariant(
      session.id,
      0,
      'interpolation-1',
      'Mention {{name}} and {{unknown}} literally in the docs',
    ))

    const agent = { id: session.id, session } as Agent
    const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent as never })
    const snapshot = renderContextSnapshot(assembly)
    expect(snapshot).toContain('Mention')
    expect(snapshot).not.toContain('{{name}}')
    expect(snapshot).toContain('\\u007b{name}')
    const charterPayload = snapshot.slice(snapshot.indexOf('{"objective"'))
    expect(JSON.parse(charterPayload).invariants)
      .toEqual(['Mention {{name}} and {{unknown}} literally in the docs'])
  })

  it('replays an idempotent mutation and rejects reuse or a stale base', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-idempotency-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('idempotency'), {
      meta: { cwd: root, createdAt: 1_700_000_000_030 },
    })
    await waitForReady(service, session)

    const request = addInvariant(session.id, 0, 'idempotent-1', 'Run the full test suite')
    const first = await service.edit(request)
    expect(first).toMatchObject({ ok: true, replayed: false, committedRevision: 1 })
    if (!first.ok) throw new Error('unreachable')
    const replay = await service.edit(request)
    expect(replay).toMatchObject({ ok: true, replayed: true, committedRevision: 1 })
    if (!replay.ok) throw new Error('unreachable')
    expect(replay.ids).toEqual(first.ids)

    const reused = await service.edit({
      ...request,
      ops: [{
        type: 'item.add',
        item: { clientRef: 'idempotent-1', kind: 'invariant', text: 'Different content', order: 0 },
      }],
    })
    expect(reused).toMatchObject({ ok: false, code: 'MUTATION_ID_REUSED' })

    const stale = await service.edit(addInvariant(session.id, 0, 'stale-1', 'Stale write'))
    expect(stale).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: 1 })
    expect(service.view(session).revision).toBe(1)
  })

  it('forks a child charter once and isolates later parent edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-fork-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const parentId = SessionId('fork-parent')
    const parent = ctx.sessions.create(parentId, {
      meta: { cwd: root, createdAt: 1_700_000_000_040 },
    })
    await waitForReady(service, parent)
    await service.edit({
      sessionId: parent.id,
      mutationId: 'fork-parent-mutation',
      baseRevision: 0,
      ops: [
        { type: 'objective.initialize', text: 'Ship the release' },
        { type: 'item.add', item: { clientRef: 'constraint', kind: 'invariant', text: 'Do not edit migrations', order: 1 } },
        { type: 'item.add', item: { clientRef: 'deliverable', kind: 'deliverable', text: 'Release notes', order: 2, progress: 'in-progress' } },
      ],
    })
    const parentView = service.view(parent)
    expect(parentView.status).toBe('ready')

    const child = ctx.sessions.create(SessionId('fork-child'), {
      meta: { cwd: root, createdAt: 1_700_000_000_041, parentSession: parentId },
    })
    await waitForReady(service, child)
    const childView = service.view(child)
    expect(childView).toMatchObject({ status: 'ready', revision: 1 })
    expect(childView.promptText).toBe(parentView.promptText)
    expect(childView.items.map(item => item.id)).not.toEqual(parentView.items.map(item => item.id))
    expect(childView.items.every(item => item.origin === 'fork')).toBe(true)

    await service.edit(addInvariant(parent.id, 1, 'fork-parent-late', 'Parent-only constraint'))
    expect(service.view(parent).revision).toBe(2)
    expect(service.view(parent).promptText).toContain('Parent-only constraint')
    expect(service.view(child).revision).toBe(1)
    expect(service.view(child).promptText).not.toContain('Parent-only constraint')
  })

  it('refuses a record from another Session lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-lifecycle-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const firstSession = first.sessions.create(SessionId('lifecycle'), {
      meta: { cwd: root, createdAt: 1_700_000_000_050 },
    })
    await waitForReady(firstService, firstSession)
    await firstService.edit(addInvariant(firstSession.id, 0, 'lifecycle-1', 'Private constraint'))
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const replacement = second.sessions.create(SessionId('lifecycle'), {
      meta: { cwd: root, createdAt: 1_700_000_000_051 },
    })
    await waitForStatus(secondService, replacement, 'unavailable')
    expect(secondService.promptText(replacement)).toBe('')

    const agent = { id: replacement.id, session: replacement } as Agent
    const assembly = await second.systemPrompt.assemble({ agent, scope: agent as never })
    expect(renderContextSnapshot(assembly)).not.toContain('Private constraint')
    expect(await secondService.edit(addInvariant(replacement.id, 1, 'lifecycle-2', 'Overwrite attempt')))
      .toMatchObject({ ok: false })
    expect(await secondService.edit(addInvariant(replacement.id, 0, 'lifecycle-2', 'Overwrite attempt')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
  })

  it('rejects an over-quota edit without publishing a new revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-quota-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('quota'), {
      meta: { cwd: root, createdAt: 1_700_000_000_080 },
    })
    await waitForReady(service, session)
    await service.edit(addInvariant(session.id, 0, 'quota-1', 'Existing constraint'))
    await new Promise(resolve => setTimeout(resolve, 20))

    let published = 0
    const unsubscribe = service.subscribe(session.id, () => { published += 1 })
    const rejected = await service.edit(addInvariant(
      session.id,
      1,
      'quota-2',
      'x'.repeat(4_096),
    ))
    unsubscribe()
    expect(rejected).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' })
    expect(published).toBe(0)
    expect(service.view(session).revision).toBe(1)
    expect(service.view(session).promptText).toContain('Existing constraint')
    expect(service.view(session).promptText).not.toContain('xxxx')
  })

  it('serves charter_read with a bounded standing view and opt-in inactive items', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-tool-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('tool'), {
      meta: { cwd: root, createdAt: 1_700_000_000_060 },
    })
    await waitForReady(service, session)
    const added = await service.edit({
      sessionId: session.id,
      mutationId: 'tool-add',
      baseRevision: 0,
      ops: [
        { type: 'item.add', item: { clientRef: 'inv', kind: 'invariant', text: 'Hidden after archive', order: 1 } },
        { type: 'item.add', item: { clientRef: 'del', kind: 'deliverable', text: 'Visible deliverable', order: 2, progress: 'not-started' } },
      ],
    })
    expect(added.ok).toBe(true)
    if (!added.ok) throw new Error('unreachable')
    const invariantId = added.ids.inv
    if (invariantId === undefined) throw new Error('missing minted id')
    await service.edit({
      sessionId: session.id,
      mutationId: 'tool-archive',
      baseRevision: 1,
      ops: [{ type: 'item.archive', itemId: invariantId }],
    })

    const tool = ctx.tools.get('charter_read')
    expect(tool).toBeDefined()
    if (tool === undefined) throw new Error('unreachable')
    const agent = { id: session.id, session } as Agent
    const exec = { agent, signal: new AbortController().signal } as never
    const standing = await tool.execute({ view: 'standing' }, exec) as {
      readonly items: readonly { readonly text: string }[]
    }
    const all = await tool.execute({ view: 'all' }, exec) as {
      readonly items: readonly { readonly text: string }[]
    }
    expect(standing.items.map(item => item.text)).toEqual(['Visible deliverable'])
    expect(all.items.map(item => item.text)).toContain('Hidden after archive')
  })

  it('bounds the charter_read all debugging view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-read-all-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('read-all'), {
      meta: { cwd: root, createdAt: 1_700_000_000_800 },
    })
    await waitForReady(service, session)
    const ops = Array.from({ length: 70 }, (_, index) => ({
      type: 'item.add' as const,
      item: {
        clientRef: `read-all-${index}`,
        kind: 'invariant' as const,
        text: `Constraint ${index}`,
        order: index,
      },
    }))
    const result = await service.edit({
      sessionId: session.id,
      baseRevision: 0,
      mutationId: 'read-all-add',
      ops,
    })
    expect(result).toMatchObject({ ok: true })
    const all = service.readForModel(session, 'all')
    expect(all.items).toHaveLength(64)
    expect(all.truncated).toBe(6)
    const standing = service.readForModel(session, 'standing')
    expect(standing.items).toHaveLength(70)
    expect(standing.truncated).toBe(0)
    // The standing projection is compact: no debug-only id/review/lifecycle.
    expect(standing.items.every(item => item.id === undefined)).toBe(true)
    expect(standing.items.every(item => item.review === undefined)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(standing), 'utf8')).toBeLessThan(16 * 1_024)
    expect(all.items[0]).toMatchObject({
      origin: 'user',
      order: expect.any(Number),
      createdRevision: 1,
    })
    expect(Buffer.byteLength(JSON.stringify(all), 'utf8')).toBeLessThanOrEqual(32 * 1_024)
  })

  it('omits an oversized objective from the all view instead of exceeding its envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-all-objective-'))
    roots.push(root)
    const ctx = await mount(root, { maxObjectiveBytes: 40_000, maxPromptBytes: 60_000 })
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('all-objective'), {
      meta: { cwd: root, createdAt: 1_700_000_000_900 },
    })
    await waitForReady(service, session)
    const text = 'x'.repeat(39_000)
    const result = await service.edit({
      sessionId: session.id,
      mutationId: 'all-objective-set',
      baseRevision: 0,
      ops: [{ type: 'objective.initialize', text }],
    })
    expect(result).toMatchObject({ ok: true })
    const all = service.readForModel(session, 'all')
    expect(all).toMatchObject({ objective: null, objectiveTruncated: true })
    expect(Buffer.byteLength(JSON.stringify(all), 'utf8')).toBeLessThanOrEqual(32 * 1_024)
    // Standing is the complete working set and still carries the objective.
    expect(service.readForModel(session, 'standing').objective).toHaveLength(39_000)
  })

  it('bounds the all view by the final tool envelope, not item JSON alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-read-envelope-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('read-envelope'), {
      meta: { cwd: root, createdAt: 1_700_000_000_810 },
    })
    await waitForReady(service, session)
    let revision = 0
    for (let index = 0; index < 30; index += 1) {
      const added = await service.edit({
        sessionId: session.id,
        mutationId: `envelope-add-${index}`,
        baseRevision: revision,
        ops: [{
          type: 'item.add',
          item: {
            clientRef: `envelope-${index}`,
            kind: 'invariant',
            text: `${index} ${'x'.repeat(900)}`,
            order: index,
          },
        }],
      })
      if (!added.ok) throw new Error(`add failed: ${added.code}`)
      revision += 1
      const archived = await service.edit({
        sessionId: session.id,
        mutationId: `envelope-archive-${index}`,
        baseRevision: revision,
        ops: [{ type: 'item.archive', itemId: added.ids[`envelope-${index}`]! }],
      })
      if (!archived.ok) throw new Error(`archive failed: ${archived.code}`)
      revision += 1
    }
    const all = service.readForModel(session, 'all')
    expect(all.truncated).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(all), 'utf8')).toBeLessThanOrEqual(32 * 1_024)
  })

  it('allows stepwise shrinking of an over-budget objective and item', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-step-shrink-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const sessionId = SessionId('step-shrink')
    const session = first.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_930 },
    })
    await waitForReady(firstService, session)
    const added = await firstService.edit(addInvariant(session.id, 0, 'shrink-item', 'abcdefghijklmnopqrst'))
    if (!added.ok) throw new Error('add failed')
    const objective = await firstService.edit({
      sessionId: session.id,
      mutationId: 'shrink-objective',
      baseRevision: 1,
      ops: [{ type: 'objective.initialize', text: 'abcdefghijklmnopqrst' }],
    })
    if (!objective.ok) throw new Error('objective failed')
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root, { maxObjectiveBytes: 4, maxItemBytes: 4 })
    const secondService = second.charter as CharterService
    const again = second.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_930 },
    })
    await waitForReady(secondService, again)
    expect(secondService.view(again).overBudget).toBe(true)

    const shortenedObjective = await secondService.edit({
      sessionId: again.id,
      mutationId: 'shrink-objective-step',
      baseRevision: 2,
      ops: [{ type: 'objective.redirect', text: '1234' }],
    })
    expect(shortenedObjective).toMatchObject({ ok: true })
    const shortenedItem = await secondService.edit({
      sessionId: again.id,
      mutationId: 'shrink-item-step',
      baseRevision: 3,
      ops: [{ type: 'item.edit', itemId: added.ids['shrink-item']!, text: '5678' }],
    })
    expect(shortenedItem).toMatchObject({ ok: true })
    expect(secondService.view(again).overBudget).toBe(false)
  })

  it('closes an open watch when its Session is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-watch-close-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('watch-close'), {
      meta: { cwd: root, createdAt: 1_700_000_000_800 },
    })
    await waitForReady(service, session)
    const controller = new AbortController()
    const iterator = watchCharter({
      read: () => service.view(session),
      subscribe: listener => service.subscribe(session.id, listener),
    }, controller.signal)
    await iterator.next()
    // This is the path the `session/disposed` listener invokes; a live watch
    // must be woken instead of remaining on the queue forever.
    ;(service as unknown as { closeListeners: (id: SessionId) => void }).closeListeners(session.id)
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
  })

  it('does not let a closed watch unsubscribe remove a same-id replacement watch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-watch-replace-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('watch-replace'), {
      meta: { cwd: root, createdAt: 1_700_000_000_790 },
    })
    await waitForReady(service, session)
    const oldSeen: string[] = []
    const unsubscribeOld = service.subscribe(session.id, view => { if (view !== null) oldSeen.push(view.status) })
    // Simulate session/disposed closing the old Set before its generator unwinds.
    ;(service as unknown as { closeListeners: (id: SessionId) => void }).closeListeners(session.id)
    const freshSeen: string[] = []
    const unsubscribeFresh = service.subscribe(session.id, view => { if (view !== null) freshSeen.push(view.status) })
    unsubscribeOld()
    ;(service as unknown as { publish: (id: SessionId) => void }).publish(session.id)
    expect(freshSeen).toEqual(['ready'])
    unsubscribeFresh()
    expect(oldSeen).toEqual([])
  })

  it('marks records over the current count limits as over budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-count-budget-'))
    roots.push(root)
    const first = await mount(root)
    const service = first.charter as CharterService
    const sessionId = SessionId('count-budget')
    const session = first.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_820 },
    })
    await waitForReady(service, session)
    for (let index = 0; index < 4; index += 1) {
      const baseRevision = index * 2
      const added = await service.edit(addInvariant(session.id, baseRevision, `count-${index}`, `Constraint ${index}`))
      if (!added.ok) throw new Error('add failed')
      const archived = await service.edit({
        sessionId: session.id,
        mutationId: `count-archive-${index}`,
        baseRevision: baseRevision + 1,
        ops: [{ type: 'item.archive', itemId: added.ids[`count-${index}`]! }],
      })
      if (!archived.ok) throw new Error('archive failed')
    }
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const second = await mount(root, { historyLimit: 1, mutationLimit: 1 })
    const secondService = second.charter as CharterService
    const again = second.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_820 },
    })
    await waitForReady(secondService, again)
    expect(secondService.view(again).overBudget).toBe(true)
  })

  it('serves a stored read-only view before a session becomes live in this process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-stored-view-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const firstSession = first.sessions.create(SessionId('stored'), {
      meta: { cwd: root, createdAt: 1_700_000_000_090 },
    })
    await waitForReady(firstService, firstSession)
    await firstService.edit(addInvariant(firstSession.id, 0, 'stored-1', 'Survives another process'))
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const missing = secondService.viewById(SessionId('not-there'))
    expect(missing).toMatchObject({ status: 'unavailable', revision: 0 })
    expect(missing.message).toContain('not live')

    const stored = secondService.viewById(SessionId('stored'))
    expect(stored).toMatchObject({ status: 'unavailable', revision: 1 })
    expect(stored.items.map(item => item.text)).toEqual(['Survives another process'])
    expect(stored.promptText).toContain('Survives another process')
    expect(stored.message).toContain('read-only')

    const views: Awaited<ReturnType<CharterService['view']>>[] = []
    const unsubscribe = secondService.subscribe(SessionId('stored'), view => { if (view !== null) views.push(view) })
    const live = second.sessions.create(SessionId('stored'), {
      meta: { cwd: root, createdAt: 1_700_000_000_090 },
    })
    await waitForReady(secondService, live)
    unsubscribe()
    expect(views.at(-1)).toMatchObject({ status: 'ready', revision: 1 })
    expect(views.at(-1)?.promptText).toContain('Survives another process')
  })

  it('rejects a cross-session parent cycle instead of deadlocking initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-parent-cycle-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const a = ctx.sessions.create(SessionId('cycle-a'), {
      meta: { cwd: root, createdAt: 1_700_000_000_020, parentSession: SessionId('cycle-b') },
    })
    const b = ctx.sessions.create(SessionId('cycle-b'), {
      meta: { cwd: root, createdAt: 1_700_000_000_021, parentSession: SessionId('cycle-a') },
    })
    await waitForStatus(service, a, 'unavailable')
    await waitForStatus(service, b, 'unavailable')
    expect(service.view(a).message).toContain('cycle')
    expect(service.view(b).message).toContain('cycle')
  })

  it('publishes the ready frame again after a failed child retry succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-parent-retry-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const parentId = SessionId('parent-retry')
    const child = ctx.sessions.create(SessionId('child-retry'), {
      meta: { cwd: root, createdAt: 1_700_000_000_010, parentSession: parentId },
    })
    // rc.3: session/created only records intent; the authoritative startup is
    // delivered explicitly here (agent/created in real DSH).
    ctx.emit('agent/created', {
      agent: { id: child.id, session: child } as never,
      source: 'startup',
      signal: new AbortController().signal,
    } as never)
    await waitForStatus(service, child, 'unavailable')

    const published: string[] = []
    const unsubscribe = service.subscribe(child.id, view => { if (view !== null) published.push(view.status) })
    const parent = ctx.sessions.create(parentId, {
      meta: { cwd: root, createdAt: 1_700_000_000_009 },
    })
    ctx.emit('agent/created', {
      agent: { id: parent.id, session: parent } as never,
      source: 'startup',
      signal: new AbortController().signal,
    } as never)
    await waitForReady(service, parent)
    await waitForStatus(service, child, 'ready')
    unsubscribe()
    expect(service.view(child).revision).toBe(1)
    expect(service.view(child).promptText).toBe('')
    expect(published.at(-1)).toBe('ready')
  })

  it('isolates one schema-invalid record from every other Session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-bad-record-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const badId = SessionId('bad-record')
    const goodId = SessionId('good-record')
    const bad = first.sessions.create(badId, {
      meta: { cwd: root, createdAt: 1_700_000_000_950 },
    })
    const good = first.sessions.create(goodId, {
      meta: { cwd: root, createdAt: 1_700_000_000_951 },
    })
    await waitForReady(firstService, bad)
    await waitForReady(firstService, good)
    await firstService.edit(addInvariant(bad.id, 0, 'bad-1', 'Bad record constraint'))
    await firstService.edit(addInvariant(good.id, 0, 'good-1', 'Good record constraint'))
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const file = join(root, 'storage', 'dsh_charter_v1', 'sessions', `${badId}.json`)
    const stored = JSON.parse(await readFile(file, 'utf8')) as { record: Record<string, unknown> }
    stored.record['unexpectedFutureField'] = 1
    await writeFile(file, JSON.stringify(stored))

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const badAgain = second.sessions.create(badId, {
      meta: { cwd: root, createdAt: 1_700_000_000_950 },
    })
    const goodAgain = second.sessions.create(goodId, {
      meta: { cwd: root, createdAt: 1_700_000_000_951 },
    })
    await waitForReady(secondService, goodAgain)
    await waitForStatus(secondService, badAgain, 'unavailable')
    expect(secondService.view(goodAgain).promptText).toContain('Good record constraint')
    expect(await secondService.edit(addInvariant(goodAgain.id, 1, 'good-2', 'Still editable')))
      .toMatchObject({ ok: true })
    expect(await secondService.edit(addInvariant(badAgain.id, 1, 'bad-2', 'Blocked')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    // The invalid document is preserved for diagnosis, not silently replaced.
    const preserved = JSON.parse(await readFile(file, 'utf8')) as { record: Record<string, unknown> }
    expect(preserved.record['unexpectedFutureField']).toBe(1)
  })

  it('rejects a record that becomes schema-invalid while the service is running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-runtime-invalid-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const bad = ctx.sessions.create(SessionId('runtime-invalid'), {
      meta: { cwd: root, createdAt: 1_700_000_000_990 },
    })
    const good = ctx.sessions.create(SessionId('runtime-good'), {
      meta: { cwd: root, createdAt: 1_700_000_000_991 },
    })
    await waitForReady(service, bad)
    await waitForReady(service, good)
    await service.edit(addInvariant(bad.id, 0, 'runtime-1', 'Will be invalidated'))
    await service.edit(addInvariant(good.id, 0, 'runtime-2', 'Still works'))

    const table = (service as unknown as {
      sessionsTable: {
        get: (id: string) => unknown
        put: (id: string, value: unknown) => Promise<void>
      }
    }).sessionsTable
    const validStored = structuredClone(table.get(bad.id))
    const stored = structuredClone(validStored) as { recordSchemaVersion: number }
    stored.recordSchemaVersion = 2
    await table.put(bad.id, stored)

    await waitForStatus(service, bad, 'unavailable')
    expect(service.promptText(bad)).toBe('')
    expect(service.view(good).status).toBe('ready')
    expect(service.view(good).promptText).toContain('Still works')
    expect(await service.edit(addInvariant(bad.id, 1, 'runtime-3', 'Blocked')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })

    // Repairing the raw document is picked up on the next access; no Host
    // restart is needed and the Session becomes editable again.
    await table.put(bad.id, validStored)
    expect(service.view(bad).status).toBe('ready')
    expect(service.promptText(bad)).toContain('Will be invalidated')
    expect(await service.edit(addInvariant(bad.id, 1, 'runtime-repair', 'Recovered')))
      .toMatchObject({ ok: true })
    expect(service.view(bad).promptText).toContain('Recovered')
  })

  it('treats lowered budgets as over-budget state instead of corruption and lets edits shrink it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-over-budget-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const sessionId = SessionId('over-budget')
    const session = first.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_970 },
    })
    await waitForReady(firstService, session)
    const ops = Array.from({ length: 6 }, (_, index) => ({
      type: 'item.add' as const,
      item: {
        clientRef: `over-${index}`,
        kind: 'invariant' as const,
        text: `Constraint ${index} ${'x'.repeat(120)}`,
        order: index,
      },
    }))
    expect(await firstService.edit({
      sessionId: session.id,
      mutationId: 'over-budget-add',
      baseRevision: 0,
      ops,
    })).toMatchObject({ ok: true })
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root, { maxPromptBytes: 300 })
    const secondService = second.charter as CharterService
    const again = second.sessions.create(sessionId, {
      meta: { cwd: root, createdAt: 1_700_000_000_970 },
    })
    await waitForReady(secondService, again)
    const overView = secondService.view(again)
    expect(overView.status).toBe('ready')
    expect(overView.overBudget).toBe(true)
    expect(secondService.promptText(again)).toBe('')

    // Adding content is rejected while the record is over budget.
    expect(await secondService.edit(addInvariant(again.id, 1, 'grow', 'New constraint')))
      .toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' })

    // Removing content is admitted because the prompt only shrinks.
    const archived = await secondService.edit({
      sessionId: again.id,
      mutationId: 'over-budget-shrink',
      baseRevision: 1,
      ops: overView.items.map(item => ({ type: 'item.archive' as const, itemId: item.id })),
    })
    expect(archived).toMatchObject({ ok: true })
    expect(secondService.view(again).overBudget).toBe(false)
  })

  it('clamps non-viable budget configurations instead of making every edit fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-clamp-'))
    roots.push(root)
    const ctx = await mount(root, {
      maxPromptBytes: 1,
      maxRecordBytes: 1,
      maxHistoryBytes: 1,
    })
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('clamped'), {
      meta: { cwd: root, createdAt: 1_700_000_000_980 },
    })
    await waitForReady(service, session)
    const view = service.view(session)
    expect(view.limits.maxPromptBytes).toBeGreaterThan(100)
    expect(view.limits.maxRecordBytes).toBeGreaterThanOrEqual(16 * 1_024)
    expect(await service.edit(addInvariant(session.id, 0, 'clamped-1', 'Works'))
      .then(result => result.ok)).toBe(true)
  })
})

describe('charter bootstrap', () => {
  it('returns a review-only draft from the latest compaction summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-bootstrap-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('bootstrap'), {
      meta: { cwd: root, createdAt: 1_700_000_000_091 },
    })
    await waitForReady(service, session)
    expect(service.bootstrap(session.id)).toEqual({ available: false, reason: 'no-summary' })

    const append = session as unknown as {
      append(type: string, data: unknown): unknown
    }
    append.append('compaction/summary', {
      summary: [{
        type: 'text',
        text: '## Primary Request and Intent\n- Latest correction: "Keep the tab last."\n## Pending Jobs\n- Verify the tab.\n',
      }],
      shadowedTokenCount: 42,
    })

    const result = service.bootstrap(session.id)
    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.proposal.objective).toBe('Keep the tab last.')
    expect(result.proposal.invariants).toEqual([])
    expect(result.proposal.deliverables).toEqual(['Verify the tab.'])
    expect(result.proposal.source.shadowedTokens).toBe(42)
  })
})
