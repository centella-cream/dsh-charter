import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CharterService } from '../../src/host/service.js'
import { buildRecordArchive } from '../../src/core/archive.js'
import { createEmptyRecord } from '../../src/core/record.js'
import { DEFAULT_CHARTER_LIMITS } from '../../src/core/limits.js'
import { recordDigestOf } from '../../src/core/archive.js'
import { charterRecordSchema, type CharterEditRequest, type CharterRecord } from '../../src/core/schemas.js'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function identityMeta(createdAt: number, parentSession?: SessionId) {
  return { meta: { cwd: '/work', createdAt, ...(parentSession === undefined ? {} : { parentSession }) } }
}

async function mount(root: string, config: Partial<Record<string, number>> = {}): Promise<Context> {
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
  return ctx
}

function announceStartup(ctx: Context, session: ReturnType<Context['sessions']['create']>, source: 'startup' | 'resume' = 'startup') {
  ctx.emit('agent/created', {
    agent: { id: session.id, session } as never,
    source,
    signal: new AbortController().signal,
  } as never)
}

async function waitFor(service: CharterService, session: ReturnType<Context['sessions']['create']>, predicate: () => boolean) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 2_000) {
      const view = service.view(session)
      throw new Error(`timeout waiting for state: ${view.status} ${JSON.stringify(view.recordState)} ${view.message ?? ''}`)
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function addItem(sessionId: string, baseRevision: number, mutationId: string, text: string): CharterEditRequest {
  return {
    sessionId,
    baseRevision,
    mutationId,
    ops: [{ type: 'item.add', item: { clientRef: mutationId, kind: 'invariant', text, order: baseRevision } }],
  }
}

async function findRecord(root: string, sessionId: string): Promise<string> {
  async function walk(dir: string): Promise<string | undefined> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = await walk(full)
        if (found !== undefined) return found
      } else if (full.includes('dsh_charter_v1') && entry.name.includes(sessionId)) {
        return full
      }
    }
    return undefined
  }
  const found = await walk(root)
  if (found === undefined) throw new Error(`no record file for ${sessionId}`)
  return found
}

describe('rc.3 source-aware initialization', () => {
  it('does not create or overwrite anything when resume finds no record (RC3-01)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-resume-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('resume-absent'), identityMeta(1_700_000_001_000))
    await service.ensureSession(session, 'resume')
    expect(service.view(session)).toMatchObject({
      status: 'unavailable',
      recordState: { kind: 'absent-unconfirmed', source: 'resume' },
    })
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(session.id)).toBeUndefined()
    expect(() => service.readForModel(session, 'standing')).toThrow(/not initialized|unavailable/i)
    expect(await service.edit(addItem(session.id, 0, 'edit-absent', 'blocked')))
      .toMatchObject({ ok: false, code: 'INITIALIZATION_REQUIRED' })
    expect(table.get(session.id)).toBeUndefined()
  })

  it('session/created alone writes nothing; authoritative startup creates the record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-startup-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('startup-new'), identityMeta(1_700_000_001_100))
    await new Promise(resolve => setTimeout(resolve, 20))
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(session.id)).toBeUndefined()
    announceStartup(ctx, session, 'startup')
    await waitFor(service, session, () => service.view(session).status === 'ready')
    expect(service.view(session).revision).toBe(0)
    expect(table.get(session.id)).toBeDefined()
  })

  it('keeps malformed outer JSON bytes untouched across Host start, view, and edit (RC3-02)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-malformed-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('malformed'), identityMeta(1_700_000_001_200))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).status === 'ready')
    const path = await findRecord(root, session.id)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const broken = '{"version":1,"record":' + 'x'.repeat(32) + '}'
    await writeFile(path, broken)
    const before = await readFile(path)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('malformed'), identityMeta(1_700_000_001_200))
    announceStartup(second, resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).recordState?.kind === 'absent-unconfirmed')
    expect(secondService.view(resumed).status).toBe('unavailable')
    expect((await secondService.edit(addItem(resumed.id, 0, 'm1', 'blocked'))).ok).toBe(false)
    expect(await readFile(path)).toEqual(before)
  })

  it('does not rebuild a missing fork child from the parent record (RC3-03)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-fork-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const parent = first.sessions.create(SessionId('fork-parent'), identityMeta(1_700_000_001_300))
    announceStartup(first, parent)
    await waitFor(firstService, parent, () => firstService.view(parent).status === 'ready')
    await firstService.edit(addItem(parent.id, 0, 'p1', 'Parent content'))
    const child = first.sessions.create(SessionId('fork-child'), identityMeta(1_700_000_001_301, SessionId('fork-parent')))
    announceStartup(first, child)
    await waitFor(firstService, child, () => firstService.view(child).status === 'ready')
    expect(firstService.view(child).revision).toBe(1)
    const childRecordPath = await findRecord(root, 'fork-child')
    await rm(childRecordPath)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumedParent = second.sessions.create(SessionId('fork-parent'), identityMeta(1_700_000_001_300))
    announceStartup(second, resumedParent, 'resume')
    await waitFor(secondService, resumedParent, () => secondService.view(resumedParent).status === 'ready')
    // The child is restored with its own identity but its record is gone: the
    // parent's current state must NOT be re-forked into it.
    const resumedChild = second.sessions.create(SessionId('fork-child'), identityMeta(1_700_000_001_301, SessionId('fork-parent')))
    announceStartup(second, resumedChild, 'resume')
    await waitFor(secondService, resumedChild, () => secondService.view(resumedChild).recordState?.kind === 'absent-unconfirmed')
    const table = (secondService as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(resumedChild.id)).toBeUndefined()
    expect(secondService.view(resumedChild).revision).toBe(0)
  })
})

