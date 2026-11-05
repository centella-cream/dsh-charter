import { charterError, CharterError } from './errors.js'
import { jsonBytes, type CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import { assertEditAuthorized } from './authorization.js'
import { applyOps } from './commands.js'
import { buildSnapshotUnchecked, emptySnapshot } from './render.js'
import { utf8Bytes } from './limits.js'
import { validateState } from './state.js'
import { maintenanceSemanticCheck } from './archive.js'
import type {
  CharterActor,
  CharterRecordV1,
  CharterEditRequest,
  CharterMaintenanceReceipt,
  CharterRecord,
  CharterReceipt,
  CharterSnapshot,
  MaintenanceKind,
  MutationReceipt,
  ProposalBatch,
  ProposalSource,
} from './schemas.js'

export interface CharterIdentity {
  readonly createdAt: number
  readonly cwd?: string | undefined
  readonly parentSession?: string | undefined
}

export const MAX_PROPOSAL_BATCHES = 64

export interface CommitRecordInput {
  readonly record: CharterRecord
  readonly request: CharterEditRequest
  readonly requestDigest: `sha256:${string}`
  readonly ids: Readonly<Record<string, string>>
  readonly actor: CharterActor
  readonly at: number
  readonly limits: CharterLimits
  readonly proposalSource?: ProposalSource
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

function migratedSnapshot(snapshot: CharterRecordV1['current']): CharterRecord['current'] {
  return {
    ...snapshot,
    items: snapshot.items.map(item => {
      const verification = item.verification
      const validity = verification.state === 'unchecked'
        ? { state: 'unassessed' as const }
        : verification.state === 'verified' && verification.by === 'user'
          ? { state: 'attested' as const, atRevision: Math.max(1, snapshot.revision) }
          : verification.state === 'verified'
            ? {
                state: 'valid' as const,
                validator: 'legacy-validator',
                inputDigest: sha256Json({ version: 1, legacy: true, text: item.text }),
                checkedAtRevision: Math.max(1, snapshot.revision),
              }
            : {
                state: verification.state === 'failed' ? 'invalid' as const : 'unknown' as const,
                validator: 'legacy-validator',
                inputDigest: sha256Json({ version: 1, legacy: true, text: item.text }),
                checkedAtRevision: Math.max(1, snapshot.revision),
                ...(verification.reason === undefined ? {} : { reason: verification.reason }),
              }
      return { ...item, validity }
    }),
  }
}

/** Read-only v1 projection to the v2 in-memory shape; no bytes are written here. */
export function migrateRecordV1ToV2(record: CharterRecordV1): CharterRecord {
  const current = migratedSnapshot(record.current)
  const pending = current.items.filter(item => item.review === 'pending')
  const proposalBatches: ProposalBatch[] = pending.length === 0
    ? []
    : [{
        id: `legacy-${record.identity.createdAt}-${record.current.revision}`,
        source: { kind: 'legacy-unknown' },
        capturedAtRevision: Math.max(1, record.current.revision),
        candidates: pending.map(item => ({ kind: 'item', id: item.id })),
      }]
  return {
    ...record,
    recordSchemaVersion: 2,
    current,
    ...(proposalBatches.length === 0 ? {} : { proposalBatches }),
  }
}

export function createEmptyRecord(identity: CharterIdentity, limits: CharterLimits): CharterRecord {
  const record: CharterRecord = {
    recordSchemaVersion: 2,
    identity,
    current: emptySnapshot(limits),
    history: [],
    recentMutations: [],
  }
  assertSnapshotAdmission(undefined, record.current, limits)
  assertRecordAdmission(undefined, record, limits)
  return record
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

/** Digest of the deterministic revision-0 empty state (initialize receipts bind it). */
export function emptyStateDigest(limits: CharterLimits): `sha256:${string}` {
  return emptySnapshot(limits).stateDigest as `sha256:${string}`
}

/**
 * The maintenance request digest binds operation kind, Session, lifecycle,
 * actor, expected target and archive digest, excluding the operation id itself.
 */
export function maintenanceRequestDigestOf(input: {
  readonly kind: MaintenanceKind
  readonly sessionId: string
  readonly lifecycle: string
  readonly actor: CharterActor
  readonly expectedTarget: unknown
  readonly sourceRecordDigest?: `sha256:${string}` | undefined
}): `sha256:${string}` {
  return sha256Json({
    version: 1,
    domain: 'dsh_charter_v1',
    kind: input.kind,
    sessionId: input.sessionId,
    lifecycle: input.lifecycle,
    actor: input.actor,
    expectedTarget: input.expectedTarget,
    sourceRecordDigest: input.sourceRecordDigest ?? null,
  })
}

/** The current operation always survives: keep at most maintenanceLimit - 1 old receipts. */
export function appendMaintenanceReceipt(
  record: CharterRecord,
  receipt: CharterMaintenanceReceipt,
  limits: CharterLimits,
): CharterRecord {
  const previous = record.recentMaintenance ?? []
  const keep = Math.max(0, limits.maintenanceLimit - 1)
  const trimmed = keep === 0 ? [] : previous.slice(-keep)
  return {
    ...record,
    recentMaintenance: [...trimmed, receipt],
  }
}

function assertProposalConsistency(record: CharterRecord, maxBatches = MAX_PROPOSAL_BATCHES): void {
  const objectiveProposalIds = new Set<string>()
  for (const proposal of record.objectiveProposals ?? []) {
    if (objectiveProposalIds.has(proposal.id)) {
      throw charterError('CORRUPT_STATE', `duplicate objective proposal ${proposal.id}`)
    }
    objectiveProposalIds.add(proposal.id)
    if (proposal.createdRevision > record.current.revision) {
      throw charterError('CORRUPT_STATE', `objective proposal ${proposal.id} has a future creation revision`)
    }
    for (const revision of [proposal.reviewedAtRevision, proposal.appliedRevision]) {
      if (revision !== undefined && (revision < 1 || revision > record.current.revision)) {
        throw charterError('CORRUPT_STATE', `objective proposal ${proposal.id} points outside the current revision`)
      }
    }
    if (proposal.review === 'accepted'
      && (proposal.textDigest === undefined || proposal.appliedRevision === undefined || proposal.text !== '')) {
      throw charterError('CORRUPT_STATE', `accepted objective proposal ${proposal.id} is not applied metadata`)
    }
    if (proposal.review === 'purged' && (proposal.text !== '' || proposal.textDigest === undefined)) {
      throw charterError('CORRUPT_STATE', `purged objective proposal ${proposal.id} is not a tombstone`)
    }
  }
  const batches = record.proposalBatches ?? []
  const batchIds = new Set<string>()
  const itemIds = new Set(record.current.items.map(item => item.id))
  if (batches.length > maxBatches) {
    throw charterError('LIMIT_EXCEEDED', `charter exceeds ${maxBatches} proposal batches`)
  }
  for (const batch of batches) {
    if (batchIds.has(batch.id)) {
      throw charterError('CORRUPT_STATE', `duplicate proposal batch ${batch.id}`)
    }
    batchIds.add(batch.id)
    if (batch.capturedAtRevision > record.current.revision) {
      throw charterError('CORRUPT_STATE', `proposal batch ${batch.id} points past the current revision`)
    }
    const candidateKeys = new Set<string>()
    for (const candidate of batch.candidates) {
      const candidateKey = `${candidate.kind}:${candidate.id}`
      if (candidateKeys.has(candidateKey)) {
        throw charterError('CORRUPT_STATE', `proposal batch ${batch.id} has duplicate candidate ${candidate.id}`)
      }
      candidateKeys.add(candidateKey)
      if (candidate.kind === 'tombstone') {
        if (candidate.atRevision > record.current.revision) {
          throw charterError('CORRUPT_STATE', `proposal tombstone ${candidate.id} points past the current revision`)
        }
        continue
      }
      if (candidate.kind === 'item' && !itemIds.has(candidate.id)) {
        throw charterError('CORRUPT_STATE', `proposal batch ${batch.id} references missing item ${candidate.id}`)
      }
      if (candidate.kind === 'objective'
        && !(record.objectiveProposals ?? []).some(proposal => proposal.id === candidate.id)) {
        throw charterError('CORRUPT_STATE', `proposal batch ${batch.id} references missing objective proposal ${candidate.id}`)
      }
    }
  }
  for (const item of record.current.items) {
    if (item.reviewedAtRevision !== undefined && item.reviewedAtRevision > record.current.revision) {
      throw charterError('CORRUPT_STATE', `item ${item.id} reviewed revision points past the current revision`)
    }
    if (item.proposalBatchId === undefined) continue
    const batch = batches.find(candidate => candidate.id === item.proposalBatchId)
    if (batch === undefined) {
      throw charterError('CORRUPT_STATE', `item ${item.id} references missing proposal batch ${item.proposalBatchId}`)
    }
    if (!batch.candidates.some(candidate => candidate.kind !== 'tombstone'
      && candidate.kind === 'item' && candidate.id === item.id)) {
      throw charterError('CORRUPT_STATE', `item ${item.id} is not a candidate of proposal batch ${item.proposalBatchId}`)
    }
  }

}

/** Final serialized record must fit the recovery envelope budget. */
export function assertRecoveryRecordAdmission(record: CharterRecord, limits: CharterLimits): void {
  const bytes = jsonBytes(record)
  if (bytes > limits.maxRecoveryBytes) {
    throw charterError('QUOTA_EXCEEDED', `restored record exceeds ${limits.maxRecoveryBytes} UTF-8 bytes`)
  }
  assertProposalConsistency(record, limits.maxProposalBatches)
  const maintenance = record.recentMaintenance ?? []
  if (maintenance.length > limits.maintenanceLimit) {
    throw charterError('QUOTA_EXCEEDED', `maintenance receipts exceed ${limits.maintenanceLimit}`)
  }
}

/** A restored record keeps archived content and appends only the maintenance receipt. */
export function restoredRecord(
  archived: CharterRecord,
  receipt: CharterMaintenanceReceipt,
  limits: CharterLimits,
): CharterRecord {
  const next = appendMaintenanceReceipt(archived, receipt, limits)
  assertRecoveryRecordAdmission(next, limits)
  return next
}

/** Records are immutable snapshots replaced by the single writer. */
const validatedRecords = new WeakSet<CharterRecord>()

function assertSnapshotIntegrity(record: CharterRecord): void {
  validateState(record.current.revision, record.current.objective, record.current.items)
  const rebuilt = buildSnapshotUnchecked(
    record.current.revision,
    record.current.objective,
    record.current.items,
  )
  if (rebuilt.promptText !== record.current.promptText
    || rebuilt.promptDigest !== record.current.promptDigest
    || rebuilt.stateDigest !== record.current.stateDigest) {
    throw charterError('CORRUPT_STATE', 'stored charter snapshot does not match its deterministic projection')
  }
}

/**
 * Validate record structure once per immutable record object.
 *
 * Quotas are deliberately excluded: they are admission policy for the next
 * write, not an invariant of the stored data. `limits` stays in the signature
 * for callers and future structure checks.
 */
export function assertRecordConsistency(record: CharterRecord, limits: CharterLimits): void {
  const limitsForConsistency = limits
  if (validatedRecords.has(record)) return
  assertSnapshotIntegrity(record)
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
  const maintenance = record.recentMaintenance ?? []
  const maintenanceIds = new Set<string>()
  for (const receipt of maintenance) {
    if (maintenanceIds.has(receipt.operationId)) {
      throw charterError('CORRUPT_STATE', `duplicate maintenance operation ${receipt.operationId}`)
    }
    maintenanceIds.add(receipt.operationId)
    if (receipt.resultRevision > record.current.revision) {
      throw charterError('CORRUPT_STATE', `maintenance ${receipt.operationId} points past the current revision`)
    }
    maintenanceSemanticCheck(receipt, emptyStateDigest(limitsForConsistency))
    const currentOrHistory = receipt.resultRevision === record.current.revision
      ? record.current.stateDigest
      : record.history.find(entry => entry.revision === receipt.resultRevision)?.resultDigest
    if (currentOrHistory !== undefined && currentOrHistory !== receipt.resultStateDigest) {
      throw charterError('CORRUPT_STATE', `maintenance ${receipt.operationId} digest disagrees with history`)
    }
  }
  assertProposalConsistency(record, limitsForConsistency.maxProposalBatches)
  validatedRecords.add(record)
}

/**
 * Whether a value may stay over its configured limit because the edit did not
 * make it worse. This lets a charter created under a larger budget converge by
 * removing content instead of becoming permanently uneditable.
 */
function overLimitGrowth(next: number, previous: number | undefined, limit: number): boolean {
  if (next <= limit) return false
  return previous === undefined || next > previous
}

function snapshotOverBudget(snapshot: CharterSnapshot, limits: CharterLimits): boolean {
  return snapshot.items.length > limits.maxItems
    || snapshot.items.filter(item => item.review === 'pending').length > limits.maxPendingItems
    || (snapshot.objective !== undefined
      && utf8Bytes(snapshot.objective.current.text) > limits.maxObjectiveBytes)
    || snapshot.items.some(item => utf8Bytes(item.text) > limits.maxItemBytes)
    || utf8Bytes(snapshot.promptText) > limits.maxPromptBytes
}

/** Admission policy for one new snapshot relative to the previous one. */
export function assertSnapshotAdmission(
  previous: CharterSnapshot | undefined,
  next: CharterSnapshot,
  limits: CharterLimits,
): void {
  const pending = (snapshot: CharterSnapshot): number =>
    snapshot.items.filter(item => item.review === 'pending').length
  if (overLimitGrowth(next.items.length, previous?.items.length, limits.maxItems)) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxItems} items`)
  }
  if (overLimitGrowth(pending(next), previous === undefined ? undefined : pending(previous), limits.maxPendingItems)) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${limits.maxPendingItems} pending items`)
  }
  const nextObjective = next.objective?.current.text
  if (nextObjective !== undefined) {
    const nextObjectiveBytes = utf8Bytes(nextObjective)
    const previousObjective = previous?.objective?.current.text
    if (nextObjectiveBytes > limits.maxObjectiveBytes) {
      const unchanged = previousObjective === nextObjective
      const shrunk = previousObjective !== undefined
        && nextObjectiveBytes < utf8Bytes(previousObjective)
      if (!unchanged && !shrunk) {
        throw charterError('QUOTA_EXCEEDED', `the objective exceeds ${limits.maxObjectiveBytes} UTF-8 bytes`)
      }
    }
  }
  const previousItems = new Map(previous?.items.map(item => [item.id, item]))
  for (const item of next.items) {
    const nextItemBytes = utf8Bytes(item.text)
    if (nextItemBytes <= limits.maxItemBytes) continue
    const before = previousItems.get(item.id)
    if (before !== undefined && (before.text === item.text || nextItemBytes < utf8Bytes(before.text))) continue
    throw charterError('QUOTA_EXCEEDED', `an item exceeds ${limits.maxItemBytes} UTF-8 bytes`)
  }
  if (overLimitGrowth(
    utf8Bytes(next.promptText),
    previous === undefined ? undefined : utf8Bytes(previous.promptText),
    limits.maxPromptBytes,
  )) {
    throw charterError('QUOTA_EXCEEDED', `charter prompt exceeds ${limits.maxPromptBytes} UTF-8 bytes`)
  }
}

