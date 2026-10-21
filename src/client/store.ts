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
import { CharterDraft } from './draft-store.js'

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

const ATTACH_TIMEOUT_MS = 15_000

export class CharterSessionSource implements CharterSource {
  private state = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private stream: RemoteStream<CharterFrame> | undefined
  private snapshotStream: RemoteSnapshotStream<CharterSnapshotFrame, CharterChangedFrame> | undefined
  private remote: CharterRemote | undefined
  private attachGeneration = 0
  private watchdog: ReturnType<typeof setTimeout> | undefined

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
    // A live stream can be restarted in place; when an earlier attach failed
    // before the snapshot stream existed, attach the already mounted Remote
    // again instead of leaving Retry as a no-op.
    if (this.snapshotStream !== undefined) {
      this.snapshotStream.restart()
      this.publish({ ...this.state, status: 'connecting', error: null })
      return
    }
    if (this.remote !== undefined) {
      this.attach(this.remote)
    }
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
        replace: frame => this.publishIfNewer(frame.value),
        update: frame => this.publishIfNewer(frame.value),
        failed: error => {
          if (generation !== this.attachGeneration) return
          this.publish({ ...this.state, status: 'error', error: messageOf(error) })
        },
      })
      this.stream = stream
      this.snapshotStream = snapshots
      this.watchdog = setTimeout(() => {
        if (generation !== this.attachGeneration || this.state.status === 'ready') return
        this.publish({
          ...this.state,
          status: 'error',
          error: 'Charter connection timed out before the first snapshot.',
        })
      }, ATTACH_TIMEOUT_MS)
      this.watchdog.unref?.()
      snapshots.start()
    }).catch(error => {
      if (generation !== this.attachGeneration) return
      this.publish({ ...this.state, status: 'error', error: messageOf(error) })
    })
  }

  detach(remote: CharterRemote): void {
    if (this.remote !== remote) return
    const generation = ++this.attachGeneration
    this.remote = undefined
    void this.stop().finally(() => {
      // A later attach owns the state after this detach.
      if (generation !== this.attachGeneration) return
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
    if (view.sessionId !== this.sessionId) return
    const current = this.state.view
    if (current !== null && view.revision < current.revision) {
      // A `ready` snapshot must never roll back an accepted revision. An
      // authoritative availability demotion (for example the record becoming
      // unreadable) must still reach the Pane; `initializing` frames from a
      // new generation are not authoritative and are ignored here.
      if (view.status !== 'unavailable') return
    }
    if (current !== null
      && view.revision === current.revision
      && view.status === current.status
      && view.promptDigest === current.promptDigest
      && view.message === current.message) return
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog)
      this.watchdog = undefined
    }
    this.publish({ status: 'ready', view, error: null })
  }

  private publish(state: CharterClientState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }

  private async stop(): Promise<void> {
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog)
      this.watchdog = undefined
    }
    const snapshots = this.snapshotStream
    const stream = this.stream
    this.snapshotStream = undefined
    this.stream = undefined
    if (snapshots !== undefined) await snapshots.dispose()
    else if (stream !== undefined) await stream.dispose()
  }
}

/** One view binding's claim on a shared per-Session source. */
export interface CharterSourceLease {
  readonly source: CharterSessionSource
  /** Idempotent: only this lease counts, and only the last lease disposes the source. */
  readonly release: () => void
}

interface SourceEntry {
  readonly source: CharterSessionSource
  refs: number
}

export interface CharterViewLease {
  readonly source: CharterSessionSource
  readonly draft: CharterDraft
  readonly release: () => void
}

export class CharterClientController {
  private remote: CharterRemote | undefined
  private readonly sources = new Map<SessionId, SourceEntry>()
  private readonly drafts = new Map<SessionId, CharterDraft>()
  private static readonly MAX_DRAFTS = 16

  constructor(private readonly ctx: ClientContext) {}

  /**
   * The per-Session draft survives Pane unmounts, but the map stays bounded:
   * the least recently used draft with no active view lease is disposed when
   * more Sessions are visited.
   */
  draftFor(sessionId: SessionId): CharterDraft {
    const existing = this.drafts.get(sessionId)
    if (existing !== undefined) {
      this.drafts.delete(sessionId)
      this.drafts.set(sessionId, existing)
      return existing
    }
    const draft = new CharterDraft(sessionId, () => this.sources.get(sessionId)?.source)
    this.drafts.set(sessionId, draft)
    while (this.drafts.size > CharterClientController.MAX_DRAFTS) {
      const victim = [...this.drafts.entries()].find(([id]) => (this.sources.get(id)?.refs ?? 0) === 0)
      if (victim === undefined) break
      this.drafts.delete(victim[0])
      victim[1].dispose()
    }
    return draft
  }

  /**
   * Acquire the source for one view binding.
   *
   * Several bindings (two panes, a re-created slot, a session switch) may
   * share one Session. A bare session id is not a safe release credential:
   * only the owning lease may release, and disposal happens when the last lease
   * is gone.
   */
  acquire(sessionId: SessionId): CharterViewLease {
    let entry = this.sources.get(sessionId)
    if (entry === undefined) {
      entry = { source: new CharterSessionSource(this.ctx, sessionId), refs: 0 }
      this.sources.set(sessionId, entry)
      if (this.remote !== undefined) entry.source.attach(this.remote)
    }
    entry.refs += 1
    const held = entry
    const draft = this.draftFor(sessionId)
    let released = false
    return {
      source: held.source,
      draft,
      release: () => {
        if (released) return
        released = true
        const current = this.sources.get(sessionId)
        // A later acquire cycle owns a different entry; this lease is no-op.
        if (current !== held) return
        current.refs -= 1
        if (current.refs > 0) return
        this.sources.delete(sessionId)
        void current.source.dispose()
      },
    }
  }

  attach(remote: CharterRemote): void {
    this.remote = remote
    for (const entry of this.sources.values()) entry.source.attach(remote)
  }

  detach(remote: CharterRemote): void {
    if (this.remote !== remote) return
    this.remote = undefined
    for (const entry of this.sources.values()) entry.source.detach(remote)
  }

  async dispose(): Promise<void> {
    this.remote = undefined
    for (const draft of this.drafts.values()) draft.dispose()
    this.drafts.clear()
    await Promise.all([...this.sources.values()].map(entry => entry.source.dispose()))
    this.sources.clear()
  }
}
