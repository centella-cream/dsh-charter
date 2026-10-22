import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterView } from '../../src/host/types.js'
import type { CharterItem } from '../../src/core/schemas.js'
import {
  activeItems,
  itemCounts,
  opTargets,
  pendingItems,
  previewPrompt,
  projectView,
  promptBudgetAdmission,
} from '../../src/client/preview.js'

const sessionId = SessionId('preview-session')

function view(overrides: Partial<CharterView> = {}): CharterView {
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
    ...overrides,
  }
}

function committedInvariant(
  overrides: Pick<CharterItem, 'id' | 'text' | 'order'> & Partial<CharterItem>,
): CharterItem {
  return {
    kind: 'invariant',
    review: 'accepted',
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    origin: 'user',
    createdRevision: 1,
    ...overrides,
  } as CharterItem
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

  it('orders rows and prompt tokens by order even when Host ids reverse-sort', () => {
    const base = view({
      items: [
        committedInvariant({ id: 'zzz-first', text: 'first', order: 1 }),
        committedInvariant({ id: 'aaa-second', text: 'second', order: 2 }),
      ],
    })
    const projected = projectView(base, [])
    expect(projected.items.map(item => item.text)).toEqual(['first', 'second'])
    const prompt = previewPrompt(base, [])
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
    expect(payload.invariants).toEqual(['first', 'second'])
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

  it('keeps a directly staged successor Unstage when a purge derives its link change', () => {
    const base = view({
      items: [
        committedInvariant({ id: 'a', text: 'A', order: 1, lifecycle: 'superseded', supersededBy: 'b' }),
        committedInvariant({ id: 'b', text: 'B', order: 2, supersedes: 'a' }),
        committedInvariant({ id: 'c', text: 'C', order: 3 }),
      ],
    })
    const purgeA = { type: 'item.purge' as const, itemId: 'a', confirmed: true as const }
    const editB = { type: 'item.edit' as const, itemId: 'b', text: 'B2' }
    const verifyB = { type: 'item.verification.set' as const, itemId: 'b', verification: 'verified' as const }
    const editC = { type: 'item.edit' as const, itemId: 'c', text: 'C2' }
    // Both orderings: a direct B operation before or after the purge that
    // derives the `supersedes` detach on B.
    for (const ordering of [
      [editB, verifyB, purgeA, editC],
      [purgeA, editB, verifyB, editC],
      [editC, purgeA, editB, verifyB],
    ]) {
      const projected = projectView(base, ordering)
      const successor = projected.items.find(item => item.id === 'b')
      expect(successor).toMatchObject({ text: 'B2', staged: true, unstageTarget: 'b' })
      expect(successor?.supersedes).toBeUndefined()
      // Unstage(B) removes exactly B's direct ops; the purge of A and the
      // independent edit of C stay staged.
      const remaining = ordering.filter(op => !opTargets(op, 'b'))
      expect(remaining.map(op => op.type).sort())
        .toEqual(['item.edit', 'item.purge'].sort())
      expect(remaining.some(op => op.type === 'item.edit' && op.itemId === 'c')).toBe(true)
      expect(remaining.some(op => op.type === 'item.purge' && op.itemId === 'a')).toBe(true)
    }
  })

  it('hides Unstage only for a row changed solely by a purge-derived detach', () => {
    const base = view({
      items: [
        committedInvariant({ id: 'a', text: 'A', order: 1, lifecycle: 'superseded', supersededBy: 'b' }),
        committedInvariant({ id: 'b', text: 'B', order: 2, supersedes: 'a' }),
      ],
    })
    const purgeA = { type: 'item.purge' as const, itemId: 'a', confirmed: true as const }
    const projected = projectView(base, [purgeA])
    const successor = projected.items.find(item => item.id === 'b')
    expect(successor).toMatchObject({ staged: true, unstageTarget: null })
    expect(successor?.supersedes).toBeUndefined()
    // No staged op targets B, so its Unstage would be dead and is hidden.
    expect(opTargets(purgeA, 'b')).toBe(false)

    // A directly added row always has its own removable operation.
    const added = projectView(base, [
      purgeA,
      { type: 'item.add' as const, item: { clientRef: 'new', kind: 'invariant' as const, text: 'N', order: 3 } },
    ])
    expect(added.items.find(item => item.id === 'draft:new'))
      .toMatchObject({ staged: true, unstageTarget: 'draft:new' })
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
