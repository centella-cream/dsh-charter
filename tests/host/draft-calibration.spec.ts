import { describe, expect, it } from 'vitest'
import { buildCalibrationRequest, filterCalibrationCandidates, filterContractDraftItems, parseCalibrationResponse, planCalibrationBatches, runCalibrationPlan, runDraftCalibration } from '../../src/host/draft-calibration.js'

const input = {
  config: {
    targetLanguage: 'zh' as const,
    maxInputBytes: 24_576,
    maxOutputTokens: 2_048,
    maxCandidates: 12,
    maxItemBytes: 96,
    timeoutMs: 1_000,
  },
  hasObjective: false,
  accepted: [{ kind: 'invariant' as const, text: 'Must keep the API stable.' }],
  draftItems: [
    { ref: 'd-inv-0', kind: 'invariant' as const, text: 'Do not modify migrations/. '.repeat(8) },
    { ref: 'd-del-0', kind: 'deliverable' as const, text: 'Run the full check before delivery.' },
    { ref: 'd-obj-0', kind: 'objective' as const, text: 'Build a reviewable local dashboard.' },
  ],
}

describe('draft calibration prompt and validation', () => {
  it('builds a bounded versioned prompt with refs, accepted context, and target language', () => {
    const prepared = buildCalibrationRequest(input)
    expect(prepared.selected.length).toBeLessThanOrEqual(12)
    expect(prepared.user).toContain('targetLanguage: zh')
    expect(prepared.user).toContain('d-inv-0')
    expect(prepared.user).toContain('Must keep the API stable.')
    expect(prepared.system).toContain('untrusted data')
    expect(prepared.system).toContain('Simplified Chinese')
  })

  it('validates a strict candidate array and keeps mergedFrom provenance', () => {
    const prepared = buildCalibrationRequest(input)
    const parsed = parseCalibrationResponse(JSON.stringify([
      {
        kind: 'invariant',
        text: 'Do not modify migrations/.',
        uncertain: false,
        mergedFrom: ['d-inv-0'],
      },
      {
        kind: 'deliverable',
        text: 'Run the full check before delivery.',
        uncertain: true,
        mergedFrom: ['d-del-0'],
      },
    ]), prepared)
    expect(parsed.candidates.map(item => item.ref)).toEqual(['c-0', 'c-1'])
    expect(parsed.candidates[0]?.mergedFrom?.[0]).toMatchObject({ ref: 'd-inv-0' })
    expect(parsed.candidates[1]?.uncertain).toBe(true)
  })

  it('rejects an invalid ref, an extra objective, or a malformed response', () => {
    const prepared = buildCalibrationRequest(input)
    expect(() => parseCalibrationResponse(JSON.stringify([
      { kind: 'invariant', text: 'x', mergedFrom: ['d-forged'] },
    ]), prepared)).toThrow(/mergedFrom/u)
    expect(() => parseCalibrationResponse('not json', prepared)).toThrow(/JSON/u)
    expect(() => parseCalibrationResponse(JSON.stringify([
      { kind: 'objective', text: 'one' },
      { kind: 'objective', text: 'two' },
    ]), prepared)).toThrow(/objective/u)
  })

  it('splits oversized calibrated text into bounded derived refs', () => {
    const prepared = buildCalibrationRequest(input)
    const parsed = parseCalibrationResponse(JSON.stringify([
      { kind: 'invariant', text: 'First sentence. Second sentence. '.repeat(10), mergedFrom: ['d-inv-0'] },
    ]), prepared)
    expect(parsed.candidates.length).toBeGreaterThan(1)
    expect(parsed.candidates.every(candidate => candidate.ref.startsWith('c-0.s'))).toBe(true)
    expect(parsed.degraded?.[0]?.ref).toBe('c-0')
  })

  it('runs one bounded stream and returns usage', async () => {
    const preview = buildCalibrationRequest(input)
    const output = JSON.stringify([
      { kind: 'invariant', text: 'Keep the API stable.', mergedFrom: ['d-inv-0'] },
    ])
    const llm = {
      async *stream() {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: output }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'usage', usage: { outputTokens: 12 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await runDraftCalibration(llm as never, { provider: 'p', model: 'm' }, preview, 1_000)
    expect(result.candidates).toHaveLength(1)
    expect(result.usage?.outputTokens).toBe(12)
  })
})

describe('draft calibration failure matrix', () => {
  const prepared = buildCalibrationRequest(input)

  function streamOf(chunks: readonly unknown[]): { stream(): AsyncGenerator<unknown> } {
    return {
      async *stream() {
        for (const chunk of chunks) yield chunk
      },
    }
  }

  it('rejects malformed JSON, schema violations, and invalid text', async () => {
    await expect(runDraftCalibration(streamOf([
      { type: 'block-end', index: 0, block: { type: 'text', text: 'not json' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]) as never, { provider: 'p', model: 'm' }, prepared, 1_000)).rejects.toMatchObject({ code: 'CALIBRATION_MALFORMED' })
    await expect(runDraftCalibration(streamOf([
      { type: 'block-end', index: 0, block: { type: 'text', text: '{"kind":"invariant"}' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]) as never, { provider: 'p', model: 'm' }, prepared, 1_000)).rejects.toMatchObject({ code: 'CALIBRATION_SCHEMA' })
    await expect(runDraftCalibration(streamOf([
      { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify([{ kind: 'invariant', text: '\u0000' }]) } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]) as never, { provider: 'p', model: 'm' }, prepared, 1_000)).rejects.toMatchObject({ code: 'CALIBRATION_TEXT' })
  })

  it('rejects tool calls, non-stop finishes, and timeouts', async () => {
    await expect(runDraftCalibration(streamOf([
      { type: 'tool-call-delta', index: 0 },
      { type: 'finish', reason: { kind: 'stop' } },
    ]) as never, { provider: 'p', model: 'm' }, prepared, 1_000)).rejects.toMatchObject({ code: 'CALIBRATION_MALFORMED' })
    await expect(runDraftCalibration(streamOf([
      { type: 'block-end', index: 0, block: { type: 'text', text: '[]' } },
      { type: 'finish', reason: { kind: 'length' } },
    ]) as never, { provider: 'p', model: 'm' }, prepared, 1_000)).rejects.toMatchObject({ code: 'CALIBRATION_MALFORMED' })
    const slow = {
      async *stream(options: { signal?: AbortSignal }) {
        await new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    }
    await expect(runDraftCalibration(slow as never, { provider: 'p', model: 'm' }, prepared, 10))
      .rejects.toMatchObject({ code: 'CALIBRATION_TIMEOUT' })
  })
})


describe('adaptive calibration planning and batching (v8)', () => {
  const items = Array.from({ length: 32 }, (_, index) => ({
    ref: `d-inv-${index}`,
    kind: 'invariant' as const,
    text: `Requirement ${index} must remain stable and readable.`,
  }))
  const source = {
    config: {
      targetLanguage: 'en' as const,
      maxInputBytes: 24_576,
      maxOutputTokens: 4_096,
      maxCandidates: 32,
      maxItemBytes: 4_096,
      timeoutMs: 2_000,
    },
    hasObjective: false,
    accepted: [],
    draftItems: items,
  }
  const batching = {
    batchCandidates: 8,
    maxBatchInputBytes: 8_192,
    maxTotalOutputTokens: 16_384,
    maxConcurrency: 2,
    retrySplitDepth: 2,
    runTimeoutMs: 5_000,
  }
  const options = { timeoutMs: 2_000, runTimeoutMs: 5_000, maxConcurrency: 2, retrySplitDepth: 2 }

  function promptRefs(options: { messages: readonly { content: readonly { text?: string }[] }[] }): string[] {
    const prompt = options.messages[0]?.content[0]?.text ?? ''
    return [...prompt.matchAll(/^- (d-[a-z]+-\d+) \[/gmu)].map(match => match[1]!)
  }

  function batchModel(behavior?: (refs: readonly string[]) => 'ok' | 'length') {
    let active = 0
    let maxActive = 0
    const calls: string[][] = []
    return {
      get maxActive() { return maxActive },
      calls,
      async *stream(options: never) {
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          const refs = promptRefs(options)
          calls.push(refs)
          await new Promise(resolve => setTimeout(resolve, 10))
          if (behavior?.(refs) === 'length') {
            yield { type: 'block-end', index: 0, block: { type: 'text', text: '[]' } }
            yield { type: 'finish', reason: { kind: 'length' } }
            return
          }
          const output = JSON.stringify(refs.map(ref => ({ kind: 'invariant', text: `Calibrated ${ref}.`, mergedFrom: [ref] })))
          yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
          yield { type: 'usage', usage: { outputTokens: 10 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } finally {
          active -= 1
        }
      },
    }
  }

  it('promotes a deliverable-provenance invariant to the deliverable kind', async () => {
    const deliverableSource = {
      ...source,
      draftItems: [{ ref: 'd-del-0', kind: 'deliverable' as const, text: 'Run the full gate.' }],
    }
    const model = {
      async *stream(options: never) {
        const refs = promptRefs(options)
        const output = JSON.stringify([{ kind: 'invariant', text: 'Run the full gate.', mergedFrom: [refs[0] ?? 'd-del-0'] }])
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(deliverableSource, batching), options)
    expect(result.candidates[0]?.kind).toBe('deliverable')
  })

  it('promotes an objective-provenance invariant to the objective kind', async () => {
    const objectiveSource = {
      ...source,
      draftItems: [
        { ref: 'd-obj-0', kind: 'objective' as const, text: 'Ship the calibrated dashboard.' },
        { ref: 'd-inv-0', kind: 'invariant' as const, text: 'Keep the API stable.' },
      ],
    }
    const model = {
      async *stream(options: never) {
        const refs = promptRefs(options)
        const output = JSON.stringify([{ kind: 'invariant', text: 'Ship the calibrated dashboard.', mergedFrom: [refs[0] ?? 'd-obj-0'] }])
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(objectiveSource, batching), options)
    expect(result.candidates.filter(candidate => candidate.kind === 'objective')).toHaveLength(1)
  })

  it('accepts objective only from the batch that carried objective input', async () => {
    const objectiveSource = {
      ...source,
      draftItems: [
        { ref: 'd-obj-0', kind: 'objective' as const, text: 'Ship the calibrated dashboard.' },
        ...Array.from({ length: 9 }, (_, index) => ({ ref: `d-inv-${index}`, kind: 'invariant' as const, text: `Requirement ${index} must remain stable.` })),
      ],
    }
    let call = 0
    const model = {
      async *stream(options: never) {
        call += 1
        const refs = promptRefs(options)
        const output = JSON.stringify([{
          kind: 'objective',
          text: `Objective from batch ${call}.`,
          mergedFrom: [refs[0] ?? 'd-obj-0'],
        }])
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'usage', usage: { outputTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(objectiveSource, batching), options)
    expect(result.candidates.filter(candidate => candidate.kind === 'objective')).toHaveLength(1)
    expect(result.conflicts?.some(conflict => conflict.reason === 'objective')).toBe(true)
  })

  it('plans bounded batches and keeps every selected ref', () => {
    const plan = planCalibrationBatches(source, batching)
    expect(plan.batches).toHaveLength(4)
    expect(plan.batches.every(batch => batch.selected.length === 8)).toBe(true)
    expect(plan.excludedRefs).toHaveLength(0)
    expect(plan.batches.flatMap(batch => batch.selected.map(item => item.ref))).toHaveLength(32)
  })

  it('runs batches concurrently within the configured cap and merges candidates', async () => {
    const model = batchModel()
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(source, batching), options)
    expect(model.maxActive).toBe(2)
    expect(result.batchCount).toBe(4)
    expect(result.completedBatches).toBe(4)
    expect(result.failedBatches).toBe(0)
    expect(result.candidates).toHaveLength(32)
    expect(result.usage?.calls).toBe(4)
  })

  it('splits a finish=length batch and keeps other batches usable', async () => {
    const model = batchModel(refs => refs.includes('d-inv-7') ? 'length' : 'ok')
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(source, batching), options)
    expect(result.completedBatches).toBeGreaterThan(0)
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.usage?.calls).toBeGreaterThan(4)
  })

  it('returns partial results and explicit failed refs when one ref cannot be calibrated', async () => {
    const model = {
      async *stream(options: never) {
        const refs = promptRefs(options)
        if (refs.includes('d-inv-7')) {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'not json' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        const output = JSON.stringify(refs.map(ref => ({ kind: 'invariant', text: `Calibrated ${ref}.`, mergedFrom: [ref] })))
        yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await runCalibrationPlan(model as never, { provider: 'p', model: 'm' }, planCalibrationBatches(source, batching), options)
    expect(result.partial).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.excludedRefs?.some(item => item.ref === 'd-inv-7' && item.reason === 'batch-failed')).toBe(true)
    expect(result.candidates.length).toBeGreaterThan(0)
  })
})


describe('contractness gate and quotas (v9)', () => {
  const noisy = [
    { ref: 'd-obj-0', kind: 'objective' as const, text: 'Ship the service.' },
    { ref: 'd-inv-0', kind: 'invariant' as const, text: 'Latest review requires 3 pre-run fixes:' },
    { ref: 'd-inv-1', kind: 'invariant' as const, text: 'T-1: add a read-only precheck before the write.' },
    { ref: 'd-inv-2', kind: 'invariant' as const, text: 'Suggested extra fixes: optimize PRAGMA.' },
    { ref: 'd-inv-3', kind: 'invariant' as const, text: 'Current git status is dirty.' },
    { ref: 'd-inv-4', kind: 'invariant' as const, text: 'Need confirm with the user before running.' },
    { ref: 'd-inv-5', kind: 'invariant' as const, text: 'No execution until the user approves.' },
    { ref: 'd-del-0', kind: 'deliverable' as const, text: 'Fix the failing transaction test.' },
    { ref: 'd-del-1', kind: 'deliverable' as const, text: 'Run the full gate.' },
  ]

  it('filters fragments/status/history/optional/pending and reclassifies actions', () => {
    const filtered = filterContractDraftItems(noisy)
    expect(filtered.items.map(item => item.ref)).toEqual(['d-obj-0', 'd-inv-1', 'd-inv-5', 'd-del-0', 'd-del-1'])
    expect(filtered.items.find(item => item.ref === 'd-inv-1')?.kind).toBe('deliverable')
    expect(filtered.excludedRefs.map(item => item.ref)).toEqual(['d-inv-0', 'd-inv-2', 'd-inv-3', 'd-inv-4'])
    expect(filtered.excludedRefs.every(item => item.reason === 'non-contract')).toBe(true)
  })

  it('keeps mandatory Test/Coverage/decision-authority lines', () => {
    const filtered = filterContractDraftItems([
      { ref: 'd-inv-0', kind: 'invariant', text: 'Tests must pass before release.' },
      { ref: 'd-inv-1', kind: 'invariant', text: 'Coverage must stay at least 90%.' },
      { ref: 'd-inv-2', kind: 'invariant', text: 'User decision authority remains with the owner.' },
    ])
    expect(filtered.items.map(item => item.ref)).toEqual(['d-inv-0', 'd-inv-1', 'd-inv-2'])
  })

  it('keeps the objective and reserves deliverable slots under the global cap', () => {
    const items = [
      { ref: 'd-obj-0', kind: 'objective' as const, text: 'Ship the service.' },
      ...Array.from({ length: 20 }, (_, index) => ({ ref: `d-inv-${index}`, kind: 'invariant' as const, text: `Requirement ${index} must hold.` })),
      ...Array.from({ length: 10 }, (_, index) => ({ ref: `d-del-${index}`, kind: 'deliverable' as const, text: `Implement deliverable ${index}.` })),
    ]
    const plan = planCalibrationBatches({
      config: { targetLanguage: 'en', maxInputBytes: 24_576, maxOutputTokens: 4_096, maxCandidates: 12, maxItemBytes: 4_096, timeoutMs: 2_000 },
      hasObjective: false,
      accepted: [],
      draftItems: items,
    }, { batchCandidates: 8, maxBatchInputBytes: 8_192, maxTotalOutputTokens: 16_384, maxConcurrency: 2, retrySplitDepth: 1, runTimeoutMs: 5_000 })
    const selected = plan.batches.flatMap(batch => batch.selected)
    expect(selected.some(item => item.ref === 'd-obj-0')).toBe(true)
    expect(selected.filter(item => item.kind === 'deliverable')).toHaveLength(4)
    expect(plan.inputTruncated).toBe(true)
  })

  it('uses prompt v2 to reject non-contract material and filters model output', () => {
    const prepared = buildCalibrationRequest(input)
    expect(prepared.system).toContain('Only emit durable contract items')
    expect(prepared.system).toContain('Drop headings/labels')
    expect(prepared.system).toContain('Action items such as T-1/T-2/T-3 are deliverables')
    const filtered = filterCalibrationCandidates([
      { ref: 'c-0', kind: 'invariant', text: 'Latest review requires 3 fixes:', uncertain: false },
      { ref: 'c-1', kind: 'invariant', text: 'T-1: add the precheck.', uncertain: false },
      { ref: 'c-2', kind: 'invariant', text: 'Current git status is dirty.', uncertain: false },
      { ref: 'c-3', kind: 'deliverable', text: 'Run the full gate.', uncertain: false },
    ])
    expect(filtered.candidates.map(item => item.ref)).toEqual(['c-1', 'c-3'])
    expect(filtered.candidates[0]?.kind).toBe('deliverable')
  })
})
