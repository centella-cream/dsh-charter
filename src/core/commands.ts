import { charterError } from './errors.js'
import type {
  CharterChange,
  CharterItem,
  CharterObjective,
  CharterOp,
  CharterSnapshot,
  NewItemInput,
} from './schemas.js'
import { buildSnapshot } from './render.js'
import { validateState } from './state.js'
import type { CharterLimits } from './limits.js'

export interface ApplyOpsInput {
  readonly snapshot: CharterSnapshot
  readonly ops: readonly CharterOp[]
  readonly ids: Readonly<Record<string, string>>
  readonly nextRevision: number
  readonly limits: CharterLimits
  readonly origin?: 'user' | 'agent'
}

export interface ApplyOpsOutput {
  readonly snapshot: CharterSnapshot
  readonly changes: readonly CharterChange[]
}

function copyItem(item: CharterItem): CharterItem {
  return item.kind === 'invariant' ? { ...item } : { ...item, progress: item.progress }
}

function itemFromInput(
  input: NewItemInput,
  id: string,
  revision: number,
  origin: 'user' | 'agent',
  links?: { readonly supersedes?: string },
): CharterItem {
  const common = {
    id,
    text: input.text,
    review: origin === 'user' ? 'accepted' as const : 'pending' as const,
    lifecycle: 'current' as const,
    verification: { state: 'unchecked' as const },
    origin,
    order: input.order,
    createdRevision: revision,
    ...links?.supersedes === undefined ? {} : { supersedes: links.supersedes },
  }
  return input.kind === 'invariant'
    ? { kind: 'invariant', ...common }
    : { kind: 'deliverable', ...common, progress: input.progress }
}

function requireItem(items: Map<string, CharterItem>, id: string): CharterItem {
  const item = items.get(id)
  if (item === undefined) throw charterError('NOT_FOUND', `charter item ${id} does not exist`)
  return item
}

function requireMappedId(ids: Readonly<Record<string, string>>, clientRef: string): string {
  const id = ids[clientRef]
  if (id === undefined) {
    throw charterError('INVALID_REFERENCE', `no host id was minted for clientRef ${clientRef}`)
  }
  return id
}

function assertEditable(item: CharterItem): void {
  if (item.lifecycle !== 'current' || (item.review !== 'pending' && item.review !== 'accepted')) {
    throw charterError('INVALID_TRANSITION', `item ${item.id} cannot be edited in its current state`)
  }
}

function sameState(
  leftObjective: CharterObjective | undefined,
  leftItems: readonly CharterItem[],
  right: CharterSnapshot,
): boolean {
  return JSON.stringify({ objective: leftObjective ?? null, items: leftItems })
    === JSON.stringify({ objective: right.objective ?? null, items: right.items })
}

