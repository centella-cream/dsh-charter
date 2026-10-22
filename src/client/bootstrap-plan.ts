import type { CharterOp } from '../core/schemas.js'
import { compareOrderedItems } from '../core/items.js'
import { inspectUserText, type UserTextIssue } from '../core/normalize.js'
import { CHARTER_PROMPT_PREFIX, encodePromptText } from '../core/prompt.js'
import type { CharterBootstrapProposal, CharterBootstrapResult, CharterView } from '../host/types.js'
import { previewPrompt, projectView } from './preview.js'

/** Browser-safe byte count; the core helper is Node-only. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** Fixed prompt fragments around the objective and the two token lists. */
const PROMPT_OBJECTIVE_OPEN = '{"objective":'
const PROMPT_INVARIANTS_OPEN = ',"invariants":['
const PROMPT_DELIVERABLES_OPEN = '],"deliverables":['
const PROMPT_TAIL = ']}'

/** One deliverable token as rendered by `renderCharterPrompt`. */
function deliverablePromptToken(text: string, progress: string): string {
  return `{"text":${encodePromptText(text)},"progress":${JSON.stringify(progress)}}`
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
 *
 * Each candidate is measured with O(1) incremental byte accounting that
 * mirrors `renderCharterPrompt` exactly (objective token + joined
 * invariant/deliverable tokens). The exact full render is kept only as a
 * final verification: if it ever disagrees, the quadratic fallback recomputes
 * the plan, so correctness never depends on the estimate.
 */
export function buildBootstrapPlan(
  view: CharterView,
  objective: string,
  items: readonly BootstrapDraftItem[],
): BootstrapPlan {
  // Normalize with the same function the Host uses for admission, so the
  // incremental byte accounting below matches `previewPrompt` exactly even for
  // CRLF or decomposed Unicode input.
  const normalizedObjective = inspectUserText(objective).value
  const objectiveOp: CharterOp | null = view.objective === null && normalizedObjective.length > 0
    ? { type: 'objective.initialize', text: normalizedObjective }
    : null
  const baseOps: CharterOp[] = objectiveOp === null ? [] : [objectiveOp]
  const base = projectView(view, baseOps)
  const standing = base.items
    .filter(item => item.review === 'accepted' && item.lifecycle === 'current')
    .sort(compareOrderedItems)
  const ops: CharterOp[] = objectiveOp === null ? [] : [objectiveOp]
  const outcomes: Record<string, 'active' | 'pending'> = {}
  const encoder = new TextEncoder()
  const bytesOf = (value: string): number => encoder.encode(value).byteLength

  const fixedBytes = bytesOf(CHARTER_PROMPT_PREFIX)
    + bytesOf(PROMPT_OBJECTIVE_OPEN)
    + bytesOf(PROMPT_INVARIANTS_OPEN)
    + bytesOf(PROMPT_DELIVERABLES_OPEN)
    + bytesOf(PROMPT_TAIL)
  const objectiveToken = base.objective === null ? 'null' : encodePromptText(base.objective.current.text)
  let invariantCount = 0
  let deliverableCount = 0
  // Joined token bytes (including separators) of the standing set.
  let tokenBytes = 0
  for (const item of standing) {
    if (item.kind === 'invariant') {
      tokenBytes += bytesOf(encodePromptText(item.text)) + (invariantCount > 0 ? 1 : 0)
      invariantCount += 1
    } else if (item.progress !== undefined) {
      tokenBytes += bytesOf(deliverablePromptToken(item.text, item.progress))
        + (deliverableCount > 0 ? 1 : 0)
      deliverableCount += 1
    }
  }
  const baseIsEmpty = base.objective === null && invariantCount === 0 && deliverableCount === 0
  let promptBytes = baseIsEmpty ? 0 : fixedBytes + bytesOf(objectiveToken) + tokenBytes
  if (promptBytes !== bytesOf(previewPrompt(view, baseOps))) {
    return exactBootstrapPlan(view, items, objectiveOp)
  }

  let order = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  let active = 0
  let pending = 0
  let pendingInvariants = 0
  let pendingDeliverables = 0

  for (const item of items) {
    if (!item.selected) continue
    const text = inspectUserText(item.text).value
    if (text.length === 0) continue
    const isInvariant = item.kind === 'invariant'
    const token = isInvariant
      ? encodePromptText(text)
      : deliverablePromptToken(text, 'not-started')
    const candidateBytes = promptBytes === 0
      ? fixedBytes + bytesOf('null') + bytesOf(token)
      : promptBytes
        + (isInvariant ? (invariantCount > 0 ? 1 : 0) : (deliverableCount > 0 ? 1 : 0))
        + bytesOf(token)
    const activeOp: CharterOp = isInvariant
      ? { type: 'item.add', item: { clientRef: `bootstrap-${item.id}`, kind: 'invariant', text, order } }
      : {
          type: 'item.add',
          item: { clientRef: `bootstrap-${item.id}`, kind: 'deliverable', text, order, progress: 'not-started' },
        }
    // The actual model-visible budget is the gate. Candidates that would
    // exceed it are preserved as review-only proposals instead of being
    // rejected or silently dropped; pending proposals never enter the prompt.
    if (candidateBytes <= view.limits.maxPromptBytes) {
      ops.push(activeOp)
      promptBytes = candidateBytes
      if (isInvariant) invariantCount += 1
      else deliverableCount += 1
      outcomes[item.id] = 'active'
      active += 1
    } else {
      ops.push({ type: 'item.propose', item: activeOp.item })
      outcomes[item.id] = 'pending'
      pending += 1
      if (isInvariant) pendingInvariants += 1
      else pendingDeliverables += 1
    }
    order += 1
  }

  // Never admit a draft the exact renderer would reject: a full render is the
  // last word. The fallback is quadratic but should be unreachable for normal
  // normalized text and ascending order values.
  const exactBytes = bytesOf(previewPrompt(view, ops))
  if (exactBytes !== promptBytes || exactBytes > view.limits.maxPromptBytes) {
    return exactBootstrapPlan(view, items, objectiveOp)
  }

  return { ops, active, pending, pendingInvariants, pendingDeliverables, outcomes }
}

/** Exact quadratic fallback used only when the incremental estimate disagrees. */
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
    if (!item.selected) continue
    const text = inspectUserText(item.text).value
    if (text.length === 0) continue
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

export interface DraftTextIssue {
  readonly issue: UserTextIssue
  readonly where: 'objective' | 'candidate'
  readonly index?: number
}

/** First invalid reviewed value in the draft, validated like the Host does. */
export function firstDraftTextIssue(
  objective: string,
  items: readonly BootstrapDraftItem[],
): DraftTextIssue | undefined {
  if (objective.trim().length > 0) {
    const issue = inspectUserText(objective).issue
    if (issue !== undefined) return { issue, where: 'objective' }
  }
  for (const [index, item] of items.entries()) {
    if (!item.selected) continue
    const issue = inspectUserText(item.text).issue
    if (issue !== undefined) return { issue, where: 'candidate', index }
  }
  return undefined
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
