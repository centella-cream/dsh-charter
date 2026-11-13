import { describe, expect, it } from 'vitest'
import { buildStandingEnvelope, STANDING_TOOL_MAX_BYTES, STANDING_TOOL_MAX_ITEMS } from '../../src/core/standing-envelope.js'
import type { CharterItem } from '../../src/core/schemas.js'

function deliverable(index: number, text = `deliverable ${index}`): CharterItem {
  return {
    kind: 'deliverable',
    id: `item-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    text,
    review: 'accepted',
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    origin: 'user',
    order: index,
    createdRevision: 1,
    progress: 'not-started',
  } as unknown as CharterItem
}

describe('standing tool envelope', () => {
  it('serializes the exact standing payload and counts id overhead', () => {
    const estimate = buildStandingEnvelope([deliverable(1), deliverable(2)], 3, 'Ship it')
    expect(estimate.itemCount).toBe(2)
    expect(estimate.deliverableCount).toBe(2)
    expect(estimate.view).toEqual({
      revision: 3,
      objective: 'Ship it',
      items: [
        { kind: 'deliverable', text: 'deliverable 1', verification: 'unchecked', progress: 'not-started', id: 'item-00000000-0000-4000-8000-000000000001', key: 'D1', requires: [] },
        { kind: 'deliverable', text: 'deliverable 2', verification: 'unchecked', progress: 'not-started', id: 'item-00000000-0000-4000-8000-000000000002', key: 'D2', requires: [] },
      ],
      truncated: 0,
    })
    expect(estimate.bytes).toBe(new TextEncoder().encode(JSON.stringify(estimate.view)).byteLength)
  })

  it('keeps the 64-item envelope within the 32 KiB cap and locks the id cost', () => {
    const items = Array.from({ length: STANDING_TOOL_MAX_ITEMS }, (_, index) => deliverable(index + 1))
    const estimate = buildStandingEnvelope(items, 1, null)
    expect(estimate.itemCount).toBe(64)
    expect(estimate.bytes).toBeLessThanOrEqual(STANDING_TOOL_MAX_BYTES)
    expect(estimate.bytes).toBe(new TextEncoder().encode(JSON.stringify(estimate.view)).byteLength)
    const withoutIds = {
      ...estimate.view,
      items: estimate.view.items.map(item => {
        const { id: _id, ...rest } = item
        return rest
      }),
    }
    const idCost = estimate.bytes - new TextEncoder().encode(JSON.stringify(withoutIds)).byteLength
    expect(idCost).toBe(64 * 49)
  })

  it('omits ids from invariants', () => {
    const invariant = {
      kind: 'invariant',
      id: 'item-inv',
      text: 'Do not rewrite history',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      order: 0,
      createdRevision: 1,
    } as unknown as CharterItem
    const estimate = buildStandingEnvelope([invariant, deliverable(1)], 2, null)
    expect(estimate.view.items[0]).not.toHaveProperty('id')
    expect(estimate.view.items[1]).toHaveProperty('id')
  })

  it('reports an over-cap estimate for long 64-item standing state', () => {
    const items = Array.from({ length: STANDING_TOOL_MAX_ITEMS }, (_, index) => deliverable(index + 1, `deliverable ${index} ${'x'.repeat(500)}`))
    const estimate = buildStandingEnvelope(items, 1, null)
    expect(estimate.bytes).toBeGreaterThan(STANDING_TOOL_MAX_BYTES)
    expect(estimate.bytes).toBe(new TextEncoder().encode(JSON.stringify(estimate.view)).byteLength)
  })
})
