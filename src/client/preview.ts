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

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, '\n').normalize('NFC').trim()
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
      case 'item.purge':
        items.delete(op.itemId)
        break
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
