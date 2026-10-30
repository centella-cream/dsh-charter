import { describe, expect, it } from 'vitest'
import { summarizeCharterRead, summarizeRuntimeSnapshots, summarizeTraffic } from '../../scripts/verify/traffic-checks.mjs'

function runtime(seq: number, charter: string, text = `runtime ${seq}`): Record<string, unknown> {
  return {
    type: 'user/message',
    seq,
    data: {
      content: [{ type: 'text', text }],
      source: {
        kind: 'runtime-context',
        sections: [{ name: 'charter:standing', text: charter }],
      },
    },
  }
}

function result(seq: number, turn: number, step: number, callId: string, text: string): Record<string, unknown> {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn,
      step,
      message: { toolCallId: callId, content: [{ type: 'text', text }] },
    },
  }
}

describe('rc.6 traffic checks', () => {
  it('counts model attempts and attempt-stream usage without dropping retries', () => {
    const report = summarizeTraffic([
      { type: 'session', version: 4, id: 's', createdAt: 1 },
      { type: 'step/start', seq: 1, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/attempt',
        seq: 2,
        data: {
          turn: 1,
          step: 1,
          stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 } } }],
        },
      },
      {
        type: 'assistant/message',
        seq: 3,
        data: { turn: 1, step: 1, usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 0 } },
      },
    ])
    expect(report.modelAttempts.total).toBe(2)
    expect(report.modelAttempts.failedAttempts).toBe(1)
    expect(report.modelAttempts.successfulMessages).toBe(1)
    expect(report.modelAttempts.retries).toBe(1)
    expect(report.modelAttempts.usage.uncachedInputTokens).toBe(30)
    expect(report.modelAttempts.usage.billedInputTokens).toBe(37)
    expect(report.modelAttempts.usage.outputTokens).toBe(15)
    expect(report.modelAttempts.missingUsage).toBe(0)
  })

  it('assigns the compaction epoch at attempt time, not the final epoch', () => {
    const report = summarizeTraffic([
      { type: 'step/start', seq: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
      { type: 'compaction/end', seq: 3, data: {} },
      { type: 'step/start', seq: 4, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 5, data: { turn: 2, step: 1, usage: { inputTokens: 2, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    ])
    expect(report.modelAttempts.attempts.map((attempt: { compactionEpoch: number }) => attempt.compactionEpoch)).toEqual([0, 1])
  })

  it('ignores legacy non-charter tool results instead of calling them unpaired charter reads', () => {
    const report = summarizeCharterRead([
      { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'bash', name: 'bash', arguments: '{}' } },
      result(2, 1, 1, 'bash', 'ok'),
    ])
    expect(report.calls).toBe(0)
    expect(report.unpairedResults).toBe(0)
    expect(report.unattributedResults).toBe(0)
  })

  it('separates historical, active-surface, and current-epoch snapshots', () => {
    const report = summarizeRuntimeSnapshots([
      runtime(1, 'old'),
      runtime(2, 'kept'),
      { type: 'assistant/message', seq: 3, data: {}, surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } },
      runtime(4, 'kept'),
      { type: 'compaction/end', seq: 5, data: {} },
    ])
    expect(report.historical).toHaveLength(3)
    expect(report.active.map((snapshot: { seq: number }) => snapshot.seq)).toEqual([2, 4])
    expect(report.currentEpoch.map((snapshot: { seq: number }) => snapshot.seq)).toEqual([])
    expect(report.shadowedCount).toBe(1)
    expect(report.compactionEpoch).toBe(1)
  })

  it('pairs repeated callIds per turn instead of overwriting them', () => {
    const report = summarizeCharterRead([
      { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'same', name: 'charter_read', arguments: '{}' } },
      result(2, 1, 1, 'same', 'first'),
      { type: 'tool/call', seq: 3, data: { turn: 2, step: 1, callId: 'same', name: 'charter_read', arguments: '{"view":"all"}' } },
      result(4, 2, 1, 'same', 'second'),
    ])
    expect(report.calls).toBe(2)
    expect(report.paired).toBe(2)
    expect(report.resultBytes).toBe(11)
    expect(report.ambiguous).toBe(0)
    expect(report.unpairedResults).toBe(0)
  })

  it('pairs modern results through sourceEventSeqs and reports ambiguity', () => {
    const report = summarizeCharterRead([
      { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'c1', name: 'charter_read', arguments: '{}' } },
      { type: 'tool/call', seq: 2, data: { turn: 1, step: 1, callId: 'c2', name: 'charter_read', arguments: '{}' } },
      { type: 'tool/result', seq: 3, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ok' }] } }, sourceEventSeqs: [1] },
      { type: 'tool/result', seq: 4, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'bad' }] } }, sourceEventSeqs: [1, 2] },
    ])
    expect(report.paired).toBe(1)
    expect(report.resultBytes).toBe(2)
    expect(report.ambiguous).toBe(1)
  })
})