/** Admission policy for one new record relative to the previous one. */
export function assertRecordAdmission(
  previous: CharterRecord | undefined,
  next: CharterRecord,
  limits: CharterLimits,
): void {
  if (overLimitGrowth(
    jsonBytes(next),
    previous === undefined ? undefined : jsonBytes(previous),
    limits.maxRecordBytes,
  )) {
    throw charterError('QUOTA_EXCEEDED', `charter record exceeds ${limits.maxRecordBytes} UTF-8 bytes`)
  }
  if (overLimitGrowth(
    jsonBytes(next.history),
    previous === undefined ? undefined : jsonBytes(previous.history),
    limits.maxHistoryBytes,
  )) {
    throw charterError('QUOTA_EXCEEDED', `charter history exceeds ${limits.maxHistoryBytes} UTF-8 bytes`)
  }
  if (next.history.length > limits.historyLimit
    && (previous === undefined || next.history.length > previous.history.length)) {
    throw charterError('QUOTA_EXCEEDED', `charter history exceeds ${limits.historyLimit} receipts`)
  }
  if (next.recentMutations.length > limits.mutationLimit
    && (previous === undefined || next.recentMutations.length > previous.recentMutations.length)) {
    throw charterError('QUOTA_EXCEEDED', `charter mutations exceed ${limits.mutationLimit} receipts`)
  }
}

