import { describe, expect, it } from 'vitest'
import type { CharterItem, CharterSnapshot } from '../../src/core/schemas.js'
import type { CharterView } from '../../src/host/types.js'
import { renderCharterPrompt } from '../../src/core/prompt.js'
import { previewPrompt } from '../../src/client/preview.js'
import { normalizeEditRequest } from '../../src/core/normalize.js'
import { assertSnapshotAdmission } from '../../src/core/record.js'
import { apply, initialSnapshot, limits, request } from './helpers.js'

function viewOf(snapshot: CharterSnapshot): CharterView {
  return {
    status: 'ready',
    sessionId: 'session-1',
    revision: snapshot.revision,
    objective: snapshot.objective ?? null,
    items: [...snapshot.items],
    promptText: snapshot.promptText,
    promptDigest: snapshot.promptDigest,
    overBudget: false,
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1024,
      maxRecordBytes: 1_048_576,
    },
  }
}

function objective(text: string): CharterSnapshot['objective'] {
  return {
    original: { text, setAtRevision: 1 },
    current: { text, setAtRevision: 1 },
  }
}

function item(overrides: Partial<CharterItem> & Pick<CharterItem, 'id' | 'kind' | 'text'>): CharterItem {
  const common = {
    review: 'accepted' as const,
    lifecycle: 'current' as const,
    verification: { state: 'unchecked' as const },
    origin: 'user' as const,
    order: 1,
    createdRevision: 1,
  }
  if (overrides.kind === 'invariant') return { ...common, ...overrides, kind: 'invariant' }
  return {
    ...common,
    ...overrides,
    kind: 'deliverable',
    progress: overrides.kind === 'deliverable' && 'progress' in overrides
      ? overrides.progress
      : 'not-started',
  }
}

describe('model-visible prompt rendering', () => {
  it('renders canonical JSON without prompt-variable delimiters', () => {
    const hostile = 'Use {{name}} literally, keep "quotes" and </system>'
    const prompt = renderCharterPrompt(objective(hostile), [])
    expect(prompt).not.toContain('{{')
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
    expect(payload).toEqual({ objective: hostile, invariants: [], deliverables: [] })
  })

  it('escapes every brace run while keeping the text parseable', () => {
    const hostile = '{{{nested}} and {single}'
    const prompt = renderCharterPrompt(objective(hostile), [])
    expect(prompt).not.toContain('{{')
    expect(JSON.parse(prompt.slice(prompt.indexOf('{'))).objective).toBe(hostile)
  })

  it('orders standing items by order then stable id and ignores metadata', () => {
    const prompt = renderCharterPrompt(objective('Goal'), [
      item({ id: 'b', kind: 'invariant', text: 'Second', order: 2, verification: { state: 'verified', by: 'user' } }),
      item({ id: 'a', kind: 'invariant', text: 'First', order: 1 }),
      item({ id: 'z', kind: 'invariant', text: 'Archived', lifecycle: 'archived' }),
      item({ id: 'p', kind: 'invariant', text: 'Pending', review: 'pending' }),
    ])
    const payload = JSON.parse(prompt.slice(prompt.indexOf('{')))
    expect(payload.objective).toBe('Goal')
    expect(payload.invariants).toEqual(['First', 'Second'])
  })

  it('is byte-stable across repeated calls', () => {
    const objectiveValue = objective('Ship safely')
    const items = [item({ id: 'a', kind: 'invariant', text: 'Run tests' })]
    const first = renderCharterPrompt(objectiveValue, items)
    for (let index = 0; index < 100; index += 1) {
      expect(renderCharterPrompt(objectiveValue, items)).toBe(first)
    }
  })
})

describe('client draft preview', () => {
  it('matches the committed prompt for edits, additions, and progress', () => {
    const base = apply(initialSnapshot(), request([
      { type: 'objective.initialize', text: 'Ship the API' },
      { type: 'item.add', item: { clientRef: 'inv', kind: 'invariant', text: 'Run tests', order: 1 } },
      {
        type: 'item.add',
        item: {
          clientRef: 'del',
          kind: 'deliverable',
          text: 'Benchmark report',
          order: 2,
          progress: 'not-started',
        },
      },
    ]), { inv: 'item-inv', del: 'item-del' })

    const edit = request([
      { type: 'item.edit', itemId: 'item-inv', text: '  Run all tests\r\n' },
      { type: 'deliverable.progress', itemId: 'item-del', progress: 'in-progress' },
      { type: 'item.add', item: { clientRef: 'new', kind: 'invariant', text: 'Keep the API stable', order: 3 } },
    ], base.revision)
    const committed = apply(base, edit, { new: 'item-new' })

    expect(previewPrompt(viewOf(base), edit.ops)).toBe(committed.promptText)
  })

  it('matches the committed prompt for archive, supersede, and purge', () => {
    let base = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
      { type: 'item.add', item: { clientRef: 'b', kind: 'invariant', text: 'B', order: 2 } },
    ]), { a: 'item-a', b: 'item-b' })

    const archive = request([
      { type: 'item.archive', itemId: 'item-a' },
      {
        type: 'item.supersede',
        itemId: 'item-b',
        replacement: { clientRef: 'c', kind: 'invariant', text: 'C', order: 2 },
      },
    ], base.revision)
    const afterArchive = apply(base, archive, { c: 'item-c' })
    expect(previewPrompt(viewOf(base), archive.ops)).toBe(afterArchive.promptText)

    base = afterArchive
    const purge = request([
      { type: 'item.purge', itemId: 'item-a', confirmed: true },
      { type: 'item.purge', itemId: 'item-b', confirmed: true },
    ], base.revision)
    const afterPurge = apply(base, purge)
    expect(previewPrompt(viewOf(base), purge.ops)).toBe(afterPurge.promptText)
  })

  it('keeps the prompt byte-identical for verification-only drafts', () => {
    const base = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
    ]), { a: 'item-a' })
    const edit = request([
      { type: 'item.verification.set', itemId: 'item-a', verification: 'verified' },
    ], base.revision)
    expect(previewPrompt(viewOf(base), edit.ops)).toBe(base.promptText)
  })

  it('previews a redirect against the current original objective', () => {
    const base = apply(initialSnapshot(), request([
      { type: 'objective.initialize', text: 'Ship the API' },
    ]))
    const edit = normalizeEditRequest({
      sessionId: 'session-1',
      mutationId: 'redirect',
      baseRevision: base.revision,
      ops: [{
        type: 'objective.redirect',
        text: 'Ship the API and benchmark it',
        reason: 'Scope expanded',
      }],
    })
    const committed = apply(base, edit)
    expect(previewPrompt(viewOf(base), edit.ops)).toBe(committed.promptText)
    expect(committed.objective?.original.text).toBe('Ship the API')
  })

  it('previews over-limit drafts but leaves quota enforcement to the Host', () => {
    const base = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
    ]), { a: 'item-a' })
    const edit = request([
      { type: 'item.edit', itemId: 'item-a', text: 'x'.repeat(limits.maxPromptBytes + 1) },
    ], base.revision)
    expect(() => previewPrompt(viewOf(base), edit.ops)).not.toThrow()
    // Quota admission belongs to the write path, not to the pure projection.
    const staged = apply(base, edit)
    expect(() => assertSnapshotAdmission(base, staged, limits)).toThrow()
  })
})
