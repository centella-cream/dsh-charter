import { describe, expect, it } from 'vitest'
import { buildCalibrationRequest, parseCalibrationResponse, runDraftCalibration } from '../../src/host/draft-calibration.js'

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
