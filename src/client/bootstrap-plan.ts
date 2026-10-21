import type { CharterOp } from '../core/schemas.js'
import { renderCharterPrompt } from '../core/prompt.js'
import type { CharterBootstrapProposal, CharterBootstrapResult, CharterView } from '../host/types.js'
import { previewPrompt, projectView, type ProjectedItem } from './preview.js'

/** Browser-safe byte count; the core helper is Node-only. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

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
  /** Per-candidate outcome for the review UI. */
  readonly outcomes: Readonly<Record<string, 'active' | 'pending'>>
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
  // One-pass planning: the projected base prompt is rendered from the
  // committed standing set, then each selected candidate is measured by
  // appending it to the running active set. Pending candidates never enter the
  // prompt, so they do not need a re-render at all.
  const objectiveOp: CharterOp | null = view.objective === null && objective.trim().length > 0
    ? { type: 'objective.initialize', text: objective.trim() }
    : null
  const base = projectView(view, objectiveOp === null ? [] : [objectiveOp])
  const standing = base.items.filter(item => item.review === 'accepted' && item.lifecycle === 'current')
  const activeItems: ProjectedItem[] = []
  const ops: CharterOp[] = []
  const outcomes: Record<string, 'active' | 'pending'> = {}
  if (objectiveOp !== null) ops.push(objectiveOp)

  let order = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  let active = 0
  let pending = 0
  let pendingInvariants = 0
  let pendingDeliverables = 0
  const encoder = new TextEncoder()
  const bytesOf = (value: string): number => encoder.encode(value).byteLength

  for (const item of items) {
    if (!item.selected || item.text.trim().length === 0) continue
    const text = item.text.trim()
    const activeOp: CharterOp = item.kind === 'invariant'
      ? { type: 'item.add', item: { clientRef: `bootstrap-${item.id}`, kind: 'invariant', text, order } }
      : {
          type: 'item.add',
          item: { clientRef: `bootstrap-${item.id}`, kind: 'deliverable', text, order, progress: 'not-started' },
        }
    const candidate: ProjectedItem = item.kind === 'invariant'
      ? {
          id: `bootstrap-${item.id}`,
          kind: 'invariant',
          text,
          order,
          review: 'accepted',
          lifecycle: 'current',
          verification: { state: 'unchecked' },
          staged: true,
          synthetic: true,
        }
      : {
          id: `bootstrap-${item.id}`,
          kind: 'deliverable',
          text,
          order,
          review: 'accepted',
          lifecycle: 'current',
          verification: { state: 'unchecked' },
          progress: 'not-started',
          staged: true,
          synthetic: true,
        }

    // The actual model-visible budget is the gate. Candidates that would
    // exceed it are preserved as review-only proposals instead of being
    // rejected or silently dropped.
    const projectedBytes = bytesOf(renderCharterPrompt(
      base.objective ?? undefined,
      [...standing, ...activeItems, candidate],
    ))
    if (projectedBytes <= view.limits.maxPromptBytes) {
      ops.push(activeOp)
      activeItems.push(candidate)
      outcomes[item.id] = 'active'
      active += 1
    } else {
      ops.push({ type: 'item.propose', item: activeOp.item })
      outcomes[item.id] = 'pending'
      pending += 1
      if (item.kind === 'invariant') pendingInvariants += 1
      else pendingDeliverables += 1
    }
    order += 1
  }

  // The incremental estimate must never admit a draft the exact renderer would
  // reject. Fall back to the exact per-candidate algorithm if the final render
  // disagrees (only possible with unusual ordering or normalization).
  if (bytesOf(previewPrompt(view, ops)) > view.limits.maxPromptBytes) {
    return exactBootstrapPlan(view, items, objectiveOp)
  }

  return { ops, active, pending, pendingInvariants, pendingDeliverables, outcomes }
}

/** Exact quadratic fallback used only when the one-pass estimate disagrees. */
function exactBootstrapPlan(
  view: CharterView,
  items: readonly BootstrapDraftItem[],
  objectiveOp: CharterOp | null,
): BootstrapPlan {
  const ops: CharterOp[] = objectiveOp === null ? [] : [objectiveOp]
  const outcomes: Record<string, 'active' | 'pending'> = {}
  let order = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  let active = 0
  let pending = 0
  let pendingInvariants = 0
  let pendingDeliverables = 0
  for (const item of items) {
    if (!item.selected || item.text.trim().length === 0) continue
    const text = item.text.trim()
    const activeOp: CharterOp = item.kind === 'invariant'
      ? { type: 'item.add', item: { clientRef: `bootstrap-${item.id}`, kind: 'invariant', text, order } }
      : {
          type: 'item.add',
          item: { clientRef: `bootstrap-${item.id}`, kind: 'deliverable', text, order, progress: 'not-started' },
        }
    if (utf8Bytes(previewPrompt(view, [...ops, activeOp])) <= view.limits.maxPromptBytes) {
      ops.push(activeOp)
      outcomes[item.id] = 'active'
      active += 1
    } else {
      ops.push({ type: 'item.propose', item: activeOp.item })
      outcomes[item.id] = 'pending'
      pending += 1
      if (item.kind === 'invariant') pendingInvariants += 1
      else pendingDeliverables += 1
    }
    order += 1
  }
  return { ops, active, pending, pendingInvariants, pendingDeliverables, outcomes }
}

/** What the pane should do with a bootstrap response. */
export type BootstrapOutcome =
  | { readonly kind: 'draft'; readonly proposal: CharterBootstrapProposal }
  | {
      readonly kind: 'unavailable'
      readonly reason: 'not-live' | 'no-summary' | 'unavailable'
      readonly message: string | undefined
    }
  | { readonly kind: 'stale' }
  | { readonly kind: 'discard' }

/**
 * Decide whether a bootstrap response is still relevant.
 *
 * The response is discarded silently when the user already committed a charter
 * or staged edits while it was in flight: showing "stale" there would punish a
 * user who simply started working. A response that is still empty but whose
 * revision moved is genuinely stale and may be retried.
 */
export function classifyBootstrapOutcome(
  result: CharterBootstrapResult,
  current: { readonly status: 'connecting' | 'ready' | 'error'; readonly view: CharterView | null },
  requestedRevision: number,
  stagedOps: number,
): BootstrapOutcome {
  if (!result.available) {
    return { kind: 'unavailable', reason: result.reason, message: result.message }
  }
  const view = current.view
  if (current.status !== 'ready' || view === null || view.status !== 'ready') {
    return { kind: 'discard' }
  }
  if (view.objective !== null || view.items.length > 0 || stagedOps > 0) {
    return { kind: 'discard' }
  }
  if (view.revision !== requestedRevision) return { kind: 'stale' }
  return { kind: 'draft', proposal: result.proposal }
}