describe('rc.3 read-triggered initialization probes (audit blockers)', () => {
  it('a view before authoritative startup never writes (RC3-01 gap probe)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-gap-view-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('gap-view'), identityMeta(1_700_000_004_000))
    // session/created only records intent; a read in the gap must not create.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(service.view(session).recordState).toMatchObject({ kind: 'absent-unconfirmed' })
    expect(service.view(session).status).toBe('unavailable')
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(session.id)).toBeUndefined()
    // The authoritative startup still creates afterwards.
    announceStartup(ctx, session, 'startup')
    await waitFor(service, session, () => service.view(session).status === 'ready')
    expect(service.view(session).revision).toBe(0)
  })

  it('a view over malformed/version-rejected bytes in the gap never rewrites them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-gap-bytes-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('gap-bytes'), identityMeta(1_700_000_004_100))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).status === 'ready')
    const path = await findRecord(root, session.id)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const broken = '{"version":99,"record":{"recordSchemaVersion":1}}'
    await writeFile(path, broken)
    const before = await readFile(path)
    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('gap-bytes'), identityMeta(1_700_000_004_100))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(secondService.view(resumed).recordState).toMatchObject({ kind: 'absent-unconfirmed' })
    expect(await readFile(path)).toEqual(before)
    const table = (secondService as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(resumed.id)).toBeUndefined()
  })

  it('a view over a missing fork child in the gap never re-forks it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-gap-fork-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const parent = first.sessions.create(SessionId('gap-parent'), identityMeta(1_700_000_004_200))
    announceStartup(first, parent, 'startup')
    await waitFor(firstService, parent, () => firstService.view(parent).status === 'ready')
    await firstService.edit(addItem(parent.id, 0, 'gp1', 'Parent content'))
    const child = first.sessions.create(SessionId('gap-child'), identityMeta(1_700_000_004_201, SessionId('gap-parent')))
    announceStartup(first, child, 'startup')
    await waitFor(firstService, child, () => firstService.view(child).status === 'ready')
    const childPath = await findRecord(root, 'gap-child')
    await rm(childPath)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumedParent = second.sessions.create(SessionId('gap-parent'), identityMeta(1_700_000_004_200))
    announceStartup(second, resumedParent, 'resume')
    await waitFor(secondService, resumedParent, () => secondService.view(resumedParent).status === 'ready')
    const resumedChild = second.sessions.create(SessionId('gap-child'), identityMeta(1_700_000_004_201, SessionId('gap-parent')))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(secondService.view(resumedChild).recordState).toMatchObject({ kind: 'absent-unconfirmed' })
    const table = (secondService as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect(table.get(resumedChild.id)).toBeUndefined()
    expect((table.get(resumedParent.id) as CharterRecord).current.items).toHaveLength(1)
  })
})

