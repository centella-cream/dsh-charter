import { describe, expect, it } from 'vitest'
import type { CharterView } from '../../src/host/types.js'
import { createRemoteMethodFactory } from '../../src/remote/compat.js'
import { watchCharter } from '../../src/remote/watch.js'

function view(revision: number, text = ''): CharterView {
  return {
    status: 'ready',
    sessionId: 'session-1',
    revision,
    objective: null,
    items: [],
    promptText: text,
    promptDigest: text === '' ? '' : `sha256:${'0'.repeat(64)}`,
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

class FakeSource {
  private readonly listeners = new Set<(value: CharterView) => void>()
  unsubscribed = false
  current: CharterView

  constructor(
    initial: CharterView,
    private readonly onSubscribe?: (source: FakeSource) => void,
  ) {
    this.current = initial
  }

  readonly read = (): CharterView => this.current

  readonly subscribe = (listener: (value: CharterView) => void): (() => void) => {
    this.listeners.add(listener)
    this.onSubscribe?.(this)
    return () => {
      this.listeners.delete(listener)
      this.unsubscribed = true
    }
  }

  push(next: CharterView): void {
    for (const listener of [...this.listeners]) listener(next)
  }

  commit(next: CharterView): void {
    this.current = next
    this.push(next)
  }
}

describe('charter watch generations', () => {
  it('emits one opening snapshot and then full changed views', async () => {
    const source = new FakeSource(view(1, 'first'))
    const controller = new AbortController()
    const iterator = watchCharter(source, controller.signal)

    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'snapshot', value: view(1, 'first') },
    })
    source.commit(view(2, 'second'))
    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'changed', value: view(2, 'second') },
    })

    source.commit(view(2, 'second'))
    source.commit(view(3, 'third'))
    expect(await iterator.next()).toEqual({
      done: false,
      value: { type: 'changed', value: view(3, 'third') },
    })

    controller.abort(new Error('test complete'))
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    expect(source.unsubscribed).toBe(true)
  })

  it('does not lose a write that races with the opening read', async () => {
    let source: FakeSource | undefined
    source = new FakeSource(view(1, 'opening'), self => {
      self.push(view(2, 'raced'))
    })
    const controller = new AbortController()
    const iterator = watchCharter(source, controller.signal)

    expect((await iterator.next()).value).toMatchObject({ type: 'snapshot', value: { revision: 1 } })
    expect((await iterator.next()).value).toMatchObject({ type: 'changed', value: { revision: 2 } })

    controller.abort(new Error('test complete'))
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
  })

  it('closes the subscription when the consumer returns early', async () => {
    const source = new FakeSource(view(1))
    const controller = new AbortController()
    const iterator = watchCharter(source, controller.signal)
    await iterator.next()
    await iterator.return?.(undefined)
    expect(source.unsubscribed).toBe(true)
  })
})

describe('Remote decorator compatibility', () => {
  it('passes modern resource options when the runtime accepts them', () => {
    const calls: unknown[] = []
    const modern = (options: unknown): (() => void) => {
      calls.push(options)
      return () => undefined
    }
    const factory = createRemoteMethodFactory(modern)
    const decorator = factory({ mode: 'stream', resources: { session: () => 's' } })
    expect(typeof decorator).toBe('function')
    expect(calls).toEqual([{ mode: 'stream', resources: { session: expect.any(Function) } }])
  })

  it('falls back to the 0.2.0 stream and direct forms', () => {
    const calls: unknown[] = []
    const legacy = (methodOrOptions: unknown, context?: unknown): undefined | (() => void) => {
      if (typeof methodOrOptions === 'function' && context !== undefined) {
        calls.push({ kind: 'direct' })
        return undefined
      }
      const keys = Reflect.ownKeys(methodOrOptions as object)
      const mode = (methodOrOptions as { mode?: string }).mode
      if (keys.length !== 1 || keys[0] !== 'mode' || mode !== 'stream') {
        throw new TypeError('legacy Remote options must be exactly mode: "stream"')
      }
      calls.push({ kind: 'stream' })
      return () => undefined
    }
    const factory = createRemoteMethodFactory(legacy)

    const stream = factory({ mode: 'stream', resources: { session: () => 's' } })
    stream(() => undefined, {} as never)
    expect(calls).toEqual([{ kind: 'stream' }])

    const direct = factory({ resources: { session: () => 's' } })
    direct(() => undefined, {} as never)
    expect(calls).toEqual([{ kind: 'stream' }, { kind: 'direct' }])
  })
})
