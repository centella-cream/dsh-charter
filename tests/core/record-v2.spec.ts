import { describe, expect, it } from 'vitest'
import { createEmptyRecord, migrateRecordV1ToV2 } from '../../src/core/record.js'
import { emptySnapshot } from '../../src/core/render.js'
import { DEFAULT_CHARTER_LIMITS } from '../../src/core/limits.js'
import { charterRecordSchema, charterRecordV1Schema } from '../../src/core/schemas.js'

describe('record v2 migration', () => {
  it('writes v2 records and reads v1 bytes through an in-memory migration', () => {
    const empty = createEmptyRecord({ createdAt: 1 }, DEFAULT_CHARTER_LIMITS)
    expect(empty.recordSchemaVersion).toBe(2)
    expect(charterRecordSchema.safeParse(empty).success).toBe(true)

    const v1 = {
      ...empty,
      recordSchemaVersion: 1,
      current: emptySnapshot(DEFAULT_CHARTER_LIMITS),
    }
    expect(charterRecordV1Schema.safeParse(v1).success).toBe(true)
    const migrated = migrateRecordV1ToV2(v1 as never)
    expect(migrated.recordSchemaVersion).toBe(2)
    expect(migrated.current.promptText).toBe(v1.current.promptText)
    expect(migrated.current.stateDigest).toBe(v1.current.stateDigest)
    expect(charterRecordSchema.safeParse(migrated).success).toBe(true)
  })

  it('maps every v1 verification state into v2 validity', () => {
    const base = createEmptyRecord({ createdAt: 1 }, DEFAULT_CHARTER_LIMITS)
    const item = (id: string, verification: unknown) => ({
      id,
      kind: 'invariant' as const,
      text: id,
      review: 'accepted' as const,
      lifecycle: 'current' as const,
      verification,
      origin: 'user' as const,
      order: 0,
      createdRevision: 1,
    })
    const current = {
      ...emptySnapshot(DEFAULT_CHARTER_LIMITS),
      revision: 1,
      items: [
        item('unchecked', { state: 'unchecked' }),
        item('attested', { state: 'verified', by: 'user' }),
        item('valid', { state: 'verified', by: 'validator' }),
        item('invalid', { state: 'failed', reason: 'nope' }),
        item('unknown', { state: 'unavailable', reason: 'io' }),
      ],
    }
    const migrated = migrateRecordV1ToV2({
      ...base,
      recordSchemaVersion: 1,
      current,
    } as never)
    expect(migrated.current.items.map(entry => entry.validity?.state)).toEqual([
      'unassessed', 'attested', 'valid', 'invalid', 'unknown',
    ])
  })
})


describe('record v2 proposal consistency', () => {
  it('rejects malformed applied objective proposals in a structurally valid v2 record', async () => {
    const { assertRecordConsistency, commitRecord, createEmptyRecord, requestDigestOf } = await import('../../src/core/record.js')
    const { normalizeEditRequest } = await import('../../src/core/normalize.js')
    const actor = { kind: 'owner' as const }
    const identity = { createdAt: 1 }
    const request = normalizeEditRequest({
      sessionId: 'session-1',
      mutationId: 'm1',
      baseRevision: 0,
      ops: [{ type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 0 } }],
    })
    const record = commitRecord({
      record: createEmptyRecord(identity, DEFAULT_CHARTER_LIMITS),
      request,
      requestDigest: requestDigestOf(request, identity, actor),
      ids: { a: 'item-a' },
      actor,
      at: 1,
      limits: DEFAULT_CHARTER_LIMITS,
    })
    expect(() => assertRecordConsistency({
      ...record,
      objectiveProposals: [{
        id: 'objective-proposal-1',
        text: 'Body retained',
        origin: 'user',
        review: 'accepted',
        createdRevision: 1,
      }],
    }, DEFAULT_CHARTER_LIMITS)).toThrow(/applied metadata|digest/)
  })
})
