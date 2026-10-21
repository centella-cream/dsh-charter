import { describe, expect, it } from 'vitest'
import {
  buildBootstrapPlan,
  classifyBootstrapOutcome,
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
    limits: {
      maxPromptBytes,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1_024,
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
})