/** Read-only policy state: the record is structurally valid but over budget. */
export function isRecordOverBudget(record: CharterRecord, limits: CharterLimits): boolean {
  return snapshotOverBudget(record.current, limits)
    || jsonBytes(record) > limits.maxRecordBytes
    || jsonBytes(record.history) > limits.maxHistoryBytes
    || record.history.length > limits.historyLimit
    || record.recentMutations.length > limits.mutationLimit
}

function trimHistory(
  history: readonly CharterReceipt[],
  limits: CharterLimits,
): CharterReceipt[] {
  const next = history.slice(-limits.historyLimit)
  while (next.length > 1 && jsonBytes(next) > limits.maxHistoryBytes) next.shift()
  return next
}

export function commitRecord(input: CommitRecordInput): CharterRecord {
  assertRecordConsistency(input.record, input.limits)
  assertEditAuthorized(input.actor, input.request.ops)

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
  const proposedCandidates: { kind: 'item' | 'objective'; id: string }[] = []
  for (const op of input.request.ops) {
    if (op.type === 'item.propose') {
      const id = input.ids[op.item.clientRef]
      if (id !== undefined) proposedCandidates.push({ kind: 'item', id })
    } else if (op.type === 'objective.propose') {
      const id = input.ids[op.clientRef]
      if (id !== undefined) proposedCandidates.push({ kind: 'objective', id })
    }
  }
  const proposalBatchId = proposedCandidates.length === 0
    ? undefined
    : `batch-${revision}-${input.requestDigest.slice(7, 23)}`
  const applied = applyOps({
    snapshot: input.record.current,
    ops: input.request.ops,
    ids: input.ids,
    nextRevision: revision,
    limits: input.limits,
    ...(input.record.objectiveProposals === undefined ? {} : { objectiveProposals: input.record.objectiveProposals }),
    ...(proposalBatchId === undefined ? {} : { proposalBatchId }),
  })
  const pendingProposalCount = applied.snapshot.items.filter(item => item.review === 'pending').length
    + applied.objectiveProposals.filter(proposal => proposal.review === 'pending').length
  if (pendingProposalCount > input.limits.maxPendingItems) {
    throw charterError('QUOTA_EXCEEDED', `charter exceeds ${input.limits.maxPendingItems} pending proposals`)
  }
  assertSnapshotAdmission(input.record.current, applied.snapshot, input.limits)
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
  const proposalBatch: ProposalBatch | undefined = proposalBatchId === undefined ? undefined : {
    id: proposalBatchId,
    source: input.proposalSource ?? (input.actor.kind === 'host'
      ? { kind: 'legacy-unknown' }
      : input.actor.kind === 'agent-tool'
        ? { kind: 'agent-tool', toolCallId: input.actor.id ?? 'agent-tool', at: input.at }
        : { kind: 'manual', actor: input.actor.kind, at: input.at }),
    capturedAtRevision: revision,
    candidates: proposedCandidates as ProposalBatch['candidates'],
  }
  const mutationReceipt: MutationReceipt = {
    mutationId: input.request.mutationId,
    requestDigest: input.requestDigest,
    committedRevision: revision,
    resultDigest: applied.snapshot.stateDigest,
    ids: input.ids,
  }
  const purgedItemIds = new Set(input.request.ops
    .filter((op): op is Extract<typeof op, { type: 'item.purge' }> => op.type === 'item.purge')
    .map(op => op.itemId))
  const purgedObjectiveIds = new Set(input.request.ops
    .filter((op): op is Extract<typeof op, { type: 'objective.purge' }> => op.type === 'objective.purge')
    .map(op => op.proposalId))
  const batches = [...(input.record.proposalBatches ?? []), ...(proposalBatch === undefined ? [] : [proposalBatch])]
    .map(batch => ({
      ...batch,
      candidates: batch.candidates.map(candidate => {
        if (candidate.kind === 'tombstone') return candidate
        const purged = candidate.kind === 'item'
          ? purgedItemIds.has(candidate.id)
          : purgedObjectiveIds.has(candidate.id)
        return purged
          ? {
              kind: 'tombstone' as const,
              candidateKind: candidate.kind,
              id: candidate.id,
              disposition: 'purged' as const,
              atRevision: revision,
            }
          : candidate
      }),
    }))
  const maxBatches = input.limits.maxProposalBatches ?? MAX_PROPOSAL_BATCHES
  if (batches.length > maxBatches) {
    throw charterError('LIMIT_EXCEEDED', `charter exceeds ${maxBatches} proposal batches`)
  }
  const next: CharterRecord = {
    ...input.record,
    current: applied.snapshot,
    ...(applied.objectiveProposals.length === 0 ? {} : { objectiveProposals: [...applied.objectiveProposals] }),
    history: trimHistory([...input.record.history, historyReceipt], input.limits),
    recentMutations: [...input.record.recentMutations, mutationReceipt]
      .slice(-input.limits.mutationLimit),
    ...(batches.length === 0 ? {} : { proposalBatches: batches }),
  }
  assertRecordAdmission(input.record, next, input.limits)
  assertRecordConsistency(next, input.limits)
  return next
}

export function isExpectedControlError(error: unknown): error is CharterError | MutationReplay | RevisionConflict {
  return error instanceof CharterError || error instanceof MutationReplay || error instanceof RevisionConflict
}
