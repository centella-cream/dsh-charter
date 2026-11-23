import { describe, expect, it } from 'vitest'
import { structuredFromSummary } from '../../src/core/structured-bootstrap.js'

const limits = { maxObjectiveBytes: 256, maxItemBytes: 120 }

describe('structured extraction', () => {
  it('keeps semantic sentences whole and folds exact/prefix duplicates', () => {
    const summary = `## Primary Request and Intent
- Original: "Keep the charter tab last."
- Stable tab order.
- Stable tab order and layout.
- Stable tab order.
## Critical Context
- 必须保持公开 API 向后兼容。
## Pending Jobs
- Write the bootstrap tests.
- Write the bootstrap tests.
`
    const draft = structuredFromSummary(summary, limits)
    expect(draft.objective).toBe('Keep the charter tab last.')
    const invariants = draft.items.filter(item => item.kind === 'invariant')
    expect(invariants).toHaveLength(2)
    const english = invariants.find(item => item.text === 'Stable tab order and layout.')
    expect(english?.ref).toBe('d-inv-0')
    expect(english?.foldCount).toBe(3)
    expect(english?.foldMembers?.map(member => member.ref)).toEqual(['d-inv-0.1', 'd-inv-0.2'])
    const deliverables = draft.items.filter(item => item.kind === 'deliverable')
      expect(deliverables).toHaveLength(1)
    expect(deliverables[0]?.foldCount).toBe(2)
    expect(draft.items.find(item => item.kind === 'objective')?.ref).toBe('d-obj-0')
  })

  it('marks an oversized sentence rather than producing fragments', () => {
    const sentence = `${'界'.repeat(80)}。`
    const draft = structuredFromSummary(`## Pending Jobs\n- ${sentence}\n`, limits)
    const item = draft.items.find(entry => entry.kind === 'deliverable')
    expect(item?.oversized).toBe(true)
    expect(item?.text).toContain('界界界')
    expect(item?.text.endsWith('。')).toBe(true)
    expect(item?.truncatedFrom).toBeUndefined()
  })

  it('truncates only a >4x sentence and records the original byte count', () => {
    const sentence = `${'界'.repeat(600)}。`
    const draft = structuredFromSummary(`## Pending Jobs\n- ${sentence}\n`, limits)
    const item = draft.items.find(entry => entry.kind === 'deliverable')
    expect(item?.oversized).toBe(true)
    expect(item?.text.endsWith('…')).toBe(true)
    expect(item?.truncatedFrom).toBe(Buffer.byteLength(sentence, 'utf8'))
  })

  it('detects Chinese, English, and mixed candidates', () => {
    const draft = structuredFromSummary(`## Primary Request and Intent
- 保持契约草案完整。
- Keep the charter draft complete.
- 中文 test
## Pending Jobs
- 交付测试。
`, limits)
    const langs = draft.items.map(item => item.lang)
    expect(langs).toContain('zh')
    expect(langs).toContain('en')
    expect(langs).toContain('mixed')
    expect(draft.draftLang).toMatch(/^(zh|en|mixed)$/u)
  })
})
