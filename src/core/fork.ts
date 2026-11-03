import { charterError } from './errors.js'
import type { CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import { buildSnapshotUnchecked } from './render.js'
import { assertRecordAdmission, assertRecordConsistency, assertSnapshotAdmission, createEmptyRecord, type CharterIdentity } from './record.js'
import type { CharterItem, CharterRecord, CharterReceipt, MutationReceipt } from './schemas.js'
import { compareItems } from './state.js'

export interface ForkRecordInput {
  readonly parentSessionId: string
  readonly parent: CharterRecord
  readonly childIdentity: CharterIdentity
  readonly ids: Readonly<Record<string, string>>
  readonly mutationId: string
  readonly at: number
  readonly limits: CharterLimits
}

export function forkRecord(input: ForkRecordInput): CharterRecord {
  assertRecordConsistency(input.parent, input.limits)
  const empty = createEmptyRecord(input.childIdentity, input.limits)
  const ordered = [...input.parent.current.items].sort(compareItems)
  if (ordered.some(item => input.ids[item.id] === undefined)) {
    throw charterError('INVALID_REFERENCE', 'fork is missing one or more child item ids')
  }
  const remap = (id: string): string => {
    const mapped = input.ids[id]
    if (mapped === undefined) throw charterError('INVALID_REFERENCE', `fork has no child id for ${id}`)
    return mapped
  }
  const items: CharterItem[] = ordered.map((item, order) => {
    const { proposalBatchId: _parentBatch, reviewedAtRevision: _parentReview, ...inherited } = item
    const base = {
      ...inherited,
      id: remap(item.id),
      origin: 'fork' as const,
      order,
      createdRevision: 1,
      ...(item.supersedes === undefined ? {} : { supersedes: remap(item.supersedes) }),
      ...(item.supersededBy === undefined ? {} : { supersededBy: remap(item.supersededBy) }),
    }
    return item.kind === 'invariant'
      ? { ...base, kind: 'invariant' }
      : {
          ...base,
          kind: 'deliverable',
          progress: item.progress,
          ...(item.requires === undefined ? {} : { requires: item.requires.map(remap) }),
        }
  })
  const objective = input.parent.current.objective === undefined
    ? undefined
    : {
        original: {
          text: input.parent.current.objective.original.text,
          setAtRevision: 1,
        },
        current: {
          text: input.parent.current.objective.current.text,
          setAtRevision: 1,
          ...(input.parent.current.objective.current.reason === undefined
            ? {}
            : { reason: input.parent.current.objective.current.reason }),
        },
      }
  const current = buildSnapshotUnchecked(1, objective, items)
  if (current.promptText !== input.parent.current.promptText
    || current.promptDigest !== input.parent.current.promptDigest) {
    throw charterError('CORRUPT_STATE', 'fork changed the model-visible charter')
  }
  const requestDigest = sha256Json({
    version: 1,
    kind: 'fork',
    parentSessionId: input.parentSessionId,
    parentRevision: input.parent.current.revision,
    childCreatedAt: input.childIdentity.createdAt,
  })
  const history: CharterReceipt = {
    revision: 1,
    baseRevision: 0,
    mutationId: input.mutationId,
    requestDigest,
    resultDigest: current.stateDigest,
    actor: { kind: 'host' },
    at: input.at,
    changes: [{ type: 'forked' }],
  }
  const mutation: MutationReceipt = {
    mutationId: input.mutationId,
    requestDigest,
    committedRevision: 1,
    resultDigest: current.stateDigest,
    ids: {},
  }
  assertSnapshotAdmission(input.parent.current, current, input.limits)
  const objectiveIdByParent = new Map<string, string>()
  const objectiveProposals = (input.parent.objectiveProposals ?? []).map(proposal => {
    const id = `fork-${proposal.id}`.slice(0, 128)
    objectiveIdByParent.set(proposal.id, id)
    return proposal.review === 'accepted'
      ? {
          ...proposal,
          id,
          text: '',
          origin: 'fork' as const,
          createdRevision: 1,
          reviewedAtRevision: 1,
          appliedRevision: 1,
        }
      : proposal.review === 'pending'
        ? {
            ...proposal,
            id,
            origin: 'fork' as const,
            createdRevision: 1,
          }
        : {
            ...proposal,
            id,
            origin: 'fork' as const,
            createdRevision: 1,
            reviewedAtRevision: 1,
          }
  })
  const inheritedBatches: import('./schemas.js').ProposalBatch[] = []
  for (const batch of input.parent.proposalBatches ?? []) {
    const candidates: { kind: 'item' | 'objective'; id: string }[] = []
    for (const candidate of batch.candidates) {
      if (candidate.kind === 'item' && input.ids[candidate.id] !== undefined) {
        candidates.push({ kind: 'item', id: remap(candidate.id) })
      } else if (candidate.kind === 'objective') {
        const id = objectiveIdByParent.get(candidate.id)
        if (id !== undefined) candidates.push({ kind: 'objective', id })
      }
    }
    if (candidates.length === 0) continue
    inheritedBatches.push({
      id: `fork-${batch.id}`.slice(0, 128),
      source: { kind: 'fork', parentBatchId: batch.id, at: input.at },
      capturedAtRevision: 1,
      candidates,
    })
  }
  const forkBatchIdByParent = new Map<string, string>()
  for (const batch of inheritedBatches) {
    if (batch.source.kind === 'fork') forkBatchIdByParent.set(batch.source.parentBatchId, batch.id)
  }
  const finalItems = items.map((item, index) => {
    const parent = ordered[index]!
    const childBatchId = parent.proposalBatchId === undefined
      ? undefined
      : forkBatchIdByParent.get(parent.proposalBatchId)
    return {
      ...item,
      ...(childBatchId === undefined ? {} : { proposalBatchId: childBatchId }),
      ...(parent.reviewedAtRevision === undefined ? {} : { reviewedAtRevision: 1 }),
    } as CharterItem
  })
  const finalCurrent = buildSnapshotUnchecked(1, objective, finalItems)
  if (finalCurrent.promptText !== input.parent.current.promptText
    || finalCurrent.promptDigest !== input.parent.current.promptDigest) {
    throw charterError('CORRUPT_STATE', 'fork changed the model-visible charter')
  }
  const finalHistory = { ...history, resultDigest: finalCurrent.stateDigest }
  const finalMutation = { ...mutation, resultDigest: finalCurrent.stateDigest }
  const child: CharterRecord = {
    ...empty,
    forkedFrom: {
      sessionId: input.parentSessionId,
      revision: input.parent.current.revision,
    },
    current: finalCurrent,
    history: [finalHistory],
    recentMutations: [finalMutation],
    ...(inheritedBatches.length === 0 ? {} : { proposalBatches: inheritedBatches }),
    ...(objectiveProposals.length === 0 ? {} : { objectiveProposals: [...objectiveProposals] }),
  }
  assertRecordAdmission(input.parent, child, input.limits)
  assertRecordConsistency(child, input.limits)
  return child
}
