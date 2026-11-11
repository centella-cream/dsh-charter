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

describe('0.2 workspace and dependency plan', () => {
  it('renders the dependency plan and editable prerequisite selector', () => {
    const a = {
      id: 'item-a', kind: 'deliverable', text: 'Build', review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 0, createdRevision: 1, progress: 'done',
    } as unknown as CharterItem
    const b = {
      id: 'item-b', kind: 'deliverable', text: 'Release', review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 1, createdRevision: 1,
      progress: 'not-started', requires: ['item-a'],
    } as unknown as CharterItem
    const ready = view({ items: [a, b] })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('deps.title')
    expect(textOf(tree.root)).toContain('D2')
    const selects = tree.root.findAll(node => node.type === 'select' && String(node.props['aria-label']).includes('deps.editAria'))
    expect(selects).toHaveLength(2)
    expect(selects[1]?.props.value).toEqual(['item-a'])
    expect(selects[0]?.props.multiple).toBe(true)
  })

  it('stages objective proposal acceptance from Review Center', () => {
    const ready = view({
      revision: 0,
      objectiveProposals: [{
        id: 'objective-proposal-1',
        text: 'Ship the workspace',
        origin: 'user',
        review: 'pending',
        createdRevision: 1,
      }],
    })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    const accept = tree.root.findAll(node => node.type === 'button' && textOf(node) === 'review.acceptObjective')[0]
    expect(accept).toBeDefined()
    act(() => accept!.props.onClick())
    expect(draft.getSnapshot().ops).toContainEqual({
      type: 'objective.accept',
      proposalId: 'objective-proposal-1',
    })
  })

  it('lays out the message proposal as a clear form outside the card heading', async () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    ;(src as unknown as { queryMessages: () => Promise<{ ok: true; messages: readonly unknown[] }> }).queryMessages = async () => ({
      ok: true,
      messages: [{ seq: 1, role: 'user', excerpt: 'Keep the API stable', text: 'Keep the API stable', length: 20 }],
    })
    ;(src as unknown as { proposeMessage: (options: unknown) => Promise<unknown> }).proposeMessage = async () => ({
      ok: false,
      code: 'UNAVAILABLE',
      message: 'not used',
    })
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const form = tree.root.findAll(node => node.props.className === 'charter-messageproposal__form')[0]
    expect(form).toBeDefined()
    const picker = tree.root.findAll(node => node.type === 'button' && node.props['aria-label'] === 'message.pick')
    expect(picker).toHaveLength(1)
    expect(picker[0]?.props['aria-haspopup']).toBe('listbox')
    act(() => picker[0]!.props.onClick())
    expect(tree.root.findAll(node => node.props.role === 'listbox')).toHaveLength(1)
    expect(tree.root.findAll(node => node.props.role === 'option')).toHaveLength(1)
    const textarea = tree.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'message.textLabel')[0]
    expect(textarea?.props.value).toBe('Keep the API stable')
    expect(tree.root.findAll(node => node.type === 'button' && node.props['aria-pressed'] === true)).toHaveLength(1)
    expect(tree.root.findAll(node => node.type === 'details')).toHaveLength(0)
  })

  it('clears the message proposal draft when the Session changes', async () => {
    const first = view({ revision: 0 })
    const second = view({ revision: 0, sessionId: SessionId('pane-other-session') })
    const base = source(first)
    let current = first
    let snapshot: CharterClientState = { status: 'ready', view: current, error: null }
    const listeners = new Set<() => void>()
    const src = {
      ...base,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      queryMessages: async () => {
        const text = current.sessionId === sessionId ? 'Session A text' : 'Session B text'
        return { ok: true as const, messages: [{ seq: 1, role: 'user' as const, excerpt: text, text, length: text.length }] }
      },
      proposeMessage: async () => ({ ok: true as const, replayed: false, committedRevision: 1, ids: {}, view: current }),
    } as unknown as CharterSessionSource
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(tree.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'message.textLabel')[0]?.props.value)
      .toBe('Session A text')
    act(() => {
      current = second
      snapshot = { status: 'ready', view: current, error: null }
      for (const listener of [...listeners]) listener()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(tree.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'message.textLabel')[0]?.props.value)
      .toBe('Session B text')
  })

  it('stages a manual item proposal instead of an accepted item', () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    const composer = tree.root.findAll(node => node.type === 'textarea' && node.props['aria-label'] === 'composer.invariantAria')[0]
    act(() => composer?.props.onChange({ target: { value: 'Review this constraint' } }))
    const propose = tree.root.findAll(node => node.type === 'button' && textOf(node) === 'composer.proposeInvariant')[0]
    expect(propose).toBeDefined()
    act(() => propose!.props.onClick())
    expect(draft.getSnapshot().ops).toContainEqual({
      type: 'item.propose',
      item: expect.objectContaining({ kind: 'invariant', text: 'Review this constraint' }),
    })
  })

  it('keeps pending item proposals out of Workspace and reviewable in Review Center', () => {
    const pending = {
      id: 'item-p', kind: 'invariant', text: 'Pending only', review: 'pending', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'agent', order: 0, createdRevision: 1,
    } as unknown as CharterItem
    const ready = view({
      items: [pending],
      proposalBatches: [{
        id: 'batch-p',
        source: { kind: 'manual', actor: 'user', at: 1 },
        capturedAtRevision: 1,
        candidates: [{ kind: 'item', id: 'item-p' }],
      }],
    })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    expect(textOf(tree.root)).not.toContain('Pending only')
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    expect(textOf(tree.root)).toContain('review.itemProposals')
    expect(textOf(tree.root)).toContain('Pending only')
    const accept = tree.root.findAll(node => node.type === 'button' && textOf(node) === 'item.accept')[0]
    act(() => accept!.props.onClick())
    expect(draft.getSnapshot().ops).toContainEqual({ type: 'item.accept', itemId: 'item-p' })
  })

  it('reports a staged dependency cycle instead of crashing the Pane', () => {
    const a = {
      id: 'item-a', kind: 'deliverable', text: 'A', review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 0, createdRevision: 1,
      progress: 'not-started', requires: ['item-b'],
    } as unknown as CharterItem
    const b = {
      id: 'item-b', kind: 'deliverable', text: 'B', review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 1, createdRevision: 1,
      progress: 'not-started',
    } as unknown as CharterItem
    const ready = view({ items: [a, b] })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, { type: 'deliverable.requires', itemId: 'item-b', requires: ['item-a'] })
    const tree = mount(src, draft)
    expect(textOf(tree.root)).toContain('deps.conflict')
    expect(textOf(tree.root)).toContain('apply.block.dependency-conflict')
    const apply = tree.root.findAll(node => node.type === 'button' && textOf(node) === 'footer.apply')[0]
    expect(apply?.props.disabled).toBe(true)
  })

  it('moves rejected and archived items out of Workspace into Review Center', () => {
    const rejected = {
      id: 'item-r', kind: 'invariant', text: 'Rejected', review: 'rejected', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 0, createdRevision: 1,
    } as unknown as CharterItem
    const archived = {
      id: 'item-a', kind: 'invariant', text: 'Archived', review: 'accepted', lifecycle: 'archived',
      verification: { state: 'unchecked' }, origin: 'user', order: 1, createdRevision: 1,
    } as unknown as CharterItem
    const ready = view({ items: [rejected, archived] })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    expect(textOf(tree.root)).not.toContain('review.inactiveItems')
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    expect(textOf(tree.root)).toContain('review.inactiveItems')
    expect(textOf(tree.root)).toContain('Rejected')
    expect(textOf(tree.root)).toContain('Archived')
  })

  it('shows proposal batch provenance in Review Center', () => {
    const pending = {
      id: 'item-p', kind: 'invariant', text: 'Pending', review: 'pending', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'agent', order: 0, createdRevision: 1,
    } as unknown as CharterItem
    const ready = view({
      items: [pending],
      proposalBatches: [{
        id: 'batch-1',
        source: { kind: 'manual', actor: 'user', at: 1 },
        capturedAtRevision: 1,
        candidates: [{ kind: 'item', id: 'item-p' }],
      }],
    })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    act(() => tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.review'))[0]!.props.onClick())
    expect(textOf(tree.root)).toContain('review.title')
    expect(textOf(tree.root)).toContain('review.source.manual')
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

describe('rc.6 pane help and formatted preview', () => {
  it('gives every navigation section a help affordance', () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    const helps = tree.root.findAll(node => node.props.className === 'charter-nav__help')
    expect(helps).toHaveLength(3)
    expect(helps.map(node => node.props['data-tooltip'])).toEqual([
      'nav.workspaceHelp',
      'nav.reviewHelp',
      'nav.diagnosticsHelp',
    ])
  })

  it('links navigation help through aria-describedby and explains an empty preview', () => {
    const ready = view({ revision: 0 })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    const overview = tree.root.findAll(node => node.type === 'button' && textOf(node) === 'nav.workspace')[0]
    expect(overview?.props['aria-describedby']).toBe('charter-nav-help-workspace')
    const help = tree.root.findAll(node => node.props.id === 'charter-nav-help-workspace')[0]
    expect(textOf(help!)).toBe('nav.workspaceHelp')
    const context = tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.diagnostics'))[0]
    expect(context).toBeDefined()
    act(() => context!.props.onClick())
    expect(textOf(tree.root)).toContain('preview.emptyHint')
  })

  it('shows the context preview as formatted JSON by default', () => {
    const ready = view({
      revision: 1,
      objective: {
        original: { text: 'Ship the release', setAtRevision: 1 },
        current: { text: 'Ship the release', setAtRevision: 1 },
      },
      items: [{
        id: 'inv-1',
        clientRef: 'inv-1',
        kind: 'invariant',
        text: 'Keep the public API stable',
        order: 0,
        review: 'accepted',
        lifecycle: 'current',
        verification: { state: 'unchecked' },
        origin: 'user',
        createdRevision: 1,
      } as unknown as CharterItem],
    })
    const src = source(ready)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    const tree = mount(src, draft)
    const context = tree.root.findAll(node => node.type === 'button' && textOf(node).includes('nav.diagnostics'))[0]
    if (context === undefined) throw new Error('no context navigation item')
    act(() => context.props.onClick())
    const pre = tree.root.findAll(node => node.type === 'pre')[0]
    expect(pre).toBeDefined()
    expect(textOf(pre!)).toContain('"objective"')
    expect(textOf(pre!)).toContain('\n  "invariants"')
    expect(textOf(pre!)).toContain('"Keep the public API stable"')
  })
})

describe('dependency graph pane surface', () => {
  function graphDeliverable(id: string, order: number, progress: string, requires?: readonly string[]): CharterItem {
    return {
      id, kind: 'deliverable', text: `Task ${id}`, review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order, createdRevision: 1, progress,
      ...(requires === undefined ? {} : { requires: [...requires] }),
    } as unknown as CharterItem
  }

  function mountGraph(): ReactTestRenderer {
    const initial = view({
      revision: 1,
      items: [
        graphDeliverable('a', 0, 'done'),
        graphDeliverable('b', 1, 'in-progress', ['a']),
      ],
    })
    const src = source(initial)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.setSection('deliverables')
    return mount(src, draft)
  }

  it('renders the graph and the semantic list together, and can hide only the graph', () => {
    const tree = mountGraph()
    expect(textOf(tree.root)).toContain('deps.graphTitle')
    expect(textOf(tree.root)).toContain('deps.title')
    expect(tree.root.findAll(node => node.props['id'] === 'charter-dependency-list')).toHaveLength(1)
    expect(tree.root.findAll(node => node.props['aria-label'] === 'deps.graphAria')).toHaveLength(1)
    expect(textOf(tree.root)).toContain('deps.locateInGraph')

    act(() => { button(tree, 'deps.hideGraph').props.onClick() })
    expect(textOf(tree.root)).not.toContain('deps.graphTitle')
    expect(tree.root.findAll(node => node.props['id'] === 'charter-dependency-list')).toHaveLength(1)
  })

  it('expands the windowed dependency list before locating a graph node', () => {
    const items = Array.from({ length: 60 }, (_, index) => graphDeliverable(
      `item-${index}`,
      index,
      index === 59 ? 'in-progress' : 'not-started',
      index === 0 ? [] : [`item-${index - 1}`],
    ))
    const src = source(view({ revision: 1, items }))
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.setSection('deliverables')
    const tree = mount(src, draft)
    expect(tree.root.findAll(node => node.props['data-dependency-id'] === 'item-59')).toHaveLength(0)

    act(() => { button(tree, 'deps.locateInList').props.onClick() })
    expect(tree.root.findAll(node => node.props['data-dependency-id'] === 'item-59')).toHaveLength(1)
  })

  it('stages the same requires op from the graph inspector and the list select', () => {
    const items = [
      graphDeliverable('a', 0, 'not-started'),
      graphDeliverable('b', 1, 'not-started', ['a']),
      graphDeliverable('c', 2, 'not-started'),
    ]
    const initial = view({ revision: 1, items })
    const graphSource = source(initial)
    const graphDraft = new CharterDraft(sessionId, () => graphSource)
    graphDraft.bindLifecycle(lifecycle)
    graphDraft.setSection('deliverables')
    const graphTree = mount(graphSource, graphDraft)

    const graphSelect = graphTree.root.findAll(node =>
      node.type === 'select' && node.props['aria-label'] === 'deps.addRequires')[0]
    expect(graphSelect).toBeDefined()
    act(() => {
      graphSelect!.props.onChange({ target: { value: 'c' }, currentTarget: { value: '' } })
    })
    const graphOps = graphDraft.getSnapshot().ops
    expect(graphOps).toHaveLength(1)
    expect(graphOps[0]).toMatchObject({ type: 'deliverable.requires', itemId: 'b', requires: ['a', 'c'] })

    const listSource = source(initial)
    const listDraft = new CharterDraft(sessionId, () => listSource)
    listDraft.bindLifecycle(lifecycle)
    listDraft.setSection('deliverables')
    const listTree = mount(listSource, listDraft)
    const listSelect = listTree.root.findAll(node => node.type === 'select' && node.props.multiple === true)
      .find(node => Array.isArray(node.props.value) && (node.props.value as string[]).includes('a'))
    expect(listSelect).toBeDefined()
    act(() => {
      listSelect!.props.onChange({
        target: { selectedOptions: [{ value: 'a' }, { value: 'c' }] },
      })
    })
    expect(listDraft.getSnapshot().ops).toEqual(graphOps)
  })

  it('marks proposal rows as focusable for graph-to-proposal navigation', () => {
    const pending = {
      id: 'pending-a', kind: 'deliverable', text: 'Pending A', review: 'pending', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order: 0, createdRevision: 1, progress: 'not-started',
    } as unknown as CharterItem
    const initial = view({ revision: 1, items: [pending] })
    const src = source(initial)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.setSection('history')
    const tree = mount(src, draft)
    const row = tree.root.findAll(node => node.props['data-proposal-id'] === 'pending-a')[0]
    expect(row?.props.tabIndex).toBe(-1)
  })

  it('shows the graph only when at least one dependency edge exists', () => {
    const isolated = view({ revision: 1, items: [graphDeliverable('a', 0, 'done')] })
    const src = source(isolated)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.setSection('deliverables')
    const tree = mount(src, draft)
    expect(textOf(tree.root)).not.toContain('deps.graphTitle')
  })
})

describe('§6.5 dependency conflict confirmation', () => {
  function countingSource(initial: CharterView, onEdit: () => void): CharterSessionSource {
    const base = source(initial) as unknown as Record<string, unknown>
    return { ...base, edit: async () => { onEdit(); return { ok: true, revision: 1 } } } as unknown as CharterSessionSource
  }

  function deliverable(id: string, order: number, progress: string, requires?: readonly string[]): CharterItem {
    return {
      id, kind: 'deliverable', text: id, review: 'accepted', lifecycle: 'current',
      verification: { state: 'unchecked' }, origin: 'user', order, createdRevision: 1, progress,
      ...(requires === undefined ? {} : { requires: [...requires] }),
    } as unknown as CharterItem
  }

  function mountWithStagedConflict(onEdit: () => void): ReactTestRenderer {
    const ready = view({ revision: 0, items: [deliverable('item-a', 0, 'not-started')] })
    const src = countingSource(ready, onEdit)
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, {
      type: 'item.add',
      item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'in-progress', requires: ['item-a'] },
    })
    return mount(src, draft)
  }

  it('needs an explicit second click before applying a batch that introduces a conflict', async () => {
    let edits = 0
    const tree = mountWithStagedConflict(() => { edits += 1 })
    // The Change Set panel names the affected deliverable before Apply is offered.
    expect(textOf(tree.root)).toContain('changeset.conflicts')
    expect(textOf(tree.root)).toContain('changeset.conflictAdded')

    const apply = button(tree, 'footer.apply')
    expect(apply.props.disabled).toBe(false)
    await act(async () => { apply.props.onClick() })
    expect(edits).toBe(0)
    expect(textOf(tree.root)).toContain('changeset.conflictConfirmHint')

    const confirm = button(tree, 'footer.applyConfirmConflicts')
    await act(async () => { confirm.props.onClick() })
    expect(edits).toBe(1)
  })

  it('applies in one click when the batch introduces no conflict', async () => {
    let edits = 0
    const ready = view({ revision: 0, items: [deliverable('item-a', 0, 'done')] })
    const src = countingSource(ready, () => { edits += 1 })
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, {
      type: 'item.add',
      item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'not-started', requires: ['item-a'] },
    })
    const tree = mount(src, draft)
    expect(textOf(tree.root)).not.toContain('changeset.conflicts')
    await act(async () => { button(tree, 'footer.apply').props.onClick() })
    expect(edits).toBe(1)
  })

  it('drops the confirmation when the baseline is rebased', async () => {
    let edits = 0
    const ready = view({ revision: 0, items: [deliverable('item-a', 0, 'not-started')] })
    const src = countingSource(ready, () => { edits += 1 })
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, {
      type: 'item.add',
      item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'in-progress', requires: ['item-a'] },
    })
    const tree = mount(src, draft)
    await act(async () => { button(tree, 'footer.apply').props.onClick() })
    expect(textOf(tree.root)).toContain('footer.applyConfirmConflicts')

    act(() => { draft.rebase(view({ revision: 2, items: ready.items })) })
    expect(textOf(tree.root)).not.toContain('footer.applyConfirmConflicts')
    expect(edits).toBe(0)
  })

  it('drops the confirmation when the staged batch changes', async () => {
    let edits = 0
    const ready = view({ revision: 0, items: [deliverable('item-a', 0, 'not-started')] })
    const src = countingSource(ready, () => { edits += 1 })
    const draft = new CharterDraft(sessionId, () => src)
    draft.bindLifecycle(lifecycle)
    draft.stage(ready, {
      type: 'item.add',
      item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'in-progress', requires: ['item-a'] },
    })
    const tree = mount(src, draft)
    await act(async () => { button(tree, 'footer.apply').props.onClick() })
    expect(textOf(tree.root)).toContain('footer.applyConfirmConflicts')
    // Unstage everything: the confirmed state must not survive a changed batch.
    act(() => { draft.discardStaged() })
    expect(textOf(tree.root)).not.toContain('footer.applyConfirmConflicts')
    expect(edits).toBe(0)
  })
})
