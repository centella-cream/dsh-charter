import type { CharterOp } from '../core/schemas.js'
import type { CharterView } from '../host/types.js'
import { previewPrompt, projectView, promptBudgetAdmission, type PromptBudgetAdmission } from './preview.js'

/** Why a staged edit batch cannot be applied to the current view. */
export type DraftAdmissionReason = 'no-ops' | 'max-ops' | 'max-items' | 'max-pending' | 'max-objective' | 'max-item' | 'prompt'

export interface DraftAdmission {
  readonly ok: boolean
  readonly reason?: DraftAdmissionReason
  /** `ops` in the batch (Host maxOps). */
  readonly ops: number
  /** Projected row count (Host maxItems). */
  readonly items: number
  /** Projected pending-review row count (Host maxPendingItems). */
  readonly pending: number
  readonly prompt: PromptBudgetAdmission
}

/** Mirror the Host's stepwise rule: an over-limit value may stay or shrink. */
function overLimitGrowth(next: number, previous: number, limit: number): boolean {
  if (next <= limit) return false
  return next > previous
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Mirror the Host's admission for an over-limit objective field: unchanged
 * text may stay over budget, and a previously committed objective may only
 * shrink (a same-byte different text is a new value and is rejected).
 */
function objectiveFieldBlocked(next: string, previous: string | undefined, limit: number): boolean {
  const nextBytes = bytes(next)
  if (nextBytes <= limit) return false
  return !(previous !== undefined && (previous === next || nextBytes < bytes(previous)))
}

/**
 * Mirror the Host's admission for an over-limit item field: only the same id
 * may stay over budget via unchanged text or a strictly shorter value; a new
 * item or a grown/equal-byte-different value is rejected.
 */
function itemFieldBlocked(
  next: readonly { readonly id: string; readonly text: string }[],
  previous: readonly { readonly id: string; readonly text: string }[],
  limit: number,
): boolean {
  const before = new Map(previous.map(item => [item.id, item.text]))
  for (const item of next) {
    const nextBytes = bytes(item.text)
    if (nextBytes <= limit) continue
    const previousText = before.get(item.id)
    if (previousText !== undefined && (previousText === item.text || nextBytes < bytes(previousText))) continue
    return true
  }
  return false
}

/**
 * One preflight for a staged edit batch, shared by the Pane (Apply button and
 * notices) and `CharterDraft.applyDraft` (a second line of defence before any
 * Remote call). It mirrors the Host-side limits that are visible from a view:
 * maxOps, maxItems and maxPendingItems with their stepwise over-limit rule,
 * plus the prompt-budget admission (growth over the budget blocks Apply;
 * shrinking or non-growing over-budget renders are admitted).
 *
 * maxRecordBytes is serialized-record sizing the client does not reproduce, so
 * it intentionally remains a Host-only check.
 */
export function draftAdmission(view: CharterView, ops: readonly CharterOp[]): DraftAdmission {
  const prompt = promptBudgetAdmission(
    view.promptText,
    previewPrompt(view, ops),
    view.limits.maxPromptBytes,
  )
  const projected = projectView(view, ops)
  const items = projected.items.length
  const pending = projected.items.filter(item => item.review === 'pending').length
  const result = (reason: DraftAdmissionReason | undefined): DraftAdmission => ({
    ok: reason === undefined,
    ...(reason === undefined ? {} : { reason }),
    ops: ops.length,
    items,
    pending,
    prompt,
  })
  if (ops.length === 0) return result('no-ops')
  if (ops.length > view.limits.maxOps) return result('max-ops')
  if (overLimitGrowth(items, view.items.length, view.limits.maxItems)) return result('max-items')
  if (overLimitGrowth(
    pending,
    view.items.filter(item => item.review === 'pending').length,
    view.limits.maxPendingItems,
  )) return result('max-pending')
  const projectedObjective = projected.objective?.current.text
  const committedObjective = view.objective?.current.text
  if (projectedObjective !== undefined
    && objectiveFieldBlocked(projectedObjective, committedObjective, view.limits.maxObjectiveBytes)) {
    return result('max-objective')
  }
  if (itemFieldBlocked(projected.items, view.items, view.limits.maxItemBytes)) return result('max-item')
  if (prompt.blocksApply) return result('prompt')
  return result(undefined)
}
