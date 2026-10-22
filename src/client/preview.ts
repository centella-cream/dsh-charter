import type {
  CharterItem,
  CharterObjective,
  CharterOp,
  DeliverableProgress,
} from '../core/schemas.js'
import { renderCharterPrompt, type PromptItem } from '../core/prompt.js'
import type { CharterView } from '../host/types.js'

/** One item as it would look after the staged operations are applied. */
export interface ProjectedItem extends PromptItem {
  readonly verification: CharterItem['verification']
  readonly supersedes?: string
  readonly supersededBy?: string
  /** Some staged operation targets this row (including a staged new item). */
  readonly staged: boolean
  /**
   * Id that `Unstage` should remove. `undefined` means the default `item.id`;
   * `null` marks a derived staged row (for example a purge-detached successor)
   * that has no directly removable operation, so the UI must not offer Unstage.
   */
  readonly unstageTarget?: string | null
  /** Created by the current draft; has no persisted id yet. */
  readonly synthetic: boolean
  readonly progress?: DeliverableProgress
  readonly origin?: CharterItem['origin']
  readonly createdRevision?: number
}

export interface ProjectedView {
  readonly objective: CharterObjective | null
  readonly items: readonly ProjectedItem[]
}

/**
 * The synthetic or persisted ids a staged operation targets. Unstage must use
 * the same rule: an operation is removable by unstaging the row it actually
 * edits, including a supersede's replacement clientRef and its predecessor.
 */
export function opTargets(op: CharterOp, itemId: string): boolean {
  return opTargetIds(op).includes(itemId)
}

/** Every projected-row id a staged operation directly targets. */
export function opTargetIds(op: CharterOp): readonly string[] {
  switch (op.type) {
    case 'item.add':
    case 'item.propose':
      return [`draft:${op.item.clientRef}`]
    case 'item.supersede':
      return [op.itemId, `draft:${op.replacement.clientRef}`]
    case 'objective.initialize':
    case 'objective.redirect':
      return []
    default:
      return 'itemId' in op ? [op.itemId] : []
  }
}

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, '\n').normalize('NFC').trim()
}

/** UTF-8 byte length, the unit every charter budget is expressed in. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** Prompt-budget admission for the currently staged draft. */
export interface PromptBudgetAdmission {
  /** Bytes of the committed prompt currently in effect. */
  readonly currentBytes: number
  /** Bytes of the prompt the staged operations would publish. */
  readonly previewBytes: number
  /** The staged prompt is over the configured prompt budget. */
  readonly over: boolean
  /** The staged prompt is strictly smaller than the committed one. */
  readonly shrinking: boolean
  /** Apply must stay disabled: the staged prompt is over budget and larger than the committed one. */
  readonly blocksApply: boolean
}

/**
 * Decide whether the Apply button must stay disabled by the prompt budget.
 *
 * This mirrors the Host's `overLimitGrowth` admission: an over-budget prompt is
 * admitted unless the edit makes it grow (an unchanged or shrinking render is
 * allowed so a tightened budget can converge stepwise). New or growing content
 * must be trimmed before Apply.
 */
export function promptBudgetAdmission(
  currentPrompt: string,
  previewPrompt: string,
  maxPromptBytes: number,
): PromptBudgetAdmission {
  const currentBytes = utf8Bytes(currentPrompt)
  const previewBytes = utf8Bytes(previewPrompt)
  const over = previewBytes > maxPromptBytes
  const shrinking = previewBytes < currentBytes
  return {
    currentBytes,
    previewBytes,
    over,
    shrinking,
    blocksApply: over && previewBytes > currentBytes,
  }
}

function fromItem(item: CharterItem): ProjectedItem {
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    review: item.review,
    lifecycle: item.lifecycle,
    verification: item.verification,
    order: item.order,
    origin: item.origin,
    createdRevision: item.createdRevision,
    ...(item.supersedes === undefined ? {} : { supersedes: item.supersedes }),
    ...(item.supersededBy === undefined ? {} : { supersededBy: item.supersededBy }),
    ...(item.kind === 'deliverable' ? { progress: item.progress } : {}),
    staged: false,
    synthetic: false,
  }
}

function draftItem(
  id: string,
  kind: 'invariant' | 'deliverable',
  text: string,
  order: number,
  progress?: DeliverableProgress,
  review: 'accepted' | 'pending' = 'accepted',
): ProjectedItem {
  return {
    id,
    kind,
    text: normalize(text),
    review,
    lifecycle: 'current',
    verification: { state: 'unchecked' },
    order,
    ...(kind === 'deliverable' ? { progress: progress ?? 'not-started' } : {}),
    staged: true,
    synthetic: true,
  } as ProjectedItem
}

/**
 * Project the committed view plus the currently staged operations.
 *
 * The Pane renders this projection instead of the committed view, so staging an
 * edit is visible immediately. The same function feeds `previewPrompt`, keeping
 * the rendered preview and the Host's eventual commit on one implementation.
 */
