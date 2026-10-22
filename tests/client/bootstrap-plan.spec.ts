import { describe, expect, it } from 'vitest'
import {
  buildBootstrapPlan,
  classifyBootstrapOutcome,
  firstDraftTextIssue,
  type BootstrapDraftItem,
} from '../../src/client/bootstrap-plan.js'
import { previewPrompt } from '../../src/client/preview.js'
import { utf8Bytes } from '../../src/core/limits.js'
import type { CharterBootstrapProposal, CharterBootstrapResult, CharterView } from '../../src/host/types.js'

function emptyView(maxPromptBytes: number): CharterView {
  return {
    status: 'ready',
    sessionId: 'session-1',
    revision: 1,
    objective: null,
    items: [],
    promptText: '',
    promptDigest: 'sha256:test',
    overBudget: false,
    limits: {
      maxPromptBytes,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1_024,
      maxRecordBytes: 1_048_576,
    },
  }
}

function candidates(count: number): BootstrapDraftItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index}`,
    kind: 'invariant' as const,
    text: `Constraint ${String(index)} ${'x'.repeat(80)}`,
    selected: true,
  }))
}

describe('bootstrap plan', () => {
  it('preserves every candidate while keeping the active prefix inside the context budget', () => {
    const view = emptyView(600)
    const items = candidates(12)
    const plan = buildBootstrapPlan(view, '', items)

    expect(plan.ops).toHaveLength(12)
    expect(plan.active + plan.pending).toBe(12)
    expect(plan.active).toBeGreaterThan(0)
    expect(plan.pending).toBeGreaterThan(0)
    expect(plan.pendingInvariants).toBe(plan.pending)
    expect(plan.ops.filter(op => op.type === 'item.propose')).toHaveLength(plan.pending)
    expect(utf8Bytes(previewPrompt(view, plan.ops))).toBeLessThanOrEqual(view.limits.maxPromptBytes)
  })

  it('does not use context budget for unselected candidates', () => {
    const items = candidates(4).map((item, index) => ({ ...item, selected: index < 2 }))
    const plan = buildBootstrapPlan(emptyView(8_192), '', items)
    expect(plan.ops).toHaveLength(2)
    expect(plan.active).toBe(2)
    expect(plan.pending).toBe(0)
  })
})

describe('draft text issues', () => {
  it('flags invalid objective or candidate text before Apply', () => {
    const items: BootstrapDraftItem[] = [
      { id: 'a', kind: 'invariant', text: 'safe', selected: true },
      { id: 'b', kind: 'invariant', text: 'bad\u0000', selected: true },
    ]
    expect(firstDraftTextIssue('', items)).toEqual({ issue: 'control', where: 'candidate', index: 1 })
    expect(firstDraftTextIssue('bad\uD800', [])).toEqual({ issue: 'surrogate', where: 'objective' })
    expect(firstDraftTextIssue('ok', [items[0]!])).toBeUndefined()
  })
})

describe('bootstrap plan outcomes', () => {
  it('labels each candidate active or pending and keeps the exact render in budget', () => {
    const view = emptyView(700)
    const items = candidates(30)
    const plan = buildBootstrapPlan(view, '', items)
    expect(plan.active + plan.pending).toBe(30)
    expect(Object.keys(plan.outcomes)).toHaveLength(30)
    expect(Object.values(plan.outcomes).filter(value => value === 'active')).toHaveLength(plan.active)
    expect(utf8Bytes(previewPrompt(view, plan.ops))).toBeLessThanOrEqual(view.limits.maxPromptBytes)
  })

  it('plans thousands of candidates in one pass without dropping any', () => {
    const view = emptyView(1_200)
    const items = Array.from({ length: 2_000 }, (_, index) => ({
      id: `c-${index}`,
      kind: 'invariant' as const,
      text: `Constraint ${String(index)} ${'x'.repeat(20)}`,
      selected: true,
    }))
    const plan = buildBootstrapPlan(view, '', items)
    expect(plan.ops).toHaveLength(2_000)
    expect(plan.active + plan.pending).toBe(2_000)
  })
})

describe('bootstrap outcome', () => {
  const proposal: CharterBootstrapProposal = {
    objective: 'Ship it',
    invariants: ['Do not break the API'],
    deliverables: [],
    source: { summarySeq: 3, at: 4 },
  }
  const draft: CharterBootstrapResult = { available: true, proposal }
  const from = (view: CharterView) => ({ status: 'ready' as const, view })

  it('accepts a draft for an unchanged empty Session', () => {
    expect(classifyBootstrapOutcome(draft, from(emptyView(8_192)), 1, 0))
      .toEqual({ kind: 'draft', proposal })
  })

  it('discards the draft silently once the user starts working', () => {
    const objectiveView: CharterView = {
      ...emptyView(8_192),
      objective: {
        original: { text: 'Ship it', setAtRevision: 1 },
        current: { text: 'Ship it', setAtRevision: 1 },
      },
    }
    expect(classifyBootstrapOutcome(draft, from(objectiveView), 1, 0)).toEqual({ kind: 'discard' })
    expect(classifyBootstrapOutcome(draft, from(emptyView(8_192)), 1, 1)).toEqual({ kind: 'discard' })
    expect(classifyBootstrapOutcome(draft, { status: 'connecting', view: null }, 1, 0))
      .toEqual({ kind: 'discard' })
  })

  it('reports stale only when the Session is still empty but moved on', () => {
    expect(classifyBootstrapOutcome(draft, from({ ...emptyView(8_192), revision: 2 }), 1, 0))
      .toEqual({ kind: 'stale' })
  })

  it('preserves an unavailable reason and message for the retry UI', () => {
    expect(classifyBootstrapOutcome(
      { available: false, reason: 'no-summary' },
      from(emptyView(8_192)),
      1,
      0,
    )).toEqual({ kind: 'unavailable', reason: 'no-summary', message: undefined })
    expect(classifyBootstrapOutcome(
      { available: false, reason: 'unavailable', message: 'storage is closed' },
      from(emptyView(8_192)),
      1,
      0,
    )).toEqual({ kind: 'unavailable', reason: 'unavailable', message: 'storage is closed' })
  })
  it('keeps all candidates active when the budget is large enough (dense case)', () => {
    const items = candidates(500)
    const plan = buildBootstrapPlan(emptyView(10 * 1_024 * 1_024), '', items)
    expect(plan.active).toBe(500)
    expect(plan.pending).toBe(0)
    expect(Object.values(plan.outcomes).every(outcome => outcome === 'active')).toBe(true)
    expect(utf8Bytes(previewPrompt(emptyView(10 * 1_024 * 1_024), plan.ops)))
      .toBeLessThanOrEqual(10 * 1_024 * 1_024)
  })

})
