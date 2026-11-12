import type { DependencyConflictDiff } from '../core/dependencies.js'
import type { CharterOp } from '../core/schemas.js'

export type ChangeSetOpCategory = 'objective' | 'item' | 'lifecycle' | 'proposal' | 'verification'

export interface ChangeSetConflictRow {
  readonly key: string
  readonly text: string
  readonly kind: 'added' | 'worsened'
  readonly before: number
  readonly after: number
}

export interface ChangeSetConflictContext {
  readonly dependencyPlan: readonly { readonly id: string; readonly localKey: string }[]
  readonly projectedItems: readonly { readonly id: string; readonly text: string }[]
}

function clip(text: string, max: number): string {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`
}

export function opCategory(op: CharterOp): ChangeSetOpCategory {
  if (op.type.startsWith('objective.')) return 'objective'
  if (op.type === 'item.verification.set' || op.type === 'item.validity.set' || op.type === 'item.attest') {
    return 'verification'
  }
  if (op.type === 'item.accept' || op.type === 'item.reject' || op.type === 'item.archive'
    || op.type === 'item.restore' || op.type === 'item.purge') {
    return 'lifecycle'
  }
  if (op.type === 'item.propose' || op.type === 'item.supersede') return 'proposal'
  return 'item'
}

export function opText(op: CharterOp): string | null {
  switch (op.type) {
    case 'objective.initialize':
    case 'objective.redirect':
    case 'objective.propose':
      return op.text
    case 'item.add':
    case 'item.propose':
      return op.item.text
    case 'item.edit':
      return op.text ?? null
    case 'item.supersede':
      return op.replacement.text
    case 'deliverable.progress':
      return op.progress
    default:
      return null
  }
}

/** Whether the Pane can map this op back to a single draft target. */
export function opCanBeUnstaged(op: CharterOp): boolean {
  return op.type.startsWith('objective.')
    || 'itemId' in op
    || op.type === 'item.add'
    || op.type === 'item.propose'
}

export function buildChangeSetConflicts(
  diff: DependencyConflictDiff,
  context: ChangeSetConflictContext,
): readonly ChangeSetConflictRow[] {
  const row = (entry: { itemId: string; beforeConflicts: number; afterConflicts: number }, kind: 'added' | 'worsened'): ChangeSetConflictRow => ({
    key: context.dependencyPlan.find(item => item.id === entry.itemId)?.localKey ?? entry.itemId,
    text: clip(context.projectedItems.find(item => item.id === entry.itemId)?.text ?? entry.itemId, 40),
    kind,
    before: entry.beforeConflicts,
    after: entry.afterConflicts,
  })
  return [
    ...diff.added.map(entry => row(entry, 'added')),
    ...diff.worsened.map(entry => row(entry, 'worsened')),
  ]
}

export interface ChangeSetDiffContext {
  readonly objectiveBefore: string | null
  readonly objectiveAfter: string | null
  readonly itemsBefore: readonly { readonly id: string; readonly text: string }[]
  readonly projectedItems: readonly { readonly id: string; readonly text: string }[]
}

export interface ChangeSetDiffLabel {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
}

export interface ChangeSetOpDiff {
  readonly before: string | null
  readonly after: string | null
  /** Localized label for states/Progress; the Pane renders it via t(). */
  readonly afterLabel?: ChangeSetDiffLabel
}

/** Per-op before→after labels for the rail; null means "not applicable". */
export function opDiff(op: CharterOp, context: ChangeSetDiffContext): ChangeSetOpDiff {
  const beforeItem = 'itemId' in op
    ? context.itemsBefore.find(item => item.id === op.itemId) ?? null
    : null
  const afterItem = 'itemId' in op
    ? context.projectedItems.find(item => item.id === op.itemId) ?? null
    : null
  switch (op.type) {
    case 'objective.initialize':
    case 'objective.redirect':
    case 'objective.propose':
      return { before: context.objectiveBefore, after: op.text }
    case 'item.add':
    case 'item.propose':
      return { before: null, after: op.item.text }
    case 'item.edit':
      return { before: beforeItem?.text ?? null, after: op.text ?? afterItem?.text ?? null }
    case 'item.supersede':
      return { before: beforeItem?.text ?? null, after: op.replacement.text }
    case 'item.accept':
    case 'item.reject':
    case 'item.archive':
    case 'item.restore':
    case 'item.purge': {
      const state = {
        accept: 'accepted',
        reject: 'rejected',
        archive: 'archived',
        restore: 'restored',
        purge: 'purged',
      }[op.type.split('.')[1] as 'accept' | 'reject' | 'archive' | 'restore' | 'purge']
      return {
        before: beforeItem?.text ?? null,
        after: null,
        afterLabel: { key: `changeset.state.${state}` },
      }
    }
    case 'item.verification.set':
      return {
        before: beforeItem?.text ?? null,
        after: null,
        afterLabel: { key: op.verification === 'verified' ? 'changeset.state.verified' : 'changeset.state.unchecked' },
      }
    case 'item.validity.set':
      return {
        before: beforeItem?.text ?? null,
        after: null,
        afterLabel: { key: `validity.${op.validity.state}` },
      }
    case 'item.attest':
      return { before: beforeItem?.text ?? null, after: null, afterLabel: { key: 'changeset.state.attested' } }
    case 'deliverable.progress':
      return {
        before: beforeItem?.text ?? null,
        after: null,
        afterLabel: { key: `progress.${op.progress}` },
      }
    case 'deliverable.requires':
      return {
        before: beforeItem?.text ?? null,
        after: null,
        afterLabel: { key: 'changeset.prerequisites', params: { count: op.requires.length } },
      }
    default:
      return { before: null, after: null }
  }
}

export interface ChangeSetOpGroup {
  readonly category: ChangeSetOpCategory
  readonly ops: readonly CharterOp[]
}

const CATEGORY_ORDER: readonly ChangeSetOpCategory[] = ['objective', 'item', 'lifecycle', 'proposal', 'verification']

/** Stable grouping for the rail: category order is fixed, op order is draft order. */
export function groupChangeSetOps(ops: readonly CharterOp[]): readonly ChangeSetOpGroup[] {
  const buckets = new Map<ChangeSetOpCategory, CharterOp[]>()
  for (const op of ops) {
    const category = opCategory(op)
    const bucket = buckets.get(category) ?? []
    bucket.push(op)
    buckets.set(category, bucket)
  }
  return CATEGORY_ORDER.filter(category => buckets.has(category)).map(category => ({
    category,
    ops: buckets.get(category) ?? [],
  }))
}