describe('rc.3 explicit initialize / export / restore', () => {
  it('initializes an absent target only after explicit confirmation, replaying the same operation id (RC3-04/07)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-init-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('init-target'), identityMeta(1_700_000_001_400))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle!
    const request = { sessionId: session.id, operationId: 'init-op-1', expectedLifecycle: lifecycle }
    const first = await service.initializeRecord(request)
    expect(first).toMatchObject({ ok: true, replayed: false, committedRevision: 0 })
    expect(service.view(session)).toMatchObject({ status: 'ready', revision: 0 })
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    const stored = table.get(session.id) as CharterRecord
    expect(stored.recentMaintenance?.[0]).toMatchObject({ operationId: 'init-op-1', kind: 'initialize', resultRevision: 0 })
    expect(stored.recentMaintenance?.[0]?.sourceRecordDigest).toBeUndefined()

    const replay = await service.initializeRecord(request)
    expect(replay).toMatchObject({ ok: true, replayed: true })
    const conflict = await service.initializeRecord({ ...request, operationId: 'init-op-2' })
    expect(conflict).toMatchObject({ ok: false, code: 'RECORD_CONFLICT' })
    const reused = await service.initializeRecord({ ...request, operationId: 'init-op-3', expectedLifecycle: 'other' })
    expect(reused).toMatchObject({ ok: false, code: 'LIFECYCLE_MISMATCH' })
    const denied = await service.initializeRecord({ ...request, operationId: 'init-op-4' }, { kind: 'user' })
    expect(denied).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('exports a complete record and restores it over a schema-invalid target (RC3-04/05/06)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-restore-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('restore-target'), identityMeta(1_700_000_001_500))
    announceStartup(ctx, session)
    await waitFor(service, session, () => service.view(session).status === 'ready')
    await service.edit(addItem(session.id, 0, 'r1', 'Restored invariant'))
    const lifecycle = service.view(session).lifecycle!
    const exported = service.exportRecord(session.id)
    expect(exported.ok).toBe(true)
    if (!exported.ok) throw new Error('export failed')
    const archive = exported.archive
    expect(archive.source).toMatchObject({ health: 'healthy', revision: 1, sessionId: session.id, lifecycle })
    const archiveRecord = archive.record as CharterRecord
    expect(archiveRecord.current.items.some(item => item.text === 'Restored invariant')).toBe(true)

    // The target is damaged after the export: same identity, invalid structure.
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown; put: (id: string, value: unknown) => Promise<void> } }).sessionsTable
    const bad = { recordSchemaVersion: 1, identity: identityMeta(1_700_000_001_500).meta, current: { revision: 99 } }
    await table.put(session.id, bad)
    await service.ensureSession(session, 'resume')
    await waitFor(service, session, () => service.view(session).recordState?.kind === 'invalid')
    const invalidState = service.view(session).recordState
    if (invalidState?.kind !== 'invalid') throw new Error('expected invalid')
    const restoreRequest = {
      sessionId: session.id,
      operationId: 'restore-op-1',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'invalid' as const, reason: 'schema' as const, recordDigest: recordDigestOf(bad) },
      archive,
    }
    const restored = await service.restoreRecord(restoreRequest)
    expect(restored).toMatchObject({ ok: true, replayed: false, committedRevision: 1 })
    expect(service.view(session).status).toBe('ready')
    expect(service.view(session).promptText).toContain('Restored invariant')
    expect(service.promptText(session)).toContain('Restored invariant')
    const stored = table.get(session.id) as CharterRecord
    expect(stored.current).toEqual(archiveRecord.current)
    expect(stored.history).toEqual(archiveRecord.history)
    expect(stored.recentMutations).toEqual(archiveRecord.recentMutations)
    expect(stored.recentMaintenance?.at(-1)).toMatchObject({
      operationId: 'restore-op-1',
      kind: 'restore',
      sourceRecordDigest: archive.source.recordDigest,
      resultRevision: 1,
    })
    expect(stored.recentMaintenance?.at(-1)?.resultStateDigest).toBe(archiveRecord.current.stateDigest)
    expect(service.readForModel(session, 'standing').items.some(item => item.text === 'Restored invariant')).toBe(true)

    // Exact replay is recognized by the maintenance receipt and returns the
    // current authoritative view.
    expect(await service.restoreRecord(restoreRequest)).toMatchObject({ ok: true, replayed: true })
    // A healthy target rejects a different restore.
    expect(await service.restoreRecord({ ...restoreRequest, operationId: 'restore-op-2' }))
      .toMatchObject({ ok: false, code: 'RECORD_CONFLICT' })
    // The same operation id with different content is rejected.
    expect(await service.restoreRecord({ ...restoreRequest, operationId: 'restore-op-1', expectedTarget: { kind: 'absent-unconfirmed' } }))
      .toMatchObject({ ok: false, code: 'OPERATION_ID_REUSED' })
  })

  it('restore followed by an ordinary edit still confirms the original operation (RC3-07)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-restore-edit-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('restore-edit'), identityMeta(1_700_000_001_600))
    announceStartup(ctx, session)
    await waitFor(service, session, () => service.view(session).status === 'ready')
    await service.edit(addItem(session.id, 0, 'a1', 'Before export'))
    const lifecycle = service.view(session).lifecycle!
    const exported = service.exportRecord(session.id)
    if (!exported.ok) throw new Error('export failed')
    const table = (service as unknown as { sessionsTable: { put: (id: string, value: unknown) => Promise<void> } }).sessionsTable
    const bad = { recordSchemaVersion: 1, identity: identityMeta(1_700_000_001_600).meta }
    await table.put(session.id, bad)
    await service.ensureSession(session, 'resume')
    await waitFor(service, session, () => service.view(session).recordState?.kind === 'invalid')
    const request = {
      sessionId: session.id,
      operationId: 'restore-edit-op',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'invalid' as const, reason: 'schema' as const, recordDigest: recordDigestOf(bad) },
      archive: exported.archive,
    }
    expect(await service.restoreRecord(request)).toMatchObject({ ok: true, replayed: false })
    const afterRestore = service.view(session).revision
    expect(await service.edit(addItem(session.id, afterRestore, 'a2', 'After restore'))).toMatchObject({ ok: true })
    expect(await service.restoreRecord(request)).toMatchObject({ ok: true, replayed: true })
    expect(service.view(session).promptText).toContain('After restore')
  })

  it('treats a version-rejected per-record document as absent and leaves its bytes untouched (RC3-02)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-version-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('version-rejected'), identityMeta(1_700_000_003_000))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).status === 'ready')
    const path = await findRecord(root, session.id)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    // Per-record documents wrap the value as { version, record }. An unaccepted
    // version stamp reads as absent and must not be rewritten.
    const rejected = '{"version":99,"record":{"recordSchemaVersion":1}}\n'
    await writeFile(path, rejected)
    const before = await readFile(path)
    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('version-rejected'), identityMeta(1_700_000_003_000))
    announceStartup(second, resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).recordState?.kind === 'absent-unconfirmed')
    expect(await secondService.edit(addItem(resumed.id, 0, 'm1', 'blocked')))
      .toMatchObject({ ok: false, code: 'INITIALIZATION_REQUIRED' })
    expect(await readFile(path)).toEqual(before)
  })

  it('restores an over-budget archive but does not inject its prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-overbudget-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('over-budget'), identityMeta(1_700_000_003_100))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).status === 'ready')
    const bigText = 'x'.repeat(800)
    for (let index = 0; index < 8; index += 1) {
      const revision = firstService.view(session).revision
      const result = await firstService.edit(addItem(session.id, revision, `big-${index}`, `${bigText}-${index}`))
      expect(result.ok).toBe(true)
    }
    const lifecycle = firstService.view(session).lifecycle!
    const exported = firstService.exportRecord(session.id)
    if (!exported.ok) throw new Error('export failed')
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root, { maxRecordBytes: 16 * 1_024 })
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('over-budget'), identityMeta(1_700_000_003_100))
    announceStartup(second, resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).status === 'ready')
    // Replace the healthy target with absence so restore is legal.
    const table = (secondService as unknown as { sessionsTable: { delete: (id: string) => Promise<boolean> } }).sessionsTable
    await table.delete(resumed.id)
    await secondService.ensureSession(resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).recordState?.kind === 'absent-unconfirmed')
    const restored = await secondService.restoreRecord({
      sessionId: resumed.id,
      operationId: 'over-budget-restore',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive: exported.archive,
    })
    expect(restored.ok).toBe(true)
    expect(secondService.view(resumed).overBudget).toBe(true)
    expect(secondService.promptText(resumed)).toBe('')
    expect(secondService.view(resumed).promptText.length).toBeGreaterThan(0)
  })

  it('serializes concurrent initialize and restore into one legal queue order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-queue-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('queue-order'), identityMeta(1_700_000_003_200))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle!
    const validRecord = createEmptyRecord(
      { createdAt: 1_700_000_003_200, cwd: '/work' },
      DEFAULT_CHARTER_LIMITS,
    )
    const archive = buildRecordArchive({
      sessionId: session.id,
      lifecycle,
      health: 'healthy',
      revision: 0,
      record: validRecord,
      exportedAt: 1,
    })
    const initialize = service.initializeRecord({
      sessionId: session.id,
      operationId: 'queue-init',
      expectedLifecycle: lifecycle,
    })
    const restore = service.restoreRecord({
      sessionId: session.id,
      operationId: 'queue-restore',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive,
    })
    const results = await Promise.all([initialize, restore])
    const wins = results.filter(result => result.ok)
    expect(wins).toHaveLength(1)
    expect(results.filter(result => !result.ok && result.code === 'RECORD_CONFLICT')).toHaveLength(1)
    const table = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    const stored = table.get(session.id) as CharterRecord
    expect(stored.recentMaintenance).toHaveLength(1)
    expect(stored.current.revision).toBe(0)
  })

  it('refuses to import an archive whose record already contains the request operation id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-ambiguous-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('ambiguous-op'), identityMeta(1_700_000_004_300))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle!
    // A record whose own recentMaintenance already claims the request id.
    const empty = createEmptyRecord({ createdAt: 1_700_000_004_300, cwd: '/work' }, DEFAULT_CHARTER_LIMITS)
    const forgedReceipt = {
      operationId: 'ambiguous-restore',
      kind: 'restore' as const,
      requestDigest: `sha256:${'0'.repeat(64)}` as `sha256:${string}`,
      resultRevision: 0,
      resultStateDigest: empty.current.stateDigest as `sha256:${string}`,
      sourceRecordDigest: `sha256:${'1'.repeat(64)}` as `sha256:${string}`,
      at: 1,
    }
    const forgedRecord = { ...empty, recentMaintenance: [forgedReceipt] }
    const archive = buildRecordArchive({
      sessionId: session.id,
      lifecycle,
      health: 'healthy',
      revision: 0,
      record: forgedRecord,
      exportedAt: 1,
    })
    const before = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable.get(session.id)
    const result = await service.restoreRecord({
      sessionId: session.id,
      operationId: 'ambiguous-restore',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive,
    })
    expect(result).toMatchObject({ ok: false, code: 'OPERATION_ID_REUSED' })
    const after = (service as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable.get(session.id)
    expect(after).toBe(before)
  })

  it('reports the receipt revision on replay even after a later edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-replay-revision-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('replay-revision'), identityMeta(1_700_000_004_400))
    announceStartup(ctx, session, 'startup')
    await waitFor(service, session, () => service.view(session).status === 'ready')
    const lifecycle = service.view(session).lifecycle!
    const exported = service.exportRecord(session.id)
    if (!exported.ok) throw new Error('export failed')
    const table = (service as unknown as { sessionsTable: { put: (id: string, value: unknown) => Promise<void> } }).sessionsTable
    await table.put(session.id, { recordSchemaVersion: 1, identity: identityMeta(1_700_000_004_400).meta })
    await service.ensureSession(session, 'resume')
    await waitFor(service, session, () => service.view(session).recordState?.kind === 'invalid')
    const targetDigest = recordDigestOf({ recordSchemaVersion: 1, identity: identityMeta(1_700_000_004_400).meta })
    const request = {
      sessionId: session.id,
      operationId: 'replay-revision-op',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'invalid' as const, reason: 'schema' as const, recordDigest: targetDigest },
      archive: exported.archive,
    }
    const restored = await service.restoreRecord(request)
    expect(restored).toMatchObject({ ok: true, replayed: false, committedRevision: 0 })
    const edited = await service.edit(addItem(session.id, 0, 'rr1', 'Later edit'))
    expect(edited).toMatchObject({ ok: true })
    const replay = await service.restoreRecord(request)
    expect(replay).toMatchObject({ ok: true, replayed: true, committedRevision: 0 })
    expect(service.view(session).revision).toBe(1)
  })

  it('lets an authoritative startup create after an earlier reattach absence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-agent-race-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('agent-race'), identityMeta(1_700_000_003_300))
    await service.ensureSession(session, 'reattach')
    expect(service.view(session).recordState?.kind).toBe('absent-unconfirmed')
    announceStartup(ctx, session, 'startup')
    await waitFor(service, session, () => service.view(session).status === 'ready')
    expect(service.view(session).revision).toBe(0)
  })

  it('rejects invalid archives, foreign Sessions, and lifecycle mismatches (RC3-05)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-invalid-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('invalid-archive'), identityMeta(1_700_000_001_700))
    const other = ctx.sessions.create(SessionId('other-archive'), identityMeta(1_700_000_001_701))
    await service.ensureSession(session, 'resume')
    await service.ensureSession(other, 'resume')
    const lifecycle = service.view(session).lifecycle!
    const foreign = buildRecordArchive({
      sessionId: 'other-archive',
      lifecycle,
      health: 'healthy',
      revision: 0,
      record: {},
      exportedAt: 1,
    })
    expect(await service.restoreRecord({
      sessionId: session.id,
      operationId: 'op-x',
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive: foreign,
    })).toMatchObject({ ok: false, code: 'INVALID_ARCHIVE' })
    // A live-health mismatch and a legacy-capability failure also fail closed.
    expect(await service.restoreRecord({
      sessionId: session.id,
      operationId: 'op-y',
      expectedLifecycle: 'wrong-lifecycle',
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive: foreign,
    })).toMatchObject({ ok: false, code: 'LIFECYCLE_MISMATCH' })
  })

  it('fails closed on a runtime without maintenance capability (RC3-10 host side)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-capability-'))
    roots.push(root)
    const ctx = await mount(root, { maxRecordBytes: 16 * 1_024 * 1_024 })
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('capability'), identityMeta(1_700_000_001_800))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle!
    expect(service.view(session).capabilities).toMatchObject({ recordMaintenance: false, recordMaintenanceReason: 'record-limit' })
    expect(await service.initializeRecord({
      sessionId: session.id,
      operationId: 'cap-op',
      expectedLifecycle: lifecycle,
    })).toMatchObject({ ok: false, code: 'RECOVERY_UNSUPPORTED' })
    expect(service.exportRecord(session.id)).toMatchObject({ ok: false, code: 'RECOVERY_UNSUPPORTED' })
  })

  it('reads a receipt-bearing record again after an rc.2-style strict schema would isolate it (RC3-13 host side)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-rc2-'))
    roots.push(root)
    const first = await mount(root)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('receipt-record'), identityMeta(1_700_000_001_900))
    await firstService.ensureSession(session, 'resume')
    const lifecycle = firstService.view(session).lifecycle!
    expect(await firstService.initializeRecord({
      sessionId: session.id,
      operationId: 'receipt-op',
      expectedLifecycle: lifecycle,
    })).toMatchObject({ ok: true })
    const table = (firstService as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    const stored = table.get(session.id) as CharterRecord
    expect(stored.recentMaintenance).toHaveLength(1)
    // rc.2's strict record schema has no recentMaintenance field: it isolates
    // the Session while preserving the raw record; rc.3 reads it again.
    const rc2Strict = charterRecordSchema.omit({ recentMaintenance: true })
    expect(rc2Strict.safeParse(stored).success).toBe(false)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mount(root)
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('receipt-record'), identityMeta(1_700_000_001_900))
    announceStartup(second, resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).status === 'ready')
    const resumedTable = (secondService as unknown as { sessionsTable: { get: (id: string) => unknown } }).sessionsTable
    expect((resumedTable.get(resumed.id) as CharterRecord).recentMaintenance).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Scripted storage fault backend (§12.3): ordered open/load/put/update/close