export function projectView(view: CharterView, ops: readonly CharterOp[]): ProjectedView {
  let objective: CharterObjective | null = view.objective ?? null
  const items = new Map<string, ProjectedItem>(
    view.items.map(item => [item.id, fromItem(item)]),
  )

  const markStaged = (id: string, patch: Partial<ProjectedItem>): void => {
    const existing = items.get(id)
    if (existing === undefined) return
    items.set(id, { ...existing, ...patch, staged: true })
  }

  // Direct op targets and purge-derived link detaches are tracked separately:
  // a row that a staged op genuinely targets must keep its own Unstage even
  // when a later purge derives a `supersedes` change on it.
  const direct = new Set<string>()
  const derivedOnly = new Set<string>()

  for (const op of ops) {
    for (const id of opTargetIds(op)) direct.add(id)
    if (op.type !== 'item.purge') continue
    for (const [id, candidate] of items) {
      if (candidate.supersedes === op.itemId) derivedOnly.add(id)
    }
  }

  for (const op of ops) {
    switch (op.type) {
      case 'objective.initialize':
      case 'objective.redirect':
        objective = {
          original: objective?.original ?? {
            text: normalize(op.text),
            setAtRevision: view.revision + 1,
          },
          current: {
            text: normalize(op.text),
            setAtRevision: view.revision + 1,
            ...(op.type === 'objective.redirect' && op.reason !== undefined
              ? { reason: normalize(op.reason) }
              : {}),
          },
        }
        break
      case 'item.add':
        items.set(`draft:${op.item.clientRef}`, draftItem(
          `draft:${op.item.clientRef}`,
          op.item.kind,
          op.item.text,
          op.item.order,
          op.item.kind === 'deliverable' ? op.item.progress : undefined,
        ))
        break
      case 'item.propose':
        items.set(`draft:${op.item.clientRef}`, draftItem(
          `draft:${op.item.clientRef}`,
          op.item.kind,
          op.item.text,
          op.item.order,
          op.item.kind === 'deliverable' ? op.item.progress : undefined,
          'pending',
        ))
        break
      case 'item.edit': {
        const item = items.get(op.itemId)
        if (item !== undefined) {
          const text = op.text === undefined ? item.text : normalize(op.text)
          items.set(item.id, {
            ...item,
            text,
            order: op.order ?? item.order,
            verification: text === item.text ? item.verification : { state: 'unchecked' },
            staged: true,
          })
        }
        break
      }
      case 'item.accept':
        markStaged(op.itemId, { review: 'accepted' })
        break
      case 'item.reject':
        markStaged(op.itemId, { review: 'rejected', verification: { state: 'unchecked' } })
        break
      case 'item.archive':
        markStaged(op.itemId, { lifecycle: 'archived' })
        break
      case 'item.restore':
        markStaged(op.itemId, { lifecycle: 'current' })
        break
      case 'item.supersede': {
        const item = items.get(op.itemId)
        if (item === undefined) break
        const replacementId = `draft:${op.replacement.clientRef}`
        items.set(item.id, { ...item, lifecycle: 'superseded', supersededBy: replacementId, staged: true })
        items.set(replacementId, {
          ...draftItem(
            replacementId,
            op.replacement.kind,
            op.replacement.text,
            op.replacement.order,
            op.replacement.kind === 'deliverable' ? op.replacement.progress : undefined,
          ),
          supersedes: item.id,
        })
        break
      }
      case 'item.purge': {
        const purged = items.get(op.itemId)
        items.delete(op.itemId)
        // Match the Host's purge semantics: removing a superseded predecessor
        // detaches its successor's `supersedes` back-link instead of leaving a
        // dangling reference in the projected view. The detached successor is
        // a derived staged row: no staged op targets its own id, so it must
        // not expose an Unstage button that cannot remove anything.
        if (purged !== undefined) {
          for (const [id, candidate] of items) {
            if (candidate.supersedes !== purged.id) continue
            const { supersedes: _detached, ...detached } = candidate
            items.set(id, { ...detached, staged: true })
          }
        }
        break
      }
      case 'deliverable.progress': {
        const item = items.get(op.itemId)
        if (item?.kind === 'deliverable') {
          items.set(item.id, { ...item, progress: op.progress, staged: true })
        }
        break
      }
      case 'item.verification.set': {
        const item = items.get(op.itemId)
        if (item !== undefined) {
          items.set(item.id, {
            ...item,
            verification: op.verification === 'verified'
              ? { state: 'verified', by: 'user' }
              : { state: 'unchecked' },
            staged: true,
          })
        }
        break
      }
    }
  }

  // Derive staged/Unstage from the fully applied op set: directly targeted rows
  // keep an Unstage that removes their own operations; rows changed only by a
  // purge-derived link detach are staged but have no directly removable op.
  for (const [id, item] of items) {
    const isDirect = direct.has(id)
    const isDerived = derivedOnly.has(id)
    if (!isDirect && !isDerived) continue
    items.set(id, isDirect
      ? { ...item, staged: true, unstageTarget: id }
      : { ...item, staged: true, unstageTarget: null })
  }

  return {
    objective,
    items: [...items.values()].sort(compareProjected),
  }
}

function compareProjected(left: ProjectedItem, right: ProjectedItem): number {
  return left.order - right.order
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
}

/** Render the prompt the current draft would publish after Apply. */
export function previewPrompt(view: CharterView, ops: readonly CharterOp[]): string {
  const projected = projectView(view, ops)
  return renderCharterPrompt(projected.objective ?? undefined, projected.items)
}

/** Display order shared by committed and projected items. */
export function displayItems<T extends { readonly id: string; readonly order: number }>(
  items: readonly T[],
): readonly T[] {
  return [...items].sort((left, right) => left.order - right.order
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

/** Rows that are accepted and current: the model-visible working set. */
export function activeItems(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items.filter(item => item.lifecycle === 'current' && item.review === 'accepted')
}

/** Pending proposals stay visible but are not part of the active working set. */
export function pendingItems(items: readonly ProjectedItem[]): ProjectedItem[] {
  return items.filter(item => item.lifecycle === 'current' && item.review === 'pending')
}

/** Counts used by the navigation badges and section headings. */
export function itemCounts(items: readonly ProjectedItem[]): {
  readonly active: number
  readonly pending: number
  readonly history: number
} {
  let active = 0
  let pending = 0
  let history = 0
  for (const item of items) {
    if (item.review === 'rejected' || item.lifecycle !== 'current') history += 1
    else if (item.review === 'pending') pending += 1
    else active += 1
  }
  return { active, pending, history }
}
