import { describe, expect, it } from 'vitest'
import { applyOps } from '../../src/core/commands.js'
import { initialSnapshot, limits, request } from './helpers.js'

describe('objective proposals', () => {
  it('creates a pending proposal and accepts it into a new objective', () => {
    const snapshot = initialSnapshot()
    const propose = request([{
      type: 'objective.propose',
      clientRef: 'objective-1',
      text: 'Ship the workspace',
    }])
    const proposed = applyOps({
      snapshot,
      ops: propose.ops,
      ids: { 'objective-1': 'objective-proposal-1' },
      nextRevision: 1,
      limits,
    })
    expect(proposed.objectiveProposals).toEqual([{
      id: 'objective-proposal-1',
      text: 'Ship the workspace',
      origin: 'user',
      review: 'pending',
      createdRevision: 1,
    }])
    expect(proposed.snapshot.objective).toBeUndefined()

    const accept = request([{
      type: 'objective.accept',
      proposalId: 'objective-proposal-1',
    }], 1)
    const accepted = applyOps({
      snapshot: proposed.snapshot,
      ops: accept.ops,
      ids: {},
      nextRevision: 2,
      limits,
      objectiveProposals: proposed.objectiveProposals,
    })
    expect(accepted.snapshot.objective?.current.text).toBe('Ship the workspace')
    expect(accepted.objectiveProposals[0]).toMatchObject({
      review: 'accepted',
      appliedRevision: 2,
      reviewedAtRevision: 2,
    })
    expect(accepted.objectiveProposals[0]?.textDigest).toMatch(/^sha256:/u)
  })

  it('rejects multiple accepted objective proposals in one Change Set', () => {
    const snapshot = initialSnapshot()
    const proposed = applyOps({
      snapshot,
      ops: request([
        { type: 'objective.propose', clientRef: 'one', text: 'One' },
        { type: 'objective.propose', clientRef: 'two', text: 'Two' },
      ]).ops,
      ids: { one: 'proposal-one', two: 'proposal-two' },
      nextRevision: 1,
      limits,
    })
    expect(() => applyOps({
      snapshot: proposed.snapshot,
      ops: request([
        { type: 'objective.accept', proposalId: 'proposal-one' },
        { type: 'objective.accept', proposalId: 'proposal-two' },
      ], 1).ops,
      ids: {},
      nextRevision: 2,
      limits,
      objectiveProposals: proposed.objectiveProposals,
    })).toThrow(/at most one objective proposal/)
  })

  it('requires a reason to replace an existing objective and supports reject/purge', () => {
    const snapshot = initialSnapshot()
    const initialized = applyOps({
      snapshot,
      ops: request([{ type: 'objective.initialize', text: 'Original' }]).ops,
      ids: {},
      nextRevision: 1,
      limits,
    }).snapshot
    const proposed = applyOps({
      snapshot: initialized,
      ops: request([{ type: 'objective.propose', clientRef: 'next', text: 'Replacement' }], 1).ops,
      ids: { next: 'objective-proposal-2' },
      nextRevision: 2,
      limits,
    })
    expect(() => applyOps({
      snapshot: proposed.snapshot,
      ops: request([{ type: 'objective.accept', proposalId: 'objective-proposal-2' }], 2).ops,
      ids: {},
      nextRevision: 3,
      limits,
      objectiveProposals: proposed.objectiveProposals,
    })).toThrow(/requires a reason/)
    const rejected = applyOps({
      snapshot: proposed.snapshot,
      ops: request([{ type: 'objective.reject', proposalId: 'objective-proposal-2' }], 2).ops,
      ids: {},
      nextRevision: 3,
      limits,
      objectiveProposals: proposed.objectiveProposals,
    })
    expect(rejected.objectiveProposals[0]?.review).toBe('rejected')
    const purged = applyOps({
      snapshot: rejected.snapshot,
      ops: request([{ type: 'objective.purge', proposalId: 'objective-proposal-2' }], 3).ops,
      ids: {},
      nextRevision: 4,
      limits,
      objectiveProposals: rejected.objectiveProposals,
    })
    expect(purged.objectiveProposals).toEqual([
      expect.objectContaining({ review: 'purged', text: '', textDigest: expect.stringMatching(/^sha256:/u) }),
    ])
  })
})
