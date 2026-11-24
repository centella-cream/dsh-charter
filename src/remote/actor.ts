import type { Context } from '@deepseek-ai/cordis'
import { resolveActor } from '../host/service.js'
import { charterError } from '../core/errors.js'
import type { CharterActor } from '../core/schemas.js'
import { peerPrincipalRequired } from './compat.js'

/**
 * Resolve the actor of the current Remote call.
 *
 * DSH 0.2.1+ carries a required Peer principal and fails closed if it is
 * missing; only a runtime that rejected resource declarations (0.1.7/0.2.0)
 * falls back to the in-process owner identity.
 */
export function resolveRemoteActor(
  ctx: Context,
  requirePrincipal: boolean = peerPrincipalRequired(),
): CharterActor {
  return resolveActor(ctx, { requirePrincipal })
}

/** Calibration spends model budget; only the owner principal may trigger it. */
export function requireOwnerCalibration(actor: CharterActor): void {
  if (actor.kind !== 'owner') throw charterError('FORBIDDEN', 'Calibration is owner-only')
}
