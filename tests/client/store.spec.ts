import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'

interface MockStreamOptions {
  readonly replace: (frame: { readonly value: CharterView }) => void
  readonly update: (frame: { readonly value: CharterView }) => void
  readonly failed: (error: unknown) => void
}

// The DSH 0.2.0 package has no Node-specific client entry; the store test only
// exercises state acceptance, so a structural stub is sufficient and portable.
vi.mock('@deepseek-ai/dsh-api-gateway/client', () => {
  class RemoteSnapshotStream {
    static instances: RemoteSnapshotStream[] = []
    readonly options: MockStreamOptions
    disposed: Promise<void>
    resolveDispose!: () => void
    constructor(_stream: unknown, options: MockStreamOptions) {
      this.options = options
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

function view(revision: number, promptText = '', sessionId = 'session-1'): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision,
    objective: null,
    items: [],
    promptText,
    overBudget: false,
    promptDigest: promptText === ''
      ? ''
      : `sha256:${createHash('sha256').update(promptText).digest('hex')}`,
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1024,
      maxRecordBytes: 1_048_576,
    },
  }
}

interface MockStreamInstance {
  readonly options: MockStreamOptions
  resolveDispose: () => void
}

const mockClass = MockRemoteSnapshotStream as unknown as {
  instances: Array<MockStreamInstance>
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function streamContext(): never {
  return { remote: { $stream: () => ({ dispose: async () => {} }) } } as never
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

    source.accept(view(9, 'other session', 'session-2'))
    expect(source.getSnapshot().view?.revision).toBe(2)

    unsubscribe()
    await source.dispose()
  })

  it('does not let an old detach overwrite a newer attach', async () => {
    const controller = new CharterClientController(streamContext())
    const lease = controller.acquire(SessionId('session-race'))
    const source = lease.source
    const oldRemote = {} as never
    const newRemote = {} as never
    source.attach(oldRemote)
    await tick()
    const oldStream = mockClass.instances.at(-1)
    source.detach(oldRemote)
    source.attach(newRemote)
    oldStream?.resolveDispose()
    await tick()
    expect(source.getSnapshot().status).toBe('connecting')
    mockClass.instances.at(-1)?.resolveDispose()
    lease.release()
    await controller.dispose()
  })

  it('shares one source between view bindings and disposes it only after the last lease', async () => {
    const controller = new CharterClientController({} as never)
    const sessionId = SessionId('session-release')
    const first = controller.acquire(sessionId)
    const second = controller.acquire(sessionId)
    expect(second.source).toBe(first.source)

    const seen: number[] = []
    const unsubscribe = first.source.subscribe(
      () => seen.push(first.source.getSnapshot().view?.revision ?? -1),
    )

    first.release()
    first.release()
    second.source.accept(view(1, 'first', 'session-release'))
    expect(seen).toEqual([1])

    // The last lease disposes the shared source; a later binding gets a new one.
    second.release()
    const third = controller.acquire(sessionId)
    expect(third.source).not.toBe(first.source)

    third.release()
    unsubscribe()
    await controller.dispose()
  })

  it('evicts the least recently used released draft when the map grows', async () => {
    const controller = new CharterClientController({} as never)
    const first = controller.acquire(SessionId('session-draft-0'))
    const firstDraft = first.draft
    first.release()
    for (let index = 1; index <= 16; index += 1) {
      const lease = controller.acquire(SessionId(`session-draft-${index}`))
      lease.release()
    }
    const again = controller.acquire(SessionId('session-draft-0'))
    expect(again.draft).not.toBe(firstDraft)
    again.release()
    await controller.dispose()
  })

  it('cannot release a newer acquire cycle through a stale binding', async () => {
    const controller = new CharterClientController({} as never)
    const sessionId = SessionId('session-stale')
    const stale = controller.acquire(sessionId)
    stale.release()
    const current = controller.acquire(sessionId)
    stale.release()
    expect(current.source.getSnapshot().status).toBe('connecting')
    current.release()
    await controller.dispose()
  })

  it('does not let an opening snapshot roll back an accepted revision', async () => {
    const controller = new CharterClientController(streamContext())
    const lease = controller.acquire(SessionId('session-1'))
    // An edit response is accepted before the older stream generation delivers
    // its opening snapshot.
    lease.source.accept(view(2, 'accepted'))
    lease.source.attach({} as never)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')

    stream.options.replace({ value: view(1, 'opening snapshot') })
    expect(lease.source.getSnapshot().view).toMatchObject({ revision: 2, promptText: 'accepted' })

    // Equal revisions keep the newer authoritative snapshot.
    stream.options.replace({ value: view(2, 'authoritative') })
    expect(lease.source.getSnapshot().view).toMatchObject({ revision: 2, promptText: 'authoritative' })

    stream.options.replace({ value: view(3, 'next generation') })
    expect(lease.source.getSnapshot().view).toMatchObject({ revision: 3 })

    stream.resolveDispose()
    lease.release()
    await controller.dispose()
  })

  it('retries an attach that failed before the stream existed', async () => {
    let attempts = 0
    const ctx = {
      remote: {
        $stream: () => {
          attempts += 1
          if (attempts === 1) throw new Error('mount failed')
          return { dispose: async () => {} }
        },
      },
    } as never
    const controller = new CharterClientController(ctx)
    const lease = controller.acquire(SessionId('session-retry'))
    lease.source.attach({} as never)
    await tick()
    expect(lease.source.getSnapshot().status).toBe('error')
    lease.source.retry()
    await tick()
    expect(attempts).toBeGreaterThan(1)
    mockClass.instances.at(-1)?.resolveDispose()
    lease.release()
    await controller.dispose()
  })

  it('accepts an authoritative availability demotion after a ready revision', async () => {
    const controller = new CharterClientController(streamContext())
    const lease = controller.acquire(SessionId('session-1'))
    lease.source.accept(view(2, 'ready'))
    lease.source.attach({} as never)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')
    stream.options.replace({
      value: {
        ...view(0, ''),
        status: 'unavailable',
        message: 'Stored charter cannot be read by this version',
      },
    })
    expect(lease.source.getSnapshot().view).toMatchObject({
      status: 'unavailable',
      revision: 0,
    })
    stream.resolveDispose()
    lease.release()
    await controller.dispose()
  })

  it('ignores stream frames for another Session', async () => {
    const controller = new CharterClientController(streamContext())
    const lease = controller.acquire(SessionId('session-1'))
    lease.source.attach({} as never)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')

    stream.options.replace({ value: view(1, 'wrong', 'session-2') })
    expect(lease.source.getSnapshot().status).toBe('connecting')
    stream.options.update({ value: view(2, 'wrong', 'session-2') })
    expect(lease.source.getSnapshot().status).toBe('connecting')

    stream.options.replace({ value: view(3, 'right') })
    expect(lease.source.getSnapshot()).toMatchObject({
      status: 'ready',
      view: { revision: 3, sessionId: 'session-1' },
    })

    stream.resolveDispose()
    lease.release()
    await controller.dispose()
  })
})
