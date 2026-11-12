import { describe, expect, it } from 'vitest'
import type { CharterOp } from '../../src/core/schemas.js'
import {
  buildChangeSetConflicts,
  groupChangeSetOps,
  opCanBeUnstaged,
  opCategory,
  opDiff,
  opText,
} from '../../src/client/change-set-model.js'

describe('change-set model (W5 Pane split)', () => {
  it('categorizes objective, item, lifecycle, proposal and verification ops', () => {
    const ops: CharterOp[] = [
      { type: 'objective.redirect', text: 'Ship it' },
      { type: 'item.add', item: { kind: 'invariant', text: 'Keep it small', clientRef: 'i1', order: 0 } },
      { type: 'item.accept', itemId: 'i1' },
      { type: 'item.supersede', itemId: 'i1', replacement: { kind: 'invariant', text: 'Keep it small', clientRef: 'i2', order: 0 } },
      { type: 'item.attest', itemId: 'i1' },
    ]
    expect(ops.map(opCategory)).toEqual(['objective', 'item', 'lifecycle', 'proposal', 'verification'])
  })

  it('extracts readable text for the rail rows', () => {
    expect(opText({ type: 'objective.redirect', text: 'Ship it' })).toBe('Ship it')
    expect(opText({ type: 'item.add', item: { kind: 'invariant', text: 'Rule', clientRef: 'i1', order: 0 } })).toBe('Rule')
    expect(opText({ type: 'item.edit', itemId: 'i1' })).toBeNull()
    expect(opText({ type: 'deliverable.progress', itemId: 'i1', progress: 'done' })).toBe('done')
  })

  it('marks objective and single-target item ops as unstaged', () => {
    expect(opCanBeUnstaged({ type: 'objective.redirect', text: 'Ship it' })).toBe(true)
    expect(opCanBeUnstaged({ type: 'item.accept', itemId: 'i1' })).toBe(true)
    expect(opCanBeUnstaged({ type: 'item.add', item: { kind: 'invariant', text: 'Rule', clientRef: 'i1', order: 0 } })).toBe(true)
  })

  it('builds conflict rows with local keys and clipped projected text', () => {
    const rows = buildChangeSetConflicts(
      { added: [{ itemId: 'a', before: 'absent', after: 'dependency-conflict', beforeConflicts: 0, afterConflicts: 1 }], worsened: [] },
      {
        dependencyPlan: [{ id: 'a', localKey: 'D1' }],
        projectedItems: [{ id: 'a', text: 'A very long deliverable text that should be clipped for the rail' }],
      },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('D1')
    expect(rows[0]?.kind).toBe('added')
    expect(rows[0]?.text.endsWith('…')).toBe(true)
  })
})


describe('change-set rail grouping and diffs', () => {
  it('groups ops in the fixed category order', () => {
    const ops: CharterOp[] = [
      { type: 'item.attest', itemId: 'i1' },
      { type: 'objective.redirect', text: 'Ship it' },
      { type: 'item.accept', itemId: 'i1' },
    ]
    expect(groupChangeSetOps(ops).map(group => group.category)).toEqual(['objective', 'lifecycle', 'verification'])
  })

  it('renders before→after for objective and item edits', () => {
    const objectiveDiff = opDiff(
      { type: 'objective.redirect', text: 'New objective' },
      { objectiveBefore: 'Old objective', objectiveAfter: 'New objective', itemsBefore: [], projectedItems: [] },
    )
    expect(objectiveDiff).toEqual({ before: 'Old objective', after: 'New objective' })
    const editDiff = opDiff(
      { type: 'item.edit', itemId: 'i1', text: 'Edited text' },
      { objectiveBefore: null, objectiveAfter: null, itemsBefore: [{ id: 'i1', text: 'Old text' }], projectedItems: [{ id: 'i1', text: 'Edited text' }] },
    )
    expect(editDiff).toEqual({ before: 'Old text', after: 'Edited text' })
    const lifecycle = opDiff(
      { type: 'item.accept', itemId: 'i1' },
      { objectiveBefore: null, objectiveAfter: null, itemsBefore: [{ id: 'i1', text: 'Old text' }], projectedItems: [{ id: 'i1', text: 'Old text' }] },
    )
    expect(lifecycle.afterLabel).toEqual({ key: 'changeset.state.accepted' })
    const progress = opDiff(
      { type: 'deliverable.progress', itemId: 'i1', progress: 'in-progress' },
      { objectiveBefore: null, objectiveAfter: null, itemsBefore: [{ id: 'i1', text: 'Ship' }], projectedItems: [{ id: 'i1', text: 'Ship' }] },
    )
    expect(progress.afterLabel).toEqual({ key: 'progress.in-progress' })
  })
})
