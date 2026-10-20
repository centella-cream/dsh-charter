import { mkdtemp, rm } from 'node:fs/promises'
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
import type { CharterEditRequest } from '../../src/core/schemas.js'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mount(root: string): Promise<Context> {
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
    const unsubscribe = secondService.subscribe(SessionId('stored'), view => views.push(view))
    const live = second.sessions.create(SessionId('stored'), {
      meta: { cwd: root, createdAt: 1_700_000_000_090 },
    })
    await waitForReady(secondService, live)
    unsubscribe()
    expect(views.at(-1)).toMatchObject({ status: 'ready', revision: 1 })
    expect(views.at(-1)?.promptText).toContain('Survives another process')
  })

  it('retries a child charter after its parent record becomes durable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-charter-parent-retry-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const parentId = SessionId('parent-retry')
    const child = ctx.sessions.create(SessionId('child-retry'), {
      meta: { cwd: root, createdAt: 1_700_000_000_010, parentSession: parentId },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(service.view(child).status).toBe('unavailable')

    const parent = ctx.sessions.create(parentId, {
      meta: { cwd: root, createdAt: 1_700_000_000_009 },
    })
    await waitForReady(service, parent)
    await waitForStatus(service, child, 'ready')
    expect(service.view(child).revision).toBe(1)
    expect(service.view(child).promptText).toBe('')
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
