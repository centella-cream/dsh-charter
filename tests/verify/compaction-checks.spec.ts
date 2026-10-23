import { describe, expect, it } from 'vitest'
import {
  charterReadArgumentsView,
  compactStandingItem,
  evaluateCompactionEvidence,
  evaluateCompactionTranscript,
  isValidCharterReadEvidence,
  postCompactionCharterReads,
  readCompactionLifecycles,
  resolveCharterReadCalls,
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

  it('parses the requested view strictly; only missing/plain objects are default', () => {
    expect(charterReadArgumentsView(undefined)).toBeUndefined()
    expect(charterReadArgumentsView({})).toBeUndefined()
    expect(charterReadArgumentsView('{}')).toBeUndefined()
    expect(charterReadArgumentsView({ other: 1 })).toBeUndefined()
    expect(charterReadArgumentsView('{"view":"standing"}')).toBe('standing')
    expect(charterReadArgumentsView({ view: 'standing' })).toBe('standing')
    expect(charterReadArgumentsView('{"view":"all"}')).toBe('all')
    // Malformed shapes are rejected, never treated as the default view.
    for (const invalid of ['', 'not-json', 'null', '[]', '42', 'true', '{"view":42}', '{"view":null}']) {
      expect(charterReadArgumentsView(invalid)).toBe('invalid-arguments')
    }
    for (const invalid of [null, [], 42, true, false]) {
      expect(charterReadArgumentsView(invalid as never)).toBe('invalid-arguments')
    }
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

describe('sourceEventSeqs presence and malformed shapes', () => {
  function malformedFixture(value: unknown, where: 'top' | 'data'): { events: TestEvent[]; resultSeq: number } {
    const resultSeq = 16
    const base: TestEvent = {
      type: 'tool/result',
      seq: resultSeq,
      time: 3_016,
      data: {
        turn: 4,
        step: 1,
        message: {
          role: 'tool',
          toolCallId: 'call-auth',
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(READ_VIEW) }],
        },
      },
    }
    const event = where === 'top'
      ? { ...base, sourceEventSeqs: value as never }
      : { ...base, data: { ...base.data, sourceEventSeqs: value } }
    return {
      events: [
        ...compactionLifecycle('malformed-compaction', 10, 1_000),
        runtimeSnapshot(14),
        charterReadCall(15, 4, 'call-auth'),
        event,
      ],
      resultSeq,
    }
  }

  function resultFor(events: TestEvent[], seq: number) {
    return resolveCharterReadCalls(events).results.find(result => result.seq === seq)
  }

  it('rejects malformed present sourceEventSeqs instead of falling back to legacy pairing', () => {
    for (const value of ['not-an-array', { seq: 15 }, null, 42, true]) {
      for (const where of ['top', 'data'] as const) {
        const fixture = malformedFixture(value, where)
        expect(resultFor(fixture.events, fixture.resultSeq)).toMatchObject({
          authenticated: false,
          authError: 'invalid-source-seqs',
        })
        // A legacy callId pairing would have passed here; it must not be used.
        expect(evaluate(fixture.events).status).not.toBe('pass')
      }
    }
  })

  it('rejects a top-level/data sourceEventSeqs mismatch', () => {
    const base: TestEvent = {
      type: 'tool/result',
      seq: 16,
      time: 3_016,
      sourceEventSeqs: [15],
      data: {
        turn: 4,
        step: 1,
        sourceEventSeqs: [16],
        message: {
          role: 'tool',
          toolCallId: 'call-auth',
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(READ_VIEW) }],
        },
      },
    }
    const events = [
      ...compactionLifecycle('mismatch-compaction', 10, 1_000),
      runtimeSnapshot(14),
      charterReadCall(15, 4, 'call-auth'),
      base,
    ]
    expect(resultFor(events, 16)).toMatchObject({
      authenticated: false,
      authError: 'source-event-seqs-mismatch',
    })
    expect(evaluate(events).status).not.toBe('pass')
  })

  it('accepts identical top-level and data sourceEventSeqs', () => {
    const base: TestEvent = {
      type: 'tool/result',
      seq: 16,
      time: 3_016,
      sourceEventSeqs: [15],
      data: {
        turn: 4,
        step: 1,
        sourceEventSeqs: [15],
        message: {
          role: 'tool',
          toolCallId: 'call-auth',
          isError: false,
          content: [{ type: 'text', text: JSON.stringify(READ_VIEW) }],
        },
      },
    }
    const events = [
      ...compactionLifecycle('identical-compaction', 10, 1_000),
      runtimeSnapshot(14),
      charterReadCall(15, 4, 'call-auth'),
      base,
    ]
    expect(resultFor(events, 16)).toMatchObject({ authenticated: true, resolution: 'sourceEventSeqs' })
  })
})

