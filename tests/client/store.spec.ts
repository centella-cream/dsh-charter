import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'

// The DSH 0.2.0 package has no Node-specific client entry; the store test only
// exercises state acceptance, so a structural stub is sufficient and portable.
vi.mock('@deepseek-ai/dsh-api-gateway/client', () => ({
  RemoteSnapshotStream: class {},
}))
import type { CharterView } from '../../src/host/types.js'
import { CharterSessionSource } from '../../src/client/store.js'

function view(revision: number, promptText = ''): CharterView {
  return {
    status: 'ready',
    sessionId: 'session-1',
    revision,
    objective: null,
    items: [],
    promptText,
    promptDigest: promptText === '' ? '' : `sha256:${'0'.repeat(64)}`,
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxActiveInvariants: 24,
      maxActiveDeliverables: 16,
      maxOps: 64,
    },
  }
}

describe('client charter source', () => {
  it('accepts a committed view immediately and ignores stale or duplicate revisions', async () => {
    const source = new CharterSessionSource({} as never, SessionId('session-1'))
    const seen: number[] = []
    const unsubscribe = source.subscribe(() => seen.push(source.getSnapshot().view?.revision ?? -1))

    source.accept(view(1, 'first'))
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 1 } })

    source.accept(view(1, 'first'))
    expect(seen).toEqual([1])

    source.accept(view(0, 'stale'))
    expect(source.getSnapshot().view?.revision).toBe(1)

    source.accept(view(2, 'second'))
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 2 } })
    expect(seen).toEqual([1, 2])

    unsubscribe()
    await source.dispose()
  })
})
