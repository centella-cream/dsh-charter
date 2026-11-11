import { describe, expect, it } from 'vitest'
import { planChangeSet } from '../../src/core/change-set.js'
import { initialSnapshot, limits, request } from './helpers.js'

describe('change set planner', () => {
  it('computes before/after prompt and a stable summary digest', () => {
    const snapshot = initialSnapshot()
    const edit = request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'deliverable', text: 'Build', order: 0, progress: 'done' } },
      { type: 'item.add', item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'not-started', requires: ['item-a'] } },
    ])
    const plan = planChangeSet({ snapshot, ops: edit.ops, ids: { a: 'item-a', b: 'item-b' }, nextRevision: 1, limits })
    expect(plan.baseRevision).toBe(0)
    expect(plan.nextRevision).toBe(1)
    expect(plan.promptChanged).toBe(true)
    expect(plan.after.promptBytes).toBeGreaterThan(plan.before.promptBytes)
    expect(plan.summaryDigest).toMatch(/^sha256:/u)
  })

  it('reports the §6.5 dependency conflicts a batch introduces', () => {
    const plan = planChangeSet({
      snapshot: initialSnapshot(),
      ops: request([
        { type: 'item.add', item: { clientRef: 'a', kind: 'deliverable', text: 'Build', order: 0, progress: 'not-started' } },
        { type: 'item.add', item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'in-progress', requires: ['item-a'] } },
      ]).ops,
      ids: { a: 'item-a', b: 'item-b' },
      nextRevision: 1,
      limits,
    })
    expect(plan.dependencyConflicts.added.map(entry => entry.itemId)).toEqual(['item-b'])
    expect(plan.dependencyConflicts.worsened).toEqual([])
  })

  it('reports no conflict for a readiness-neutral batch', () => {
    const plan = planChangeSet({
      snapshot: initialSnapshot(),
      ops: request([
        { type: 'item.add', item: { clientRef: 'a', kind: 'deliverable', text: 'Build', order: 0, progress: 'done' } },
        { type: 'item.add', item: { clientRef: 'b', kind: 'deliverable', text: 'Release', order: 1, progress: 'not-started', requires: ['item-a'] } },
      ]).ops,
      ids: { a: 'item-a', b: 'item-b' },
      nextRevision: 1,
      limits,
    })
    expect(plan.dependencyConflicts).toEqual({ added: [], worsened: [] })
    expect(plan.summaryDigest).toMatch(/^sha256:/u)
  })
})
