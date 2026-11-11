import { describe, expect, it } from 'vitest'
import type { GraphInputItem } from '../../src/client/relation-graph.js'
import {
  buildRelationGraph,
  defaultFocus,
  GRAPH,
  graphNavigationTarget,
  graphOverlaps,
  layoutRelationGraph,
  LINE_CAPACITY,
} from '../../src/client/relation-graph.js'

function deliverable(
  id: string,
  order: number,
  progress: 'not-started' | 'in-progress' | 'blocked' | 'done' | 'cancelled',
  requires: readonly string[] = [],
  extra: Partial<GraphInputItem> = {},
): GraphInputItem {
  return {
    id,
    kind: 'deliverable',
    text: `Deliverable ${id}`,
    review: 'accepted',
    lifecycle: 'current',
    progress,
    requires,
    order,
    ...extra,
  } as GraphInputItem
}

const committed: readonly GraphInputItem[] = [
  deliverable('a', 0, 'done'),
  deliverable('b', 1, 'in-progress', ['a']),
  deliverable('c', 2, 'not-started', ['b']),
]
const projected: readonly GraphInputItem[] = [
  deliverable('a', 0, 'done'),
  deliverable('b', 1, 'in-progress', ['a']),
  deliverable('c', 2, 'in-progress', ['b']),
]

