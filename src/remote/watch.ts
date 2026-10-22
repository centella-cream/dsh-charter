import type { CharterView } from '../host/types.js'
import type { CharterFrame } from './wire.js'

interface QueueWaiter {
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

/** Keeps only the newest view; a slow consumer never replays intermediate states. */
export class LatestViewQueue {
  private pending: CharterView | undefined
  private waiter: QueueWaiter | undefined
  private closed = false

  push(view: CharterView): void {
    if (this.closed) return
    this.pending = view
    this.waiter?.resolve()
    this.waiter = undefined
  }

  take(): CharterView | undefined {
    const view = this.pending
    this.pending = undefined
    return view
  }

  async wait(signal: AbortSignal): Promise<void> {
    if (this.pending !== undefined || this.closed) return
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort)
        if (this.waiter?.resolve === settleResolve) this.waiter = undefined
        reject(signal.reason ?? new Error('charter watch aborted'))
      }
      const settleResolve = (): void => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      this.waiter = { resolve: settleResolve, reject }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
      } else if (this.pending !== undefined || this.closed) {
        this.waiter = undefined
        settleResolve()
      }
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending = undefined
    this.waiter?.resolve()
    this.waiter = undefined
  }
}

export function sameCharterView(left: CharterView, right: CharterView): boolean {
  return left.status === right.status
    && left.revision === right.revision
    && left.promptDigest === right.promptDigest
    && left.message === right.message
    && left.lifecycle === right.lifecycle
}

export interface CharterWatchSource {
  /** Read the committed view. Must be synchronous and side-effect free. */
  readonly read: () => CharterView
  /** Register a change listener before the opening snapshot is read. */
  readonly subscribe: (listener: (view: CharterView | null) => void) => () => void
}

/**
 * Stream every committed view, beginning with one opening snapshot per
 * physical generation.
 *
 * The listener is registered before the opening read, so a write that races
 * with the read is queued rather than lost. Each later frame carries the full
 * current view; intermediate views may be coalesced. A revision with the same
 * status, digest and message as the last sent frame is skipped by consumers on
 * both sides.
 */
export async function* watchCharter(
  source: CharterWatchSource,
  signal: AbortSignal,
): AsyncGenerator<CharterFrame> {
  signal.throwIfAborted()
  const queue = new LatestViewQueue()
  const unsubscribe = source.subscribe(view => {
    if (view === null) queue.close()
    else queue.push(view)
  })
  try {
    let published = source.read()
    yield { type: 'snapshot', value: published }

    const duringOpening = queue.take()
    if (duringOpening !== undefined && !sameCharterView(duringOpening, published)) {
      published = duringOpening
      yield { type: 'changed', value: published }
    }

    while (!signal.aborted) {
      await queue.wait(signal)
      if (queue.isClosed) return
      const next = queue.take()
      if (next === undefined || sameCharterView(next, published)) continue
      published = next
      yield { type: 'changed', value: next }
    }
  } finally {
    unsubscribe()
    queue.close()
  }
}