export function applyOps(input: ApplyOpsInput): ApplyOpsOutput {
  if (input.nextRevision !== input.snapshot.revision + 1) {
    throw charterError('INVALID_ARGUMENT', 'nextRevision must advance exactly once')
  }
  if (input.ops.length === 0 || input.ops.length > input.limits.maxOps) {
    throw charterError('QUOTA_EXCEEDED', `one edit must contain 1-${input.limits.maxOps} operations`)
  }

  let objective = input.snapshot.objective
  const items = new Map(input.snapshot.items.map(item => [item.id, copyItem(item)]))
  const changes: CharterChange[] = []
  const purgeIds = new Set(
    input.ops.filter((op): op is Extract<CharterOp, { type: 'item.purge' }> => op.type === 'item.purge')
      .map(op => op.itemId),
  )
  const nonPurgeTargets = new Set<string>()
  for (const op of input.ops) {
    if ('itemId' in op && op.type !== 'item.purge') nonPurgeTargets.add(op.itemId)
  }
  for (const id of purgeIds) {
    if (nonPurgeTargets.has(id)) {
      throw charterError('INVALID_ARGUMENT', `item ${id} cannot be purged and otherwise edited in one batch`)
    }
  }

  const origin = input.origin ?? 'user'
  for (const op of input.ops) {
    switch (op.type) {
      case 'objective.initialize': {
        if (objective !== undefined) {
          throw charterError('INVALID_TRANSITION', 'the original objective is already initialized')
        }
        objective = {
          original: { text: op.text, setAtRevision: input.nextRevision },
          current: { text: op.text, setAtRevision: input.nextRevision },
        }
        changes.push({ type: 'objective.initialized' })
        break
      }
      case 'objective.redirect': {
        if (objective === undefined) {
          throw charterError('INVALID_TRANSITION', 'the objective must be initialized before it can be redirected')
        }
        if (objective.current.text === op.text) {
          throw charterError('INVALID_TRANSITION', 'the redirected objective is unchanged')
        }
        objective = {
          original: objective.original,
          current: {
            text: op.text,
            setAtRevision: input.nextRevision,
            reason: op.reason,
          },
        }
        changes.push({ type: 'objective.redirected' })
        break
      }
      case 'item.add': {
        const id = requireMappedId(input.ids, op.item.clientRef)
        if (items.has(id)) throw charterError('INVALID_REFERENCE', `minted item id ${id} already exists`)
        items.set(id, itemFromInput(op.item, id, input.nextRevision, origin))
        changes.push({ type: 'item.added', itemId: id })
        break
      }
      case 'item.edit': {
        const item = requireItem(items, op.itemId)
        assertEditable(item)
        const nextText = op.text ?? item.text
        const nextOrder = op.order ?? item.order
        if (nextText === item.text && nextOrder === item.order) {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is unchanged`)
        }
        const fields: ('text' | 'order')[] = []
        if (nextText !== item.text) fields.push('text')
        if (nextOrder !== item.order) fields.push('order')
        items.set(item.id, {
          ...item,
          text: nextText,
          order: nextOrder,
          verification: nextText === item.text ? item.verification : { state: 'unchecked' },
        })
        changes.push({ type: 'item.edited', itemId: item.id, fields })
        break
      }
      case 'item.accept': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'pending' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not a pending proposal`)
        }
        items.set(item.id, { ...item, review: 'accepted' })
        changes.push({ type: 'item.accepted', itemId: item.id })
        break
      }
      case 'item.reject': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'pending' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not a pending proposal`)
        }
        items.set(item.id, { ...item, review: 'rejected', verification: { state: 'unchecked' } })
        changes.push({ type: 'item.rejected', itemId: item.id })
        break
      }
      case 'item.archive': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        items.set(item.id, { ...item, lifecycle: 'archived' })
        changes.push({ type: 'item.archived', itemId: item.id })
        break
      }
      case 'item.restore': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'archived') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an archived accepted item`)
        }
        items.set(item.id, { ...item, lifecycle: 'current' })
        changes.push({ type: 'item.restored', itemId: item.id })
        break
      }
      case 'item.supersede': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        if (item.kind !== op.replacement.kind) {
          throw charterError('INVALID_TRANSITION', 'a replacement must have the same item kind')
        }
        const replacementId = requireMappedId(input.ids, op.replacement.clientRef)
        if (items.has(replacementId)) {
          throw charterError('INVALID_REFERENCE', `minted item id ${replacementId} already exists`)
        }
        items.set(item.id, { ...item, lifecycle: 'superseded', supersededBy: replacementId })
        items.set(replacementId, itemFromInput(
          op.replacement,
          replacementId,
          input.nextRevision,
          origin,
          { supersedes: item.id },
        ))
        changes.push({ type: 'item.superseded', itemId: item.id, replacementId })
        break
      }
      case 'item.purge':
        break
      case 'deliverable.progress': {
        const item = requireItem(items, op.itemId)
        if (item.kind !== 'deliverable' || item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active deliverable`)
        }
        if (item.progress === op.progress) {
          throw charterError('INVALID_TRANSITION', `deliverable ${item.id} already has progress ${op.progress}`)
        }
        items.set(item.id, { ...item, progress: op.progress })
        changes.push({
          type: 'deliverable.progressed',
          itemId: item.id,
          from: item.progress,
          to: op.progress,
        })
        break
      }
      case 'item.verification.set': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        const verification = op.verification === 'verified'
          ? { state: 'verified' as const, by: 'user' as const }
          : { state: 'unchecked' as const }
        if (JSON.stringify(item.verification) === JSON.stringify(verification)) {
          throw charterError('INVALID_TRANSITION', `item ${item.id} verification is unchanged`)
        }
        items.set(item.id, { ...item, verification })
        changes.push({ type: 'item.verification.changed', itemId: item.id })
        break
      }
    }
  }

  for (const id of purgeIds) requireItem(items, id)
  for (const id of purgeIds) {
    const item = requireItem(items, id)
    if (item.supersedes !== undefined && !purgeIds.has(item.supersedes)) {
      throw charterError(
        'INVALID_TRANSITION',
        `cannot purge ${id} while its predecessor ${item.supersedes} still points to it`,
      )
    }
    if (item.supersededBy !== undefined && !purgeIds.has(item.supersededBy)) {
      const successor = requireItem(items, item.supersededBy)
      const { supersedes: _removed, ...detached } = successor
      items.set(successor.id, detached as CharterItem)
    }
  }
  for (const id of purgeIds) {
    items.delete(id)
    changes.push({ type: 'item.purged', itemId: id })
  }

  const nextItems = [...items.values()]
  validateState(input.nextRevision, objective, nextItems)
  if (sameState(objective, nextItems, input.snapshot)) {
    throw charterError('INVALID_TRANSITION', 'the edit produces no state change')
  }
  return {
    snapshot: buildSnapshot(input.nextRevision, objective, nextItems, input.limits),
    changes,
  }
}
