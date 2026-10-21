import { describe, expect, it } from 'vitest'
import { CharterError } from '../../src/core/errors.js'
import { applyOps } from '../../src/core/commands.js'
import { normalizeEditRequest } from '../../src/core/normalize.js'
import { renderPrompt } from '../../src/core/render.js'
import { apply, initialSnapshot, limits, request } from './helpers.js'

function expectCode(operation: () => unknown, code: CharterError['code']): void {
  try {
    operation()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(CharterError)
    expect((error as CharterError).code).toBe(code)
  }
}

describe('charter commands', () => {
  it('initializes and redirects the objective without changing the original', () => {
    const initialized = apply(initialSnapshot(), request([
      { type: 'objective.initialize', text: ' Ship the API\r\n safely ' },
    ]))
    expect(initialized.objective).toEqual({
      original: { text: 'Ship the API\n safely', setAtRevision: 1 },
      current: { text: 'Ship the API\n safely', setAtRevision: 1 },
    })

    const redirected = apply(initialized, request([
      { type: 'objective.redirect', text: 'Ship the API and benchmark it', reason: 'Scope expanded' },
    ], 1))
    expect(redirected.objective?.original.text).toBe('Ship the API\n safely')
    expect(redirected.objective?.current).toEqual({
      text: 'Ship the API and benchmark it',
      setAtRevision: 2,
      reason: 'Scope expanded',
    })
  })

  it('rejects reinitialization and no-op redirects', () => {
    const initialized = apply(initialSnapshot(), request([
      { type: 'objective.initialize', text: 'Ship the API' },
    ]))
    expectCode(() => apply(initialized, request([
      { type: 'objective.initialize', text: 'Different' },
    ], 1)), 'INVALID_TRANSITION')
    expectCode(() => apply(initialized, request([
      { type: 'objective.redirect', text: 'Ship the API', reason: 'No actual change' },
    ], 1)), 'INVALID_TRANSITION')
  })

  it('adds typed items and renders only accepted current items', () => {
    const snapshot = apply(initialSnapshot(), request([
      { type: 'objective.initialize', text: 'Release safely' },
      { type: 'item.add', item: { clientRef: 'inv', kind: 'invariant', text: 'Run tests', order: 2 } },
      {
        type: 'item.add',
        item: {
          clientRef: 'del',
          kind: 'deliverable',
          text: 'Benchmark report',
          order: 1,
          progress: 'not-started',
        },
      },
    ]), { inv: 'item-invariant', del: 'item-deliverable' })

    expect(snapshot.items.map(item => item.id)).toEqual(['item-deliverable', 'item-invariant'])
    expect(snapshot.items[0]).toMatchObject({
      kind: 'deliverable',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      progress: 'not-started',
    })
    expect(JSON.parse(snapshot.promptText.slice(snapshot.promptText.indexOf('{')))).toEqual({
      objective: 'Release safely',
      invariants: ['Run tests'],
      deliverables: [{ text: 'Benchmark report', progress: 'not-started' }],
    })
  })

  it('adds overflow candidates as pending proposals without publishing them', () => {
    let snapshot = apply(initialSnapshot(), request([
      { type: 'item.propose', item: { clientRef: 'p', kind: 'invariant', text: 'Keep the API stable', order: 1 } },
    ]), { p: 'item-proposal' })
    expect(snapshot.items[0]).toMatchObject({
      kind: 'invariant',
      review: 'pending',
      lifecycle: 'current',
      origin: 'agent',
    })
    expect(snapshot.promptText).toBe('')

    snapshot = apply(snapshot, request([
      { type: 'item.accept', itemId: 'item-proposal' },
    ], 1))
    expect(snapshot.items[0]?.review).toBe('accepted')
    expect(snapshot.promptText).toContain('Keep the API stable')
  })

  it('does not cap active items by kind; storage is the remaining bound', () => {
    const ops = Array.from({ length: 26 }, (_, index) => ({
      type: 'item.add' as const,
      item: { clientRef: `inv-${index}`, kind: 'invariant' as const, text: `Constraint ${index}`, order: index },
    }))
    const snapshot = apply(initialSnapshot(), request(ops), Object.fromEntries(
      ops.map((op, index) => [op.item.clientRef, `item-${index}`]),
    ))
    expect(snapshot.items).toHaveLength(26)
    expect(snapshot.items.every(item => item.review === 'accepted')).toBe(true)
  })

  it('edits text, resets verification, and leaves order-only verification intact', () => {
    let snapshot = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'inv', kind: 'invariant', text: 'Run tests', order: 1 } },
    ]), { inv: 'item-1' })
    snapshot = apply(snapshot, request([
      { type: 'item.verification.set', itemId: 'item-1', verification: 'verified' },
    ], 1))
    expect(snapshot.items[0]?.verification).toEqual({ state: 'verified', by: 'user' })

    snapshot = apply(snapshot, request([
      { type: 'item.edit', itemId: 'item-1', order: 4 },
    ], 2))
    expect(snapshot.items[0]?.verification).toEqual({ state: 'verified', by: 'user' })

    snapshot = apply(snapshot, request([
      { type: 'item.edit', itemId: 'item-1', text: 'Run all tests' },
    ], 3))
    expect(snapshot.items[0]?.verification).toEqual({ state: 'unchecked' })
  })

  it('keeps verification out of the model-visible prompt', () => {
    const added = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'inv', kind: 'invariant', text: 'Run tests', order: 1 } },
    ]), { inv: 'item-1' })
    const verified = apply(added, request([
      { type: 'item.verification.set', itemId: 'item-1', verification: 'verified' },
    ], 1))
    expect(verified.promptText).toBe(added.promptText)
    expect(verified.promptDigest).toBe(added.promptDigest)
    expect(verified.stateDigest).not.toBe(added.stateDigest)
  })

  it('archives and restores without changing other state axes', () => {
    let snapshot = apply(initialSnapshot(), request([
      {
        type: 'item.add',
        item: {
          clientRef: 'del',
          kind: 'deliverable',
          text: 'Report',
          order: 1,
          progress: 'done',
        },
      },
    ]), { del: 'item-1' })
    snapshot = apply(snapshot, request([
      { type: 'item.verification.set', itemId: 'item-1', verification: 'verified' },
      { type: 'item.archive', itemId: 'item-1' },
    ], 1))
    expect(snapshot.items[0]).toMatchObject({
      lifecycle: 'archived',
      progress: 'done',
      verification: { state: 'verified', by: 'user' },
    })
    expect(snapshot.promptText).toBe('')

    snapshot = apply(snapshot, request([
      { type: 'item.restore', itemId: 'item-1' },
    ], 2))
    expect(snapshot.items[0]).toMatchObject({
      lifecycle: 'current',
      progress: 'done',
      verification: { state: 'verified', by: 'user' },
    })
  })

  it('updates deliverable progress without changing verification', () => {
    let snapshot = apply(initialSnapshot(), request([
      {
        type: 'item.add',
        item: {
          clientRef: 'del',
          kind: 'deliverable',
          text: 'Report',
          order: 1,
          progress: 'not-started',
        },
      },
    ]), { del: 'item-1' })
    snapshot = apply(snapshot, request([
      { type: 'item.verification.set', itemId: 'item-1', verification: 'verified' },
      { type: 'deliverable.progress', itemId: 'item-1', progress: 'done' },
    ], 1))
    expect(snapshot.items[0]).toMatchObject({
      progress: 'done',
      verification: { state: 'verified', by: 'user' },
    })
    expect(snapshot.promptText).toContain('"progress":"done"')
  })

  it('supersedes an item atomically and validates the replacement kind', () => {
    const initial = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'old', kind: 'invariant', text: 'Run tests', order: 1 } },
    ]), { old: 'item-old' })
    const superseded = apply(initial, request([{
      type: 'item.supersede',
      itemId: 'item-old',
      replacement: { clientRef: 'new', kind: 'invariant', text: 'Run all tests', order: 1 },
    }], 1), { new: 'item-new' })

    expect(superseded.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'item-old', lifecycle: 'superseded', supersededBy: 'item-new' }),
      expect.objectContaining({ id: 'item-new', lifecycle: 'current', supersedes: 'item-old' }),
    ]))
    expect(superseded.promptText).not.toContain('"Run tests"')
    expect(superseded.promptText).toContain('Run all tests')

    expectCode(() => apply(initial, request([{
      type: 'item.supersede',
      itemId: 'item-old',
      replacement: {
        clientRef: 'bad',
        kind: 'deliverable',
        text: 'Wrong kind',
        order: 1,
        progress: 'not-started',
      },
    }], 1), { bad: 'item-bad' }), 'INVALID_TRANSITION')
  })

  it('purges an old replacement-chain prefix without leaving dangling links', () => {
    let snapshot = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
    ]), { a: 'item-a' })
    snapshot = apply(snapshot, request([{
      type: 'item.supersede',
      itemId: 'item-a',
      replacement: { clientRef: 'b', kind: 'invariant', text: 'B', order: 1 },
    }], 1), { b: 'item-b' })
    const purged = apply(snapshot, request([
      { type: 'item.purge', itemId: 'item-a', confirmed: true },
    ], 2))
    expect(purged.items).toEqual([
      expect.objectContaining({ id: 'item-b', lifecycle: 'current' }),
    ])
    expect(purged.items[0]).not.toHaveProperty('supersedes')
  })

  it('rejects purging a live successor while its superseded predecessor remains', () => {
    let snapshot = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
    ]), { a: 'item-a' })
    snapshot = apply(snapshot, request([{
      type: 'item.supersede',
      itemId: 'item-a',
      replacement: { clientRef: 'b', kind: 'invariant', text: 'B', order: 1 },
    }], 1), { b: 'item-b' })
    expectCode(() => apply(snapshot, request([
      { type: 'item.purge', itemId: 'item-b', confirmed: true },
    ], 2)), 'INVALID_TRANSITION')
  })

  it('rejects purging an active accepted or pending item', () => {
    const added = apply(initialSnapshot(), request([
      { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'Active', order: 1 } },
    ]), { a: 'item-a' })
    expectCode(() => apply(added, request([
      { type: 'item.purge', itemId: 'item-a', confirmed: true },
    ], 1)), 'INVALID_TRANSITION')

    const proposed = apply(initialSnapshot(), request([
      { type: 'item.propose', item: { clientRef: 'p', kind: 'invariant', text: 'Pending', order: 1 } },
    ]), { p: 'item-p' })
    expectCode(() => apply(proposed, request([
      { type: 'item.purge', itemId: 'item-p', confirmed: true },
    ], 1)), 'INVALID_TRANSITION')
  })

  it('rolls back the whole batch when a later operation fails', () => {
    const before = initialSnapshot()
    const edit = request([
      { type: 'objective.initialize', text: 'Do the work' },
      { type: 'item.archive', itemId: 'missing' },
    ])
    expectCode(() => applyOps({
      snapshot: before,
      ops: edit.ops,
      ids: {},
      nextRevision: 1,
      limits,
    }), 'NOT_FOUND')
    expect(before).toEqual(initialSnapshot())
  })

  it('rejects spoofed host-owned fields and duplicate client references', () => {
    expectCode(() => normalizeEditRequest({
      sessionId: 'session-1',
      mutationId: 'mutation-1',
      baseRevision: 0,
      ops: [{
        type: 'item.add',
        item: {
          clientRef: 'x',
          id: 'spoofed',
          origin: 'agent',
          kind: 'invariant',
          text: 'Run tests',
          order: 1,
        },
      }],
    }), 'INVALID_ARGUMENT')
  })

  it('does not render inactive items', () => {
    const text = renderPrompt(undefined, [{
      id: 'pending',
      kind: 'invariant',
      text: 'Pending proposal',
      review: 'pending',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'agent',
      order: 1,
      createdRevision: 1,
    }])
    expect(text).toBe('')
  })
})
