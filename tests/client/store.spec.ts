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
    starts = 0
    restarts = 0
    disposeCalls = 0
    constructor(_stream: unknown, options: MockStreamOptions) {
      this.options = options
      this.disposed = new Promise(resolve => { this.resolveDispose = resolve })
      RemoteSnapshotStream.instances.push(this)
    }
    start() { this.starts += 1 }
    restart() { this.restarts += 1 }
    dispose(): Promise<void> {
      this.disposeCalls += 1
      return this.disposed
    }
  }
  return { RemoteSnapshotStream }
})
import { RemoteSnapshotStream as MockRemoteSnapshotStream } from '@deepseek-ai/dsh-api-gateway/client'
import type { CharterEditRequest } from '../../src/core/schemas.js'
import type { CharterEditResult, CharterView } from '../../src/host/types.js'
import {
  attemptEditRequest,
  attemptMutationId,
} from '../../src/client/draft-store.js'
import { CharterClientController, CharterSessionSource } from '../../src/client/store.js'

function view(
  revision: number,
  promptText = '',
  sessionId = 'session-1',
  items: CharterView['items'] = [],
): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision,
    objective: null,
    items: [...items],
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
  readonly starts: number
  readonly restarts: number
  readonly disposeCalls: number
}

const mockClass = MockRemoteSnapshotStream as unknown as {
  instances: Array<MockStreamInstance>
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function streamContext(): never {
  return { remote: { $stream: () => ({ dispose: async () => {} }) } } as never
}

describe('client charter source', () => {
  it('exposes a monotonic connection epoch across attach, retry, and detach', async () => {
    const source = new CharterSessionSource(streamContext(), SessionId('session-connection'))
    const seen: number[] = []
    const off = source.onConnectionChange(() => seen.push(source.connectionGeneration))
    const remote = {} as never
    source.attach(remote)
    await tick()
    const attached = source.connectionGeneration
    expect(attached).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(attached)
    source.retry()
    expect(source.connectionGeneration).toBeGreaterThan(attached)
    source.detach(remote)
    expect(source.connectionGeneration).toBeGreaterThan(attached)
    off()
    await source.dispose()
  })

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

  it('publishes same-revision record-state, digest, and capability changes', async () => {
    const source = new CharterSessionSource({} as never, SessionId('session-record-state'))
    const seen: string[] = []
    const unsubscribe = source.subscribe(() => {
      const view = source.getSnapshot().view
      seen.push(`${view?.revision ?? -1}:${view?.recordState?.kind ?? '-'}:${view?.capabilities?.recordMaintenance ?? '-'}`)
    })
    const first: CharterView = {
      ...view(1, 'state', 'session-record-state'),
      recordState: { kind: 'healthy', recordDigest: `sha256:${'a'.repeat(64)}` },
      capabilities: { recordMaintenance: true },
    }
    source.accept(first)
    source.accept({ ...first, recordState: { kind: 'healthy', recordDigest: `sha256:${'b'.repeat(64)}` } })
    source.accept({
      ...first,
      recordState: { kind: 'healthy', recordDigest: `sha256:${'b'.repeat(64)}` },
      capabilities: { recordMaintenance: false, recordMaintenanceReason: 'runtime' },
    })
    expect(seen).toHaveLength(3)
    expect(source.getSnapshot().view?.recordState).toMatchObject({ kind: 'healthy', recordDigest: `sha256:${'b'.repeat(64)}` })
    expect(source.getSnapshot().view?.capabilities?.recordMaintenance).toBe(false)
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

  it('cancels a pending attach when its detach arrives before the dispose resolves', async () => {
    const source = new CharterSessionSource(streamContext(), SessionId('session-pending-detach'))
    const oldRemote = {} as never
    const newRemote = {} as never
    source.attach(oldRemote)
    await tick()
    const streams = mockClass.instances.length
    expect(streams).toBeGreaterThan(0)
    const oldStream = mockClass.instances.at(-1)
    if (oldStream === undefined) throw new Error('no stream')
    // The old stream is still disposing, so this attach cannot own the remote yet.
    source.attach(newRemote)
    // Cancelling the pending attach must prevent its stream from ever starting.
    source.detach(newRemote)
    oldStream.resolveDispose()
    await tick()
    expect(mockClass.instances.length).toBe(streams)
    expect(source.getSnapshot()).toMatchObject({ status: 'error', view: null })
    await source.dispose()
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

  it('drops an empty draft as soon as its last lease is released', async () => {
    const controller = new CharterClientController({} as never)
    const first = controller.acquire(SessionId('session-empty-draft'))
    const firstDraft = first.draft
    first.release()
    const again = controller.acquire(SessionId('session-empty-draft'))
    expect(again.draft).not.toBe(firstDraft)
    again.release()
    await controller.dispose()
  })

  it('keeps dirty released drafts even when the map exceeds its LRU target', async () => {
    const controller = new CharterClientController({} as never)
    const stage = (lease: ReturnType<typeof controller.acquire>, index: number) => {
      lease.draft.stage(view(0), {
        type: 'item.add',
        item: { clientRef: `lru-${index}`, kind: 'invariant', text: `draft ${index}`, order: 0 },
      })
    }
    const first = controller.acquire(SessionId('session-draft-0'))
    stage(first, 0)
    const firstDraft = first.draft
    first.release()
    for (let index = 1; index <= 16; index += 1) {
      const lease = controller.acquire(SessionId(`session-draft-${index}`))
      stage(lease, index)
      lease.release()
    }
    const again = controller.acquire(SessionId('session-draft-0'))
    expect(again.draft).toBe(firstDraft)
    again.release()
    await controller.dispose()
  })

  it('does not idle-evict a dirty released draft', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000_000))
      const controller = new CharterClientController({} as never)
      const lease = controller.acquire(SessionId('session-idle-draft'))
      lease.draft.stage(view(0), {
        type: 'item.add',
        item: { clientRef: 'idle-1', kind: 'invariant', text: 'Keep me', order: 0 },
      })
      lease.release()
      vi.setSystemTime(new Date(1_000_000 + 31 * 60 * 1_000))
      const other = controller.acquire(SessionId('session-idle-other'))
      other.release()
      const again = controller.acquire(SessionId('session-idle-draft'))
      expect(again.draft).toBe(lease.draft)
      again.release()
      await controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not bump the generation for a duplicate attach of the live stream', async () => {
    const source = new CharterSessionSource(streamContext(), SessionId('session-duplicate-attach'))
    const remote = {} as never
    source.attach(remote)
    await tick()
    const generation = source.connectionGeneration
    source.attach(remote)
    await tick()
    expect(source.connectionGeneration).toBe(generation)
    mockClass.instances.at(-1)?.resolveDispose()
    await source.dispose()
  })

  it('ignores frames that arrive from a replaced stream generation', async () => {
    const source = new CharterSessionSource(streamContext(), SessionId('session-stale-frame'))
    const remote = {} as never
    source.attach(remote)
    await tick()
    const stale = mockClass.instances.at(-1)
    if (stale === undefined) throw new Error('no stream')
    source.detach(remote)
    await tick()
    stale.options.replace({ value: view(9, 'stale') })
    stale.options.update({ value: view(9, 'stale') })
    expect(source.getSnapshot().view?.revision).not.toBe(9)
    stale.resolveDispose()
    await source.dispose()
  })

  it('accepts the first lifecycle frame even when it arrives at a lower revision', () => {
    const source = new CharterSessionSource({} as never, SessionId('session-lifecycle-intro'))
    source.accept({ ...view(10, 'old', 'session-lifecycle-intro') })
    source.accept({ ...view(0, 'new', 'session-lifecycle-intro'), lifecycle: 'life-intro' })
    expect(source.getSnapshot().view).toMatchObject({ revision: 0, lifecycle: 'life-intro' })
  })

  it('does not dedupe a same-revision snapshot whose limits or over-budget flag changed', () => {
    const source = new CharterSessionSource({} as never, SessionId('session-config-frame'))
    source.accept(view(1, 'same', 'session-config-frame'))
    source.accept({
      ...view(1, 'same', 'session-config-frame'),
      overBudget: true,
      limits: { ...view(1, 'same', 'session-config-frame').limits, maxPromptBytes: 4_096 },
    })
    expect(source.getSnapshot().view).toMatchObject({
      overBudget: true,
      limits: { maxPromptBytes: 4_096 },
    })
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

  it('accepts a new lifecycle even when its revision and digest repeat or go backwards', () => {
    const source = new CharterSessionSource({} as never, SessionId('session-lifecycle'))
    source.accept({ ...view(10, 'old', 'session-lifecycle'), lifecycle: 'life-old' })
    const replacement = { ...view(0, 'new', 'session-lifecycle'), lifecycle: 'life-new' }
    source.accept(replacement)
    expect(source.getSnapshot().view).toMatchObject({ revision: 0, lifecycle: 'life-new' })
    // Same revision/status/digest with a different lifecycle must not be deduped.
    source.accept({ ...replacement, lifecycle: 'life-newer' })
    expect(source.getSnapshot().view?.lifecycle).toBe('life-newer')
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

  it('recovers ready when a retry delivers the same revision it already had', async () => {
    const source = new CharterSessionSource(
      streamContext(),
      SessionId('session-retry-same'),
      { attachTimeoutMs: 25 },
    )
    const remote = {} as never
    source.attach(remote)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')
    const instancesBefore = mockClass.instances.length
    let published = 0
    source.subscribe(() => { published += 1 })
    stream.options.replace({ value: view(1, 'same', 'session-retry-same') })
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 1 } })
    const publishedAfterReady = published

    source.retry()
    expect(source.getSnapshot().status).toBe('connecting')
    expect(stream.restarts).toBe(1)
    expect(mockClass.instances.length).toBe(instancesBefore)

    // The state is merely `connecting`: the identical business view must still
    // be republished as ready and clear the first-frame watchdog.
    stream.options.update({ value: view(1, 'same', 'session-retry-same') })
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 1 } })
    expect(published).toBeGreaterThan(publishedAfterReady)
    await sleep(60)
    expect(source.getSnapshot().status).toBe('ready')

    // An identical revision while already ready stays deduped.
    const publishedAfterReconnect = published
    stream.options.update({ value: view(1, 'same', 'session-retry-same') })
    expect(published).toBe(publishedAfterReconnect)

    stream.resolveDispose()
    await source.dispose()
  })

  it('recreates the snapshot stream after a terminal end and retries successfully', async () => {
    const source = new CharterSessionSource(
      streamContext(),
      SessionId('session-terminal'),
      { attachTimeoutMs: 25 },
    )
    const remote = {} as never
    source.attach(remote)
    await tick()
    const instancesAfterAttach = mockClass.instances.length
    const first = mockClass.instances.at(-1)
    if (first === undefined) throw new Error('no stream was created')
    first.options.replace({ value: view(1, 'first', 'session-terminal') })
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 1 } })

    first.options.failed(new Error('stream ended after snapshot'))
    expect(source.getSnapshot()).toMatchObject({ status: 'error' })
    expect(first.disposeCalls).toBe(1)

    // Retry must recreate the stream, not restart the aborted lifetime.
    source.retry()
    await tick()
    expect(mockClass.instances.length).toBe(instancesAfterAttach + 1)
    const second = mockClass.instances.at(-1)
    if (second === undefined) throw new Error('retry did not create a new stream')
    expect(second).not.toBe(first)
    expect(second.starts).toBe(1)

    // Re-armed watchdog must be cleared by a first snapshot; an identical view
    // still recovers ready, and no timeout error may appear.
    second.options.replace({ value: view(1, 'first', 'session-terminal') })
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 1 } })
    await sleep(60)
    expect(source.getSnapshot().status).toBe('ready')

    second.resolveDispose()
    await source.dispose()
  })

  it('recreates the snapshot stream after an end before the first snapshot', async () => {
    const source = new CharterSessionSource(
      streamContext(),
      SessionId('session-terminal-early'),
      { attachTimeoutMs: 25 },
    )
    source.attach({} as never)
    await tick()
    const instancesAfterAttach = mockClass.instances.length
    const first = mockClass.instances.at(-1)
    if (first === undefined) throw new Error('no stream was created')
    first.options.failed(new Error('stream ended before snapshot'))
    expect(source.getSnapshot()).toMatchObject({ status: 'error', view: null })

    source.retry()
    await tick()
    expect(mockClass.instances.length).toBe(instancesAfterAttach + 1)
    const second = mockClass.instances.at(-1)
    if (second === undefined) throw new Error('retry did not create a new stream')
    second.options.replace({ value: view(2, 'fresh', 'session-terminal-early') })
    expect(source.getSnapshot()).toMatchObject({ status: 'ready', view: { revision: 2 } })
    await sleep(60)
    expect(source.getSnapshot().status).toBe('ready')

    second.resolveDispose()
    await source.dispose()
  })

  it('advances the connection epoch on terminal failure so a late Apply cannot clear the draft', async () => {
    const controller = new CharterClientController(streamContext())
    const sessionId = SessionId('session-terminal-race')
    const lease = controller.acquire(sessionId)
    const requests: CharterEditRequest[] = []
    let releaseFirst: ((value: { ok: true; value: CharterEditResult }) => void) | undefined
    const first = new Promise<{ ok: true; value: CharterEditResult }>(resolve => { releaseFirst = resolve })
    let calls = 0
    const remote = {
      edit: async (request: CharterEditRequest) => {
        requests.push(request)
        calls += 1
        if (calls === 1) return first
        return {
          ok: true as const,
          value: {
            ok: true,
            replayed: false,
            committedRevision: 2,
            ids: {},
            view: view(2, 'after retry', 'session-terminal-race'),
          },
        }
      },
    } as never
    controller.attach(remote)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')
    stream.options.replace({ value: view(1, 'one', 'session-terminal-race') })
    expect(lease.source.getSnapshot().status).toBe('ready')

    lease.draft.stage(view(1, 'one', 'session-terminal-race'), {
      type: 'item.add',
      item: { clientRef: 'race-1', kind: 'invariant', text: 'Keep me', order: 0 },
    })
    const generationBefore = lease.source.connectionGeneration
    const applied = lease.draft.applyDraft(view(1, 'one', 'session-terminal-race'))
    await tick()
    expect(lease.draft.getSnapshot().saving).toBe(true)

    // The stream dies while the request is in flight: the terminal failure must
    // advance the connection epoch and invalidate the draft request without
    // clearing the staged ops or the mutation id.
    stream.options.failed(new Error('stream ended during Apply'))
    expect(lease.source.getSnapshot()).toMatchObject({ status: 'error' })
    expect(lease.source.connectionGeneration).toBeGreaterThan(generationBefore)
    expect(lease.draft.getSnapshot()).toMatchObject({
      saving: false,
      feedback: { kind: 'connection' },
      ops: [expect.objectContaining({ type: 'item.add' })],
    })

    // The old request resolves successfully later: it must not be accepted.
    releaseFirst!({
      ok: true,
      value: {
        ok: true,
        replayed: false,
        committedRevision: 2,
        ids: {},
        view: view(2, 'late success', 'session-terminal-race'),
      },
    })
    await applied
    expect(lease.source.getSnapshot()).toMatchObject({ status: 'error', view: { revision: 1 } })
    expect(lease.draft.getSnapshot().ops).toHaveLength(1)

    // Retry reuses the mutation id through the rebuilt connection.
    await lease.draft.applyDraft(view(1, 'one', 'session-terminal-race'))
    expect(requests).toHaveLength(2)
    expect(requests[1]?.mutationId).toBe(requests[0]?.mutationId)
    expect(lease.draft.getSnapshot()).toMatchObject({
      ops: [],
      feedback: { kind: 'saved', revision: 2 },
    })

    lease.release()
    await controller.dispose()
  })

  it('keeps an unknown edit attempt through detach/UNAVAILABLE and replays it exactly once', async () => {
    const controller = new CharterClientController(streamContext())
    const sessionId = SessionId('session-unknown-edit')
    const lease = controller.acquire(sessionId)
    const requests: CharterEditRequest[] = []
    const remoteOne = {
      edit: async (request: CharterEditRequest) => {
        requests.push(request)
        throw new Error('connection lost after the Host committed M1')
      },
    } as never
    controller.attach(remoteOne)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')
    stream.options.replace({ value: view(1, 'one', 'session-unknown-edit') })
    lease.draft.stage(view(1, 'one', 'session-unknown-edit'), {
      type: 'item.add',
      item: { clientRef: 'm1', kind: 'invariant', text: 'Exactly once', order: 0 },
    })
    await lease.draft.applyDraft(view(1, 'one', 'session-unknown-edit'))
    expect(lease.draft.getSnapshot().attempt).toMatchObject({ status: 'unknown' })
    const unknown = lease.draft.getSnapshot().attempt
    const committedOps = lease.draft.getSnapshot().ops
    const baseRevision = lease.draft.getSnapshot().baseRevision

    // Source detached: Retry's source.edit returns business UNAVAILABLE, which
    // must keep the attempt unknown with the exact same request/mutation id.
    controller.detach(remoteOne)
    await lease.draft.applyDraft(view(1, 'one', 'session-unknown-edit'))
    expect(lease.draft.getSnapshot().attempt).toMatchObject({ status: 'unknown' })
    expect(attemptMutationId(lease.draft.getSnapshot().attempt))
      .toBe(attemptMutationId(unknown))
    expect(lease.draft.getSnapshot().ops).toBe(committedOps)
    expect(lease.draft.getSnapshot().baseRevision).toBe(baseRevision)
    // All request-changing actions stay locked.
    lease.draft.stage(view(1, 'one', 'session-unknown-edit'), {
      type: 'item.add',
      item: { clientRef: 'm2', kind: 'invariant', text: 'Second', order: 2 },
    })
    lease.draft.unstage('draft:m1')
    lease.draft.addItem(view(1, 'one', 'session-unknown-edit'), 'invariant', 'Another', () => undefined)
    lease.draft.discardAllLocalWork()
    lease.draft.rebase(view(2, 'two', 'session-unknown-edit'))
    expect(lease.draft.getSnapshot().attempt).toMatchObject({ status: 'unknown' })
    expect(lease.draft.getSnapshot().ops).toBe(committedOps)

    // Reattach and replay: the Host receipt is replayed, applying exactly once.
    const committedItem = {
      id: 'host-m1',
      kind: 'invariant' as const,
      text: 'Exactly once',
      review: 'accepted' as const,
      lifecycle: 'current' as const,
      verification: { state: 'unchecked' as const },
      origin: 'user' as const,
      order: 1,
      createdRevision: 2,
    }
    const remoteTwo = {
      edit: async (request: CharterEditRequest) => {
        requests.push(request)
        return {
          ok: true as const,
          value: {
            ok: true,
            replayed: true,
            committedRevision: 2,
            ids: { 'draft:m1': 'host-m1' },
            view: view(2, 'two', 'session-unknown-edit', [committedItem]),
          },
        }
      },
    } as never
    controller.attach(remoteTwo)
    await tick()
    await lease.draft.applyDraft(view(2, 'two', 'session-unknown-edit', [committedItem]))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(new Set(requests.map(request => request.mutationId)).size).toBe(1)
    expect(lease.draft.getSnapshot()).toMatchObject({
      attempt: null,
      ops: [],
      feedback: { kind: 'replayed' },
    })
    // Exactly one committed item exists after the replay; no duplicate M2.
    expect(lease.source.getSnapshot().view?.items).toHaveLength(1)
    expect(lease.source.getSnapshot().view?.items[0]?.id).toBe('host-m1')
    lease.release()
    await controller.dispose()
  })

  it('keeps the exact request across repeated UNAVAILABLE replays and clears only on success', async () => {
    const controller = new CharterClientController(streamContext())
    const sessionId = SessionId('session-unknown-unavailable')
    const lease = controller.acquire(sessionId)
    const requests: CharterEditRequest[] = []
    let call = 0
    const remote = {
      edit: async (request: CharterEditRequest) => {
        requests.push(request)
        call += 1
        if (call === 1) throw new Error('lost after commit')
        if (call <= 3) {
          // The remote itself answers UNAVAILABLE (e.g. storage not ready):
          // still an unknown outcome, never a definitive failure.
          return { ok: true as const, value: { ok: false, code: 'UNAVAILABLE', message: 'storage not ready' } }
        }
        return {
          ok: true as const,
          value: {
            ok: true,
            replayed: true,
            committedRevision: 2,
            ids: { 'draft:m1': 'host-m1' },
            view: view(2, 'two', 'session-unknown-unavailable'),
          },
        }
      },
    } as never
    controller.attach(remote)
    await tick()
    const stream = mockClass.instances.at(-1)
    if (stream === undefined) throw new Error('no stream was created')
    stream.options.replace({ value: view(1, 'one', 'session-unknown-unavailable') })
    lease.draft.stage(view(1, 'one', 'session-unknown-unavailable'), {
      type: 'item.add',
      item: { clientRef: 'm1', kind: 'invariant', text: 'Once', order: 0 },
    })
    await lease.draft.applyDraft(view(1, 'one', 'session-unknown-unavailable'))
    expect(lease.draft.getSnapshot().attempt).toMatchObject({ status: 'unknown' })
    const original = lease.draft.getSnapshot().attempt

    // Repeated UNAVAILABLE replays must keep the same credentials.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await lease.draft.applyDraft(view(1, 'one', 'session-unknown-unavailable'))
      expect(lease.draft.getSnapshot().attempt).toMatchObject({ status: 'unknown' })
      expect(attemptMutationId(lease.draft.getSnapshot().attempt)).toBe(attemptMutationId(original))
      expect(attemptEditRequest(lease.draft.getSnapshot().attempt)?.baseRevision).toBe(attemptEditRequest(original)?.baseRevision)
      expect(attemptEditRequest(lease.draft.getSnapshot().attempt)?.ops).toEqual(attemptEditRequest(original)?.ops)
      expect(lease.draft.getSnapshot().ops).toEqual(attemptEditRequest(original)?.ops)
    }
    expect(requests).toHaveLength(3)
    expect(new Set(requests.map(request => request.mutationId)).size).toBe(1)

    // Only a definitive success resolves the attempt and applies exactly once.
    await lease.draft.applyDraft(view(1, 'one', 'session-unknown-unavailable'))
    expect(requests).toHaveLength(4)
    expect(requests[3]).toEqual(requests[0])
    expect(lease.draft.getSnapshot()).toMatchObject({
      attempt: null,
      ops: [],
      feedback: { kind: 'replayed' },
    })
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
