import { charterError } from './errors.js'
import type {
  CharterChange,
  CharterItem,
  CharterOp,
  CharterSnapshot,
  NewItemInput,
  ObjectiveProposal,
} from './schemas.js'
import { buildSnapshotUnchecked } from './render.js'
import { validateState } from './state.js'
import { validateDependencyGraph } from './dependencies.js'
import type { CharterLimits } from './limits.js'
import { sha256Text } from './digest.js'

export interface ApplyOpsInput {
  readonly snapshot: CharterSnapshot
  readonly ops: readonly CharterOp[]
  readonly ids: Readonly<Record<string, string>>
  readonly nextRevision: number
  readonly limits: CharterLimits
  readonly origin?: 'user' | 'agent'
  readonly objectiveProposals?: readonly ObjectiveProposal[]
  readonly proposalBatchId?: string
  readonly activeProposalBatchId?: string
}

export interface ApplyOpsOutput {
  readonly snapshot: CharterSnapshot
  readonly changes: readonly CharterChange[]
  readonly objectiveProposals: readonly ObjectiveProposal[]
}

function copyItem(item: CharterItem): CharterItem {
  return item.kind === 'invariant' ? { ...item } : { ...item, progress: item.progress }
}

/** Core callers may pass an explicit origin; Host edits overwrite it from provenance. */
function itemFromInput(
  input: NewItemInput,
  id: string,
  revision: number,
  origin: 'user' | 'agent',
  links?: { readonly supersedes?: string; readonly proposalBatchId?: string },
): CharterItem {
  const common = {
    id,
    text: input.text,
    review: origin === 'user' ? 'accepted' as const : 'pending' as const,
    lifecycle: 'current' as const,
    verification: { state: 'unchecked' as const },
    validity: { state: 'unassessed' as const },
    origin: input.origin ?? origin,
    order: input.order,
    createdRevision: revision,
    ...links?.supersedes === undefined ? {} : { supersedes: links.supersedes },
    ...links?.proposalBatchId === undefined ? {} : { proposalBatchId: links.proposalBatchId },
    ...(input.contentModified === true ? { contentModified: true } : {}),
  }
  return input.kind === 'invariant'
    ? { kind: 'invariant', ...common }
    : {
        kind: 'deliverable',
        ...common,
        progress: input.progress,
        ...(input.requires === undefined ? {} : { requires: [...input.requires] }),
        ...(input.proposedRequires === undefined ? {} : { proposedRequires: [...input.proposedRequires] }),
      }
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

function resolveProposedRequires(
  item: NewItemInput,
  ids: Readonly<Record<string, string>>,
): NewItemInput {
  if (item.kind !== 'deliverable' || item.proposedRequires === undefined) return item
  return {
    ...item,
    proposedRequires: item.proposedRequires.map(id => ids[id] ?? id),
  }
}

function reorderAccepts(
  ops: readonly CharterOp[],
  items: ReadonlyMap<string, CharterItem>,
): CharterOp[] {
  const accepts = ops.filter((op): op is Extract<CharterOp, { type: 'item.accept' }> => op.type === 'item.accept')
  if (accepts.length < 2) return [...ops]
  const acceptIds = new Set(accepts.map(op => op.itemId))
  const dependencies = new Map<string, string[]>()
  for (const op of accepts) {
    const item = items.get(op.itemId)
    dependencies.set(op.itemId, (item?.proposedRequires ?? []).filter(id => acceptIds.has(id)))
  }
  const ordered: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw charterError('INVALID_CHANGE_SET', 'proposed prerequisite acceptance contains a cycle')
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
    ordered.push(id)
  }
  for (const op of accepts) visit(op.itemId)
  const byId = new Map(ordered.map((id, index) => [id, index]))
  const sorted = [...accepts].sort((left, right) => byId.get(left.itemId)! - byId.get(right.itemId)!)
  let cursor = 0
  return ops.map(op => op.type === 'item.accept' ? sorted[cursor++]! : op)
}

