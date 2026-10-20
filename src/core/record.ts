import { charterError, CharterError } from './errors.js'
import { jsonBytes, type CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import { applyOps } from './commands.js'
import { buildSnapshot, emptySnapshot } from './render.js'
import { validateState } from './state.js'
import type {
  CharterActor,
  CharterEditRequest,
  CharterRecord,
  CharterReceipt,
  MutationReceipt,
} from './schemas.js'

export interface CharterIdentity {
  readonly createdAt: number
  readonly cwd?: string | undefined
  readonly parentSession?: string | undefined
}

export interface CommitRecordInput {
  readonly record: CharterRecord
  readonly request: CharterEditRequest
  readonly requestDigest: `sha256:${string}`
  readonly ids: Readonly<Record<string, string>>
  readonly actor: CharterActor
  readonly at: number
  readonly limits: CharterLimits
}

export class MutationReplay extends Error {
  readonly receipt: MutationReceipt

  constructor(receipt: MutationReceipt) {
    super(`mutation ${receipt.mutationId} is already committed`)
    this.name = 'MutationReplay'
    this.receipt = receipt
  }
}

export class RevisionConflict extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super(`charter changed since revision ${currentRevision}`)
    this.name = 'RevisionConflict'
    this.currentRevision = currentRevision
  }
}

export function createEmptyRecord(identity: CharterIdentity, limits: CharterLimits): CharterRecord {
  return {
    recordSchemaVersion: 1,
    identity,
    current: emptySnapshot(limits),
    history: [],
    recentMutations: [],
  }
}

export function requestDigestOf(
  request: CharterEditRequest,
  identity: CharterIdentity,
  actor: CharterActor,
): `sha256:${string}` {
  return sha256Json({
    version: 1,
    sessionId: request.sessionId,
    sessionCreatedAt: identity.createdAt,
    actor,
    baseRevision: request.baseRevision,
    ops: request.ops,
  })
}

function assertSnapshotIntegrity(record: CharterRecord, limits: CharterLimits): void {
  validateState(record.current.revision, record.current.objective, record.current.items)
  const rebuilt = buildSnapshot(
    record.current.revision,
    record.current.objective,
    record.current.items,
    limits,
  )
  if (rebuilt.promptText !== record.current.promptText
    || rebuilt.promptDigest !== record.current.promptDigest
    || rebuilt.stateDigest !== record.current.stateDigest) {
    throw charterError('CORRUPT_STATE', 'stored charter snapshot does not match its deterministic projection')
  }
}

export function assertRecordConsistency(record: CharterRecord, limits: CharterLimits): void {
  assertSnapshotIntegrity(record, limits)
  const last = record.history.at(-1)
  if (record.current.revision === 0) {
    if (last !== undefined) {
      throw charterError('CORRUPT_STATE', 'revision 0 must not have history')
    }
  } else if (last === undefined
    || last.revision !== record.current.revision
    || last.resultDigest !== record.current.stateDigest) {
    throw charterError('CORRUPT_STATE', 'current snapshot and history tail disagree')
  }

  const historyMutationIds = new Set<string>()
  for (let index = 0; index < record.history.length; index += 1) {
    const receipt = record.history[index]!
    if (receipt.revision !== receipt.baseRevision + 1) {
      throw charterError('CORRUPT_STATE', `history revision ${receipt.revision} has an invalid baseRevision`)
    }
    if (index > 0) {
      const previous = record.history[index - 1]!
      if (receipt.baseRevision !== previous.revision || receipt.revision <= previous.revision) {
        throw charterError('CORRUPT_STATE', `history revisions are not a contiguous suffix at ${receipt.revision}`)
      }
    }
    if (historyMutationIds.has(receipt.mutationId)) {
      throw charterError('CORRUPT_STATE', `history contains duplicate mutation ${receipt.mutationId}`)
    }
    historyMutationIds.add(receipt.mutationId)
  }

  const mutations = new Map(record.recentMutations.map(receipt => [receipt.mutationId, receipt]))
  if (mutations.size !== record.recentMutations.length) {
    throw charterError('CORRUPT_STATE', 'recent mutation receipts contain duplicate mutation ids')
  }
  for (const receipt of record.recentMutations) {
    if (receipt.committedRevision < 1 || receipt.committedRevision > record.current.revision) {
      throw charterError('CORRUPT_STATE', `mutation ${receipt.mutationId} points outside the current revision`)
    }
    const ids = Object.values(receipt.ids)
    if (new Set(ids).size !== ids.length) {
      throw charterError('CORRUPT_STATE', `mutation ${receipt.mutationId} contains duplicate item ids`)
    }
  }
  if (record.current.revision === 0 && record.recentMutations.length > 0) {
    throw charterError('CORRUPT_STATE', 'revision 0 must not have mutation receipts')
  }
  for (const receipt of record.history) {
    const mutation = mutations.get(receipt.mutationId)
    if (mutation === undefined) continue
    if (mutation.requestDigest !== receipt.requestDigest
      || mutation.committedRevision !== receipt.revision
      || mutation.resultDigest !== receipt.resultDigest) {
      throw charterError('CORRUPT_STATE', `history and mutation receipt disagree for ${receipt.mutationId}`)
    }
  }
}