describe('relation graph projection', () => {
  it('derives execution lanes, local keys, and readiness from committed/projected items', () => {
    const model = buildRelationGraph({ committed, projected })
    const execution = model.nodes.filter(node => node.lane === 'execution')
    expect(execution.map(node => node.localKey)).toEqual(['D1', 'D2', 'D3'])
    expect(model.edges.filter(edge => edge.kind === 'requires')).toHaveLength(2)
    expect(model.nodes.find(node => node.id === 'c')?.prerequisiteStatus).toBe('dependency-conflict')
    expect(model.nodes.find(node => node.id === 'c')?.executionDisplay).toBe('in-progress')
  })

  it('keeps graph local keys aligned with the canonical order field', () => {
    const outOfIdOrder: readonly GraphInputItem[] = [
      deliverable('z-last-id', 0, 'done'),
      deliverable('a-first-id', 1, 'not-started', ['z-last-id']),
    ]
    const model = buildRelationGraph({ committed: outOfIdOrder, projected: outOfIdOrder })
    expect(model.nodes.filter(node => node.lane === 'execution').map(node => [node.id, node.localKey])).toEqual([
      ['z-last-id', 'D1'],
      ['a-first-id', 'D2'],
    ])
  })

  it('marks changed nodes and staged edges without rebuilding the committed baseline', () => {
    const model = buildRelationGraph({
      committed,
      projected: [
        deliverable('a', 0, 'done'),
        deliverable('b', 1, 'in-progress', ['a']),
        deliverable('c', 2, 'in-progress', ['a']),
      ],
    })
    expect(model.nodes.find(node => node.id === 'c')?.state).toBe('staged-changed')
    expect(model.edges.some(edge => edge.kind === 'requires' && edge.from === 'b' && edge.to === 'c' && edge.state === 'staged-removed')).toBe(true)
    expect(model.edges.some(edge => edge.kind === 'requires' && edge.from === 'a' && edge.to === 'c' && edge.state === 'staged-added')).toBe(true)
  })

  it('puts pending deliverables in a candidate lane without an execution rank or local key', () => {
    const pending: GraphInputItem = {
      id: 'p', kind: 'deliverable', text: 'Pending', review: 'pending', lifecycle: 'current',
      progress: 'not-started', proposedRequires: ['a'], order: 9,
    } as GraphInputItem
    const model = buildRelationGraph({ committed, projected: [...projected, pending] })
    const node = model.nodes.find(candidate => candidate.id === 'p')
    expect(node).toMatchObject({ lane: 'candidate', localKey: undefined, rank: undefined })
    expect(model.edges.some(edge => edge.kind === 'proposed' && edge.from === 'a' && edge.to === 'p')).toBe(true)
  })

  it('uses prerequisiteStatus, not the masked executionDisplay, for default focus', () => {
    const model = buildRelationGraph({ committed, projected })
    const focused = defaultFocus(model)
    expect(focused).toBe('c')
    const conflictModel = buildRelationGraph({
      committed: [deliverable('a', 0, 'not-started'), deliverable('b', 1, 'in-progress', ['a'])],
      projected: [deliverable('a', 0, 'not-started'), deliverable('b', 1, 'in-progress', ['a'])],
    })
    expect(defaultFocus(conflictModel)).toBe('b')
  })

  it('is deterministic and produces non-overlapping nodes across focus/depth combinations', () => {
    const model = buildRelationGraph({ committed, projected })
    const first = layoutRelationGraph(model, { depth: 2 })
    const second = layoutRelationGraph(model, { depth: 2 })
    expect(first).toEqual(second)
    for (const depth of [1, 2] as const) {
      for (const node of [undefined, ...model.nodes.map(candidate => candidate.id)]) {
        const layout = layoutRelationGraph(model, { focusId: node, depth })
        expect(graphOverlaps(layout)).toEqual([])
      }
    }
  })

  it('walks requires edges with arrows and all navigable items with brackets', () => {
    const model = buildRelationGraph({ committed, projected })
    const layout = layoutRelationGraph(model, { focusId: 'b', depth: 1 })
    expect(layout.traversal.length).toBe(layout.nodes.length + layout.edges.length)
    const down = graphNavigationTarget(layout, 'b', 'ArrowRight')
    expect(['a', 'c']).toContain(down)
    const all = graphNavigationTarget(layout, layout.traversal[0] ?? '', 'BracketRight')
    expect(all).toBe(layout.traversal[1])
    expect(LINE_CAPACITY).toBeGreaterThanOrEqual(11)
    expect(layout.width).toBeGreaterThan(0)
  })

  it('places pending-to-pending candidates in ranked columns and marks cycles', () => {
    const pending = (id: string, proposedRequires: readonly string[], order: number): GraphInputItem => ({
      id, kind: 'deliverable', text: id, review: 'pending', lifecycle: 'current', progress: 'not-started', proposedRequires, order,
    } as GraphInputItem)
    const items = [deliverable('a', 0, 'done'), pending('p1', ['p2'], 1), pending('p2', ['p1'], 2), pending('p3', ['p2'], 3)]
    const model = buildRelationGraph({ committed: items, projected: items })
    expect(model.nodes.find(node => node.id === 'p1')?.groupRank).toBe(0)
    expect(model.nodes.find(node => node.id === 'p2')?.groupRank).toBe(0)
    expect(model.nodes.find(node => node.id === 'p3')?.groupRank).toBe(1)
    expect(model.nodes.find(node => node.id === 'p1')?.candidateCycle).toBe(true)
  })

  it('lays isolated contracts out as a bounded grid instead of one column', () => {
    const isolated = Array.from({ length: 12 }, (_, index) => deliverable(`iso-${index}`, index, 'not-started'))
    const model = buildRelationGraph({ committed: isolated, projected: isolated })
    const layout = layoutRelationGraph(model, { depth: 1 })
    expect(layout.nodes).toHaveLength(12)
    expect(layout.width).toBeGreaterThan(GRAPH.nodeWidthEm)
    expect(new Set(layout.nodes.map(node => node.x)).size).toBeGreaterThan(1)
    expect(layout.degraded.isolatedTooMany).toBe(false)
  })

  it('hides an oversized isolated preview with the isolated reason', () => {
    const isolated = Array.from({ length: 21 }, (_, index) => deliverable(`iso-${index}`, index, 'not-started'))
    const model = buildRelationGraph({ committed: isolated, projected: isolated })
    const layout = layoutRelationGraph(model, { depth: 1 })
    expect(layout.degraded.hidden).toBe(true)
    expect(layout.degraded.isolatedTooMany).toBe(true)
    expect(layout.nodes).toHaveLength(0)
  })

  it('does not expand the whole model when supersedes are hidden from an ego view', () => {
    const old: GraphInputItem = {
      ...deliverable('old-0', 99, 'cancelled'),
      lifecycle: 'superseded',
      supersededBy: 'item-0',
    }
    const items: GraphInputItem[] = [old, ...Array.from({ length: 30 }, (_, index) => ({
      ...deliverable(`item-${index}`, index, 'done'),
      ...(index === 0 ? { supersedes: 'old-0' } : {}),
    }))]
    const model = buildRelationGraph({ committed: items, projected: items, showSupersedes: true })
    const layout = layoutRelationGraph(model, { focusId: 'item-0', depth: 1, supersedesHidden: true })
    expect(layout.nodes.length).toBeLessThan(30)
    expect(layout.degraded.isolatedTooMany).toBe(false)
  })

  it('keeps requires and supersedes edges with the same endpoints distinct', () => {
    const before: readonly GraphInputItem[] = [deliverable('a', 0, 'done'), deliverable('b', 1, 'not-started', ['a'])]
    const after: readonly GraphInputItem[] = [
      { ...deliverable('a', 0, 'done'), lifecycle: 'superseded', supersededBy: 'b' },
      { ...deliverable('b', 1, 'not-started', ['a']), supersedes: 'a' },
    ]
    const model = buildRelationGraph({ committed: before, projected: after, showSupersedes: true })
    const keys = layoutRelationGraph(model, { focusId: 'b', depth: 2 }).edges.map(edge => edge.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('e:requires:a→b')
    expect(keys).toContain('e:supersedes:a→b')
  })

  it('hides history first when the navigation budget is exceeded', () => {
    const history = deliverable('old', 9, 'cancelled', [], { lifecycle: 'superseded', supersededBy: 'a' })
    const model = buildRelationGraph({
      committed: [...committed, history],
      projected: [...projected, history],
      showSupersedes: true,
    })
    expect(model.nodes.some(node => node.lane === 'history')).toBe(true)
    const layout = layoutRelationGraph(model, { focusId: 'b', depth: 2 })
    expect(layout.degraded.hidden).toBe(false)
  })
})
