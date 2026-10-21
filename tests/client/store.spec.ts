import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'

// The DSH 0.2.0 package has no Node-specific client entry; the store test only
// exercises state acceptance, so a structural stub is sufficient and portable.
vi.mock('@deepseek-ai/dsh-api-gateway/client', () => {
  class RemoteSnapshotStream {
    static instances: RemoteSnapshotStream[] = []
    disposed: Promise<void>
    resolveDispose!: () => void
    constructor() {
      this.disposed = new Promise(resolve => { this.resolveDispose = resolve })
      RemoteSnapshotStream.instances.push(this)
    }
    start() {}
    dispose(): Promise<void> { return this.disposed }
  }
  return { RemoteSnapshotStream }
})
import { RemoteSnapshotStream as MockRemoteSnapshotStream } from '@deepseek-ai/dsh-api-gateway/client'
import type { CharterView } from '../../src/host/types.js'
import { CharterClientController, CharterSessionSource } from '../../src/client/store.js'

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
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1024,
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

  it('does not let an old detach overwrite a newer attach', async () => {
    const controller = new CharterClientController({
      remote: { $stream: () => ({}) },
    } as never)
    const source = controller.source(SessionId('session-race'))
    const oldRemote = {} as never
    const newRemote = {} as never
    source.attach(oldRemote)
    await new Promise(resolve => setTimeout(resolve, 0))
    const mockClass = MockRemoteSnapshotStream as unknown as {
      instances: Array<{ resolveDispose: () => void }>
    }
    const oldStream = mockClass.instances.at(-1)
    source.detach(oldRemote)
    source.attach(newRemote)
    oldStream?.resolveDispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(source.getSnapshot().status).toBe('connecting')
    mockClass.instances.at(-1)?.resolveDispose()
    await controller.dispose()
  })

  it('releases a Session source when its view binding unmounts', async () => {
    const controller = new CharterClientController({} as never)
    const first = controller.source(SessionId('session-release'))
    expect(controller.source(SessionId('session-release'))).toBe(first)
    controller.release(SessionId('session-release'))
    const second = controller.source(SessionId('session-release'))
    expect(second).not.toBe(first)
    await controller.dispose()
  })
})
