import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterClientState } from '../../src/client/store.js'
import type { CharterSessionSource } from '../../src/client/store.js'
import type { CharterView } from '../../src/host/types.js'
import { CharterDraft } from '../../src/client/draft-store.js'
import { CharterPane } from '../../src/client/CharterPane.js'

const sessionId = SessionId('pane-hooks-session')

function view(revision: number): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision,
    objective: {
      original: { text: 'Ship the release', setAtRevision: 1 },
      current: { text: 'Ship the release', setAtRevision: 1 },
    },
    items: [],
    promptText: 'Ship the release',
    promptDigest: 'sha256:pane-hooks',
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
  }
}

interface PaneSourceHarness {
  readonly source: CharterSessionSource
  readonly set: (next: CharterClientState) => void
}

function paneSource(initial: CharterClientState): PaneSourceHarness {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    retry: () => undefined,
    edit: async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: 'unused' }),
    bootstrap: async () => ({ available: false as const, reason: 'unavailable' as const }),
    accept: () => undefined,
  } as unknown as CharterSessionSource
  return {
    source,
    set: (next: CharterClientState) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function renderPane(harness: PaneSourceHarness): {
  readonly tree: ReactTestRenderer
  readonly draft: CharterDraft
} {
  const draft = new CharterDraft(sessionId, () => undefined)
  const Pane = CharterPane as unknown as React.ComponentType<Record<string, unknown>>
  let tree: ReactTestRenderer | undefined
  act(() => {
    tree = create(
      <Pane
        source={harness.source}
        draft={draft}
        release={() => undefined}
        t={(key: string) => key}
      />,
    )
  })
  if (tree === undefined) throw new Error('pane did not render')
  return { tree, draft }
}

const connecting: CharterClientState = { status: 'connecting', view: null, error: null }
const failed: CharterClientState = { status: 'error', view: null, error: 'offline' }
const ready = (revision: number): CharterClientState => ({
  status: 'ready',
  view: view(revision),
  error: null,
})

let trees: ReactTestRenderer[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const tree of trees) {
    act(() => tree.unmount())
  }
  trees = []
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

describe('CharterPane hook order across connection states', () => {
  it('renders connecting/null then the ready view without changing the hook count', () => {
    const harness = paneSource(connecting)
    const { tree } = renderPane(harness)
    trees.push(tree)
    expect(tree.toJSON()).not.toBeNull()

    // Old code returned early here and only then called the replay hooks, which
    // React rejects with "Rendered more hooks than during the previous render".
    act(() => harness.set(ready(1)))
    expect(tree.toJSON()).not.toBeNull()
    act(() => harness.set(ready(2)))
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders error/null, retries to ready, and keeps the hook count invariant', () => {
    const harness = paneSource(failed)
    const { tree } = renderPane(harness)
    trees.push(tree)
    expect(tree.toJSON()).not.toBeNull()

    act(() => harness.set(ready(1)))
    expect(tree.toJSON()).not.toBeNull()
  })

  it('keeps rendering across ready revision updates', () => {
    const harness = paneSource(ready(1))
    const { tree } = renderPane(harness)
    trees.push(tree)
    expect(tree.toJSON()).not.toBeNull()

    act(() => harness.set(ready(2)))
    expect(tree.toJSON()).not.toBeNull()
    act(() => harness.set(ready(3)))
    expect(tree.toJSON()).not.toBeNull()
  })
})
