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
