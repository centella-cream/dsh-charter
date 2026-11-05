import { describe, expect, it } from 'vitest'
import { queryItems, type ItemQueryRequest } from '../../src/core/query.js'
import type { CharterItem } from '../../src/core/schemas.js'

function item(id: string, order: number, overrides: Partial<CharterItem> = {}): CharterItem {
  return {
    kind: 'invariant',
    id,
    text: id,
    review: 'accepted',
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    origin: 'user',
    order,
    createdRevision: 1,
    ...overrides,
  } as CharterItem
}

const items = [
  item('item-b', 1, { text: 'Beta' }),
  item('item-a', 0, { text: 'Alpha' }),
  item('item-c', 2, { review: 'pending', text: 'Gamma' }),
]

describe('item query', () => {
  it('pages all 512 active items with a revision-bound cursor', () => {
    const many = Array.from({ length: 512 }, (_, index) =>
      item(`scale-${String(index).padStart(3, '0')}`, index, { text: `Scale ${index}` }))
    const ids: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 16; page += 1) {
      const result = queryItems(7, 'scale-lifecycle', many, {
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected scale page')
      ids.push(...result.items.map(entry => entry.id))
      cursor = result.nextCursor
      if (cursor === undefined) break
    }
    expect(ids).toHaveLength(512)
    expect(new Set(ids).size).toBe(512)
    expect(ids[0]).toBe('scale-000')
    expect(ids[511]).toBe('scale-511')
  })

  it('sorts canonically, filters, and pages without duplicate or missing rows', () => {
    const first = queryItems(3, 'life', items, { limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('expected page')
    expect(first.items.map(row => row.id)).toEqual(['item-a', 'item-b'])
    expect(first.nextCursor).toBeDefined()
    const second = queryItems(3, 'life', items, { limit: 2, cursor: first.nextCursor } as ItemQueryRequest)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('expected page')
    expect(second.items.map(row => row.id)).toEqual(['item-c'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('rejects stale cursors and invalid limits', () => {
    const first = queryItems(3, 'life', items, { limit: 1 })
    if (!first.ok || first.nextCursor === undefined) throw new Error('expected cursor')
    expect(queryItems(4, 'life', items, { cursor: first.nextCursor })).toMatchObject({
      ok: false,
      code: 'STALE_REVISION',
    })
    expect(queryItems(3, 'life', items, { limit: 0 })).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' })
    expect(queryItems(3, 'life', items, { cursor: 'not-a-cursor' })).toMatchObject({
      ok: false,
      code: 'INVALID_CURSOR',
    })
  })
})
