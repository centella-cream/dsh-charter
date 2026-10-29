import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterClientState, CharterSessionSource } from '../../src/client/store.js'
import type { CharterView } from '../../src/host/types.js'
import type { CharterItem } from '../../src/core/schemas.js'
import { CharterDraft } from '../../src/client/draft-store.js'
import { CharterPane } from '../../src/client/CharterPane.js'

const sessionId = SessionId('pane-workflow-session')
const lifecycle = JSON.stringify({ createdAt: 1_700_000_000_000, cwd: '/work', parentSession: null })
const trees: ReactTestRenderer[] = []

function view(overrides: Partial<CharterView> = {}): CharterView {
  return {
    status: 'ready',
    sessionId,
    lifecycle,
    revision: 1,
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
    ...overrides,
  }
}

function source(initial: CharterView, bootstrap?: () => Promise<unknown>): CharterSessionSource {
  const snapshot: CharterClientState = { status: 'ready', view: initial, error: null }
  return {
    sessionId,
    connectionGeneration: 1,
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    edit: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'unused' }),
    bootstrap: bootstrap ?? (async () => ({ available: false, reason: 'unavailable' })),
    accept: () => undefined,
    retry: () => undefined,
  } as unknown as CharterSessionSource
}

function textOf(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
}

function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll(node => node.type === 'button' && textOf(node) === label)[0]
  if (found === undefined) throw new Error(`no button ${label}: ${tree.root.findAll(n => n.type === 'button').map(textOf).join(' | ')}`)
  return found
}

function mount(sourceValue: CharterSessionSource, draft: CharterDraft): ReactTestRenderer {
  const Pane = CharterPane as unknown as React.ComponentType<Record<string, unknown>>
  let tree: ReactTestRenderer | undefined
  act(() => {
    tree = create(<Pane source={sourceValue} draft={draft} release={() => undefined} t={(key: string) => key} />)
  })
  if (tree === undefined) throw new Error('pane did not render')
  trees.push(tree)
  return tree
}

beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => {
  for (const tree of trees) act(() => tree.unmount())
  trees.length = 0
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

describe('rc.5 pane workflow acceptance', () => {
  it('keeps the empty CTA visible but disabled on an unavailable empty Charter', () => {
    const unavailable = view({
      status: 'unavailable',
      recordState: { kind: 'absent-unconfirmed', source: 'resume' },
    })
    const draft = new CharterDraft(sessionId, () => source(unavailable))
    draft.bindLifecycle(lifecycle)
    const tree = mount(source(unavailable), draft)
    expect(textOf(tree.root)).toContain('header.version')
    expect(button(tree, 'objective.set').props.disabled).toBe(true)
    expect(button(tree, 'composer.addInvariant').props.disabled).toBe(true)
  })

  it('marks projected Overview counts with After Apply', () => {
    const committed = {
      id: 'host-invariant',
      clientRef: 'host-invariant',
      kind: 'invariant',
      text: 'Committed invariant',
      order: 0,
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      createdRevision: 0,
    } as unknown as CharterItem
    const ready = view({ items: [committed] })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, {
      type: 'item.add',
      item: { clientRef: 'staged', kind: 'invariant', text: 'Staged invariant', order: 1 },
    })
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('overview.afterApply')
  })

  it('uses the bootstrap apply hint and associates it with the Apply button', async () => {
    const empty = view({ revision: 0 })
    const src = source(empty, async () => ({
      available: true,
      proposal: {
        objective: 'Reviewed objective',
        invariants: ['Reviewed invariant'],
        deliverables: [],
        source: { summarySeq: 1, at: 1 },
      },
    }))
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.ensureBootstrap(empty, true)
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      if (draft.getSnapshot().bootstrapPhase === 'draft') break
    }
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('bootstrap.applyHint')
    const apply = button(tree, 'bootstrap.apply')
    const describedBy = apply.props['aria-describedby'] as string | undefined
    expect(describedBy).toBeDefined()
    expect(tree.root.findAll(node => node.props.id === describedBy).length).toBe(1)
    const objective = tree.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'bootstrap.objective')[0]
    expect(objective?.props['aria-invalid']).toBe(false)
    expect(objective?.props['aria-describedby']).toBeDefined()
    const candidateText = tree.root.findAll(node => node.type === 'textarea' && node.props.id?.includes('-text-'))[0]
    expect(candidateText?.props['aria-invalid']).toBe(false)
    expect(candidateText?.props['aria-describedby']).toBeDefined()
  })
})

describe('rc.5 pane workflow Apply/objective acceptance', () => {
  it('shows and clears the objective staged tag', () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, { type: 'objective.redirect', text: 'New objective', reason: 'Accepted scope' })
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('tag.staged')
    const unstage = button(tree, 'discard.unstageObjective')
    act(() => unstage.props.onClick())
    expect(textOf(tree.root)).not.toContain('tag.staged')
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'discard.unstageObjective')).toHaveLength(0)
  })

  it('shows no-changes as the Apply reason and links it to the disabled Apply button', () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('apply.block.no-changes')
    const apply = button(tree, 'footer.apply')
    expect(apply.props.disabled).toBe(true)
    const describedBy = apply.props['aria-describedby'] as string | undefined
    expect(describedBy).toBeDefined()
    expect(tree.root.findAll(node => node.props.id === describedBy && textOf(node).includes('apply.block.no-changes'))).toHaveLength(1)
  })
})
