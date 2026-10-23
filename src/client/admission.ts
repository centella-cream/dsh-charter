import type { CharterOp } from '../core/schemas.js'
import type { CharterView } from '../host/types.js'
import { previewPrompt, projectView, promptBudgetAdmission, type PromptBudgetAdmission } from './preview.js'

/** Why a staged edit batch cannot be applied to the current view. */
export type DraftAdmissionReason = 'no-ops' | 'max-ops' | 'max-items' | 'max-pending' | 'prompt'

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
  if (prompt.blocksApply) return result('prompt')
  return result(undefined)
}
