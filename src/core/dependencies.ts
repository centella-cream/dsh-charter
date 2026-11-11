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
    const proposed = item.kind === 'deliverable' ? item.proposedRequires ?? [] : []
    if (new Set(proposed).size !== proposed.length) {
      throw charterError('CORRUPT_STATE', `deliverable ${item.id} has duplicate proposed prerequisites`)
    }
    for (const prerequisiteId of proposed) {
      const prerequisite = byId.get(prerequisiteId)
      if (prerequisite === undefined || prerequisite.kind !== 'deliverable'
        || (!isStandingItem(prerequisite) && !(prerequisite.review === 'pending' && prerequisite.lifecycle === 'current'))) {
        throw charterError('INVALID_CHANGE_SET', `deliverable ${item.id} has a dangling proposed prerequisite ${prerequisiteId}`)
      }
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

/**
 * Prerequisite ids that make `item` conflict right now: a cancelled prerequisite,
 * or a prerequisite that is not `done` while the dependent already started.
 * Mirrors `prerequisiteStatus` rules 1–2, but returns the causes so a Change Set
 * can tell "new conflict" from "worsened conflict".
 */
export function conflictingPrerequisites(
  item: DeliverableItem,
  items: readonly CharterItem[],
): readonly string[] {
  const byId = new Map(items.map(candidate => [candidate.id, candidate]))
  const causes: string[] = []
  for (const id of item.requires ?? []) {
    const prerequisite = byId.get(id)
    if (prerequisite === undefined || prerequisite.kind !== 'deliverable') continue
    if (prerequisite.progress === 'cancelled') {
      causes.push(id)
      continue
    }
    if (prerequisite.progress !== 'done' && (item.progress === 'in-progress' || item.progress === 'done')) {
      causes.push(id)
    }
  }
  return causes
}

export interface DependencyConflictRef {
  readonly itemId: string
  /** `absent` when the item was not an active deliverable before this Change Set. */
  readonly before: PrerequisiteStatus | 'absent'
  readonly after: PrerequisiteStatus
  readonly beforeConflicts: number
  readonly afterConflicts: number
}

export interface DependencyConflictDiff {
  readonly added: readonly DependencyConflictRef[]
  readonly worsened: readonly DependencyConflictRef[]
}

/**
 * Design §6.5: a Change Set must prominently mark newly introduced or worsened
 * readiness conflicts and require explicit user confirmation. This is the shared
 * before/after comparison used by the planner (Host authority) and the Pane
 * (immediate feedback), so both sides cannot drift.
 *
 * Structural illegality (cycles, dangling or inactive endpoints) is *not* part of
 * this diff: `validateDependencyGraph` rejects those outright.
 */
export function dependencyConflictDiff(
  before: readonly CharterItem[],
  after: readonly CharterItem[],
): DependencyConflictDiff {
  const snapshot = (items: readonly CharterItem[]): Map<string, { status: PrerequisiteStatus; conflicts: number }> => {
    const out = new Map<string, { status: PrerequisiteStatus; conflicts: number }>()
    for (const item of standingDeliverables(items)) {
      out.set(item.id, {
        status: prerequisiteStatus(item, items),
        conflicts: conflictingPrerequisites(item, items).length,
      })
    }
    return out
  }
  const beforeState = snapshot(before)
  const afterState = snapshot(after)
  const added: DependencyConflictRef[] = []
  const worsened: DependencyConflictRef[] = []
  for (const [itemId, next] of afterState) {
    if (next.status !== 'dependency-conflict') continue
    const previous = beforeState.get(itemId)
    if (previous === undefined || previous.status !== 'dependency-conflict') {
      added.push({
        itemId,
        before: previous?.status ?? 'absent',
        after: next.status,
        beforeConflicts: previous?.conflicts ?? 0,
        afterConflicts: next.conflicts,
      })
      continue
    }
    if (next.conflicts > previous.conflicts) {
      worsened.push({
        itemId,
        before: previous.status,
        after: next.status,
        beforeConflicts: previous.conflicts,
        afterConflicts: next.conflicts,
      })
    }
  }
  // Deterministic order independent of Map iteration and of item ids' insertion order.
  const byItemId = (left: DependencyConflictRef, right: DependencyConflictRef): number =>
    left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0
  return { added: added.sort(byItemId), worsened: worsened.sort(byItemId) }
}
