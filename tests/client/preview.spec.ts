import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterView } from '../../src/host/types.js'
import {
  activeItems,
  itemCounts,
  pendingItems,
  previewPrompt,
  projectView,
  promptBudgetAdmission,
} from '../../src/client/preview.js'

const sessionId = SessionId('preview-session')

function view(): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision: 0,
    objective: null,
    items: [],
    promptText: '',
    promptDigest: '',
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1_024,
      maxRecordBytes: 1_048_576,
    },
    overBudget: false,
  }
}

describe('projected draft view', () => {
  it('shows staged additions immediately and excludes rejected/historical rows from active counts', () => {
    const projected = projectView(view(), [
      { type: 'objective.initialize', text: 'Ship it' },
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'Keep the API', order: 1 } },
      { type: 'item.add', item: { clientRef: 'b', kind: 'invariant', text: 'Lint later', order: 2 } },
      { type: 'item.reject', itemId: 'draft:b' },
    ])
    expect(projected.objective?.current.text).toBe('Ship it')
    expect(projected.items.map(item => item.text)).toEqual(['Keep the API', 'Lint later'])
    expect(projected.items.every(item => item.staged)).toBe(true)
    expect(itemCounts(projected.items)).toEqual({ active: 1, pending: 0, history: 1 })
    expect(activeItems(projected.items).map(item => item.text)).toEqual(['Keep the API'])
    expect(pendingItems(projected.items)).toEqual([])
  })

  it('projects edits, progress, archive, supersede and purge onto the rows', () => {
    const projected = projectView(view(), [
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
      { type: 'item.supersede', itemId: 'draft:a', replacement: { clientRef: 'b', kind: 'invariant', text: 'B', order: 2 } },
      { type: 'item.add', item: { clientRef: 'd', kind: 'deliverable', text: 'D', order: 3, progress: 'in-progress' } },
      { type: 'deliverable.progress', itemId: 'draft:d', progress: 'done' },
      { type: 'item.purge', itemId: 'draft:d', confirmed: true },
    ])
    expect(projected.items).toHaveLength(2)
    expect(projected.items[0]).toMatchObject({ text: 'A', lifecycle: 'superseded' })
    expect(projected.items[1]).toMatchObject({ text: 'B', supersedes: 'draft:a' })
    // Purged rows disappear from the projection and therefore from the prompt.
    expect(previewPrompt(view(), [
      { type: 'item.add', item: { clientRef: 'p', kind: 'invariant', text: 'Gone', order: 1 } },
      { type: 'item.purge', itemId: 'draft:p', confirmed: true },
    ])).toBe('')
  })

  it('keeps the exact prompt renderer as the projection consumer', () => {
    const ops = [
      { type: 'objective.initialize' as const, text: 'Objective' },
      { type: 'item.add' as const, item: { clientRef: 'i', kind: 'invariant' as const, text: 'Invariant', order: 1 } },
      { type: 'item.add' as const, item: { clientRef: 'd', kind: 'deliverable' as const, text: 'Deliverable', order: 2, progress: 'not-started' as const } },
      { type: 'item.propose' as const, item: { clientRef: 'pp', kind: 'invariant' as const, text: 'Pending', order: 3 } },
    ]
    const prompt = previewPrompt(view(), ops)
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
    expect(payload.objective).toBe('Objective')
    expect(payload.invariants).toEqual(['Invariant'])
    expect(payload.deliverables).toEqual([{ text: 'Deliverable', progress: 'not-started' }])
    expect(prompt).not.toContain('Pending')
  })

  it('detaches a successor and marks it as a derived row when the previewed purge removes its predecessor', () => {
    const ops = [
      { type: 'item.add' as const, item: { clientRef: 'a', kind: 'invariant' as const, text: 'A', order: 1 } },
      {
        type: 'item.supersede' as const,
        itemId: 'draft:a',
        replacement: { clientRef: 'b', kind: 'invariant' as const, text: 'B', order: 2 },
      },
      { type: 'item.purge' as const, itemId: 'draft:a', confirmed: true as const },
    ]
    const projected = projectView(view(), ops)
    expect(projected.items).toHaveLength(1)
    const successor = projected.items[0]!
    expect(successor).toMatchObject({ text: 'B', lifecycle: 'current', staged: true, unstageTarget: null })
    expect(successor.supersedes).toBeUndefined()
    // No staged op targets the derived successor, so Unstage would be dead.
    expect(ops.some(op => 'itemId' in op && op.itemId === successor.id)).toBe(false)
    // Directly staged rows keep the default target (undefined means item.id).
    const directlyStaged = projectView(view(), ops.filter(op => op.type !== 'item.purge'))
    const replacement = directlyStaged.items.find(item => item.text === 'B')
    expect(replacement?.staged).toBe(true)
    expect(replacement?.unstageTarget).toBeUndefined()
  })
})

describe('prompt budget admission', () => {
  it('allows Apply when an over-budget prompt shrinks or keeps the same size', () => {
    const shrinking = promptBudgetAdmission('x'.repeat(200), 'x'.repeat(150), 100)
    expect(shrinking).toMatchObject({ over: true, shrinking: true, blocksApply: false })
    expect(shrinking.currentBytes).toBe(200)
    expect(shrinking.previewBytes).toBe(150)
    // Host admission blocks growth only: an unchanged over-budget render is admitted.
    const unchanged = promptBudgetAdmission('x'.repeat(150), 'x'.repeat(150), 100)
    expect(unchanged).toMatchObject({ over: true, shrinking: false, blocksApply: false })
  })

  it('blocks Apply when a prompt grows past or further above the budget', () => {
    const growingPast = promptBudgetAdmission('x'.repeat(90), 'x'.repeat(150), 100)
    expect(growingPast).toMatchObject({ over: true, shrinking: false, blocksApply: true })
    const growingAbove = promptBudgetAdmission('x'.repeat(150), 'x'.repeat(200), 100)
    expect(growingAbove).toMatchObject({ over: true, blocksApply: true })
  })

  it('allows Apply for a prompt within the budget', () => {
    const admission = promptBudgetAdmission('x'.repeat(10), 'x'.repeat(90), 100)
    expect(admission).toMatchObject({ over: false, shrinking: false, blocksApply: false })
  })
})
