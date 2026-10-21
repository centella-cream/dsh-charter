import { charterError, CharterError } from './errors.js'
import { jsonBytes, type CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import { assertEditAuthorized } from './authorization.js'
import { applyOps } from './commands.js'
import { buildSnapshotUnchecked, emptySnapshot } from './render.js'
import { utf8Bytes } from './limits.js'
import { validateState } from './state.js'
import type {
  CharterActor,
  CharterEditRequest,
  CharterRecord,
  CharterReceipt,
  CharterSnapshot,
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
  const record: CharterRecord = {
    recordSchemaVersion: 1,
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
  void limits
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
  if (nextObjective !== undefined && utf8Bytes(nextObjective) > limits.maxObjectiveBytes) {
    const unchanged = previous?.objective?.current.text === nextObjective
    if (!unchanged) {
      throw charterError('QUOTA_EXCEEDED', `the objective exceeds ${limits.maxObjectiveBytes} UTF-8 bytes`)
    }
  }
  const previousItems = new Map(previous?.items.map(item => [item.id, item]))
  for (const item of next.items) {
    if (utf8Bytes(item.text) <= limits.maxItemBytes) continue
    const before = previousItems.get(item.id)
    if (before !== undefined && before.text === item.text) continue
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
  const applied = applyOps({
    snapshot: input.record.current,
    ops: input.request.ops,
    ids: input.ids,
    nextRevision: revision,
    limits: input.limits,
  })
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
  assertRecordAdmission(input.record, next, input.limits)
  assertRecordConsistency(next, input.limits)
  return next
}

export function isExpectedControlError(error: unknown): error is CharterError | MutationReplay | RevisionConflict {
  return error instanceof CharterError || error instanceof MutationReplay || error instanceof RevisionConflict
}