function trimHistory(
  history: readonly CharterReceipt[],
  limits: CharterLimits,
): CharterReceipt[] {
  const next = history.slice(-limits.historyLimit)
  while (next.length > 1 && jsonBytes(next) > limits.maxHistoryBytes) next.shift()
  if (jsonBytes(next) > limits.maxHistoryBytes) {
    throw charterError('QUOTA_EXCEEDED', 'the newest charter history receipt exceeds the history budget')
  }
  return next
}

export function commitRecord(input: CommitRecordInput): CharterRecord {
  assertRecordConsistency(input.record, input.limits)

  const existing = input.record.recentMutations.find(
    receipt => receipt.mutationId === input.request.mutationId,
  )
  if (existing !== undefined) {
    if (existing.requestDigest !== input.requestDigest) {
      throw charterError(
        'MUTATION_ID_REUSED',
        `mutationId ${input.request.mutationId} was reused with different content`,
      )
    }
    throw new MutationReplay(existing)
  }
  if (input.record.current.revision !== input.request.baseRevision) {
    throw new RevisionConflict(input.record.current.revision)
  }

  const revision = input.record.current.revision + 1
  const applied = applyOps({
    snapshot: input.record.current,
    ops: input.request.ops,
    ids: input.ids,
    nextRevision: revision,
    limits: input.limits,
  })
  const historyReceipt: CharterReceipt = {
    revision,
    baseRevision: input.record.current.revision,
    mutationId: input.request.mutationId,
    requestDigest: input.requestDigest,
    resultDigest: applied.snapshot.stateDigest,
    actor: input.actor,
    at: input.at,
    changes: [...applied.changes],
  }
  const mutationReceipt: MutationReceipt = {
    mutationId: input.request.mutationId,
    requestDigest: input.requestDigest,
    committedRevision: revision,
    resultDigest: applied.snapshot.stateDigest,
    ids: input.ids,
  }
  const next: CharterRecord = {
    ...input.record,
    current: applied.snapshot,
    history: trimHistory([...input.record.history, historyReceipt], input.limits),
    recentMutations: [...input.record.recentMutations, mutationReceipt]
      .slice(-input.limits.mutationLimit),
  }
  if (jsonBytes(next) > input.limits.maxRecordBytes) {
    throw charterError('QUOTA_EXCEEDED', `charter record exceeds ${input.limits.maxRecordBytes} UTF-8 bytes`)
  }
  assertRecordConsistency(next, input.limits)
  return next
}

export function isExpectedControlError(error: unknown): error is CharterError | MutationReplay | RevisionConflict {
  return error instanceof CharterError || error instanceof MutationReplay || error instanceof RevisionConflict
}
