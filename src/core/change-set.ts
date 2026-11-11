import { sha256Json } from './digest.js'
import { applyOps, type ApplyOpsInput } from './commands.js'
import { dependencyConflictDiff, type DependencyConflictDiff } from './dependencies.js'
import type { CharterEditRequest, CharterOp, CharterSnapshot } from './schemas.js'

export interface ChangeSetSide {
  readonly revision: number
  readonly promptBytes: number
  readonly items: number
  readonly pendingItems: number
}

export interface PlannedChangeSet {
  readonly baseRevision: number
  readonly nextRevision: number
  readonly before: ChangeSetSide
  readonly after: ChangeSetSide
  readonly changes: readonly ReturnType<typeof applyOps>['changes'][number][]
  readonly summaryDigest: `sha256:${string}`
  readonly promptChanged: boolean
  readonly metadataOnly: boolean
  /**
   * Design §6.5: readiness conflicts this Change Set introduces or worsens.
   * Deliberately NOT part of `summaryDigest` (which binds revisions, prompt
   * digests and changes) so adding it cannot invalidate an existing preview.
   */
  readonly dependencyConflicts: DependencyConflictDiff
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function side(snapshot: CharterSnapshot): ChangeSetSide {
  return {
    revision: snapshot.revision,
    promptBytes: utf8Bytes(snapshot.promptText),
    items: snapshot.items.length,
    pendingItems: snapshot.items.filter(item => item.review === 'pending').length,
  }
}

/**
 * Canonical client-side Change Set projection. The Host remains the authority;
 * this is the exact before/after summary the UI can render and compare.
 */
export function planChangeSet(input: ApplyOpsInput): PlannedChangeSet {
  const applied = applyOps(input)
  const before = side(input.snapshot)
  const after = side(applied.snapshot)
  const promptChanged = applied.snapshot.promptText !== input.snapshot.promptText
  const metadataOnly = applied.changes.every(change =>
    change.type === 'item.accepted'
    || change.type === 'item.rejected'
    || change.type === 'item.archived'
    || change.type === 'item.restored'
    || change.type === 'item.superseded'
    || change.type === 'item.purged'
    || change.type === 'item.verification.changed')
    && !promptChanged
  const dependencyConflicts = dependencyConflictDiff(input.snapshot.items, applied.snapshot.items)
  const summaryDigest = sha256Json({
    version: 1,
    baseRevision: input.snapshot.revision,
    nextRevision: input.nextRevision,
    before: { revision: before.revision, promptDigest: input.snapshot.promptDigest },
    after: { revision: after.revision, promptDigest: applied.snapshot.promptDigest },
    changes: applied.changes,
  })
  return {
    baseRevision: input.snapshot.revision,
    nextRevision: input.nextRevision,
    before,
    after,
    changes: [...applied.changes],
    summaryDigest,
    promptChanged,
    metadataOnly,
    dependencyConflicts,
  }
}

export function changeSetOps(ops: readonly CharterOp[]): number {
  return ops.length
}

/** Digest of the reviewed request, bound to the authoritative snapshot. */
export function changeSetPreviewDigest(request: CharterEditRequest, stateDigest: string): `sha256:${string}` {
  return sha256Json({
    version: 1,
    kind: 'change-set-preview',
    sessionId: request.sessionId,
    baseRevision: request.baseRevision,
    stateDigest,
    ops: request.ops,
  })
}
