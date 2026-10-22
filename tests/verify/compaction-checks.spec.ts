import { describe, expect, it } from 'vitest'
import {
  compactStandingItem,
  evaluateCompactionEvidence,
} from '../../scripts/verify/compaction-checks.mjs'

const pass = {
  charterReady: true,
  survivesCompaction: true,
  systemPromptClean: true,
  charterReadCalled: true,
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

  it('fails a called-but-mismatched charter_read standing result', () => {
    const result = evaluateCompactionEvidence({ ...pass, charterReadStanding: false })
    expect(result.ok).toBe(false)
    expect(result.failures.some(message => message.includes('charter_read'))).toBe(true)
    // No charter_read call in the transcript is not a failure by itself.
    expect(evaluateCompactionEvidence({
      ...pass,
      charterReadCalled: false,
      charterReadStanding: undefined,
    }).ok).toBe(true)
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
