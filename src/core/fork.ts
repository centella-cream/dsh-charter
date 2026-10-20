import { charterError } from './errors.js'
import type { CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import { buildSnapshot } from './render.js'
import { assertRecordConsistency, createEmptyRecord, type CharterIdentity } from './record.js'
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
    const base = {
      ...item,
      id: remap(item.id),
      origin: 'fork' as const,
      order,
      createdRevision: 1,
      ...(item.supersedes === undefined ? {} : { supersedes: remap(item.supersedes) }),
      ...(item.supersededBy === undefined ? {} : { supersededBy: remap(item.supersededBy) }),
    }
    return item.kind === 'invariant'
      ? { ...base, kind: 'invariant' }
      : { ...base, kind: 'deliverable', progress: item.progress }
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
  const current = buildSnapshot(1, objective, items, input.limits)
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
  const child: CharterRecord = {
    ...empty,
    forkedFrom: {
      sessionId: input.parentSessionId,
      revision: input.parent.current.revision,
    },
    current,
    history: [history],
    recentMutations: [mutation],
  }
  assertRecordConsistency(child, input.limits)
  return child
}
