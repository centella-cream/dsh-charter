import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CharterEditRequest, CharterOp } from '../core/schemas.js'

/**
 * Build the atomic edit request for the currently staged draft.
 *
 * A view binding can be reused for another Session. The draft itself carries
 * the Session that produced it, so a mismatched binding can never submit A's
 * staged operations under B's session id. The Pane also resets its draft state
 * when `sessionId` changes; this guard is the last line of defence.
 */
export function draftRequestFor(
  sessionId: SessionId,
  draftSessionId: SessionId | null,
  baseRevision: number | null,
  ops: readonly CharterOp[],
  mutationId: string,
): CharterEditRequest | undefined {
  if (draftSessionId !== sessionId) return undefined
  if (baseRevision === null || ops.length === 0) return undefined
  return { sessionId, mutationId, baseRevision, ops: [...ops] }
}
