import type { CharterOp, CharterItem, DeliverableProgress } from '../core/schemas.js'
import { renderCharterPrompt, type PromptItem } from '../core/prompt.js'
import type { CharterView } from '../host/types.js'

type PreviewItem = PromptItem

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, '\n').normalize('NFC').trim()
}

function draftItem(
  id: string,
  kind: 'invariant' | 'deliverable',
  text: string,
  order: number,
  progress?: DeliverableProgress,
  review: 'accepted' | 'pending' = 'accepted',
): PreviewItem {
  return kind === 'invariant'
    ? { id, kind: 'invariant', text: normalize(text), review, lifecycle: 'current', order }
    : {
        id,
        kind: 'deliverable',
        text: normalize(text),
        review,
        lifecycle: 'current',
        order,
        progress: progress ?? 'not-started',
      }
}

/**
 * Render the prompt the current draft would publish after Apply.
 *
 * This intentionally calls the same pure renderer the Host uses, so the
 * preview cannot drift from the model-visible context. It is not a second
 * validator: the Host still rejects quota, references and transitions.
 */
export function previewPrompt(view: CharterView, ops: readonly CharterOp[]): string {
  let objective = view.objective ?? undefined
  const items = new Map<string, PreviewItem>(view.items.map(item => [item.id, {
    id: item.id,
    kind: item.kind,
    text: item.text,
    review: item.review,
    lifecycle: item.lifecycle,
    order: item.order,
    ...(item.kind === 'deliverable' ? { progress: item.progress } : {}),
  }]))

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
            ...(op.type === 'objective.redirect' ? { reason: normalize(op.reason) } : {}),
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
        if (item !== undefined) items.set(item.id, {
          ...item,
          ...(op.text === undefined ? {} : { text: normalize(op.text) }),
          ...(op.order === undefined ? {} : { order: op.order }),
        })
        break
      }
      case 'item.accept': {
        const item = items.get(op.itemId)
        if (item !== undefined) items.set(item.id, { ...item, review: 'accepted' })
        break
      }
      case 'item.reject': {
        const item = items.get(op.itemId)
        if (item !== undefined) items.set(item.id, { ...item, review: 'rejected' })
        break
      }
      case 'item.archive': {
        const item = items.get(op.itemId)
        if (item !== undefined) items.set(item.id, { ...item, lifecycle: 'archived' })
        break
      }
      case 'item.restore': {
        const item = items.get(op.itemId)
        if (item !== undefined) items.set(item.id, { ...item, lifecycle: 'current' })
        break
      }
      case 'item.supersede': {
        const item = items.get(op.itemId)
        if (item !== undefined) {
          items.set(item.id, { ...item, lifecycle: 'superseded' })
          items.set(`draft:${op.replacement.clientRef}`, draftItem(
            `draft:${op.replacement.clientRef}`,
            op.replacement.kind,
            op.replacement.text,
            op.replacement.order,
            op.replacement.kind === 'deliverable' ? op.replacement.progress : undefined,
          ))
        }
        break
      }
      case 'item.purge':
        items.delete(op.itemId)
        break
      case 'deliverable.progress': {
        const item = items.get(op.itemId)
        if (item?.kind === 'deliverable') items.set(item.id, { ...item, progress: op.progress })
        break
      }
      case 'item.verification.set':
        break
    }
  }

  return renderCharterPrompt(objective, [...items.values()])
}

export function displayItems(items: readonly CharterItem[]): readonly CharterItem[] {
  return [...items].sort((left, right) => left.order - right.order
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}
