import { describe, expect, it } from 'vitest'
import { apply, initialSnapshot, request } from './helpers.js'
import { renderCharterPrompt } from '../../src/core/prompt.js'
import { dependencyConflictDiff, dependencyProjection, executionDisplay, prerequisiteStatus } from '../../src/core/dependencies.js'
import type { CharterItem, DeliverableItem } from '../../src/core/schemas.js'

function deliverable(id: string, order: number, requires?: readonly string[]): DeliverableItem {
  return {
    kind: 'deliverable',
    id,
    text: id,
    review: 'accepted',
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    origin: 'user',
    order,
    createdRevision: 1,
    progress: 'not-started',
    ...(requires === undefined ? {} : { requires: [...requires] }),
  }
}

describe('deliverable dependencies', () => {
  it('keeps the exact v1 prompt when no active edge exists', () => {
    const items: CharterItem[] = [deliverable('item-a', 0), deliverable('item-b', 1)]
    const prompt = renderCharterPrompt(undefined, items)
    expect(prompt).toContain('"deliverables":[{"text":"item-a","progress":"not-started"},{"text":"item-b","progress":"not-started"}]')
  })

  it('renders stable topological D labels and prerequisite keys', () => {
    const snap = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'deliverable', text: 'Build', order: 0, progress: 'done' } },
      { type: 'item.add', item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'not-started', requires: ['item-a'] } },
    ]), { a: 'item-a', b: 'item-b' })
    expect(snap.promptText).toContain('{"key":"D1","text":"Build","progress":"done","requires":[]}')
    expect(snap.promptText).toContain('{"key":"D2","text":"Release","progress":"not-started","requires":["D1"]}')
    expect(snap.items.find(item => item.id === 'item-b')).toMatchObject({ requires: ['item-a'] })
  })

  it('derives readiness without mutating progress', () => {
    const items = [deliverable('item-a', 0), deliverable('item-b', 1, ['item-a'])]
    const b = items[1]!
    expect(prerequisiteStatus(b, items)).toBe('waiting')
    expect(executionDisplay(b, items)).toBe('waiting')
    expect(dependencyProjection(items).map(row => row.localKey)).toEqual(['D1', 'D2'])
    expect(b.progress).toBe('not-started')
  })

  it('rejects self-dependency, dangling references, inactive endpoints and cycles', () => {
    const snap = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'deliverable', text: 'A', order: 0, progress: 'not-started' } },
      { type: 'item.add', item: { clientRef: 'b', kind: 'deliverable', text: 'B', order: 1, progress: 'not-started' } },
    ]), { a: 'item-a', b: 'item-b' })
    const fail = (requires: string[], target = 'item-b', base = snap) => apply(base, request([
      { type: 'deliverable.requires', itemId: target, requires },
    ], base.revision), {})
    expect(() => fail(['item-b'])).toThrow(/require itself/)
    expect(() => fail(['item-missing'])).toThrow(/dangling prerequisite/)
    const chained = apply(snap, request([
      { type: 'deliverable.requires', itemId: 'item-b', requires: ['item-a'] },
    ], snap.revision), {})
    expect(() => fail(['item-b'], 'item-a', chained)).toThrow(/cycle/)
  })
})

describe('dependencyConflictDiff (design v2 §6.5)', () => {
  function started(id: string, order: number, requires?: readonly string[]): DeliverableItem {
    return { ...deliverable(id, order, requires), progress: 'in-progress' }
  }

  it('reports a conflict the batch introduces', () => {
    const before: CharterItem[] = [deliverable('item-a', 0), deliverable('item-b', 1, ['item-a'])]
    const after: CharterItem[] = [deliverable('item-a', 0), started('item-b', 1, ['item-a'])]
    expect(dependencyConflictDiff(before, after)).toEqual({
      added: [{ itemId: 'item-b', before: 'waiting', after: 'dependency-conflict', beforeConflicts: 0, afterConflicts: 1 }],
      worsened: [],
    })
  })

  it('distinguishes a worsened conflict from an unchanged one by cause count', () => {
    const done: DeliverableItem = { ...deliverable('item-c', 1), progress: 'done' }
    const before: CharterItem[] = [deliverable('item-a', 0), done, started('item-b', 2, ['item-a', 'item-c'])]
    const after: CharterItem[] = [
      deliverable('item-a', 0),
      { ...deliverable('item-c', 1), progress: 'cancelled' },
      started('item-b', 2, ['item-a', 'item-c']),
    ]
    const diff = dependencyConflictDiff(before, after)
    expect(diff.added).toEqual([])
    expect(diff.worsened).toEqual([
      { itemId: 'item-b', before: 'dependency-conflict', after: 'dependency-conflict', beforeConflicts: 1, afterConflicts: 2 },
    ])
    // Same status, same cause count: nothing new to confirm.
    expect(dependencyConflictDiff(before, before).worsened).toEqual([])
  })

  it('reports nothing when the batch changes no readiness', () => {
    const items: CharterItem[] = [deliverable('item-a', 0), deliverable('item-b', 1, ['item-a'])]
    expect(dependencyConflictDiff(items, items)).toEqual({ added: [], worsened: [] })
  })

  it('counts a brand-new deliverable that starts in conflict as added', () => {
    const before: CharterItem[] = [deliverable('item-a', 0)]
    const after: CharterItem[] = [deliverable('item-a', 0), started('item-b', 1, ['item-a'])]
    expect(dependencyConflictDiff(before, after).added).toEqual([
      { itemId: 'item-b', before: 'absent', after: 'dependency-conflict', beforeConflicts: 0, afterConflicts: 1 },
    ])
  })

  it('ignores items outside the active graph', () => {
    const pending = { ...started('item-b', 1, ['item-a']), review: 'pending' as const }
    const superseded = { ...started('item-c', 2, ['item-a']), lifecycle: 'superseded' as const }
    const before: CharterItem[] = [deliverable('item-a', 0)]
    expect(dependencyConflictDiff(before, [deliverable('item-a', 0), pending])).toEqual({ added: [], worsened: [] })
    expect(dependencyConflictDiff(before, [deliverable('item-a', 0), superseded])).toEqual({ added: [], worsened: [] })
  })

  it('does not treat a structural rejection as a conflict report', () => {
    // Cycles are rejected by validateDependencyGraph before any Apply; the diff
    // only describes readiness semantics of two well-formed snapshots.
    const cyclic: CharterItem[] = [
      started('item-a', 0, ['item-b']),
      started('item-b', 1, ['item-a']),
    ]
    const diff = dependencyConflictDiff([], cyclic)
    expect(diff.added.map(entry => entry.itemId)).toEqual(['item-a', 'item-b'])
  })
})