// controls. It is injected as a fake `storageDomain` service through the same
// public open/table surface the real domain exposes.
// ---------------------------------------------------------------------------
type FaultAction = 'pass' | 'reject' | 'commit-then-reject' | 'defer' | 'closed'

interface FaultState {
  readonly medium: Map<string, unknown>
  puts: FaultAction[]
  updates: FaultAction[]
  open: 'pass' | 'reject'
  load: 'pass' | 'reject'
  readonly pending: Array<() => void>
  readonly calls: string[]
}

function faultState(medium?: Map<string, unknown>): FaultState {
  return {
    medium: medium ?? new Map(),
    puts: [],
    updates: [],
    open: 'pass',
    load: 'pass',
    pending: [],
    calls: [],
  }
}

class FakeStorageDomain extends Service {
  static inject: string[] = []
  private readonly state: FaultState

  constructor(ctx: Context, state: FaultState) {
    super(ctx, 'storageDomain')
    this.state = state
  }

  async open(): Promise<unknown> {
    this.state.calls.push('open')
    if (this.state.open === 'reject') throw new Error('scripted open failure')
    const medium = this.state.medium
    const table = {
      get: (key: string) => medium.get(key),
      entries: () => {
        this.state.calls.push('loadAll')
        if (this.state.load === 'reject') throw new Error('scripted load failure')
        return medium.entries()
      },
      keys: () => medium.keys(),
      get size(): number { return medium.size },
      put: async (key: string, value: unknown) => {
        this.state.calls.push('put')
        const action = this.state.puts.shift() ?? 'pass'
        if (action === 'closed') throw new DomainError('closed', 'scripted closed domain')
        if (action === 'reject') throw new Error('scripted backend write rejection')
        if (action === 'defer') await new Promise<void>(resolve => this.state.pending.push(resolve))
        this.state.medium.set(key, value)
        if (action === 'commit-then-reject') throw new Error('scripted fsync failure after rename')
      },
      update: async (key: string, fn: (current: unknown) => unknown) => {
        this.state.calls.push('update')
        const action = this.state.updates.shift() ?? 'pass'
        if (action === 'closed') throw new DomainError('closed', 'scripted closed domain')
        const current = this.state.medium.get(key)
        if (current === undefined) throw new DomainError('missing-key', 'scripted missing key')
        const next = fn(current)
        if (action === 'reject') throw new Error('scripted backend write rejection')
        if (action === 'defer') await new Promise<void>(resolve => this.state.pending.push(resolve))
        this.state.medium.set(key, next)
        if (action === 'commit-then-reject') throw new Error('scripted fsync failure after rename')
        return next
      },
      delete: async (key: string) => this.state.medium.delete(key),
    }
    const ctx = this.ctx
    return {
      name: 'dsh_charter_v1',
      table: () => table,
      close: async () => {
        ctx.logger.info('charter: scripted storage domain closed')
      },
    }
  }
}

