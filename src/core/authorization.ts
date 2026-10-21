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
  if (actor.kind === 'owner') return
  if (actor.kind === 'user') {
    if (ops.some(op => op.type === 'item.purge')) {
      throw charterError('FORBIDDEN', 'item.purge requires an owner actor')
    }
    return
  }
  throw charterError('FORBIDDEN', `actor ${actor.kind} cannot edit the session charter`)
}
