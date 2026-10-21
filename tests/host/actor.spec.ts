import { describe, expect, it } from 'vitest'
import { CharterError } from '../../src/core/errors.js'
import { resolveActor } from '../../src/host/service.js'
import { peerPrincipalRequired } from '../../src/remote/compat.js'
import { resolveRemoteActor } from '../../src/remote/actor.js'

function context(invocation: unknown): Parameters<typeof resolveActor>[0] {
  return { invocation } as never
}

function codeOf(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(CharterError)
    return error instanceof CharterError ? error.code : undefined
  }
}

describe('Remote actor resolution', () => {
  it('records the owner when DSH 0.2.1 provides an owner principal', () => {
    expect(resolveActor(context({ peer: { principal: { kind: 'owner' } } })))
      .toEqual({ kind: 'owner' })
  })

  it('records a non-owner principal as a user, not the owner', () => {
    expect(resolveActor(context({ peer: { principal: { kind: 'guest' } } })))
      .toEqual({ kind: 'user' })
  })

  it('treats an in-process Host call without an invocation as the owner', () => {
    expect(resolveActor(context(undefined))).toEqual({ kind: 'owner' })
    expect(resolveActor(context(undefined), { requirePrincipal: true })).toEqual({ kind: 'owner' })
  })

  it('falls back to the owner only for a confirmed legacy runtime', () => {
    // DSH 0.1.7/0.2.0 has no PeerScope.principal field; the Gateway peer is the
    // local operator. Only an explicit legacy signal may use this fallback.
    expect(resolveActor(context({ peer: {} }), { requirePrincipal: false }))
      .toEqual({ kind: 'owner' })
    expect(resolveActor(context({ peer: { principal: undefined } }), { requirePrincipal: false }))
      .toEqual({ kind: 'owner' })
  })

  it('denies a principal-aware Remote call that lost its Peer principal', () => {
    expect(codeOf(() => resolveActor(context({ peer: {} }), { requirePrincipal: true })))
      .toBe('FORBIDDEN')
    // The default is fail-closed when the caller does not know the generation.
    expect(codeOf(() => resolveActor(context({ peer: {} })))).toBe('FORBIDDEN')
    expect(codeOf(() => resolveActor(context({ peer: { principal: undefined } }))))
      .toBe('FORBIDDEN')
  })

  it('binds Remote edit authorization to the detected DSH generation', () => {
    // Unknown or modern generation: a missing principal is a denial.
    expect(peerPrincipalRequired()).toBe(true)
    expect(codeOf(() => resolveRemoteActor(context({ peer: {} })))).toBe('FORBIDDEN')
    expect(resolveRemoteActor(context({ peer: { principal: { kind: 'owner' } } })))
      .toEqual({ kind: 'owner' })
    // Confirmed legacy runtime (0.1.7/0.2.0): the local operator is the owner.
    expect(resolveRemoteActor(context({ peer: {} }), false)).toEqual({ kind: 'owner' })
  })
})
