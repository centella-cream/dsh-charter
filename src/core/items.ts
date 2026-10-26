import type {
  CharterItem,
  DeliverableItem,
  InvariantItem,
} from './schemas.js'

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface OrderedItem {
  readonly id: string
  readonly order: number
}

export function compareOrderedItems(left: OrderedItem, right: OrderedItem): number {
  return left.order - right.order || compareCodeUnits(left.id, right.id)
}

/**
 * Rebuild one item with the exact schema field order and without explicit
 * `undefined` optional fields. The state digest hashes this shape, so a record
 * parsed from JSON (zod schema order) and a record built in memory must hash
 * identically regardless of property insertion order.
 */
export function normalizeItemShape(item: CharterItem): CharterItem {
  const common = {
    id: item.id,
    text: item.text,
    review: item.review,
    lifecycle: item.lifecycle,
    verification: item.verification,
    origin: item.origin,
    order: item.order,
    createdRevision: item.createdRevision,
    ...(item.supersedes === undefined ? {} : { supersedes: item.supersedes }),
    ...(item.supersededBy === undefined ? {} : { supersededBy: item.supersededBy }),
  }
  if (item.kind === 'deliverable') {
    return { kind: 'deliverable', ...common, progress: item.progress }
  }
  return { kind: 'invariant', ...common }
}

export function canonicalItems<T extends OrderedItem>(items: Iterable<T>): readonly T[] {
  return [...items].sort(compareOrderedItems)
}

export interface StandingItem {
  readonly review: CharterItem['review']
  readonly lifecycle: CharterItem['lifecycle']
}

export function isStandingItem(item: StandingItem): boolean {
  return item.review === 'accepted' && item.lifecycle === 'current'
}

export function isInvariant(item: CharterItem): item is InvariantItem {
  return item.kind === 'invariant'
}

export function isDeliverable(item: CharterItem): item is DeliverableItem {
  return item.kind === 'deliverable'
}
