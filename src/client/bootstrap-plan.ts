import { utf8Bytes } from '../core/limits.js'
import type { CharterOp } from '../core/schemas.js'
import type { CharterView } from '../host/types.js'
import { previewPrompt } from './preview.js'

/** One editable candidate extracted from a compaction summary. */
export interface BootstrapDraftItem {
  readonly id: string
  readonly kind: 'invariant' | 'deliverable'
  readonly text: string
  readonly selected: boolean
}

/** The model-visible part of a history import plus its deferred proposals. */
export interface BootstrapPlan {
  readonly ops: CharterOp[]
  readonly active: number
  readonly pending: number
  readonly pendingInvariants: number
  readonly pendingDeliverables: number
}

/**
 * Split a reviewed history draft into the part that fits the real context
 * budget and the part preserved as pending proposals.
 *
 * The plan never drops a selected candidate. Items are tried in draft order;
 * once one does not fit, later shorter items may still become active. This is
 * deliberate: a long low-priority candidate must not consume the remaining
 * budget for everything after it.
 */
export function buildBootstrapPlan(
  view: CharterView,
  objective: string,
  items: readonly BootstrapDraftItem[],
): BootstrapPlan {
  const ops: CharterOp[] = []
  if (view.objective === null && objective.trim().length > 0) {
    ops.push({ type: 'objective.initialize', text: objective.trim() })
  }

  let order = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  let active = 0
  let pending = 0
  let pendingInvariants = 0
  let pendingDeliverables = 0

  for (const item of items) {
    if (!item.selected || item.text.trim().length === 0) continue
    const activeOp: CharterOp = item.kind === 'invariant'
      ? {
          type: 'item.add',
          item: { clientRef: `bootstrap-${item.id}`, kind: 'invariant', text: item.text.trim(), order },
        }
      : {
          type: 'item.add',
          item: {
            clientRef: `bootstrap-${item.id}`,
            kind: 'deliverable',
            text: item.text.trim(),
            order,
            progress: 'not-started',
          },
        }

    // The actual model-visible budget is the gate. Candidates that would
    // exceed it are preserved as review-only proposals instead of being
    // rejected or silently dropped.
    if (utf8Bytes(previewPrompt(view, [...ops, activeOp])) <= view.limits.maxPromptBytes) {
      ops.push(activeOp)
      active += 1
    } else {
      ops.push({ type: 'item.propose', item: activeOp.item })
      pending += 1
      if (item.kind === 'invariant') pendingInvariants += 1
      else pendingDeliverables += 1
    }
    order += 1
  }

  return { ops, active, pending, pendingInvariants, pendingDeliverables }
}
