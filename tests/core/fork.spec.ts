import { describe, expect, it } from 'vitest'
import { forkRecord } from '../../src/core/fork.js'
import { commitRecord, createEmptyRecord, requestDigestOf } from '../../src/core/record.js'
import { normalizeEditRequest } from '../../src/core/normalize.js'
import type { CharterActor } from '../../src/core/schemas.js'
import { limits } from './helpers.js'

describe('charter fork', () => {
  it('re-mints item identities while preserving the model-visible charter', () => {
    const identity = { createdAt: 1, cwd: '/parent' }
    const actor: CharterActor = { kind: 'owner' }
    const request = normalizeEditRequest({
      sessionId: 'parent',
      mutationId: 'parent-mutation',
      baseRevision: 0,
      ops: [
        { type: 'objective.initialize', text: 'Ship safely' },
        { type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } },
        { type: 'item.add', item: { clientRef: 'b', kind: 'invariant', text: 'B', order: 1 } },
      ],
    })
    const parent = commitRecord({
      record: createEmptyRecord(identity, limits),
      request,
      requestDigest: requestDigestOf(request, identity, actor),
      ids: { a: 'parent-a', b: 'parent-b' },
      actor,
      at: 1,
      limits,
    })
    const child = forkRecord({
      parentSessionId: 'parent',
      parent,
      childIdentity: { createdAt: 2, cwd: '/child', parentSession: 'parent' },
      ids: { 'parent-a': 'child-a', 'parent-b': 'child-b' },
      mutationId: 'fork-parent-1',
      at: 2,
      limits,
    })

    expect(child.forkedFrom).toEqual({ sessionId: 'parent', revision: 1 })
    expect(child.current.revision).toBe(1)
    expect(child.current.promptText).toBe(parent.current.promptText)
    expect(child.current.promptDigest).toBe(parent.current.promptDigest)
    expect(child.current.stateDigest).not.toBe(parent.current.stateDigest)
    expect(child.current.objective).toMatchObject({
      original: { setAtRevision: 1 },
      current: { setAtRevision: 1 },
    })
    expect(child.current.items.map(item => item.id)).toEqual(['child-a', 'child-b'])
    expect(child.current.items.map(item => item.origin)).toEqual(['fork', 'fork'])
    expect(child.current.items.map(item => item.order)).toEqual([0, 1])
    expect(child.history).toEqual([
      expect.objectContaining({ revision: 1, changes: [{ type: 'forked' }] }),
    ])
    expect(JSON.stringify(child)).not.toContain('parent-mutation')
  })

  it('remaps replacement links entirely into the child namespace', () => {
    const identity = { createdAt: 1 }
    const actor: CharterActor = { kind: 'owner' }
    let parent = createEmptyRecord(identity, limits)
    let request = normalizeEditRequest({
      sessionId: 'parent',
      mutationId: 'm1',
      baseRevision: 0,
      ops: [{ type: 'item.add', item: { clientRef: 'a', kind: 'invariant', text: 'A', order: 1 } }],
    })
    parent = commitRecord({
      record: parent,
      request,
      requestDigest: requestDigestOf(request, identity, actor),
      ids: { a: 'parent-a' },
      actor,
      at: 1,
      limits,
    })
    request = normalizeEditRequest({
      sessionId: 'parent',
      mutationId: 'm2',
      baseRevision: 1,
      ops: [{
        type: 'item.supersede',
        itemId: 'parent-a',
        replacement: { clientRef: 'b', kind: 'invariant', text: 'B', order: 1 },
      }],
    })
    parent = commitRecord({
      record: parent,
      request,
      requestDigest: requestDigestOf(request, identity, actor),
      ids: { b: 'parent-b' },
      actor,
      at: 2,
      limits,
    })

    const child = forkRecord({
      parentSessionId: 'parent',
      parent,
      childIdentity: { createdAt: 2, parentSession: 'parent' },
      ids: { 'parent-a': 'child-a', 'parent-b': 'child-b' },
      mutationId: 'fork-parent-2',
      at: 3,
      limits,
    })
    expect(child.current.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'child-a', supersededBy: 'child-b' }),
      expect.objectContaining({ id: 'child-b', supersedes: 'child-a' }),
    ]))
    expect(JSON.stringify(child.current.items)).not.toContain('parent-a')
    expect(JSON.stringify(child.current.items)).not.toContain('parent-b')
  })
})
