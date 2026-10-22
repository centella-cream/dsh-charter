import { describe, expect, it } from 'vitest'
import { bootstrapFromEvents, bootstrapFromSummary } from '../../src/core/bootstrap.js'

const limits = { maxObjectiveBytes: 256, maxItemBytes: 256 }

const summary = `## Primary Request and Intent
- Original: "Build a charter plugin."
- Latest correction: "Put the charter tab after Trajectory."
- User wants:
  - Keep the charter tab last.
  - Do not modify migrations/.
## Key Technical Concepts
- storage-domain records.
## Critical Context
- The runtime is DSH 0.2.0-rc.2.
- Must keep the public API backward compatible.
## Pending Jobs
- Write tests for bootstrap.
- Update the user guide.
## Next Step
- Run the full check.
`

describe('bootstrapFromSummary', () => {
  it('extracts the latest objective, user constraints, and pending deliverables', () => {
    const draft = bootstrapFromSummary(summary, limits)
    expect(draft.objective).toBe('Put the charter tab after Trajectory.')
    expect(draft.invariants).toEqual([
      'Keep the charter tab last.',
      'Do not modify migrations/.',
      'Must keep the public API backward compatible.',
    ])
    expect(draft.deliverables).toEqual([
      'Write tests for bootstrap.',
      'Update the user guide.',
      'Run the full check.',
    ])
  })

  it('keeps an oversized objective whole and splits oversized items', () => {
    const longDeliverable = Array.from({ length: 80 }, (_, index) => `step-${index}`).join(' ')
    const draft = bootstrapFromSummary(
      `## Primary Request and Intent\n- Original: ${'界'.repeat(300)}\n## Pending Jobs\n- ${longDeliverable}\n`,
      { maxObjectiveBytes: 30, maxItemBytes: 30 },
    )
    expect(Buffer.byteLength(draft.objective ?? '', 'utf8')).toBeGreaterThan(30)
    expect(draft.objective?.endsWith('…')).not.toBe(true)
    expect(draft.deliverables.length).toBeGreaterThan(1)
    expect(draft.deliverables.every(item => Buffer.byteLength(item, 'utf8') <= 30)).toBe(true)
    expect(draft.deliverables.join(' ')).toContain('step-79')
  })

  it('keeps the objective limit separate from the item limit', () => {
    const draft = bootstrapFromSummary(
      `## Primary Request and Intent\n- Original: ${'x'.repeat(600)}\n## Pending Jobs\n- ${'y'.repeat(300)}\n`,
      { maxObjectiveBytes: 1_024, maxItemBytes: 256 },
    )
    expect(Buffer.byteLength(draft.objective ?? '', 'utf8')).toBe(600)
    expect(Buffer.byteLength(draft.deliverables[0] ?? '', 'utf8')).toBeLessThanOrEqual(256)
  })

  it('falls back to the first primary bullet when the summary has no objective label', () => {
    // Real DSH summaries usually use bullet-only Primary Request sections.
    const draft = bootstrapFromSummary(`## Primary Request and Intent
- Build a durable session charter plugin for DSH.
- Keep the existing UI styling.
## Key Technical Concepts
- storage-domain records.
## Critical Context
- Must survive compaction.
## Pending Jobs
- Run the full check.
`, limits)
    expect(draft.objective).toBe('Build a durable session charter plugin for DSH.')
    expect(draft.invariants).toContain('Must survive compaction.')
  })

  it('splits a pathological single-line summary without quadratic cost', () => {
    const draft = bootstrapFromSummary(
      `## Primary Request and Intent\n- ${'界'.repeat(20_000)}`,
      { maxObjectiveBytes: 256, maxItemBytes: 256 },
    )
    expect(draft.objective).toHaveLength(20_000)
  })

  it('returns an empty draft for a summary without recognizable sections', () => {
    const draft = bootstrapFromSummary('Nothing structured here.', limits)
    expect(draft).toEqual({ objective: 'Nothing structured here.', invariants: [], deliverables: [] })
  })
})

describe('bootstrapFromEvents', () => {
  it('uses the latest non-empty compaction summary', () => {
    const extraction = bootstrapFromEvents([
      {
        type: 'compaction/summary',
        seq: 4,
        time: 100,
        data: { summary: [{ type: 'text', text: summary }], shadowedTokenCount: 10 },
      },
      {
        type: 'compaction/summary',
        seq: 8,
        time: 200,
        data: { summary: [{ type: 'text', text: '## Primary Request and Intent\n- Original: "Newest."\n' }] },
      },
    ], limits)
    expect(extraction?.draft.objective).toBe('Newest.')
    expect(extraction?.source).toEqual({ summarySeq: 8, at: 200 })
  })

  it('falls back to an older summary when the newest one yields no usable candidates', () => {
    const extraction = bootstrapFromEvents([
      {
        type: 'compaction/summary',
        seq: 1,
        time: 1,
        data: { summary: [{ type: 'text', text: '## Primary Request and Intent\n- Original: "Older usable objective."\n' }] },
      },
      {
        type: 'compaction/summary',
        seq: 2,
        time: 2,
        data: { summary: [{ type: 'text', text: '## Other\n' }] },
      },
    ], limits)
    expect(extraction?.draft.objective).toBe('Older usable objective.')
    expect(extraction?.source.summarySeq).toBe(1)
  })

  it('rejects invalid shadowed-token metadata instead of forwarding it to the Remote', () => {
    const text = '## Primary Request and Intent\n- Original: "Objective for metadata."\n'
    expect(bootstrapFromEvents([
      { type: 'compaction/summary', seq: 1, time: 1, data: { summary: [{ type: 'text', text }], shadowedTokenCount: -1 } },
    ], limits)).toBeUndefined()
    const valid = bootstrapFromEvents([
      { type: 'compaction/summary', seq: 1, time: 1, data: { summary: [{ type: 'text', text }], shadowedTokenCount: 12 } },
    ], limits)
    expect(valid?.source.shadowedTokens).toBe(12)
  })

  it('skips malformed and empty summaries', () => {
    const extraction = bootstrapFromEvents([
      { type: 'compaction/summary', seq: 1, time: 1, data: { summary: [] } },
      { type: 'compaction/summary', seq: 2, time: 2, data: { summary: [{ type: 'text', text: '   ' }] } },
    ], limits)
    expect(extraction).toBeUndefined()
  })
})
