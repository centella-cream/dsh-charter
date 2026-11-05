import { describe, expect, it } from 'vitest'
import {
  agentProjectionDigest,
  compactionProjectionDigest,
  messageProjectionDigest,
  verifySourceProjection,
} from '../../src/core/source-registry.js'

describe('proposal source projection registry', () => {
  it('recomputes message, compaction, and agent projections', () => {
    const messageSource = {
      kind: 'message' as const,
      sessionId: 'session-1',
      sessionCreatedAt: 1,
      projectionVersion: 1,
      digest: messageProjectionDigest({
        sessionId: 'session-1',
        sessionCreatedAt: 1,
        seqs: [2],
        role: 'user',
      }, ['hello']),
      seqs: [2],
      role: 'user' as const,
      at: 1,
    }
    const events = [{
      seq: 2,
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'hello' }] },
    }]
    expect(verifySourceProjection(messageSource, { events })).toBe('intact')
    expect(verifySourceProjection(messageSource, {
      events: [{ ...events[0]!, data: { content: [{ type: 'text', text: 'changed' }] } }],
    })).toBe('mismatch')
    expect(verifySourceProjection(messageSource)).toBe('unsupported')

    const compaction = { objective: 'Ship', invariants: ['A'], deliverables: ['B'] }
    const compactionSource = {
      kind: 'compaction-summary' as const,
      summarySeq: 3,
      sessionId: 'session-1',
      projectionVersion: 1,
      digest: compactionProjectionDigest({ sessionId: 'session-1', summarySeq: 3, projectionVersion: 1 }, compaction),
      at: 1,
    }
    expect(verifySourceProjection(compactionSource, { compaction })).toBe('intact')
    expect(verifySourceProjection(compactionSource, {
      compaction: { ...compaction, objective: 'Different' },
    })).toBe('mismatch')

    const candidates = [{ kind: 'item' as const, text: 'B', proposedRequires: ['a'] }]
    const agentSource = {
      kind: 'agent-tool' as const,
      toolCallId: 'tool-1',
      at: 1,
      digest: agentProjectionDigest('tool-1', candidates),
    }
    expect(verifySourceProjection(agentSource, { candidates })).toBe('intact')
    expect(verifySourceProjection(agentSource, {
      candidates: [{ ...candidates[0]!, text: 'C' }],
    })).toBe('mismatch')

    const unsupported = {
      kind: 'fork' as const,
      parentBatchId: 'batch-1',
      at: 1,
      digest: messageProjectionDigest({ sessionId: 's', sessionCreatedAt: 1, seqs: [1], role: 'user' }, ['x']),
    }
    expect(verifySourceProjection(unsupported)).toBe('unsupported')
  })
})
