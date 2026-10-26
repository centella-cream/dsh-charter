import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterClientState, CharterSessionSource } from '../../src/client/store.js'
import type { CharterView } from '../../src/host/types.js'
import type { CharterRecordOperationResult } from '../../src/host/types.js'
import { CharterDraft, maintenanceReplayPending } from '../../src/client/draft-store.js'

const sessionId = SessionId('recovery-lifecycle-races')
const lifecycle = JSON.stringify({ createdAt: 1_700_000_000_000, cwd: '/work', parentSession: null })

function view(life = lifecycle): CharterView {
  return {
    status: 'unavailable',
    sessionId,
    revision: 0,
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
      maintenanceLimit: 16,
      maxRecoveryBytes: 4_194_304,
    },
    overBudget: false,
    lifecycle: life,
    recordState: { kind: 'absent-unconfirmed', source: 'resume' },
    capabilities: { recordMaintenance: true },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function fakeSource(initializeRecord: (request: never) => Promise<CharterRecordOperationResult>) {
  const accepted: CharterView[] = []
  const state: CharterClientState = { status: 'ready', view: view(), error: null }
  const source = {
    sessionId,
    connectionGeneration: 1,
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    edit: async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: 'unused' }),
    bootstrap: async () => ({ available: false as const, reason: 'unavailable' as const }),
    accept: (next: CharterView) => { accepted.push(next) },
    retry: () => undefined,
    exportRecord: async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: 'unused' }),
    initializeRecord,
    restoreRecord: async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: 'unused' }),
  } as unknown as CharterSessionSource
  return { source, accepted }
}

describe('maintenance lifecycle races', () => {
  it('turns an in-flight maintenance attempt into an explicit unknown outcome when lifecycle changes', async () => {
    const pending = deferred<CharterRecordOperationResult>()
    const harness = fakeSource(() => pending.promise)
    const draft = new CharterDraft(sessionId, () => harness.source)
    draft.bindLifecycle(lifecycle)
    const operation = draft.initializeEmpty(view())
    expect(draft.getSnapshot()).toMatchObject({ maintenanceSaving: true })
    draft.bindLifecycle('lifecycle-replaced')
    expect(draft.getSnapshot()).toMatchObject({
      lifecycle: 'lifecycle-replaced',
      maintenanceSaving: false,
      maintenanceProblem: { kind: 'unavailable', code: 'UNAVAILABLE' },
    })
    expect(maintenanceReplayPending(draft.getSnapshot())).toBe(true)
    pending.resolve({ ok: true, replayed: false, committedRevision: 0, view: view() })
    await operation
    // The old completion is fenced by the async generation and cannot unlock or
    // accept the old lifecycle view.
    expect(harness.accepted).toHaveLength(0)
    expect(maintenanceReplayPending(draft.getSnapshot())).toBe(true)
  })

  it('accepts the authoritative write-uncertain view carried by a failed maintenance result', async () => {
    const uncertain: CharterView = {
      ...view(),
      status: 'unavailable',
      recordState: { kind: 'write-uncertain', operation: 'initialize' },
    }
    const harness = fakeSource(async () => ({
      ok: false,
      code: 'UNAVAILABLE',
      message: 'write outcome uncertain',
      view: uncertain,
    }))
    const draft = new CharterDraft(sessionId, () => harness.source)
    draft.bindLifecycle(lifecycle)
    await draft.initializeEmpty(view())
    expect(harness.accepted).toEqual([uncertain])
    expect(maintenanceReplayPending(draft.getSnapshot())).toBe(true)
  })
})
