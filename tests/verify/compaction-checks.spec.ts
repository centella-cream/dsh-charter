import { describe, expect, it } from 'vitest'
import {
  compactStandingItem,
  evaluateCompactionEvidence,
  postCompactionCharterReads,
} from '../../scripts/verify/compaction-checks.mjs'

const pass = {
  charterReady: true,
  survivesCompaction: true,
  systemPromptClean: true,
  charterReadStanding: true,
  checkpointLeaksCharter: false,
}

describe('compaction checker success criteria', () => {
  it('passes only when compaction survived and all required evidence is true', () => {
    expect(evaluateCompactionEvidence(pass)).toEqual({ ok: true, failures: [], warnings: [] })
  })

  it('fails a dirty system prompt even when the charter survives compaction', () => {
    const result = evaluateCompactionEvidence({ ...pass, systemPromptClean: false })
    expect(result.ok).toBe(false)
    expect(result.failures).toContain('a system-role prompt snapshot carries the charter body')
  })

  it('requires a matching post-compaction charter_read standing result', () => {
    const mismatched = evaluateCompactionEvidence({ ...pass, charterReadStanding: false })
    expect(mismatched.ok).toBe(false)
    expect(mismatched.failures.some(message => message.includes('charter_read'))).toBe(true)
    // No post-compaction charter_read call at all is a failure, not a note.
    const absent = evaluateCompactionEvidence({ ...pass, charterReadStanding: undefined })
    expect(absent.ok).toBe(false)
    expect(absent.failures.some(message => message.includes('post-compaction charter_read'))).toBe(true)
    // A matching result after the latest compaction passes.
    expect(evaluateCompactionEvidence({ ...pass, charterReadStanding: true }).ok).toBe(true)
  })

  it('ignores charter_read results recorded before the latest compaction', () => {
    const results = [
      { seq: 50, invalid: false },
      { seq: 90, invalid: false },
      { seq: 130, invalid: false },
    ]
    expect(postCompactionCharterReads(results, 120).map(result => result.seq)).toEqual([130])
    // Only pre-compaction reads: no evidence after the compaction.
    expect(postCompactionCharterReads(results.slice(0, 2), 120)).toEqual([])
    // No compaction recorded yet: every read is eligible.
    expect(postCompactionCharterReads(results, undefined)).toHaveLength(3)
  })

  it('fails when the post-compaction snapshot lost the charter', () => {
    const result = evaluateCompactionEvidence({ ...pass, survivesCompaction: false })
    expect(result.ok).toBe(false)
    expect(result.failures.some(message => message.includes('post-compaction'))).toBe(true)
  })

  it('warns when the compaction summary leaks the charter text', () => {
    const result = evaluateCompactionEvidence({ ...pass, checkpointLeaksCharter: true })
    expect(result.ok).toBe(true)
    expect(result.warnings.some(message => message.includes('summary'))).toBe(true)
  })

  it('compacts standing items exactly like the Host projection', () => {
    expect(compactStandingItem({
      id: 'item-1',
      kind: 'deliverable',
      text: 'Ship it',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'verified', by: 'user' },
      progress: 'done',
      origin: 'user',
      order: 3,
    })).toEqual({
      kind: 'deliverable',
      text: 'Ship it',
      verification: 'verified',
      progress: 'done',
    })
    // Current compact output is idempotent under the same projection.
    expect(compactStandingItem({
      kind: 'invariant',
      text: 'Keep it',
      verification: 'unchecked',
      progress: null,
    })).toEqual({
      kind: 'invariant',
      text: 'Keep it',
      verification: 'unchecked',
      progress: null,
    })
  })
})
