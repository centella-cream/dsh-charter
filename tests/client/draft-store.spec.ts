import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterEditRequest, CharterItem } from '../../src/core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../../src/host/types.js'
import type { CharterSessionSource } from '../../src/client/store.js'
import {
  CharterDraft,
  bootstrapReplayPending,
  editReplayPending,
  rebaseAvailable,
} from '../../src/client/draft-store.js'
import { draftAdmission } from '../../src/client/admission.js'
import { previewPrompt } from '../../src/client/preview.js'
import { utf8Bytes } from '../../src/core/limits.js'

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

function committedInvariant(
  overrides: Pick<CharterItem, 'id' | 'text' | 'order'> & Partial<CharterItem>,
): CharterItem {
  return {
    kind: 'invariant',
    review: 'accepted',
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    origin: 'user',
    createdRevision: 1,
    ...overrides,
  } as CharterItem
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

  it('does not rebase while the Apply request is in flight', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    const fake = source({ edit: () => pending })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-rebase')
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'rebase-1', kind: 'invariant', text: 'Keep attempt', order: 0 },
    })
    const applied = draft.applyDraft(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    draft.rebase(view(9))
    expect(draft.getSnapshot().baseRevision).toBe(0)
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    expect(draft.getSnapshot()).toMatchObject({ saving: false, ops: [] })
  })

  it('allows a stepwise shrink of an over-budget objective editor', () => {
    const base = view(0)
    const shrinkable = {
      ...base,
      objective: {
        original: { text: '1234567890', setAtRevision: 0 },
        current: { text: '1234567890', setAtRevision: 0 },
      },
      limits: { ...base.limits, maxObjectiveBytes: 4 },
    }
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.openEditor({ kind: 'objective' }, shrinkable)
    draft.setEditorText('12345678')
    draft.saveEditor(shrinkable)
    expect(draft.getSnapshot().ops).toEqual([expect.objectContaining({ type: 'objective.redirect', text: '12345678' })])
  })

  it('ignores a bootstrap extraction result from an older connection', async () => {
    let release: ((value: CharterBootstrapResult) => void) | undefined
    const pending = new Promise<CharterBootstrapResult>(resolve => { release = resolve })
    let epoch = 0
    const fake = source({ edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }), bootstrap: () => pending })
    Object.defineProperty(fake, 'connectionGeneration', { get: () => epoch })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-bootstrap-connection')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('checking')
    epoch = 1
    draft.invalidateSource()
    release!({
      available: true,
      proposal: {
        objective: 'Stale proposal',
        invariants: ['Do not apply'],
        deliverables: [],
        source: { summarySeq: 1, at: 1 },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('failed')
    expect(draft.getSnapshot().bootstrap).toBeNull()
  })

  it('rejects Unstage while the Apply request is in flight', async () => {
    let release: ((value: CharterEditResult) => void) | undefined
    const pending = new Promise<CharterEditResult>(resolve => { release = resolve })
    const fake = source({ edit: () => pending })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-unstage')
    draft.stage(view(0), {
      type: 'item.add',
      item: { clientRef: 'busy-1', kind: 'invariant', text: 'Busy', order: 0 },
    })
    const applied = draft.applyDraft(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    draft.unstage('draft:busy-1')
    expect(draft.getSnapshot().ops).toHaveLength(1)
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    expect(draft.getSnapshot()).toMatchObject({ saving: false, ops: [], feedback: { kind: 'saved', revision: 1 } })
  })

  it('keeps a reviewed history draft when the tab lease is released', async () => {
    const fake = source({
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
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-history')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    expect(draft.isEmpty).toBe(false)
    draft.dismissBootstrap()
    expect(draft.isEmpty).toBe(true)
  })

  it('rejects bootstrap edits while the save request is in flight', async () => {
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
    draft.bindLifecycle('life-bootstrap-saving')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    const candidateId = draft.getSnapshot().bootstrapItems[0]!.id
    const applied = draft.applyBootstrap(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapSaving).toBe(true)
    draft.setBootstrapObjective('changed after save')
    draft.updateBootstrapItem(candidateId, { selected: false })
    draft.setAllBootstrapSelected(false)
    expect(draft.getSnapshot().bootstrapObjective).toBe('Draft objective')
    expect(draft.getSnapshot().bootstrapItems[0]?.selected).toBe(true)
    release!({ ok: true, replayed: false, committedRevision: 1, ids: {}, view: view(1) })
    await applied
    expect(draft.getSnapshot().bootstrapPhase).toBe('dismissed')
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

  it('stages an editor against the baseline revision it captured at open time', async () => {
    const requests: CharterEditRequest[] = []
    const rev1 = view(1, {
      objective: {
        original: { text: 'Original', setAtRevision: 1 },
        current: { text: 'Original', setAtRevision: 1 },
      },
    })
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (request.baseRevision !== 2) {
          return { ok: false, code: 'REVISION_CONFLICT', message: 'stale', currentRevision: 2, view: view(2) }
        }
        return { ok: true, replayed: false, committedRevision: 3, ids: {}, view: view(3) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-editor-baseline')
    draft.openEditor({ kind: 'objective' }, rev1)
    draft.setEditorText('Imported objective')
    draft.setEditorReason('Because we need it')
    // An unrelated (and even same-field) remote commit arrives while editing.
    const rev2 = view(2, {
      objective: {
        original: { text: 'Original', setAtRevision: 1 },
        current: { text: 'Remote edit', setAtRevision: 2 },
      },
    })
    draft.saveEditor(rev2)
    expect(draft.getSnapshot()).toMatchObject({
      baseRevision: 1,
      ops: [expect.objectContaining({
        type: 'objective.redirect',
        text: 'Imported objective',
        reason: 'Because we need it',
      })],
    })
    // A later add must not advance the already staged baseline.
    draft.addItem(rev2, 'invariant', 'Another item', () => undefined)
    expect(draft.getSnapshot().baseRevision).toBe(1)
    // Applying against rev2 conflicts until an explicit rebase.
    await draft.applyDraft(rev2)
    expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'error', code: 'REVISION_CONFLICT' })
    expect(requests[0]?.baseRevision).toBe(1)
    draft.rebase(rev2)
    expect(draft.getSnapshot().baseRevision).toBe(2)
    await draft.applyDraft(rev2)
    expect(draft.getSnapshot().ops).toHaveLength(0)
    expect(requests[1]?.baseRevision).toBe(2)
  })

  it('stages an open item editor against its baseline when the item changes remotely', () => {
    const item = committedInvariant({ id: 'item-1', text: 'Original item', order: 1 })
    const rev1 = view(1, { items: [item] })
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('life-item-baseline')
    draft.openEditor({ kind: 'edit', item }, rev1)
    draft.setEditorText('Edited item')
    const rev2 = view(2, {
      items: [{ ...item, text: 'Remote edit', verification: { state: 'verified', by: 'user' } }],
    })
    draft.saveEditor(rev2)
    expect(draft.getSnapshot()).toMatchObject({
      baseRevision: 1,
      ops: [expect.objectContaining({ type: 'item.edit', itemId: 'item-1', text: 'Edited item' })],
    })
  })

  it('admits normalized bytes rather than raw input bytes in the editor and composer', () => {
    const base = view(0, { limits: { ...view(0).limits, maxItemBytes: 1_024 } })
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('life-normalized-admission')
    // NFC contraction: 342 decomposed e+acute = 1026 raw bytes but 684 stored.
    const decomposed = 'e\u0301'.repeat(342)
    expect(utf8Bytes(decomposed)).toBe(1_026)
    draft.addItem(base, 'invariant', decomposed, () => undefined)
    expect(draft.getSnapshot().feedback).toBeNull()
    expect(draft.getSnapshot().ops).toHaveLength(1)
    const added = draft.getSnapshot().ops[0]
    expect(added?.type).toBe('item.add')
    if (added?.type === 'item.add') {
      expect(added.item.text).toBe('\u00e9'.repeat(342))
      expect(utf8Bytes(added.item.text)).toBe(684)
    }

    // NFC expansion: 1022 x + U+0344 is 1024 raw bytes but normalizes to 1026.
    const draft2 = new CharterDraft(sessionId, () => undefined)
    draft2.bindLifecycle('life-normalized-expansion')
    const expanding = 'x'.repeat(1_022) + '\u0344'
    expect(utf8Bytes(expanding)).toBe(1_024)
    draft2.addItem(base, 'invariant', expanding, () => undefined)
    expect(draft2.getSnapshot().feedback).toEqual({ kind: 'itemBudget', limit: 1_024 })
    expect(draft2.getSnapshot().ops).toHaveLength(0)
  })

  it('enforces the normalized item limit boundary', () => {
    const base = view(0, { limits: { ...view(0).limits, maxItemBytes: 100 } })
    for (const [text, expected] of [
      ['a'.repeat(99), 'staged'],
      ['a'.repeat(100), 'staged'],
      ['a'.repeat(101), 'over'],
    ] as const) {
      const draft = new CharterDraft(sessionId, () => undefined)
      draft.addItem(base, 'invariant', text, () => undefined)
      if (expected === 'staged') {
        expect(draft.getSnapshot().ops).toHaveLength(1)
        expect(draft.getSnapshot().feedback).toBeNull()
      } else {
        expect(draft.getSnapshot().ops).toHaveLength(0)
        expect(draft.getSnapshot().feedback).toEqual({ kind: 'itemBudget', limit: 100 })
      }
    }
  })

  it('treats CRLF/LF and composed/decomposed forms as unchanged and still allows other ops', () => {
    const item = committedInvariant({ id: 'crlf', text: 'line one\nline two', order: 1 })
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('life-crlf')
    draft.openEditor({ kind: 'edit', item }, view(1, { items: [item] }))
    draft.setEditorText('line one\r\nline two')
    draft.saveEditor(view(1, { items: [item] }))
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'editorUnchanged', target: 'item' })
    expect(draft.getSnapshot().ops).toHaveLength(0)
    draft.addItem(view(1, { items: [item] }), 'invariant', 'Other valid op', () => undefined)
    expect(draft.getSnapshot().ops).toHaveLength(1)

    const cafe = committedInvariant({ id: 'cafe', text: 'Caf\u00e9', order: 2 })
    const draft2 = new CharterDraft(sessionId, () => undefined)
    draft2.bindLifecycle('life-nfc-unchanged')
    draft2.openEditor({ kind: 'edit', item: cafe }, view(1, { items: [cafe] }))
    draft2.setEditorText('Cafe\u0301')
    draft2.saveEditor(view(1, { items: [cafe] }))
    expect(draft2.getSnapshot().feedback).toEqual({ kind: 'editorUnchanged', target: 'item' })
    expect(draft2.getSnapshot().ops).toHaveLength(0)
  })

  it('normalizes the objective reason before generating the staged op', () => {
    const rev1 = view(1, {
      objective: {
        original: { text: 'Old', setAtRevision: 1 },
        current: { text: 'Old', setAtRevision: 1 },
      },
    })
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('life-reason')
    draft.openEditor({ kind: 'objective' }, rev1)
    draft.setEditorText('New objective')
    draft.setEditorReason('Be\u0301cause')
    draft.saveEditor(rev1)
    expect(draft.getSnapshot().ops[0]).toMatchObject({
      type: 'objective.redirect',
      text: 'New objective',
      reason: 'B\u00e9cause',
    })
  })

  it('allocates orders above committed and currently staged rows after an unstage', () => {
    const base = view(0)
    const draft = new CharterDraft(sessionId, () => undefined)
    draft.bindLifecycle('life-order')
    draft.addItem(base, 'invariant', 'first', () => undefined)
    draft.addItem(base, 'invariant', 'second', () => undefined)
    const firstOp = draft.getSnapshot().ops[0]
    expect(firstOp?.type).toBe('item.add')
    if (firstOp?.type !== 'item.add') throw new Error('expected an item.add op')
    expect([...draft.getSnapshot().ops].map(op => op.type === 'item.add' ? op.item.order : -1))
      .toEqual([0, 1])
    draft.unstage(`draft:${firstOp.item.clientRef}`)
    draft.addItem(base, 'invariant', 'third', () => undefined)
    const orders = draft.getSnapshot().ops.map(op => op.type === 'item.add' ? op.item.order : -1)
    expect(orders).toEqual([1, 2])
  })

  it('rejects rebase while an editor is open and keeps the reviewed baseline', async () => {
    const requests: CharterEditRequest[] = []
    const fake = source({
      edit: async request => {
        requests.push(request)
        return { ok: false, code: 'REVISION_CONFLICT', message: 'stale', currentRevision: 2, view: view(2) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-rebase-editor')
    const item = committedInvariant({ id: 'item-rebase', text: 'Original', order: 1 })
    const rev1 = view(1, { items: [item] })
    draft.stage(rev1, { type: 'item.edit', itemId: 'item-rebase', text: 'Staged edit' })
    draft.openEditor({ kind: 'edit', item }, rev1)
    draft.setEditorText('Reviewed edit')
    const rev2 = view(2, {
      items: [{ ...item, text: 'Remote edit', verification: { state: 'verified', by: 'user' } }],
    })
    expect(rebaseAvailable(draft.getSnapshot())).toBe(false)
    draft.rebase(rev2)
    expect(draft.getSnapshot().baseRevision).toBe(1)
    expect(draft.getSnapshot().editorBaseRevision).toBe(1)
    // Saving the old edit keeps the frozen baseline; Apply still conflicts.
    draft.saveEditor(rev2)
    expect(draft.getSnapshot().ops.at(-1)).toMatchObject({ type: 'item.edit', text: 'Reviewed edit' })
    await draft.applyDraft(rev2)
    expect(requests[0]?.baseRevision).toBe(1)
    expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'error', code: 'REVISION_CONFLICT' })
    expect(draft.getSnapshot().baseRevision).toBe(1)
    // Only after closing the editor may an explicit rebase advance it.
    draft.closeEditor()
    expect(rebaseAvailable(draft.getSnapshot())).toBe(true)
    draft.rebase(rev2)
    expect(draft.getSnapshot().baseRevision).toBe(2)
  })

  it('applies a reviewed history draft only against its extraction revision', async () => {
    const requests: CharterEditRequest[] = []
    let liveRevision = 0
    const fake = source({
      edit: async request => {
        requests.push(request)
        return { ok: true, replayed: false, committedRevision: 4, ids: {}, view: view(4) }
      },
      snapshot: () => ({ status: 'ready', view: view(liveRevision), error: null }),
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
    draft.bindLifecycle('life-bootstrap-baseline')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    expect(draft.getSnapshot().bootstrapBaseRevision).toBe(0)

    // A new empty revision means the reviewed draft no longer describes the
    // state: Apply must not send the current revision, and it becomes stale.
    await draft.applyBootstrap(view(3))
    expect(requests).toHaveLength(0)
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'failed',
      bootstrap: null,
      bootstrapBaseRevision: null,
      bootstrapProblem: { kind: 'stale' },
    })

    // Re-extraction captures the new revision; Apply sends that baseline.
    liveRevision = 3
    draft.retryBootstrap(view(3))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapBaseRevision).toBe(3)
    await draft.applyBootstrap(view(3))
    expect(requests).toHaveLength(1)
    expect(requests[0]?.baseRevision).toBe(3)
    expect(draft.getSnapshot().bootstrapPhase).toBe('dismissed')
  })

  it('marks a reviewed history draft stale when the live view stops being empty', async () => {
    const fake = source({
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
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-bootstrap-stale')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    const item = committedInvariant({ id: 'external', text: 'External commit', order: 1 })
    draft.markBootstrapStale(view(0, { items: [item] }))
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'failed',
      bootstrap: null,
      bootstrapProblem: { kind: 'stale' },
    })
  })

  it('preflights maxOps/maxItems/maxPendingItems and prompt growth in one draftAdmission', () => {
    const small = (overrides: Partial<CharterView['limits']>) => view(1, {
      limits: { ...view(1).limits, ...overrides },
    })
    const addOp = (clientRef: string, text = 'small') => ({
      type: 'item.add' as const,
      item: { clientRef, kind: 'invariant' as const, text, order: 0 },
    })
    // maxOps
    expect(draftAdmission(small({ maxOps: 1 }), [addOp('a'), addOp('b')]))
      .toMatchObject({ ok: false, reason: 'max-ops' })
    // maxItems: existing + new exceeds a limit that was not already exceeded
    const oneItem = view(1, { items: [committedInvariant({ id: 'existing', text: 'Existing', order: 1 })] })
    const oneItemLimit = { ...oneItem, limits: { ...oneItem.limits, maxItems: 1 } }
    expect(draftAdmission(oneItemLimit, [addOp('new')]))
      .toMatchObject({ ok: false, reason: 'max-items' })
    // Stepwise rule: an already over-limit view may still shrink.
    const overItems = { ...oneItem, limits: { ...oneItem.limits, maxItems: 1 } }
    expect(draftAdmission(overItems, [{ type: 'item.purge' as const, itemId: 'existing', confirmed: true }]))
      .toMatchObject({ ok: true })
    // maxPendingItems
    const pendingItem = committedInvariant({ id: 'pending', text: 'Pending', order: 1, review: 'pending' })
    const pendingView = view(1, {
      items: [pendingItem],
      limits: { ...view(1).limits, maxPendingItems: 1 },
    })
    expect(draftAdmission(pendingView, [{
      type: 'item.propose' as const,
      item: { clientRef: 'proposal', kind: 'invariant' as const, text: 'New proposal', order: 2 },
    }])).toMatchObject({ ok: false, reason: 'max-pending' })
    // Prompt growth over the budget blocks Apply; a shrinking render is admitted.
    const tinyPrompt = small({ maxPromptBytes: 80 })
    expect(draftAdmission(tinyPrompt, [
      { type: 'item.add', item: { clientRef: 'big', kind: 'invariant', text: 'x'.repeat(200), order: 0 } },
    ])).toMatchObject({ ok: false, reason: 'prompt' })
    const overPrompt = view(1, {
      items: [committedInvariant({ id: 'big', text: 'y'.repeat(200), order: 1 })],
      promptText: 'y'.repeat(200),
      limits: { ...view(1).limits, maxPromptBytes: 80 },
    })
    expect(previewPrompt(overPrompt, [])).toContain('y'.repeat(200))
    expect(draftAdmission(overPrompt, [
      { type: 'item.purge', itemId: 'big', confirmed: true },
    ])).toMatchObject({ ok: true, prompt: { blocksApply: false } })
  })

  it('refuses an inadmissible batch in applyDraft without calling the Remote', async () => {
    const requests: CharterEditRequest[] = []
    const fake = source({
      edit: async request => {
        requests.push(request)
        return { ok: true, replayed: false, committedRevision: 2, ids: {}, view: view(2) }
      },
    })
    const base = view(1, { limits: { ...view(1).limits, maxOps: 1 } })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-admission')
    draft.stage(base, { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 0 } })
    draft.stage(base, { type: 'item.add', item: { clientRef: 'b', kind: 'invariant', text: 'B', order: 1 } })
    await draft.applyDraft(base)
    expect(requests).toHaveLength(0)
    expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'error', code: 'QUOTA_EXCEEDED' })
    expect(draft.getSnapshot().ops).toHaveLength(2)
  })

  it('binds the first lifecycle fingerprint only to an empty draft', () => {
    const empty = new CharterDraft(sessionId, () => undefined)
    empty.bindLifecycle(undefined)
    empty.bindLifecycle('fingerprint-first')
    expect(empty.getSnapshot()).toMatchObject({ lifecycle: 'fingerprint-first', ops: [] })

    const dirty = new CharterDraft(sessionId, () => undefined)
    dirty.bindLifecycle(undefined)
    dirty.setSection('objective')
    dirty.stage(view(2), { type: 'item.add', item: { clientRef: 'old', kind: 'invariant', text: 'Old', order: 0 } })
    dirty.bindLifecycle('fingerprint-second')
    expect(dirty.getSnapshot()).toMatchObject({
      lifecycle: 'fingerprint-second',
      section: 'objective',
      ops: [],
      baseRevision: null,
    })
  })

  it('replays a retryable lost request verbatim before any current admission check', async () => {
    const requests: CharterEditRequest[] = []
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (requests.length === 1) throw new Error('connection lost after the Host committed')
        return { ok: true, replayed: true, committedRevision: 2, ids: {}, view: view(2) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-replay')
    draft.stage(view(1), {
      type: 'item.add',
      item: { clientRef: 'm1', kind: 'invariant', text: 'Exactly once', order: 0 },
    })
    await draft.applyDraft(view(1))
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'connection' })
    expect(rebaseAvailable(draft.getSnapshot())).toBe(false)
    draft.rebase(view(1))
    expect(draft.getSnapshot().baseRevision).toBe(1)

    // The reconnected view already contains the committed item and has a
    // tighter maxItems, so a fresh add would be rejected by admission.
    const committedItem = committedInvariant({ id: 'host-1', text: 'Exactly once', order: 1 })
    const reconnect = view(2, {
      items: [committedItem],
      limits: { ...view(2).limits, maxItems: 1 },
    })
    expect(draftAdmission(reconnect, draft.getSnapshot().ops))
      .toMatchObject({ ok: false, reason: 'max-items' })
    draft.rebase(reconnect)
    expect(draft.getSnapshot().baseRevision).toBe(1)

    await draft.applyDraft(reconnect)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(draft.getSnapshot().feedback).toEqual({ kind: 'replayed' })
    expect(draft.getSnapshot().ops).toHaveLength(0)
    // Only the one committed item exists; no second mutation id was minted.
    expect(new Set(requests.map(request => request.mutationId)).size).toBe(1)
    expect(draft.getSnapshot().attempt).toBeNull()
  })

  it('clears a replay attempt on a deterministic conflict so Rebase becomes available', async () => {
    const requests: CharterEditRequest[] = []
    let first = true
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (first) {
          first = false
          throw new Error('lost')
        }
        return { ok: false, code: 'REVISION_CONFLICT', message: 'stale', currentRevision: 2, view: view(2) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-replay-conflict')
    draft.stage(view(1), {
      type: 'item.add',
      item: { clientRef: 'm1', kind: 'invariant', text: 'Conflict', order: 0 },
    })
    await draft.applyDraft(view(1))
    expect(rebaseAvailable(draft.getSnapshot())).toBe(false)
    await draft.applyDraft(view(1))
    expect(requests).toHaveLength(2)
    expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'error', code: 'REVISION_CONFLICT' })
    expect(draft.getSnapshot().attempt).toBeNull()
    expect(rebaseAvailable(draft.getSnapshot())).toBe(true)
  })

  it('invalidates a bootstrap extraction started under an unknown lifecycle and re-extracts', async () => {
    let releaseFirst: ((value: CharterBootstrapResult) => void) | undefined
    let releaseSecond: ((value: CharterBootstrapResult) => void) | undefined
    const first = new Promise<CharterBootstrapResult>(resolve => { releaseFirst = resolve })
    const second = new Promise<CharterBootstrapResult>(resolve => { releaseSecond = resolve })
    let calls = 0
    const fake = source({
      edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }),
      bootstrap: () => {
        calls += 1
        return calls === 1 ? first : second
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle(undefined)
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('checking')

    // First real fingerprint arrives while the extraction is in flight: the old
    // request belongs to the unknown lifecycle and must be discarded.
    draft.bindLifecycle('lifecycle-defined')
    expect(draft.getSnapshot()).toMatchObject({ lifecycle: 'lifecycle-defined', bootstrapPhase: 'idle' })
    releaseFirst!({
      available: true,
      proposal: { objective: 'Old lifecycle', invariants: ['Old'], deliverables: [], source: { summarySeq: 1, at: 1 } },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('idle')
    expect(draft.getSnapshot().bootstrap).toBeNull()

    // The Pane effect runs ensure again for the defined lifecycle.
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('checking')
    releaseSecond!({
      available: true,
      proposal: { objective: 'New lifecycle', invariants: ['New'], deliverables: [], source: { summarySeq: 1, at: 1 } },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    expect(draft.getSnapshot().bootstrap?.objective).toBe('New lifecycle')
    expect(calls).toBe(2)
  })

  it('discards an A extraction and accepts only the B extraction after a lifecycle switch', async () => {
    const releases: Array<(value: CharterBootstrapResult) => void> = []
    const promises: Promise<CharterBootstrapResult>[] = []
    for (let index = 0; index < 2; index += 1) {
      promises.push(new Promise<CharterBootstrapResult>(resolve => { releases.push(resolve) }))
    }
    let calls = 0
    const fake = source({
      edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }),
      bootstrap: () => {
        calls += 1
        return promises[calls - 1]!
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('lifecycle-a')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('checking')

    // Switch A -> B while A is checking: A's result must be discarded, B's
    // extraction requested and only B accepted.
    draft.bindLifecycle('lifecycle-b')
    expect(draft.getSnapshot()).toMatchObject({ lifecycle: 'lifecycle-b', bootstrapPhase: 'idle' })
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    releases[0]!({
      available: true,
      proposal: { objective: 'From A', invariants: ['A'], deliverables: [], source: { summarySeq: 1, at: 1 } },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('checking')
    expect(draft.getSnapshot().bootstrap).toBeNull()
    releases[1]!({
      available: true,
      proposal: { objective: 'From B', invariants: ['B'], deliverables: [], source: { summarySeq: 1, at: 1 } },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    expect(draft.getSnapshot().bootstrap?.objective).toBe('From B')
    expect(calls).toBe(2)
  })

  it('fully cleans up a reviewed draft when the live view becomes non-empty', async () => {
    const fake = source({
      edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }),
      bootstrap: async () => ({
        available: true,
        proposal: { objective: 'Draft objective', invariants: ['Keep it'], deliverables: [], source: { summarySeq: 1, at: 1 } },
      }),
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-cleanup')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    expect(draft.isEmpty).toBe(false)

    const item = committedInvariant({ id: 'external', text: 'External commit', order: 1 })
    draft.markBootstrapStale(view(0, { items: [item] }))
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'failed',
      bootstrap: null,
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapBaseRevision: null,
      attempt: null,
      bootstrapProblem: { kind: 'stale' },
    })
    expect(draft.isEmpty).toBe(true)
    // No hidden payload survives the single cleanup path.
    expect(draft.getSnapshot().bootstrap).toBeNull()
    expect(draft.getSnapshot().bootstrapObjective).toBe('')
    expect(draft.getSnapshot().bootstrapItems).toEqual([])
  })

  it('preflights bootstrap invalid text in the store before any Remote call', async () => {
    const requests: CharterEditRequest[] = []
    const bootSource = source({
      edit: async request => {
        requests.push(request)
        return { ok: true, replayed: false, committedRevision: 2, ids: {}, view: view(2) }
      },
      snapshot: () => ({ status: 'ready', view: view(1), error: null }),
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Draft objective',
          invariants: ['bad\u0000control'],
          deliverables: [],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    })
    const draft = new CharterDraft(sessionId, () => bootSource)
    draft.bindLifecycle('life-bootstrap-preflight')
    draft.ensureBootstrap(view(1), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    await draft.applyBootstrap(view(1))
    expect(requests).toHaveLength(0)
    expect(draft.getSnapshot().bootstrapProblem).toMatchObject({
      kind: 'save-failed',
      code: 'INVALID_ARGUMENT',
    })
    // The reviewed draft stays reviewable.
    expect(draft.getSnapshot().bootstrap).not.toBeNull()
  })

  it('rejects bootstrap plans that exceed the shared limit preflight without calling the Remote', async () => {
    const requests: CharterEditRequest[] = []
    const tightView = view(1, { limits: { ...view(1).limits, maxItems: 1 } })
    const fake = source({
      edit: async request => {
        requests.push(request)
        return { ok: true, replayed: false, committedRevision: 2, ids: {}, view: view(2) }
      },
      snapshot: () => ({ status: 'ready', view: tightView, error: null }),
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Draft objective',
          invariants: ['First invariant', 'Second invariant'],
          deliverables: [],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-bootstrap-limits')
    draft.ensureBootstrap(tightView, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    await draft.applyBootstrap(tightView)
    expect(requests).toHaveLength(0)
    expect(draft.getSnapshot().bootstrapProblem).toMatchObject({
      kind: 'save-failed',
      code: 'QUOTA_EXCEEDED',
    })
    expect(draft.getSnapshot().bootstrap).not.toBeNull()
  })

  it('admits objective and item fields with the Host stepwise shrink rule', () => {
    const bigObjective = 'o'.repeat(100)
    const objectiveView = view(1, {
      objective: {
        original: { text: bigObjective, setAtRevision: 1 },
        current: { text: bigObjective, setAtRevision: 1 },
      },
      limits: { ...view(1).limits, maxObjectiveBytes: 50 },
    })
    // Unchanged over-limit objective is admitted; growth and equal-byte-different
    // text are rejected; a strict shrink is admitted.
    expect(draftAdmission(objectiveView, [
      { type: 'objective.redirect', text: bigObjective },
    ])).toMatchObject({ ok: true })
    expect(draftAdmission(objectiveView, [
      { type: 'objective.redirect', text: 'o'.repeat(101) },
    ])).toMatchObject({ ok: false, reason: 'max-objective' })
    expect(draftAdmission(objectiveView, [
      { type: 'objective.redirect', text: 'x'.repeat(100) },
    ])).toMatchObject({ ok: false, reason: 'max-objective' })
    expect(draftAdmission(objectiveView, [
      { type: 'objective.redirect', text: 'o'.repeat(90) },
    ])).toMatchObject({ ok: true })

    const bigItem = committedInvariant({ id: 'big', text: 'i'.repeat(100), order: 1 })
    const itemView = view(1, {
      items: [bigItem],
      limits: { ...view(1).limits, maxItemBytes: 50 },
    })
    expect(draftAdmission(itemView, [
      { type: 'item.edit', itemId: 'big', text: 'i'.repeat(100) },
    ])).toMatchObject({ ok: true })
    expect(draftAdmission(itemView, [
      { type: 'item.edit', itemId: 'big', text: 'i'.repeat(101) },
    ])).toMatchObject({ ok: false, reason: 'max-item' })
    expect(draftAdmission(itemView, [
      { type: 'item.edit', itemId: 'big', text: 'j'.repeat(100) },
    ])).toMatchObject({ ok: false, reason: 'max-item' })
    expect(draftAdmission(itemView, [
      { type: 'item.edit', itemId: 'big', text: 'i'.repeat(80) },
    ])).toMatchObject({ ok: true })
    // A new over-limit item is always rejected.
    expect(draftAdmission(itemView, [
      { type: 'item.add', item: { clientRef: 'new', kind: 'invariant', text: 'k'.repeat(60), order: 2 } },
    ])).toMatchObject({ ok: false, reason: 'max-item' })
  })

  it('refuses a field-budget violation in applyDraft without calling the Remote', async () => {
    const requests: CharterEditRequest[] = []
    const fake = source({
      edit: async request => {
        requests.push(request)
        return { ok: true, replayed: false, committedRevision: 2, ids: {}, view: view(2) }
      },
    })
    const bigItem = committedInvariant({ id: 'big', text: 'i'.repeat(100), order: 1 })
    const constrained = view(1, {
      items: [bigItem],
      limits: { ...view(1).limits, maxItemBytes: 50 },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-field-budget')
    draft.stage(constrained, { type: 'item.edit', itemId: 'big', text: 'i'.repeat(120) })
    await draft.applyDraft(constrained)
    expect(requests).toHaveLength(0)
    expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'error', code: 'QUOTA_EXCEEDED' })
  })

  it('locks every edit action while an edit replay is pending and retries exactly once', async () => {
    const requests: CharterEditRequest[] = []
    let first = true
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (first) {
          first = false
          throw new Error('lost after commit')
        }
        return { ok: true, replayed: true, committedRevision: 2, ids: {}, view: view(2) }
      },
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-replay-lock')
    const rev1 = view(1)
    draft.stage(rev1, {
      type: 'item.add',
      item: { clientRef: 'm1', kind: 'invariant', text: 'Once', order: 0 },
    })
    await draft.applyDraft(rev1)
    expect(editReplayPending(draft.getSnapshot())).toBe(true)
    // A conflicting reconnected view does not turn the retry into a fresh batch.
    const conflictView = view(2, {
      items: [committedInvariant({ id: 'host-1', text: 'Once', order: 1 })],
      limits: { ...view(2).limits, maxItems: 1 },
    })
    expect(editReplayPending(draft.getSnapshot())).toBe(true)
    const before = draft.getSnapshot()
    draft.stage(conflictView, {
      type: 'item.add',
      item: { clientRef: 'm2', kind: 'invariant', text: 'Second', order: 2 },
    })
    draft.unstage('draft:m1')
    draft.addItem(conflictView, 'invariant', 'Another', () => undefined)
    draft.openEditor({ kind: 'objective' }, conflictView)
    draft.setEditorText('typing')
    draft.discard()
    draft.rebase(conflictView)
    expect(draft.getSnapshot()).toMatchObject({
      attempt: before.attempt,
      ops: before.ops,
      baseRevision: before.baseRevision,
      editor: null,
    })
    expect(rebaseAvailable(draft.getSnapshot())).toBe(false)

    await draft.applyDraft(conflictView)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(draft.getSnapshot()).toMatchObject({ ops: [], attempt: null, feedback: { kind: 'replayed' } })
    expect(editReplayPending(draft.getSnapshot())).toBe(false)
    // Edits and rebase unlock only after the replay resolved.
    draft.stage(conflictView, {
      type: 'item.add',
      item: { clientRef: 'm3', kind: 'invariant', text: 'After', order: 2 },
    })
    expect(draft.getSnapshot().ops).toHaveLength(1)
  })

  it('replays a bootstrap request before fresh stale/admission checks', async () => {
    const requests: CharterEditRequest[] = []
    let first = true
    const fake = source({
      edit: async request => {
        requests.push(request)
        if (first) {
          first = false
          throw new Error('lost after the Host committed the bootstrap')
        }
        return { ok: true, replayed: true, committedRevision: 2, ids: {}, view: view(2) }
      },
      snapshot: () => ({ status: 'ready', view: view(0, { limits: { ...view(0).limits, maxPromptBytes: 200 } }), error: null }),
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Reviewed objective',
          invariants: ['First candidate invariant', 'Second candidate invariant'],
          deliverables: ['First candidate deliverable'],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    })
    const baseView = view(0, { limits: { ...view(0).limits, maxPromptBytes: 200 } })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-bootstrap-replay')
    draft.ensureBootstrap(baseView, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    await draft.applyBootstrap(baseView)
    expect(bootstrapReplayPending(draft.getSnapshot())).toBe(true)
    // The reviewed payload stays visible and replayable.
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'draft',
      bootstrapBaseRevision: 0,
      bootstrapSaving: false,
    })
    expect(draft.getSnapshot().bootstrap).not.toBeNull()
    const before = draft.getSnapshot()
    draft.setBootstrapObjective('changed')
    draft.updateBootstrapItem(before.bootstrapItems[0]!.id, { selected: false })
    draft.setAllBootstrapSelected(false)
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapObjective: before.bootstrapObjective,
      bootstrapItems: before.bootstrapItems,
    })

    // Tightened limits/plan would reject a fresh batch; replay must still send
    // the exact retained request and succeed.
    const tightened = view(0, { limits: { ...view(0).limits, maxOps: 1, maxItems: 1, maxPromptBytes: 50 } })
    await draft.applyBootstrap(tightened)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(draft.getSnapshot().bootstrapPhase).toBe('dismissed')
    expect(draft.getSnapshot().bootstrap).toBeNull()
    expect(draft.getSnapshot().attempt).toBeNull()
    // Feedback counts come from the retained request, not a fresh re-plan.
    const retainedProposals = requests[0]!.ops.filter(op => op.type === 'item.propose').length
    if (retainedProposals > 0) {
      expect(draft.getSnapshot().feedback).toMatchObject({ kind: 'bootstrapSaved' })
    }
    expect(draft.isEmpty).toBe(true)
  })

  it('keeps a bootstrap draft visible across a stream change until the RPC outcome is known', async () => {
    let rejectApply: ((error: Error) => void) | undefined
    const pending = new Promise<never>((_resolve, reject) => { rejectApply = reject })
    const fake = source({
      edit: () => pending,
      snapshot: () => ({ status: 'ready', view: view(0), error: null }),
      bootstrap: async () => ({
        available: true,
        proposal: {
          objective: 'Reviewed objective',
          invariants: ['Keep it'],
          deliverables: [],
          source: { summarySeq: 1, at: 1 },
        },
      }),
    })
    const draft = new CharterDraft(sessionId, () => fake)
    draft.bindLifecycle('life-bootstrap-stream')
    draft.ensureBootstrap(view(0), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapPhase).toBe('draft')
    const applying = draft.applyBootstrap(view(0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(draft.getSnapshot().bootstrapSaving).toBe(true)

    // A non-empty view arrives while the RPC is in flight: do not half-dismiss.
    const nonEmpty = view(0, { items: [committedInvariant({ id: 'external', text: 'External', order: 1 })] })
    draft.markBootstrapStale(nonEmpty)
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'draft',
      bootstrapSaving: true,
      bootstrapNeedsStale: true,
    })
    expect(draft.getSnapshot().bootstrap).not.toBeNull()

    rejectApply!(new Error('transport lost after the frame'))
    await applying
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'draft',
      bootstrapSaving: false,
      bootstrapNeedsStale: true,
      bootstrapBaseRevision: 0,
      bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
    })
    expect(draft.getSnapshot().bootstrap).not.toBeNull()
    expect(draft.getSnapshot().attempt).not.toBeNull()
    expect(bootstrapReplayPending(draft.getSnapshot())).toBe(true)
    expect(draft.isEmpty).toBe(false)

    // Explicit dismiss is the single full cleanup.
    draft.dismissBootstrap()
    expect(draft.getSnapshot()).toMatchObject({
      bootstrapPhase: 'dismissed',
      bootstrap: null,
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapBaseRevision: null,
      bootstrapNeedsStale: false,
      bootstrapSaving: false,
      attempt: null,
    })
    expect(draft.isEmpty).toBe(true)
  })

  it('does not steal the current section when a draft arrives while editing', async () => {
    const fakeSource = source({
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
    })
    const fake = new CharterDraft(sessionId, () => fakeSource)
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
