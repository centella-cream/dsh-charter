import { describe, expect, it } from 'vitest'
import { apply, initialSnapshot, request } from './helpers.js'
import { renderCharterPrompt } from '../../src/core/prompt.js'
import { dependencyProjection, executionDisplay, prerequisiteStatus } from '../../src/core/dependencies.js'
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