async function mountFault(state: FaultState, config: Partial<Record<string, number>> = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeStorageDomain, state as never)
  await ctx.plugin(CharterService, config as never)
  return ctx
}

function recordOf(state: FaultState, sessionId: string): CharterRecord | undefined {
  const value = state.medium.get(sessionId)
  return value === undefined ? undefined : value as CharterRecord
}

describe('rc.3 scripted storage fault backend (RC3-08)', () => {
  it('an open/load failure creates no record and never publishes ready', async () => {
    const state = faultState()
    state.open = 'reject'
    const ctx = await mountFault(state)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('fault-open'), identityMeta(1_700_000_002_000))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(service.view(session).status).toBe('unavailable')
    expect(state.medium.size).toBe(0)
    expect(state.calls.filter(call => call === 'put')).toHaveLength(0)

    state.open = 'pass'
    state.load = 'reject'
    const ctx2 = await mountFault(state)
    const service2 = ctx2.charter as CharterService
    const session2 = ctx2.sessions.create(SessionId('fault-load'), identityMeta(1_700_000_002_001))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(service2.view(session2).status).toBe('unavailable')
    expect(state.medium.size).toBe(0)
  })

  it('a rejected startup put fences write-uncertain without publishing proposed content', async () => {
    const state = faultState()
    state.puts.push('reject')
    const ctx = await mountFault(state)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('fault-startup'), identityMeta(1_700_000_002_100))
    const frames: string[] = []
    service.subscribe(session.id, view => { if (view !== null) frames.push(view.recordState?.kind ?? view.status) })
    announceStartup(ctx, session, 'startup')
    await waitFor(service, session, () => service.view(session).recordState?.kind === 'write-uncertain')
    expect(service.view(session).status).toBe('unavailable')
    expect(state.medium.size).toBe(0)
    // The proposed record was never published, and later writes are rejected.
    expect(service.view(session).revision).toBe(0)
    expect(await service.edit(addItem(session.id, 0, 'fence-1', 'blocked')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(service.promptText(session)).toBe('')
    expect(() => service.readForModel(session, 'standing')).toThrow(/uncertain/i)
    expect(frames.filter(kind => kind === 'write-uncertain')).toHaveLength(1)
    // No same-lifetime overwrite is attempted.
    expect(service.view(session).recordState?.kind).toBe('write-uncertain')
  })

  it('commit-then-reject fences the Session and converges after a restart', async () => {
    const state = faultState()
    state.puts.push('commit-then-reject')
    const first = await mountFault(state)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('fault-commit'), identityMeta(1_700_000_002_200))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).recordState?.kind === 'write-uncertain')
    // The medium may already contain the new value even though the domain
    // reported failure: the Session is fenced, not repaired in place.
    expect(state.medium.size).toBe(1)
    expect(firstService.view(session).status).toBe('unavailable')
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await mountFault(state)
    const secondService = second.charter as CharterService
    const resumed = second.sessions.create(SessionId('fault-commit'), identityMeta(1_700_000_002_200))
    announceStartup(second, resumed, 'resume')
    await waitFor(secondService, resumed, () => secondService.view(resumed).status === 'ready')
    expect(recordOf(state, resumed.id)).toBeDefined()
    expect(secondService.view(resumed).recordState).toMatchObject({ kind: 'healthy' })
  })

  it('an update rejection after the callback fences; a known preflight failure does not', async () => {
    const state = faultState()
    const first = await mountFault(state)
    const firstService = first.charter as CharterService
    const session = first.sessions.create(SessionId('fault-update'), identityMeta(1_700_000_002_300))
    announceStartup(first, session, 'startup')
    await waitFor(firstService, session, () => firstService.view(session).status === 'ready')
    state.updates.push('reject')
    expect(await firstService.edit(addItem(session.id, 0, 'u1', 'May have landed')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(firstService.view(session).recordState?.kind).toBe('write-uncertain')
    expect((recordOf(state, session.id) as CharterRecord).current.revision).toBe(0)
    expect(firstService.view(session).revision).toBe(0)

    // A known pre-durable DomainError is a definite non-executed outcome: it
    // must not fence a Session.
    const other = await mountFault(state)
    const otherService = other.charter as CharterService
    const otherSession = other.sessions.create(SessionId('fault-known'), identityMeta(1_700_000_002_301))
    announceStartup(other, otherSession, 'startup')
    await waitFor(otherService, otherSession, () => otherService.view(otherSession).status === 'ready')
    state.updates.push('closed')
    expect(await otherService.edit(addItem(otherSession.id, 0, 'known-1', 'Not executed')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(otherService.view(otherSession).recordState?.kind).toBe('healthy')
    expect(await otherService.edit(addItem(otherSession.id, 0, 'known-2', 'Executed'))).toMatchObject({ ok: true })
  })

  it('a deferred put publishes nothing before resolution, and one fenced Session leaves others usable', async () => {
    const state = faultState()
    state.puts.push('defer')
    state.puts.push('pass')
    const ctx = await mountFault(state)
    const service = ctx.charter as CharterService
    const blocked = ctx.sessions.create(SessionId('fault-defer'), identityMeta(1_700_000_002_400))
    const healthy = ctx.sessions.create(SessionId('fault-other'), identityMeta(1_700_000_002_401))
    announceStartup(ctx, blocked, 'startup')
    announceStartup(ctx, healthy, 'startup')
    // Exactly one of the two writes is deferred; nothing may publish ready
    // before it resolves.
    const started = Date.now()
    while (state.pending.length === 0) {
      if (Date.now() - started > 2_000) throw new Error('no deferred write was reached')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const deferredSession = service.view(blocked).status === 'ready' ? healthy : blocked
    const otherSession = deferredSession === blocked ? healthy : blocked
    expect(service.view(deferredSession).status).not.toBe('ready')
    expect(state.medium.has(deferredSession.id)).toBe(false)
    try {
      state.pending.shift()!()
      await waitFor(service, deferredSession, () => service.view(deferredSession).status === 'ready')
      await waitFor(service, otherSession, () => service.view(otherSession).status === 'ready')
      expect(state.medium.size).toBe(2)
    } finally {
      while (state.pending.length > 0) state.pending.shift()!()
    }
  })
})

describe('rc.3 queued maintenance lifecycle and fence guards', () => {
  it('refuses a queued initialize after its Session object is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-queued-lifecycle-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('queued-lifecycle'), identityMeta(1_700_000_003_000))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle
    expect(lifecycle).toBeDefined()

    let release!: () => void
    const blocker = new Promise<void>(resolve => { release = resolve })
    const queued = (service as unknown as {
      runMutationQueue: (id: SessionId, task: () => Promise<void>) => Promise<void>
    }).runMutationQueue(session.id, () => blocker)
    const operation = service.initializeRecord({
      sessionId: session.id,
      operationId: 'queued-lifecycle-op',
      expectedLifecycle: lifecycle!,
    })
    const replacement = {
      ...session,
      header: { ...session.header, createdAt: session.header.createdAt + 1 },
    } as never
    ;(ctx.sessions as unknown as { get: (id: SessionId) => unknown }).get = () => replacement
    release()
    await queued
    await expect(operation).resolves.toMatchObject({ ok: false, code: 'LIFECYCLE_MISMATCH' })
    const table = (service as unknown as { sessionsTable: { get: (id: SessionId) => unknown } }).sessionsTable
    expect(table.get(session.id)).toBeUndefined()
  })

  it('refuses a queued maintenance after another writer fences the Session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-queued-fence-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('queued-fence'), identityMeta(1_700_000_003_100))
    await service.ensureSession(session, 'resume')
    const lifecycle = service.view(session).lifecycle

    let release!: () => void
    const blocker = new Promise<void>(resolve => { release = resolve })
    const queued = (service as unknown as {
      runMutationQueue: (id: SessionId, task: () => Promise<void>) => Promise<void>
    }).runMutationQueue(session.id, () => blocker)
    const operation = service.initializeRecord({
      sessionId: session.id,
      operationId: 'queued-fence-op',
      expectedLifecycle: lifecycle!,
    })
    ;(service as unknown as { writeUncertain: Map<string, string> }).writeUncertain.set(session.id, 'edit')
    release()
    await queued
    await expect(operation).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    const table = (service as unknown as { sessionsTable: { get: (id: SessionId) => unknown } }).sessionsTable
    expect(table.get(session.id)).toBeUndefined()
  })
})

describe('rc.5 forward-schema fence', () => {
  it('detects a finite higher record schema before loose identity and blocks every write/read path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-forward-schema-'))
    roots.push(root)
    const ctx = await mount(root)
    const service = ctx.charter as CharterService
    const session = ctx.sessions.create(SessionId('future-schema'), identityMeta(1_700_000_004_000))
    announceStartup(ctx, session)
    await waitFor(service, session, () => service.view(session).status === 'ready')
    await service.edit(addItem(session.id, 0, 'future-1', 'Future invariant'))
    const path = await findRecord(root, session.id)
    const original = JSON.parse(await readFile(path, 'utf8')) as CharterRecord
    const future = { ...original, recordSchemaVersion: 2, futureOnlyField: { revision: 99 } }
    const table = (service as unknown as {
      sessionsTable: { get: (id: string) => unknown; put: (id: string, value: unknown) => Promise<void> }
    }).sessionsTable
    await table.put(session.id, future)
    await service.ensureSession(session, 'resume')
    await waitFor(service, session, () => service.view(session).recordState?.kind === 'invalid')
    const state = service.view(session).recordState
    expect(state).toMatchObject({ kind: 'invalid', reason: 'future-schema', recoverable: false })
    expect(service.view(session).status).toBe('unavailable')
    expect(service.promptText(session)).toBe('')
    expect(() => service.readForModel(session, 'standing')).toThrow(/not initialized/)
    expect(await service.edit(addItem(session.id, 1, 'future-2', 'Should not write')))
      .toMatchObject({ ok: false, code: 'UNAVAILABLE' })
    expect(await service.initializeRecord({
      sessionId: session.id,
      operationId: 'future-init',
      expectedLifecycle: service.view(session).lifecycle!,
    })).toMatchObject({ ok: false, code: 'RECORD_CONFLICT' })
    const exported = service.exportRecord(session.id)
    expect(exported.ok).toBe(true)
    if (exported.ok) expect(exported.archive.source.health).toBe('schema-invalid')
    const beforeBytes = await readFile(path)
    // A stale rc.4 client request naming reason:schema and the exact digest must not overwrite it.
    const restore = await service.restoreRecord({
      sessionId: session.id,
      operationId: 'future-restore',
      expectedLifecycle: service.view(session).lifecycle!,
      expectedTarget: {
        kind: 'invalid',
        reason: 'schema',
        recordDigest: recordDigestOf(future),
      },
      archive: exported.ok ? exported.archive : { format: 'dsh-charter-record', formatVersion: 1 },
    } as never)
    expect(restore).toMatchObject({ ok: false })
    expect(await readFile(path)).toEqual(beforeBytes)
  })
})
