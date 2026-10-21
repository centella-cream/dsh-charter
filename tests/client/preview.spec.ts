import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterView } from '../../src/host/types.js'
import { itemCounts, previewPrompt, projectView } from '../../src/client/preview.js'

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
})
