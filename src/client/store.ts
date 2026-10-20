import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  RemoteSnapshotStream,
  type RemoteStream,
} from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { CharterEditRequest } from '../core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../host/types.js'
import type {
  CharterChangedFrame,
  CharterFrame,
  CharterSnapshotFrame,
} from '../remote/wire.js'

export interface CharterClientState {
  readonly status: 'connecting' | 'ready' | 'error'
  readonly view: CharterView | null
  readonly error: string | null
}

export interface CharterSource {
  readonly getSnapshot: () => CharterClientState
  readonly subscribe: (listener: () => void) => () => void
  readonly edit: (request: CharterEditRequest) => Promise<CharterEditResult>
  /** Extract a review-only draft from the latest compaction summary. */
  readonly bootstrap: () => Promise<CharterBootstrapResult>
  /** Apply a committed view returned by edit immediately, without waiting for the stream. */
  readonly accept: (view: CharterView) => void
  readonly retry: () => void
}

type CharterRemote = TypertRemoteNamespaceMap['charter']

const INITIAL_STATE: CharterClientState = {
  status: 'connecting',
  view: null,
  error: null,
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CharterSessionSource implements CharterSource {
  private state = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private stream: RemoteStream<CharterFrame> | undefined
  private snapshotStream: RemoteSnapshotStream<CharterSnapshotFrame, CharterChangedFrame> | undefined
  private remote: CharterRemote | undefined
  private attachGeneration = 0

  constructor(
    private readonly ctx: ClientContext,
    readonly sessionId: SessionId,
  ) {}

  readonly getSnapshot = (): CharterClientState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly bootstrap = async (): Promise<CharterBootstrapResult> => {
    const remote = this.remote
    if (remote === undefined) return { available: false, reason: 'unavailable' }
    const result = await remote.bootstrap(this.sessionId)
    if (!result.ok) throw result.error
    return result.value
  }

  readonly edit = async (request: CharterEditRequest): Promise<CharterEditResult> => {
    const remote = this.remote
    if (remote === undefined) {
      return { ok: false, code: 'UNAVAILABLE', message: 'Charter connection is unavailable.' }
    }
    const result = await remote.edit(request)
    if (!result.ok) throw result.error
    return result.value
  }

  readonly accept = (view: CharterView): void => {
    if (view.sessionId !== this.sessionId) return
    this.publishIfNewer(view)
  }

  readonly retry = (): void => {
    this.snapshotStream?.restart()
  }

  attach(remote: CharterRemote): void {
    const generation = ++this.attachGeneration
    if (this.remote === remote && this.snapshotStream !== undefined) return
    void this.stop().then(() => {
      if (generation !== this.attachGeneration) return
      this.remote = remote
      this.publish({ ...this.state, status: 'connecting', error: null })
      const stream = this.ctx.remote.$stream<CharterFrame>({
        name: `dsh-charter:${this.sessionId}`,
        open: signal => remote.watch(this.sessionId, signal),
        ended: accepted => new Error(
          accepted
            ? 'Charter stream ended after its snapshot.'
            : 'Charter stream ended before its snapshot.',
        ),
      })
      const snapshots = new RemoteSnapshotStream<CharterSnapshotFrame, CharterChangedFrame>(stream, {
        name: `dsh-charter:${this.sessionId}`,
        isSnapshot: (frame): frame is CharterSnapshotFrame => frame.type === 'snapshot',
        replace: frame => this.publish({ status: 'ready', view: frame.value, error: null }),
        update: frame => this.publishIfNewer(frame.value),
        failed: error => this.publish({ ...this.state, status: 'error', error: messageOf(error) }),
      })
      this.stream = stream
      this.snapshotStream = snapshots
      snapshots.start()
    }).catch(error => {
      if (generation !== this.attachGeneration) return
      this.publish({ ...this.state, status: 'error', error: messageOf(error) })
    })
  }

  detach(remote: CharterRemote): void {
    if (this.remote !== remote) return
    this.attachGeneration += 1
    this.remote = undefined
    void this.stop().finally(() => {
      this.publish({ ...this.state, status: 'error', error: 'Charter connection is unavailable.' })
    })
  }

  async dispose(): Promise<void> {
    this.attachGeneration += 1
    this.remote = undefined
    await this.stop()
    this.listeners.clear()
  }

  private publishIfNewer(view: CharterView): void {
    const current = this.state.view
    if (current !== null && view.revision < current.revision) return
    if (current !== null
      && view.revision === current.revision
      && view.status === current.status
      && view.promptDigest === current.promptDigest
      && view.message === current.message) return
    this.publish({ status: 'ready', view, error: null })
  }

  private publish(state: CharterClientState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }

  private async stop(): Promise<void> {
    const snapshots = this.snapshotStream
    const stream = this.stream
    this.snapshotStream = undefined
    this.stream = undefined
    if (snapshots !== undefined) await snapshots.dispose()
    else if (stream !== undefined) await stream.dispose()
  }
}

export class CharterClientController {
  private remote: CharterRemote | undefined
  private readonly sources = new Map<SessionId, CharterSessionSource>()

  constructor(private readonly ctx: ClientContext) {}

  source(sessionId: SessionId): CharterSessionSource {
    let source = this.sources.get(sessionId)
    if (source === undefined) {
      source = new CharterSessionSource(this.ctx, sessionId)
      this.sources.set(sessionId, source)
      if (this.remote !== undefined) source.attach(this.remote)
    }
    return source
  }

  attach(remote: CharterRemote): void {
    this.remote = remote
    for (const source of this.sources.values()) source.attach(remote)
  }

  detach(remote: CharterRemote): void {
    if (this.remote !== remote) return
    this.remote = undefined
    for (const source of this.sources.values()) source.detach(remote)
  }

  async dispose(): Promise<void> {
    this.remote = undefined
    await Promise.all([...this.sources.values()].map(source => source.dispose()))
    this.sources.clear()
  }
}
