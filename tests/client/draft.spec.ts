import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { draftRequestFor } from '../../src/client/draft.js'
import type { CharterOp } from '../../src/core/schemas.js'

const sessionA = SessionId('session-a')
const sessionB = SessionId('session-b')
const ops: readonly CharterOp[] = [{
  type: 'item.add',
  item: { clientRef: 'draft-1', kind: 'invariant', text: 'Staged in Session A', order: 1 },
}]

describe('staged draft scoping', () => {
  it('never submits Session A staged ops under Session B', () => {
    expect(draftRequestFor(sessionB, sessionA, 0, ops, 'mutation-b')).toBeUndefined()
    expect(draftRequestFor(sessionA, sessionA, 0, ops, 'mutation-a')).toEqual({
      sessionId: sessionA,
      mutationId: 'mutation-a',
      baseRevision: 0,
      ops: [...ops],
    })
  })

  it('does not build a request without a staged draft or base revision', () => {
    expect(draftRequestFor(sessionA, null, 0, ops, 'mutation-empty')).toBeUndefined()
    expect(draftRequestFor(sessionA, sessionA, null, ops, 'mutation-no-base')).toBeUndefined()
    expect(draftRequestFor(sessionA, sessionA, 0, [], 'mutation-no-ops')).toBeUndefined()
  })
})