describe('later landed compaction attempts', () => {
  function withFailedLandedAttempt(options: { readonly checkpoint?: boolean } = {}): TestEvent[] {
    return [
      ...evidenceFixture(),
      { type: 'compaction/start', seq: 20, time: 4_000, data: { compactionId: 'later-compaction' } },
      { type: 'compaction/summary', seq: 21, time: 4_001, data: { compactionId: 'later-compaction' } },
      ...(options.checkpoint === false ? [] : [{
        type: 'user/message',
        seq: 22,
        time: 4_002,
        data: {
          source: { kind: 'compact-checkpoint', compactionId: 'later-compaction' },
          content: [{ type: 'text', text: 'later landed checkpoint' }],
        },
      }]),
      {
        type: 'compaction/end',
        seq: 23,
        time: 4_003,
        data: { compactionId: 'later-compaction', error: 'summary generation failed' },
      },
    ]
  }

  it('fails when a later failed compaction landed a checkpoint', () => {
    const report = evaluate(withFailedLandedAttempt())
    expect(report.verdicts.laterCompactionAttempt).toBe('landed-failed')
    expect(report.status).toBe('fail')
    expect(report.exitCode).toBe(1)
    expect(report.verification.ok).toBe(false)
    expect(report.verification.failures).toContain(
      'a later failed compaction landed a checkpoint after the evidence; re-compact and re-read before claiming survival',
    )
    expect(report.verdictLines.find(line => line.label === 'charter survives compaction'))
      .toMatchObject({ state: 'FAIL' })
  })

  it('waits when a later compaction attempt is still open', () => {
    const events = [
      ...evidenceFixture(),
      { type: 'compaction/start', seq: 20, time: 4_000, data: { compactionId: 'open-compaction' } },
    ]
    const report = evaluate(events)
    expect(report.verdicts.laterCompactionAttempt).toBe('open')
    expect(report.status).toBe('wait')
    expect(report.exitCode).toBe(3)
    expect(report.verdictLines.find(line => line.label === 'charter survives compaction'))
      .toMatchObject({ state: 'WAIT' })
  })

  it('keeps the earlier PASS when the later failed attempt landed no checkpoint', () => {
    const report = evaluate(withFailedLandedAttempt({ checkpoint: false }))
    expect(report.verdicts.laterCompactionAttempt).toBeUndefined()
    expect(report.status).toBe('pass')
    expect(report.exitCode).toBe(0)
  })

  it('waits for post-evidence after a later successful compaction', () => {
    const events = [
      ...evidenceFixture(),
      ...compactionLifecycle('newer-success', 30, 5_000),
    ]
    const report = evaluate(events)
    expect(report.latestCompaction).toMatchObject({ id: 'newer-success' })
    // The newer compaction has no post-compaction activity yet.
    expect(report.verdicts.noPostCompactionActivity).toBe(true)
    expect(report.status).toBe('wait')
    expect(report.exitCode).toBe(3)
  })
})

