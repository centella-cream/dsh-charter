import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterEditRequest } from '../../src/core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../../src/host/types.js'
import type { CharterSessionSource } from '../../src/client/store.js'
import { CharterDraft } from '../../src/client/draft-store.js'

const sessionId = SessionId('draft-session')

function view(revision = 0, overrides: Partial<CharterView> = {}): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision,
    objective: null,
    items: [],
    promptText: '',
    promptDigest: '',
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1_024,
      maxRecordBytes: 1_048_576,
    },
    overBudget: false,
    ...overrides,
  }
}

function source(handlers: {
  edit: (request: CharterEditRequest) => Promise<CharterEditResult>
  bootstrap?: () => Promise<CharterBootstrapResult>
  snapshot?: () => ReturnType<CharterSessionSource['getSnapshot']>
}): CharterSessionSource {
  return {
    sessionId,
    edit: handlers.edit,
    bootstrap: handlers.bootstrap ?? (async () => ({ available: false, reason: 'unavailable' })),
    accept: () => undefined,
    getSnapshot: handlers.snapshot ?? (() => ({ status: 'ready', view: view(0), error: null })),
    subscribe: () => () => undefined,
    retry: () => undefined,
  } as unknown as CharterSessionSource
}

describe('per-Session draft ownership', () => {
  it('keeps staged work when the view binding unmounts and remounts', () => {
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.stage(view(2), {
      type: 'item.add',
      item: { clientRef: 'draft-1', kind: 'invariant', text: 'Survives a tab switch', order: 0 },
    })
    draft.setSection('invariants')
    draft.setNewInvariant('Half-typed text')
    expect(draft.getSnapshot()).toMatchObject({ section: 'invariants', baseRevision: 2 })
    expect(draft.getSnapshot().ops).toHaveLength(1)
    expect(draft.getSnapshot().newInvariant).toBe('Half-typed text')
  })

  it('reuses the same mutation id when retrying an unknown-outcome request', async () => {
    const requests: CharterEditRequest[] = []
    let fail = true
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (fail) throw new Error('connection lost')
        return { ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'draft-3', kind: 'invariant', text: 'Retry me', order: 0 },
    })
    await draft.applyDraft(view(0))
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'connection' })
    fail = false
    await draft.applyDraft(view(0))
    expect(requests).toHaveLength(2)
    expect(requests[1]?.mutationId).toBe(requests[0]?.mutationId)
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'saved', revision: 1 })
    expect(draft.getSnapshot().ops).toHaveLength(0)
  })

  it('mints a fresh mutation id for a rebase after a revision conflict', async () => {
    const mutationIds: string[] = []
    const fake = source({
      edit: async request => {
        mutationIds.push(request.mutationId)
        return {
          ok: false,
          code: 'REVISION_CONFLICT',
          message: 'stale',
          currentRevision: 2,
          view: view(2),
        }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'draft-4', kind: 'invariant', text: 'Rebase me', order: 0 },
    })
    await draft.applyDraft(view(0))
    expect(draft.getSnapshot().feedback).toEqual({
      kind: 'error',
      code: 'REVISION_CONFLICT',
      detail: 'stale',
    })
    draft.rebase(view(2))
    await draft.applyDraft(view(2))
    expect(mutationIds).toHaveLength(2)
    expect(mutationIds[1]).not.toBe(mutationIds[0])
  })

  it('rejects control characters and lone surrogates before Apply', () => {
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.openEditor({ kind: 'objective' }, view(0))
    draft.setEditorText('bad\u0000text')
    draft.saveEditor(view(0))
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'editorInvalid', issue: 'control' })
    expect(draft.getSnapshot().ops).toHaveLength(0)

    draft.setEditorText('bad\uD800text')
    draft.saveEditor(view(0))
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'editorInvalid', issue: 'surrogate' })
  })

  it('ignores an Apply result after its source was replaced', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    const mutations: string[] = []
    const fake = source({ edit: request => { mutations.push(request.mutationId); return pending } })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-a')
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'guard-1', kind: 'invariant', text: 'Guarded', order: 0 },
    })
    const applied = draft.applyDraft(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().saving).toBe(true)
    draft.invalidateSource()
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    // The old request cannot clear or overwrite the preserved draft; the retry
    // keeps the same mutation id.
    expect(draft.getSnapshot()).toMatchObject({
      saving: false,
      ops: [expect.objectContaining({ type: 'item.add' })],
      feedback: { kind: 'connection' },
    })
    // Retrying through the new source replays the same mutation id.
    await draft.applyDraft(view(0))
    expect(mutations[1]).toBe(mutations[0])
    expect(draft.getSnapshot().ops).toHaveLength(0)
  })

  it('ignores an Apply result from an older connection epoch', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    let epoch = 0
    const fake = source({ edit: () => pending })
    Object.defineProperty(fake, 'connectionGeneration', { get: () => epoch })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-conn')
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'conn-1', kind: 'invariant', text: 'Old connection', order: 0 },
    })
    const applied = draft.applyDraft(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    epoch = 1
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    // Even with the same source object and draft ops, a result from the old
    // connection epoch cannot clear the current draft.
    expect(draft.getSnapshot().ops).toHaveLength(1)
    expect(draft.getSnapshot().saving).toBe(true)
    draft.invalidateSource()
    expect(draft.getSnapshot()).toMatchObject({
      saving: false,
      ops: [expect.objectContaining({ type: 'item.add' })],
      feedback: { kind: 'connection' },
    })
  })

  it('ignores an Apply result after the lifecycle was reset', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    const fake = source({ edit: () => pending })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-a')
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'guard-2', kind: 'invariant', text: 'Old life', order: 0 },
    })
    const applied = draft.applyDraft(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    draft.bindLifecycle('life-b')
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    expect(draft.getSnapshot()).toMatchObject({
      lifecycle: 'life-b',
      saving: false,
      ops: [],
      feedback: null,
    })
  })

  it('ignores a bootstrap Apply result after its source was replaced', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    const fake = source({
      edit: () => pending,
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Draft objective',
          invariants: ['Keep it'],
          deliverables: [],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-a')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    const applied = draft.applyBootstrap(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapSaving).toBe(true)
    draft.invalidateSource()
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapSaving: false,
      bootstrapPhase: 'draft',
      bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
    })
    expect(draft.getSnapshot().bootstrap).not.toBeNull()
  })

  it('resets staged work when the Session lifecycle changes', () => {
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('lifecycle-1')
    draft.stage(view(2), {
      type: 'item.add',
      item: { clientRef: 'life-1', kind: 'invariant', text: 'Old life draft', order: 0 },
    })
    draft.openEditor({ kind: 'objective' }, view(2))
    draft.setEditorText('typing')
    expect(draft.getSnapshot().ops).toHaveLength(1)
    expect(draft.getSnapshot().editor).not.toBeNull()

    draft.bindLifecycle('lifecycle-2')
    expect(draft.getSnapshot()).toMatchObject({
      lifecycle: 'lifecycle-2',
      ops: [],
      baseRevision: null,
      editor: null,
      feedback: null,
    })
    // Undefined (an older Host view) must not reset a bound draft.
    draft.stage(view(2), {
      type: 'item.add',
      item: { clientRef: 'life-2', kind: 'invariant', text: 'New draft', order: 0 },
    })
    draft.bindLifecycle(undefined)
    expect(draft.getSnapshot().ops).toHaveLength(1)
  })

  it('does not steal the current section when a draft arrives while editing', async () => {
    const fake = new CharterDraft(sessionId, () => source({
      edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }),
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Draft objective',
          invariants: ['Keep it'],
          deliverables: [],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    }))
    fake.openEditor({ kind: 'objective' }, view(0))
    fake.setEditorText('typing')
    fake.setSection('objective')
    fake.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fake.getSnapshot().bootstrapPhase).toBe('draft')
    expect(fake.getSnapshot().section).toBe('objective')
    expect(fake.getSnapshot().bootstrap?.objective).toBe('Draft objective')
  })
})
