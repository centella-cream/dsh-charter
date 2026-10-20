import { applyOps } from '../../src/core/commands.js'
import { DEFAULT_CHARTER_LIMITS, type CharterLimits } from '../../src/core/limits.js'
import { normalizeEditRequest } from '../../src/core/normalize.js'
import { emptySnapshot } from '../../src/core/render.js'
import type { CharterEditRequest, CharterSnapshot } from '../../src/core/schemas.js'

export const limits: CharterLimits = { ...DEFAULT_CHARTER_LIMITS }

export function request(
  ops: CharterEditRequest['ops'],
  baseRevision = 0,
  mutationId = `mutation-${baseRevision + 1}`,
): CharterEditRequest {
  return normalizeEditRequest({
    sessionId: 'session-1',
    mutationId,
    baseRevision,
    ops,
  })
}

export function apply(
  snapshot: CharterSnapshot,
  edit: CharterEditRequest,
  ids: Readonly<Record<string, string>> = {},
): CharterSnapshot {
  return applyOps({
    snapshot,
    ops: edit.ops,
    ids,
    nextRevision: snapshot.revision + 1,
    limits,
  }).snapshot
}

export function initialSnapshot(): CharterSnapshot {
  return emptySnapshot(limits)
}
