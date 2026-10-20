import { describe, expect, it } from 'vitest'
import type { CharterItem } from '../../src/core/schemas.js'
import { validateState } from '../../src/core/state.js'

const old: CharterItem = {
  id: 'item-old',
  kind: 'invariant',
  text: 'Old constraint',
  review: 'accepted',
  lifecycle: 'superseded',
  verification: { state: 'unchecked' },
  origin: 'user',
  order: 1,
  createdRevision: 1,
  supersededBy: 'item-new',
}

const replacement: CharterItem = {
  id: 'item-new',
  kind: 'invariant',
  text: 'New constraint',
  review: 'accepted',
  lifecycle: 'current',
  verification: { state: 'unchecked' },
  origin: 'user',
  order: 1,
  createdRevision: 2,
  supersedes: 'item-old',
}

describe('charter state invariants', () => {
  it('requires a replacement to remain the current successor', () => {
    expect(() => validateState(2, undefined, [old, replacement])).not.toThrow()
    expect(() => validateState(2, undefined, [
      old,
      { ...replacement, lifecycle: 'archived' },
    ])).toThrow(/current successor/u)
  })
})
