import { describe, expect, it } from 'vitest'
import { resolveActor } from '../../src/host/service.js'

function context(invocation: unknown): Parameters<typeof resolveActor>[0] {
  return { invocation } as never
}

describe('Remote actor resolution', () => {
  it('records the owner when DSH 0.2.1 provides an owner principal', () => {
    expect(resolveActor(context({ peer: { principal: { kind: 'owner' } } })))
      .toEqual({ kind: 'owner' })
  })

  it('falls back to the owner when DSH 0.2.0 exposes no principal', () => {
    expect(resolveActor(context({ peer: {} }))).toEqual({ kind: 'owner' })
    expect(resolveActor(context(undefined))).toEqual({ kind: 'owner' })
  })

  it('records a non-owner principal as a user, not the owner', () => {
    expect(resolveActor(context({ peer: { principal: { kind: 'guest' } } })))
      .toEqual({ kind: 'user' })
  })
})
