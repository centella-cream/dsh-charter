import { describe, expect, it } from 'vitest'
import {
  charterReadArgumentsView,
  compactStandingItem,
  evaluateCompactionEvidence,
  isValidCharterReadEvidence,
  postCompactionCharterReads,
} from '../../scripts/verify/compaction-checks.mjs'

const pass = {
  charterReady: true,
  survivesCompaction: true,
  systemPromptClean: true,
  charterReadStanding: true,
  checkpointLeaksCharter: false,
}

describe('authenticated charter_read evidence', () => {
  it('rejects a call recorded before the latest compaction even when its result is after it', () => {
    expect(isValidCharterReadEvidence({
      callSeq: 90,
      resultSeq: 130,
      compactionSeq: 120,
      runtimeSeq: 80,
      argumentsView: 'standing',
      isError: false,
    })).toBe(false)
  })

  it('accepts a call with missing arguments (default standing view)', () => {
    expect(isValidCharterReadEvidence({
      callSeq: 130,
      resultSeq: 140,
      compactionSeq: 120,
      runtimeSeq: 110,
      argumentsView: undefined,
      isError: false,
    })).toBe(true)
  })

  it('rejects an explicit non-standing view and error results', () => {
    const base = {
      callSeq: 130,
      resultSeq: 140,
      compactionSeq: 120,
      runtimeSeq: 110,
      isError: false,
    }
    expect(isValidCharterReadEvidence({ ...base, argumentsView: 'all' })).toBe(false)
    expect(isValidCharterReadEvidence({ ...base, argumentsView: 'standing' })).toBe(true)
    expect(isValidCharterReadEvidence({ ...base, argumentsView: 'standing', isError: true })).toBe(false)
  })

  it('rejects calls not ordered after the runtime-context snapshot or the result', () => {
    const base = {
      resultSeq: 140,
      compactionSeq: 120,
      runtimeSeq: 110,
      argumentsView: 'standing',
      isError: false,
    }
    expect(isValidCharterReadEvidence({ ...base, callSeq: 115 })).toBe(false)
    expect(isValidCharterReadEvidence({ ...base, callSeq: 130, resultSeq: 125 })).toBe(false)
    expect(isValidCharterReadEvidence({ ...base, callSeq: 130 })).toBe(true)
  })

  it('parses the requested view from call arguments', () => {
    expect(charterReadArgumentsView(undefined)).toBeUndefined()
    expect(charterReadArgumentsView('')).toBeUndefined()
    expect(charterReadArgumentsView({})).toBeUndefined()
    expect(charterReadArgumentsView('{"view":"standing"}')).toBe('standing')
    expect(charterReadArgumentsView({ view: 'standing' })).toBe('standing')
    expect(charterReadArgumentsView('{"view":"all"}')).toBe('all')
    expect(charterReadArgumentsView('not-json')).toBe('invalid-arguments')
  })
})

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
