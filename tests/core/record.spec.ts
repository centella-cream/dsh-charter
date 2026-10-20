import { describe, expect, it } from 'vitest'
import { CharterError } from '../../src/core/errors.js'
import {
  assertRecordConsistency,
  commitRecord,
  createEmptyRecord,
  MutationReplay,
  requestDigestOf,
  RevisionConflict,
} from '../../src/core/record.js'
import { normalizeEditRequest } from '../../src/core/normalize.js'
import type { CharterActor, CharterRecord } from '../../src/core/schemas.js'
import { limits } from './helpers.js'

const identity = { createdAt: 1_700_000_000_000, cwd: '/workspace' }
const actor: CharterActor = { kind: 'owner' }

function commit(
  record: CharterRecord,
  mutationId: string,
  baseRevision: number,
  text: string,
  itemId: string,
): CharterRecord {
  const request = normalizeEditRequest({
    sessionId: 'session-1',
    mutationId,
    baseRevision,
    ops: [{
      type: 'item.add',
      item: { clientRef: 'new', kind: 'invariant', text, order: baseRevision },
    }],
  })
  return commitRecord({
    record,
    request,
    requestDigest: requestDigestOf(request, identity, actor),
    ids: { new: itemId },
    actor,
    at: 1_700_000_000_000 + baseRevision,
    limits,
  })
}

describe('charter record commits', () => {
  it('commits a snapshot, history receipt, and mutation receipt atomically', () => {
    const record = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, 'Run tests', 'item-1')
    expect(record.current.revision).toBe(1)
    expect(record.history).toHaveLength(1)
    expect(record.recentMutations).toHaveLength(1)
    expect(record.history[0]).toMatchObject({
      revision: 1,
      mutationId: 'mutation-1',
      resultDigest: record.current.stateDigest,
    })
    expect(record.recentMutations[0]).toMatchObject({
      committedRevision: 1,
      mutationId: 'mutation-1',
      resultDigest: record.current.stateDigest,
      ids: { new: 'item-1' },
    })
  })

  it('keeps user text out of structured history receipts', () => {
    const secret = 'do not expose this exact constraint'
    const record = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, secret, 'item-1')
    expect(JSON.stringify(record.history)).not.toContain(secret)
    expect(JSON.stringify(record.recentMutations)).not.toContain(secret)
  })

  it('detects idempotent replays and mutation id reuse before revision conflicts', () => {
    const first = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, 'Run tests', 'item-1')
    const sameRequest = normalizeEditRequest({
      sessionId: 'session-1',
      mutationId: 'mutation-1',
      baseRevision: 0,
      ops: [{
        type: 'item.add',
        item: { clientRef: 'new', kind: 'invariant', text: 'Run tests', order: 0 },
      }],
    })
    expect(() => commitRecord({
      record: first,
      request: sameRequest,
      requestDigest: requestDigestOf(sameRequest, identity, actor),
      ids: { new: 'unused-new-id' },
      actor,
      at: 2,
      limits,
    })).toThrow(MutationReplay)

    const changed = normalizeEditRequest({
      ...sameRequest,
      ops: [{
        type: 'item.add',
        item: { clientRef: 'new', kind: 'invariant', text: 'Different', order: 0 },
      }],
    })
    try {
      commitRecord({
        record: first,
        request: changed,
        requestDigest: requestDigestOf(changed, identity, actor),
        ids: { new: 'item-2' },
        actor,
        at: 2,
        limits,
      })
      throw new Error('expected mutation reuse failure')
    } catch (error) {
      expect(error).toBeInstanceOf(CharterError)
      expect((error as CharterError).code).toBe('MUTATION_ID_REUSED')
    }
  })

  it('rejects stale base revisions without changing the record', () => {
    const first = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, 'Run tests', 'item-1')
    const stale = normalizeEditRequest({
      sessionId: 'session-1',
      mutationId: 'mutation-2',
      baseRevision: 0,
      ops: [{ type: 'item.archive', itemId: 'item-1' }],
    })
    expect(() => commitRecord({
      record: first,
      request: stale,
      requestDigest: requestDigestOf(stale, identity, actor),
      ids: {},
      actor,
      at: 2,
      limits,
    })).toThrow(RevisionConflict)
    expect(first.current.revision).toBe(1)
  })

  it('trims old receipts without changing current state', () => {
    const tinyLimits = { ...limits, historyLimit: 2, mutationLimit: 2 }
    let record = createEmptyRecord(identity, tinyLimits)
    for (let index = 0; index < 4; index += 1) {
      const request = normalizeEditRequest({
        sessionId: 'session-1',
        mutationId: `mutation-${index + 1}`,
        baseRevision: index,
        ops: [{
          type: 'item.add',
          item: {
            clientRef: `new-${index}`,
            kind: 'invariant',
            text: `Constraint ${index}`,
            order: index,
          },
        }],
      })
      record = commitRecord({
        record,
        request,
        requestDigest: requestDigestOf(request, identity, actor),
        ids: { [`new-${index}`]: `item-${index}` },
        actor,
        at: index,
        limits: tinyLimits,
      })
    }
    expect(record.current.revision).toBe(4)
    expect(record.current.items).toHaveLength(4)
    expect(record.history.map(entry => entry.revision)).toEqual([3, 4])
    expect(record.recentMutations.map(entry => entry.committedRevision)).toEqual([3, 4])
    assertRecordConsistency(record, tinyLimits)
  })

  it('detects tampered prompt and cross-receipt state', () => {
    const record = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, 'Run tests', 'item-1')
    expect(() => assertRecordConsistency({
      ...record,
      current: { ...record.current, promptText: 'tampered' },
    }, limits)).toThrow(CharterError)
    expect(() => assertRecordConsistency({
      ...record,
      recentMutations: record.recentMutations.map(entry => ({
        ...entry,
        resultDigest: `sha256:${'0'.repeat(64)}`,
      })),
    }, limits)).toThrow(CharterError)
  })

  it('rejects schema-valid but semantically impossible receipt histories', () => {
    const record = commit(createEmptyRecord(identity, limits), 'mutation-1', 0, 'Run tests', 'item-1')
    expect(() => assertRecordConsistency({
      ...record,
      history: record.history.map(receipt => ({ ...receipt, baseRevision: 7 })),
    }, limits)).toThrow(CharterError)
    expect(() => assertRecordConsistency({
      ...record,
      recentMutations: record.recentMutations.map(receipt => ({
        ...receipt,
        committedRevision: 99,
      })),
    }, limits)).toThrow(CharterError)
  })
})
