import { describe, expect, it } from 'vitest'
import { buildBootstrapPlan, type BootstrapDraftItem } from '../../src/client/bootstrap-plan.js'
import { previewPrompt } from '../../src/client/preview.js'
import { utf8Bytes } from '../../src/core/limits.js'
import type { CharterView } from '../../src/host/types.js'

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