describe('strict compaction lifecycle state machine', () => {
  function attempt(id: string, baseSeq: number, options: { readonly error?: string } = {}): TestEvent[] {
    const loop = compactionLifecycle(id, baseSeq, baseSeq * 10)
    if (options.error === undefined) return loop
    const end = loop.at(-1)!
    return [
      ...loop.slice(0, -1),
      { ...end, data: { ...end.data, error: options.error } },
    ]
  }

  it('never treats an end before its start as evidence', () => {
    const events: TestEvent[] = [
      { type: 'compaction/end', seq: 1, time: 1, data: { compactionId: 'out-of-order' } },
      { type: 'compaction/start', seq: 2, time: 2, data: { compactionId: 'out-of-order' } },
      { type: 'compaction/summary', seq: 3, time: 3, data: { compactionId: 'out-of-order' } },
    ]
    const report = evaluate(events)
    expect(report.latestCompaction).toBeNull()
    expect(report.status).toBe('wait')
    expect(report.exitCode).toBe(3)
  })

  it('ignores a summary that appears before the start opens its attempt', () => {
    const events: TestEvent[] = [
      { type: 'compaction/summary', seq: 1, time: 1, data: { compactionId: 'before-start' } },
      { type: 'compaction/start', seq: 2, time: 2, data: { compactionId: 'before-start' } },
      { type: 'compaction/end', seq: 3, time: 3, data: { compactionId: 'before-start' } },
    ]
    const lifecycles = readCompactionLifecycles(events)
    expect(lifecycles.successful).toHaveLength(0)
    expect(evaluate(events).status).toBe('wait')
  })

  it('treats a same-id retry as an independent attempt and ignores the failed one', () => {
    const events = [
      ...attempt('retry', 10, { error: 'summary generation failed' }),
      ...attempt('retry', 20),
    ]
    const lifecycles = readCompactionLifecycles(events)
    expect(lifecycles.successful).toHaveLength(1)
    expect(lifecycles.successful[0]).toMatchObject({ id: 'retry', startSeq: 20, endSeq: 23 })
    const report = evaluate(events)
    expect(report.latestCompaction).toMatchObject({ id: 'retry', startSeq: 20, endSeq: 23 })
    expect(report.compactions.filter(compaction => compaction.id === 'retry')).toHaveLength(2)
  })

  it('keeps a valid sequence successful', () => {
    const lifecycles = readCompactionLifecycles(compactionLifecycle('valid', 10, 1_000))
    expect(lifecycles.successful).toHaveLength(1)
    expect(lifecycles.successful[0]).toMatchObject({ startSeq: 10, summarySeq: 11, endSeq: 13, ok: true })
  })
})

describe('modern charter_read producing-call authentication', () => {
  function modernFixture(options: {
    readonly calls: TestEvent[]
    readonly result: TestEvent
  }): { events: TestEvent[]; resultSeq: number } {
    return {
      events: [
        ...compactionLifecycle('auth-compaction', 10, 1_000),
        runtimeSnapshot(14),
        ...options.calls,
        options.result,
      ],
      resultSeq: options.result.seq,
    }
  }

  function resultFor(events: TestEvent[], seq: number) {
    return resolveCharterReadCalls(events).results.find(result => result.seq === seq)
  }

  it('accepts exactly one matching producing call', () => {
    const fixture = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth')],
      result: charterReadResult(16, 4, 'call-auth', { sourceEventSeqs: [15] }),
    })
    expect(resultFor(fixture.events, fixture.resultSeq)).toMatchObject({
      authenticated: true,
      resolution: 'sourceEventSeqs',
      callSeq: 15,
    })
    expect(evaluate(fixture.events).status).toBe('pass')
  })

  it('rejects source seqs that reference another tool call', () => {
    const bashCall: TestEvent = {
      type: 'tool/call',
      seq: 16,
      time: 3_016,
      data: { turn: 4, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' },
    }
    const fixture = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth'), bashCall],
      result: charterReadResult(17, 4, 'call-auth', { sourceEventSeqs: [15, 16] }),
    })
    expect(resultFor(fixture.events, fixture.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'source-seqs-reference-other-tool',
    })
    expect(evaluate(fixture.events).status).toBe('fail')
  })

  it('rejects a toolCallId / turn / step mismatch with the producing call', () => {
    const mismatchedId = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth')],
      result: charterReadResult(16, 4, 'call-other', { sourceEventSeqs: [15] }),
    })
    expect(resultFor(mismatchedId.events, mismatchedId.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'tool-call-id-mismatch',
    })
    const mismatchedTurn = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth')],
      result: charterReadResult(16, 5, 'call-auth', { sourceEventSeqs: [15] }),
    })
    expect(resultFor(mismatchedTurn.events, mismatchedTurn.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'turn-mismatch',
    })
    const callWithStep: TestEvent = {
      type: 'tool/call',
      seq: 15,
      time: 3_015,
      data: { turn: 4, step: 2, callId: 'call-auth', name: 'charter_read', arguments: '{}' },
    }
    const mismatchedStep = modernFixture({
      calls: [callWithStep],
      result: charterReadResult(16, 4, 'call-auth', { sourceEventSeqs: [15] }),
    })
    expect(resultFor(mismatchedStep.events, mismatchedStep.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'step-mismatch',
    })
  })

  it('rejects source seqs that are not finite integers earlier than the result', () => {
    const fixture = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth'), charterReadCall(18, 4, 'call-late')],
      result: charterReadResult(17, 4, 'call-auth', { sourceEventSeqs: [18] }),
    })
    expect(resultFor(fixture.events, fixture.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'invalid-source-seqs',
    })
    const nonInteger = modernFixture({
      calls: [charterReadCall(15, 4, 'call-auth')],
      result: charterReadResult(16, 4, 'call-auth', { sourceEventSeqs: [15.5] }),
    })
    expect(resultFor(nonInteger.events, nonInteger.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'invalid-source-seqs',
    })
  })

  it('rejects ambiguous or non-charter_read producing calls', () => {
    const ambiguous = modernFixture({
      calls: [charterReadCall(15, 4, 'call-a'), charterReadCall(16, 4, 'call-b')],
      result: charterReadResult(17, 4, 'call-a', { sourceEventSeqs: [15, 16] }),
    })
    expect(resultFor(ambiguous.events, ambiguous.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'source-seqs-ambiguous',
    })
    const bashCall: TestEvent = {
      type: 'tool/call',
      seq: 15,
      time: 3_015,
      data: { turn: 4, step: 1, callId: 'call-bash', name: 'bash', arguments: '{}' },
    }
    const noCharter = modernFixture({
      calls: [bashCall],
      result: charterReadResult(16, 4, 'call-bash', { sourceEventSeqs: [15] }),
    })
    expect(resultFor(noCharter.events, noCharter.resultSeq)).toMatchObject({
      authenticated: false,
      authError: 'source-seqs-reference-other-tool',
    })
  })
})

