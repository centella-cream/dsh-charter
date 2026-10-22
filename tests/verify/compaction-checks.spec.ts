import { describe, expect, it } from 'vitest'
import {
  charterReadArgumentsView,
  compactStandingItem,
  evaluateCompactionEvidence,
  evaluateCompactionTranscript,
  isValidCharterReadEvidence,
  postCompactionCharterReads,
  sha256Text,
} from '../../scripts/verify/compaction-checks.mjs'

const pass = {
  charterReady: true,
  survivesCompaction: true,
  systemPromptClean: true,
  charterReadStanding: true,
  checkpointLeaksCharter: false,
}

const PROMPT = 'Current user-authored session charter.\n{"objective":"Ship it"}'
const PROMPT_PREFIX = 'Current user-authored session charter.'
const READ_VIEW = { revision: 1, objective: null, items: [] }

function storage(overrides: Record<string, unknown> = {}) {
  return {
    revision: 1,
    promptText: PROMPT,
    promptDigest: sha256Text(PROMPT),
    objective: null,
    items: [],
    committedAt: 900,
    ...overrides,
  }
}

interface TestEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: Record<string, unknown>
  readonly sourceEventSeqs?: readonly number[]
}

function compactionLifecycle(id: string, baseSeq: number, baseTime: number): TestEvent[] {
  return [
    { type: 'compaction/start', seq: baseSeq, time: baseTime, data: { compactionId: id } },
    { type: 'compaction/summary', seq: baseSeq + 1, time: baseTime + 1, data: { compactionId: id } },
    {
      type: 'user/message',
      seq: baseSeq + 2,
      time: baseTime + 2,
      data: {
        source: { kind: 'compact-checkpoint', compactionId: id },
        content: [{ type: 'text', text: 'ordinary summary' }],
      },
    },
    { type: 'compaction/end', seq: baseSeq + 3, time: baseTime + 3, data: { compactionId: id } },
  ]
}

function runtimeSnapshot(seq: number, text = PROMPT): TestEvent {
  return {
    type: 'user/message',
    seq,
    time: 2_000 + seq,
    data: {
      source: {
        kind: 'runtime-context',
        sections: [
          { name: 'sandbox:policy', text: 'sandbox' },
          { name: 'charter:standing', text },
        ],
      },
    },
  }
}

function charterReadCall(seq: number, turn: number, callId: string): TestEvent {
  return {
    type: 'tool/call',
    seq,
    time: 3_000 + seq,
    data: { turn, step: 1, callId, name: 'charter_read', arguments: '{"view":"standing"}' },
  }
}

function charterReadResult(
  seq: number,
  turn: number,
  callId: string,
  options: { readonly sourceEventSeqs?: readonly number[]; readonly view?: unknown; readonly isError?: boolean } = {},
): TestEvent {
  return {
    type: 'tool/result',
    seq,
    time: 3_000 + seq,
    ...(options.sourceEventSeqs === undefined
      ? {}
      : { sourceEventSeqs: options.sourceEventSeqs }),
    data: {
      turn,
      step: 1,
      message: {
        role: 'tool',
        toolCallId: callId,
        isError: options.isError === true,
        content: [{ type: 'text', text: JSON.stringify(options.view ?? READ_VIEW) }],
      },
    },
  }
}

function evidenceFixture(): TestEvent[] {
  const callSeq = 15
  return [
    ...compactionLifecycle('compaction-1', 10, 1_000),
    runtimeSnapshot(14),
    charterReadCall(callSeq, 4, 'call-read-1'),
    charterReadResult(16, 4, 'call-read-1', { sourceEventSeqs: [callSeq] }),
  ]
}

function verdict(report: ReturnType<typeof evaluateCompactionTranscript>, label: string) {
  return report.verdictLines.find(line => line.label === label)
}

function evaluate(events: TestEvent[], overrides: Record<string, unknown> = {}) {
  return evaluateCompactionTranscript({
    events,
    current: storage(overrides) as never,
    promptPrefix: PROMPT_PREFIX,
  })
}

