import { charterError } from './errors.js'
import type { CharterActor, CharterOp } from './schemas.js'

/**
 * Apply the actor policy before any storage mutation.
 *
 * `owner` and `user` are human callers. Both may perform ordinary charter
 * edits. Irreversible purge is owner-only. `host` is reserved for internal
 * operations that do not pass through the Remote edit path.
 */
export function assertEditAuthorized(actor: CharterActor, ops: readonly CharterOp[]): void {
  const writesValidity = ops.some(op => op.type === 'item.validity.set')
  if (writesValidity) {
    if (actor.kind !== 'host') {
      throw charterError('FORBIDDEN', 'validator results are written by the Host, not a client edit')
    }
    if (ops.some(op => op.type !== 'item.validity.set')) {
      throw charterError('FORBIDDEN', 'validator results cannot share a Change Set with ordinary edits')
    }
    return
  }
  if (actor.kind === 'host') {
    throw charterError('FORBIDDEN', 'host authoring is limited to validator results')
  }
  if (actor.kind === 'owner') return
  if (actor.kind === 'user') {
    if (ops.some(op => op.type === 'item.purge' || op.type === 'objective.purge')) {
      throw charterError('FORBIDDEN', 'purge requires an owner actor')
    }
    return
  }
  if (actor.kind === 'agent-tool') {
    if (ops.every(op => op.type === 'item.propose')) return
    throw charterError('FORBIDDEN', 'agent-tool may only create pending item proposals')
  }
  throw charterError('FORBIDDEN', `actor ${actor.kind} cannot edit the session charter`)
}