describe('post-compaction activity gating', () => {
  it('returns WAIT (exit 3) with no evidence failures when no request activity followed the compaction', () => {
    const report = evaluate(compactionLifecycle('idle-compaction', 10, 1_000))
    expect(report.verdicts.noPostCompactionActivity).toBe(true)
    expect(report.verdicts.postCompactionExecutionWithoutSnapshot).toBe(false)
    // No activity means no evidence was evaluated: WAIT, not a false failure.
    expect(report.verification).toMatchObject({ ok: true, failures: [] })
    expect(report.verdicts.survivesCompaction).toBeUndefined()
    expect(report.verdicts.injectedAfterCompaction).toBeUndefined()
    expect(report.verdicts.systemPromptClean).toBeUndefined()
    expect(report.verdicts.charterReadStanding).toBeUndefined()
    expect(report.status).toBe('wait')
    expect(report.exitCode).toBe(3)
    expect(report.verdictLines.find(line => line.label === 'charter survives compaction'))
      .toMatchObject({ state: 'WAIT' })
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      status: 'wait',
      exitCode: 3,
      verification: { ok: true, failures: [] },
    })
  })
})

describe('checkpoint association by compactionId', () => {
  it('never associates a checkpoint belonging to another compactionId', () => {
    const events = [
      ...evidenceFixture(),
      {
        type: 'user/message',
        seq: 20,
        time: 5_020,
        data: {
          source: { kind: 'compact-checkpoint', compactionId: 'some-other-compaction' },
          content: [{ type: 'text', text: `other summary that leaks: ${PROMPT}` }],
        },
      },
    ]
    const report = evaluate(events)
    expect(report.verdicts.checkpointLeaksCharter).toBe(false)
    expect(report.verification.warnings).toEqual([])
    expect(report.checkpoints.some(checkpoint => checkpoint.leaksCharter)).toBe(false)
  })

  it('allows a positional fallback only for an id-less legacy checkpoint', () => {
    const events: TestEvent[] = [
      { type: 'compaction/start', seq: 10, time: 1_000, data: { compactionId: 'legacy-compaction' } },
      { type: 'compaction/summary', seq: 11, time: 1_001, data: { compactionId: 'legacy-compaction' } },
      { type: 'compaction/end', seq: 12, time: 1_002, data: { compactionId: 'legacy-compaction' } },
      {
        type: 'user/message',
        seq: 13,
        time: 1_003,
        data: {
          source: { kind: 'compact-checkpoint' },
          content: [{ type: 'text', text: `id-less summary that leaks: ${PROMPT}` }],
        },
      },
      runtimeSnapshot(14),
      charterReadCall(15, 4, 'call-legacy'),
      charterReadResult(16, 4, 'call-legacy', { sourceEventSeqs: [15] }),
    ]
    const report = evaluate(events)
    expect(report.verdicts.checkpointLeaksCharter).toBe(true)
    expect(report.verification.warnings).toHaveLength(1)
  })
})