describe('compaction transcript lifecycle evaluation', () => {
  it('passes a clean lifecycle and reports exit code, verdicts, text and warnings', () => {
    const report = evaluate(evidenceFixture())
    expect(report.status).toBe('pass')
    expect(report.exitCode).toBe(0)
    expect(report.latestCompaction).toMatchObject({ id: 'compaction-1', startSeq: 10, endSeq: 13 })
    expect(report.verdicts).toMatchObject({
      charterReady: true,
      survivesCompaction: true,
      injectedAfterCompaction: true,
      charterPredatesCompaction: true,
      charterReadStanding: true,
      postCompactionExecutionWithoutSnapshot: false,
    })
    expect(report.authenticatedCharterReads).toBe(1)
    expect(report.verification.warnings).toEqual([])
    expect(verdict(report, 'charter survives compaction')).toMatchObject({ state: 'PASS' })
    expect(verdict(report, 'authenticated post-compaction charter_read standing view matches the storage revision/objective'))
      .toMatchObject({ state: 'PASS' })
    // JSON-serializable report for --json output.
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ status: 'pass', exitCode: 0 })
  })

  it('ignores a later compaction with a failed end as PASS evidence', () => {
    const events = [
      ...evidenceFixture(),
      { type: 'compaction/start', seq: 20, time: 4_000, data: { compactionId: 'compaction-2' } },
      { type: 'compaction/summary', seq: 21, time: 4_001, data: { compactionId: 'compaction-2' } },
      {
        type: 'compaction/end',
        seq: 22,
        time: 4_002,
        data: { compactionId: 'compaction-2', error: 'summary generation failed' },
      },
    ]
    const report = evaluate(events)
    expect(report.latestCompaction).toMatchObject({ id: 'compaction-1' })
    expect(report.compactions.find(compaction => compaction.id === 'compaction-2'))
      .toMatchObject({ ok: false, error: 'summary generation failed' })
    expect(report.status).toBe('pass')
    expect(report.exitCode).toBe(0)
  })

  it('warns when a checkpoint before the end carries the charter text', () => {
    const events = evidenceFixture().map(event => event.seq === 12
      ? {
          ...event,
          data: {
            ...event.data,
            content: [{ type: 'text', text: `summary that leaks: ${PROMPT}` }],
          },
        }
      : event)
    const report = evaluate(events)
    expect(report.verdicts.checkpointLeaksCharter).toBe(true)
    expect(report.checkpoints.some(checkpoint => checkpoint.leaksCharter)).toBe(true)
    expect(report.verification.ok).toBe(true)
    expect(report.verification.warnings).toHaveLength(1)
    expect(report.verification.warnings[0]).toContain('summary carries the charter')
    expect(verdict(report, 'compaction summary does not carry the charter text')?.detail)
      .toContain('WARNING')
  })

  it('requires the charter to be committed before the compaction start, not its end', () => {
    // Committed between compaction start (time 1000) and end (time 1003).
    const report = evaluate(evidenceFixture(), { committedAt: 1_002 })
    expect(report.verdicts.charterPredatesCompaction).toBe(false)
    expect(report.status).toBe('wait')
    expect(report.exitCode).toBe(3)
    expect(verdict(report, 'charter survives compaction')).toMatchObject({ state: 'WAIT' })
  })

  it('fails when a request executed after the compaction without a runtime snapshot', () => {
    const events = [
      ...compactionLifecycle('compaction-1', 10, 1_000),
      // No runtime-context snapshot after the end; request activity starts.
      {
        type: 'assistant/message',
        seq: 14,
        time: 2_014,
        data: { turn: 4, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } },
      },
      { type: 'tool/call', seq: 15, time: 2_015, data: { turn: 4, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' } },
    ]
    const report = evaluate(events)
    expect(report.verdicts.postCompactionExecutionWithoutSnapshot).toBe(true)
    expect(report.status).toBe('fail')
    expect(report.exitCode).toBe(1)
    expect(report.verification.failures).toContain(
      'a post-compaction request executed without a new runtime-context snapshot',
    )
    expect(verdict(report, 'charter survives compaction')).toMatchObject({ state: 'FAIL' })
  })

  it('pairs a legacy duplicate callId by turn/step and event order, not globally', () => {
    const callSeq = 15
    const events = [
      // Same callId used in an older turn before the compaction.
      charterReadCall(2, 2, 'call-duplicate'),
      charterReadResult(3, 2, 'call-duplicate'),
      ...compactionLifecycle('compaction-1', 10, 1_000),
      runtimeSnapshot(14),
      charterReadCall(callSeq, 3, 'call-duplicate'),
      charterReadResult(16, 3, 'call-duplicate', { view: READ_VIEW }),
    ]
    const report = evaluate(events)
    expect(report.status).toBe('pass')
    expect(report.charterRead).toMatchObject({
      callSeq: 15,
      callId: 'call-duplicate',
      resolution: 'callId-turn-step',
    })
    expect(report.authenticatedCharterReads).toBe(1)
  })
})

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
