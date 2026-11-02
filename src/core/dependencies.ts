import { charterError } from './errors.js'
import { isDeliverable, isStandingItem, compareOrderedItems } from './items.js'
import type { CharterItem, DeliverableItem } from './schemas.js'

export type PrerequisiteStatus = 'satisfied' | 'waiting' | 'dependency-conflict'

export type ExecutionDisplay =
  | 'ready'
  | 'waiting'
  | 'dependency-conflict'
  | 'in-progress'
  | 'blocked'
  | 'terminal'

export interface DependencyProjection {
  readonly id: string
  readonly localKey: string
  readonly requires: readonly string[]
  readonly requiresIds: readonly string[]
  readonly prerequisiteStatus: PrerequisiteStatus
  readonly executionDisplay: ExecutionDisplay
}

export function standingDeliverables(items: readonly CharterItem[]): readonly DeliverableItem[] {
  return items.filter((item): item is DeliverableItem => isStandingItem(item) && isDeliverable(item))
}

/** Canonicalize a relation list: de-duplicate and sort by stable ID code units. */
export function canonicalRequires(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

/**
 * Stable topological order. Ties inside a layer use the persisted canonical order,
 * never UUID alone, so fork and pre/post migration renderings agree.
 */
export function topologicalDeliverables(items: readonly CharterItem[]): readonly DeliverableItem[] {
  const active = standingDeliverables(items)
  const pending = new Map(active.map(item => [item.id, new Set(item.requires ?? [])]))
  const ordered: DeliverableItem[] = []
  while (pending.size > 0) {
    const layer = active
      .filter(item => pending.has(item.id) && [...pending.get(item.id)!].every(id => !pending.has(id)))
      .sort(compareOrderedItems)
    if (layer.length === 0) {
      throw charterError('INVALID_CHANGE_SET', 'deliverable dependency graph contains a cycle')
    }
    for (const item of layer) {
      ordered.push(item)
      pending.delete(item.id)
    }
  }
  return ordered
}

export function validateDependencyGraph(items: readonly CharterItem[]): void {
  const byId = new Map(items.map(item => [item.id, item]))
  for (const item of items) {
    if (item.kind !== 'deliverable') {
      if ('requires' in item) {
        throw charterError('CORRUPT_STATE', `non-deliverable item ${item.id} cannot carry requires`)
      }
      continue
    }
    const requires = item.requires ?? []
    if (new Set(requires).size !== requires.length) {
      throw charterError('CORRUPT_STATE', `deliverable ${item.id} has duplicate prerequisites`)
    }
    if (requires.length === 0) continue
    if (!isStandingItem(item)) {
      throw charterError('CORRUPT_STATE', `inactive deliverable ${item.id} cannot carry requires`)
    }
    for (const prerequisiteId of requires) {
      if (prerequisiteId === item.id) {
        throw charterError('INVALID_CHANGE_SET', `deliverable ${item.id} cannot require itself`)
      }
      const prerequisite = byId.get(prerequisiteId)
      if (prerequisite === undefined || prerequisite.kind !== 'deliverable' || !isStandingItem(prerequisite)) {
        throw charterError('INVALID_CHANGE_SET', `deliverable ${item.id} has a dangling prerequisite ${prerequisiteId}`)
      }
    }
  }
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (item: DeliverableItem): void => {
    const current = state.get(item.id) ?? 0
    if (current === 1) throw charterError('INVALID_CHANGE_SET', 'deliverable dependency graph contains a cycle')
    if (current === 2) return
    state.set(item.id, 1)
    for (const id of item.requires ?? []) {
      const next = byId.get(id)
      if (next !== undefined && next.kind === 'deliverable') visit(next)
    }
    state.set(item.id, 2)
  }
  for (const item of standingDeliverables(items)) visit(item)
}

export function prerequisiteStatus(item: DeliverableItem, items: readonly CharterItem[]): PrerequisiteStatus {
  const byId = new Map(items.map(candidate => [candidate.id, candidate]))
  const prerequisites = (item.requires ?? []).map(id => byId.get(id))
  if (prerequisites.some(prerequisite => prerequisite?.kind === 'deliverable' && prerequisite.progress === 'cancelled')) {
    return 'dependency-conflict'
  }
  if (prerequisites.some(prerequisite => prerequisite?.kind === 'deliverable' && prerequisite.progress !== 'done')
    && (item.progress === 'in-progress' || item.progress === 'done')) {
    return 'dependency-conflict'
  }
  if (prerequisites.some(prerequisite => prerequisite?.kind !== 'deliverable' || prerequisite.progress !== 'done')) {
    return 'waiting'
  }
  return 'satisfied'
}

export function executionDisplay(item: DeliverableItem, items: readonly CharterItem[]): ExecutionDisplay {
  const status = prerequisiteStatus(item, items)
  if (item.progress === 'done' || item.progress === 'cancelled') return 'terminal'
  if (item.progress === 'blocked') return 'blocked'
  if (item.progress === 'in-progress') return 'in-progress'
  return status === 'satisfied' ? 'ready' : status
}

export function dependencyProjection(items: readonly CharterItem[]): readonly DependencyProjection[] {
  const ordered = topologicalDeliverables(items)
  const keyById = new Map(ordered.map((item, index) => [item.id, `D${index + 1}`]))
  return ordered.map(item => ({
    id: item.id,
    localKey: keyById.get(item.id)!,
    requires: [...(item.requires ?? [])].sort((left, right) =>
      (keyById.get(left) ?? left).localeCompare(keyById.get(right) ?? right)),
    requiresIds: [...(item.requires ?? [])],
    prerequisiteStatus: prerequisiteStatus(item, items),
    executionDisplay: executionDisplay(item, items),
  }))
}