export function applyOps(input: ApplyOpsInput): ApplyOpsOutput {
  if (input.nextRevision !== input.snapshot.revision + 1) {
    throw charterError('INVALID_ARGUMENT', 'nextRevision must advance exactly once')
  }
  if (input.ops.length === 0 || input.ops.length > input.limits.maxOps) {
    throw charterError('QUOTA_EXCEEDED', `one edit must contain 1-${input.limits.maxOps} operations`)
  }

  let objective = input.snapshot.objective
  const objectiveProposals = new Map((input.objectiveProposals ?? []).map(proposal => [proposal.id, { ...proposal }]))
  const items = new Map(input.snapshot.items.map(item => [item.id, copyItem(item)]))
  const ops = reorderAccepts(input.ops, items)
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

  const acceptedObjectiveProposals = input.ops.filter(op => op.type === 'objective.accept')
  if (acceptedObjectiveProposals.length > 1) {
    throw charterError('INVALID_ARGUMENT', 'one Change Set may accept at most one objective proposal')
  }
  if (acceptedObjectiveProposals.length > 0 && input.ops.some(op =>
    op.type === 'objective.initialize' || op.type === 'objective.redirect')) {
    throw charterError('INVALID_ARGUMENT', 'an accepted objective proposal cannot be combined with a direct objective edit')
  }

  const origin = input.origin ?? 'user'
  for (const op of ops) {
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
            ...(op.reason === undefined ? {} : { reason: op.reason }),
          },
        }
        changes.push({ type: 'objective.redirected' })
        break
      }
      case 'objective.propose': {
        const id = requireMappedId(input.ids, op.clientRef)
        if (objectiveProposals.has(id)) throw charterError('INVALID_REFERENCE', `minted proposal id ${id} already exists`)
        objectiveProposals.set(id, {
          id,
          text: op.text,
          origin,
          review: 'pending',
          createdRevision: input.nextRevision,
        })
        changes.push({ type: 'objective.proposed', proposalId: id })
        break
      }
      case 'objective.accept': {
        const proposal = objectiveProposals.get(op.proposalId)
        if (proposal === undefined) throw charterError('NOT_FOUND', `objective proposal ${op.proposalId} does not exist`)
        if (proposal.review !== 'pending') {
          throw charterError('INVALID_TRANSITION', `objective proposal ${proposal.id} is not pending`)
        }
        if (objective === undefined) {
          objective = {
            original: { text: proposal.text, setAtRevision: input.nextRevision },
            current: { text: proposal.text, setAtRevision: input.nextRevision },
          }
          changes.push({ type: 'objective.initialized' })
        } else {
          if (op.reason === undefined) {
            throw charterError('INVALID_TRANSITION', 'accepting an objective proposal over an existing objective requires a reason')
          }
          if (objective.current.text === proposal.text) {
            throw charterError('INVALID_TRANSITION', 'the accepted objective proposal is unchanged')
          }
          objective = {
            original: objective.original,
            current: {
              text: proposal.text,
              setAtRevision: input.nextRevision,
              reason: op.reason,
            },
          }
          changes.push({ type: 'objective.redirected' })
        }
        objectiveProposals.set(proposal.id, {
          ...proposal,
          text: '',
          review: 'accepted',
          reviewedAtRevision: input.nextRevision,
          appliedRevision: input.nextRevision,
          textDigest: sha256Text(proposal.text),
        })
        changes.push({ type: 'objective.accepted', proposalId: proposal.id })
        break
      }
      case 'objective.reject': {
        const proposal = objectiveProposals.get(op.proposalId)
        if (proposal === undefined) throw charterError('NOT_FOUND', `objective proposal ${op.proposalId} does not exist`)
        if (proposal.review !== 'pending') {
          throw charterError('INVALID_TRANSITION', `objective proposal ${proposal.id} is not pending`)
        }
        objectiveProposals.set(proposal.id, {
          ...proposal,
          review: 'rejected',
          reviewedAtRevision: input.nextRevision,
        })
        changes.push({ type: 'objective.rejected', proposalId: proposal.id })
        break
      }
      case 'objective.purge': {
        const proposal = objectiveProposals.get(op.proposalId)
        if (proposal === undefined) throw charterError('NOT_FOUND', `objective proposal ${op.proposalId} does not exist`)
        if (proposal.review === 'pending') {
          throw charterError('INVALID_TRANSITION', 'a pending objective proposal must be rejected before purge')
        }
        objectiveProposals.set(proposal.id, {
          ...proposal,
          text: '',
          review: 'purged',
          reviewedAtRevision: input.nextRevision,
          textDigest: proposal.textDigest ?? sha256Text(proposal.text),
        })
        changes.push({ type: 'objective.purged', proposalId: proposal.id })
        break
      }
      case 'item.add': {
        const id = requireMappedId(input.ids, op.item.clientRef)
        if (items.has(id)) throw charterError('INVALID_REFERENCE', `minted item id ${id} already exists`)
        items.set(id, itemFromInput(resolveProposedRequires(op.item, input.ids), id, input.nextRevision, origin, {
          ...(input.activeProposalBatchId === undefined ? {} : { proposalBatchId: input.activeProposalBatchId }),
        }))
        changes.push({ type: 'item.added', itemId: id })
        break
      }
      case 'item.propose': {
        const id = requireMappedId(input.ids, op.item.clientRef)
        if (items.has(id)) throw charterError('INVALID_REFERENCE', `minted item id ${id} already exists`)
        // A proposal is always pending, even when a user imported it from history.
        items.set(id, itemFromInput(resolveProposedRequires(op.item, input.ids), id, input.nextRevision, 'agent', {
          ...(input.proposalBatchId === undefined ? {} : { proposalBatchId: input.proposalBatchId }),
        }))
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
          ...(nextText !== item.text && item.validity !== undefined
            && item.validity.state !== 'unassessed' && item.validity.state !== 'stale'
            ? { validity: { state: 'stale' as const, previous: item.validity.state, atRevision: input.nextRevision } }
            : {}),
        })
        changes.push({ type: 'item.edited', itemId: item.id, fields })
        break
      }
      case 'item.accept': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'pending' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not a pending proposal`)
        }
        const { proposedRequires: proposed, ...accepted } = item
        if (proposed !== undefined && proposed.length > 0) {
          if (item.kind !== 'deliverable') {
            throw charterError('INVALID_TRANSITION', `item ${item.id} cannot carry proposed prerequisites`)
          }
          for (const prerequisiteId of proposed) {
            const prerequisite = items.get(prerequisiteId)
            if (prerequisite === undefined || prerequisite.kind !== 'deliverable'
              || prerequisite.review !== 'accepted' || prerequisite.lifecycle !== 'current') {
              throw charterError('INVALID_CHANGE_SET', `item ${item.id} has an unresolved proposed prerequisite ${prerequisiteId}`)
            }
          }
          items.set(item.id, {
            ...(accepted as Extract<CharterItem, { kind: 'deliverable' }>),
            requires: [...proposed].sort(),
            review: 'accepted',
            reviewedAtRevision: input.nextRevision,
          })
        } else {
          items.set(item.id, { ...accepted, review: 'accepted', reviewedAtRevision: input.nextRevision })
        }
        changes.push({ type: 'item.accepted', itemId: item.id })
        break
      }
      case 'item.reject': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'pending' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not a pending proposal`)
        }
        items.set(item.id, {
          ...item,
          review: 'rejected',
          reviewedAtRevision: input.nextRevision,
          verification: { state: 'unchecked' },
          validity: { state: 'unassessed' },
        })
        changes.push({ type: 'item.rejected', itemId: item.id })
        break
      }
      case 'item.archive': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        if (item.supersedes !== undefined) {
          throw charterError(
            'INVALID_TRANSITION',
            `item ${item.id} is a replacement; purge its superseded predecessor before archiving it`,
          )
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
        if (item.supersedes !== undefined) {
          throw charterError(
            'INVALID_TRANSITION',
            `item ${item.id} is a replacement; purge its predecessor before replacing it again`,
          )
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
          resolveProposedRequires(op.replacement, input.ids),
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
      case 'deliverable.requires': {
        const item = requireItem(items, op.itemId)
        if (item.kind !== 'deliverable' || item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active deliverable`)
        }
        if (new Set(op.requires).size !== op.requires.length) {
          throw charterError('INVALID_ARGUMENT', `deliverable ${item.id} has duplicate prerequisites`)
        }
        const requires = [...op.requires].sort()
        if (JSON.stringify(item.requires ?? []) === JSON.stringify(requires)) {
          throw charterError('INVALID_TRANSITION', `deliverable ${item.id} dependencies are unchanged`)
        }
        items.set(item.id, { ...item, requires })
        changes.push({ type: 'deliverable.requires.changed', itemId: item.id, requires })
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
        items.set(item.id, {
          ...item,
          verification,
          validity: op.verification === 'verified'
            ? { state: 'attested', atRevision: input.nextRevision }
            : { state: 'unassessed' },
        })
        changes.push({ type: 'item.verification.changed', itemId: item.id })
        break
      }
      case 'item.validity.set': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        items.set(item.id, {
          ...item,
          validity: op.validity,
          ...(op.evidence === undefined ? {} : { evidence: [...op.evidence] }),
        })
        changes.push({ type: 'item.validity.changed', itemId: item.id, state: op.validity.state })
        break
      }
      case 'item.attest': {
        const item = requireItem(items, op.itemId)
        if (item.review !== 'accepted' || item.lifecycle !== 'current') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is not an active accepted item`)
        }
        if (item.validity?.state === 'attested') {
          throw charterError('INVALID_TRANSITION', `item ${item.id} is already attested`)
        }
        items.set(item.id, { ...item, validity: { state: 'attested', atRevision: input.nextRevision } })
        changes.push({ type: 'item.attested', itemId: item.id })
        break
      }
    }
  }

  for (const id of purgeIds) requireItem(items, id)
  for (const id of purgeIds) {
    const item = requireItem(items, id)
    if (item.lifecycle !== 'archived'
      && item.lifecycle !== 'superseded'
      && item.review !== 'rejected') {
      throw charterError('INVALID_TRANSITION', `item ${id} is not purgeable in its current lifecycle`)
    }
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
  validateDependencyGraph(nextItems)
  validateState(input.nextRevision, objective, nextItems)
  const snapshot = buildSnapshotUnchecked(input.nextRevision, objective, nextItems)
  const nextProposals = [...objectiveProposals.values()]
  const proposalsChanged = JSON.stringify(nextProposals)
    !== JSON.stringify(input.objectiveProposals ?? [])
  if (snapshot.stateDigest === input.snapshot.stateDigest && !proposalsChanged) {
    throw charterError('INVALID_TRANSITION', 'the edit produces no state change')
  }
  return { snapshot, changes, objectiveProposals: nextProposals }
}
