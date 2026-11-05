import { z } from 'zod'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  charterEditRequestSchema,
  charterBootstrapApplyRequestSchema,
  charterInitializeRequestSchema,
  charterItemSchema,
  charterChangeSchema,
  charterActorSchema,
  charterObjectiveSchema,
  charterRecordArchiveSchema,
  charterRestoreRequestSchema,
} from '../core/schemas.js'
import type {
  CharterEditRequest,
  CharterBootstrapApplyRequest,
  CharterInitializeRequest,
  CharterRestoreRequest,
} from '../core/schemas.js'
import type {
  CharterBootstrapResult,
  CharterEditResult,
  CharterRecordExport,
  CharterRecordOperationResult,
  CharterRecordState,
  CharterView,
  CharterViewCapabilities,
  CharterSummary,
  CharterItemQueryRequest,
  CharterItemQueryResult,
  CharterProposalQueryRequest,
  CharterProposalQueryResult,
  CharterChangeQueryRequest,
  CharterChangeQueryResult,
  CharterChangeSetPreviewResult,
  CharterValidatorRequest,
  CharterValidatorRunResult,
  CharterSourceIntegrityResult,
  CharterMessageListResult,
} from '../host/types.js'

const charterErrorCodeSchema = z.enum([
  'INVALID_ARGUMENT',
  'FORBIDDEN',
  'NOT_FOUND',
  'LIFECYCLE_MISMATCH',
  'REVISION_CONFLICT',
  'PREVIEW_MISMATCH',
  'MUTATION_ID_REUSED',
  'INVALID_REFERENCE',
  'INVALID_TRANSITION',
  'IMMUTABLE_FIELD',
  'QUOTA_EXCEEDED',
  'CORRUPT_STATE',
  'UNAVAILABLE',
  'INITIALIZATION_REQUIRED',
  'INVALID_ARCHIVE',
  'RECORD_CONFLICT',
  'OPERATION_ID_REUSED',
  'RECOVERY_UNSUPPORTED',
])

export const charterRecordStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('healthy'), recordDigest: z.string() }).strict(),
  z.object({
    kind: z.literal('absent-unconfirmed'),
    source: z.enum(['resume', 'clear', 'compact', 'reattach', 'unknown']),
  }).strict(),
  z.object({
    kind: z.literal('invalid'),
    reason: z.enum(['schema', 'consistency', 'future-schema']),
    recordDigest: z.string(),
    observedRevision: z.number().int().nonnegative().optional(),
    recoverable: z.boolean(),
  }).strict().superRefine((value, ctx) => {
    if (value.reason === 'future-schema' && value.recoverable !== false) {
      ctx.addIssue({ code: 'custom', message: 'future-schema records are never recoverable' })
    }
  }),
  z.object({ kind: z.literal('lifecycle-mismatch'), recordDigest: z.string() }).strict(),
  z.object({
    kind: z.literal('unknown'),
    reason: z.enum(['initializing', 'storage-unavailable', 'legacy-host']),
  }).strict(),
  z.object({
    kind: z.literal('write-uncertain'),
    operation: z.enum(['startup', 'edit', 'initialize', 'restore']),
    lastKnownRecordDigest: z.string().optional(),
  }).strict(),
])

export const charterViewCapabilitiesSchema = z.object({
  recordMaintenance: z.boolean(),
  recordMaintenanceReason: z.enum(['runtime', 'record-limit', 'legacy-host']).optional(),
}).strict()

const LEGACY_HOST_RECORD_STATE = { kind: 'unknown' as const, reason: 'legacy-host' as const }
const LEGACY_HOST_CAPABILITIES = { recordMaintenance: false, recordMaintenanceReason: 'legacy-host' as const }

export const charterViewSchema = z.object({
  status: z.enum(['ready', 'initializing', 'unavailable']),
  sessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  objective: charterObjectiveSchema.nullable(),
  items: z.array(charterItemSchema),
  promptText: z.string(),
  promptDigest: z.string(),
  limits: z.object({
    maxPromptBytes: z.number().int().positive(),
    maxObjectiveBytes: z.number().int().positive(),
    maxItemBytes: z.number().int().positive(),
    // Defaults keep a newly built client readable when the Host process is
    // still running the previous bundle. The maxActive* fields are accepted
    // for that same version-skew window and are not used by new clients.
    maxItems: z.number().int().positive().default(512),
    // Host config allows 0 to disable proposals entirely, so wire validation
    // must accept it as well (maxItems stays at least 1).
    maxPendingItems: z.number().int().nonnegative().default(512),
    maxOps: z.number().int().positive(),
    // Added with the record-admission model; defaults keep a new client
    // readable while an older Host process is still running.
    maxRecordBytes: z.number().int().positive().default(1_048_576),
    maintenanceLimit: z.number().int().positive().default(16),
    maxRecoveryBytes: z.number().int().positive().default(4_194_304),
    maxActiveInvariants: z.number().int().positive().optional(),
    maxActiveDeliverables: z.number().int().positive().optional(),
  }).strict(),
  /** The stored record is valid but exceeds the current budget configuration. */
  overBudget: z.boolean().default(false),
  /** Optional Session lifecycle fingerprint for client draft binding. */
  lifecycle: z.string().optional(),
  message: z.string().optional(),
  // Added with rc.3 record recovery; defaults keep an old Host frame readable
  // (legacy-host: maintenance disabled, absence treated as unknown).
  recordState: charterRecordStateSchema.default(LEGACY_HOST_RECORD_STATE),
  capabilities: charterViewCapabilitiesSchema.default(LEGACY_HOST_CAPABILITIES),
  objectiveProposals: z.array(z.object({
    id: z.string(),
    text: z.string(),
    origin: z.enum(['user', 'agent', 'fork']),
    review: z.enum(['pending', 'accepted', 'rejected', 'purged']),
    createdRevision: z.number().int().positive(),
    reviewedAtRevision: z.number().int().positive().optional(),
    appliedRevision: z.number().int().positive().optional(),
    textDigest: z.string().optional(),
  }).strict()).optional(),
  proposalBatches: z.array(z.object({
    id: z.string(),
    source: z.object({ kind: z.string(), actor: z.string().optional(), at: z.number().optional() }).passthrough(),
    capturedAtRevision: z.number().int().positive(),
    candidates: z.array(z.object({ kind: z.string(), id: z.string() }).strict()),
  }).passthrough()).optional(),
}).strict()

export const charterSummarySchema = z.object({
  sessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  objective: charterObjectiveSchema.nullable(),
  limits: z.object({
    maxPromptBytes: z.number().int().positive(),
    maxObjectiveBytes: z.number().int().positive(),
    maxItemBytes: z.number().int().positive(),
    maxItems: z.number().int().positive(),
    maxPendingItems: z.number().int().nonnegative(),
    maxOps: z.number().int().positive(),
    maxRecordBytes: z.number().int().positive(),
    maintenanceLimit: z.number().int().positive(),
    maxRecoveryBytes: z.number().int().positive(),
    maxActiveInvariants: z.number().int().positive(),
    maxActiveDeliverables: z.number().int().positive(),
  }).passthrough(),
  promptText: z.string(),
  promptDigest: z.string(),
  hasObjective: z.boolean(),
  lifecycle: z.string().optional(),
  recordState: charterRecordStateSchema.optional(),
  message: z.string().optional(),
  activeItems: z.number().int().nonnegative(),
  pendingItems: z.number().int().nonnegative(),
  historyItems: z.number().int().nonnegative(),
  pendingBatches: z.number().int().nonnegative(),
  promptBytes: z.number().int().nonnegative(),
  overBudget: z.boolean(),
  status: z.enum(['ready', 'initializing', 'unavailable']),
  recordHealth: z.enum(['healthy', 'invalid', 'absent', 'unknown', 'write-uncertain']),
  capabilities: charterViewCapabilitiesSchema,
}).strict()

export const charterSummaryFrameSchema = z.union([
  z.object({ type: z.literal('snapshot'), value: charterSummarySchema }).strict(),
  z.object({ type: z.literal('changed'), value: charterSummarySchema }).strict(),
])

export const charterChangeQueryRequestSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  changeSetId: z.string().optional(),
  operationKind: z.string().optional(),
  itemId: z.string().optional(),
  proposalId: z.string().optional(),
}).strict()

export const charterChangeQueryResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    revision: z.number().int().nonnegative(),
    changes: z.array(z.object({
      mutationId: z.string(),
      revision: z.number().int().positive(),
      baseRevision: z.number().int().nonnegative(),
      actor: charterActorSchema,
      at: z.number().int().nonnegative(),
      changes: z.array(charterChangeSchema),
    }).strict()),
    nextCursor: z.string().optional(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: z.enum(['INVALID_CURSOR', 'LIMIT_EXCEEDED', 'NOT_FOUND', 'UNAVAILABLE']),
    message: z.string(),
  }).strict(),
])

export const charterItemQueryRequestSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['invariant', 'deliverable']).optional(),
  review: z.enum(['pending', 'accepted', 'rejected']).optional(),
  lifecycle: z.enum(['current', 'superseded', 'archived']).optional(),
  search: z.string().optional(),
  sourceKind: z.enum(['manual', 'message', 'compaction-summary', 'agent-tool', 'fork', 'legacy-unknown']).optional(),
  batchId: z.string().optional(),
  verification: z.enum(['unchecked', 'verified', 'failed', 'unavailable']).optional(),
  execution: z.enum(['ready', 'waiting', 'dependency-conflict', 'in-progress', 'blocked', 'terminal']).optional(),
  prerequisite: z.enum(['satisfied', 'waiting', 'dependency-conflict']).optional(),
  validity: z.enum(['unassessed', 'attested', 'valid', 'invalid', 'unknown', 'stale']).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict()

const itemQueryFailureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(['STALE_REVISION', 'INVALID_CURSOR', 'LIMIT_EXCEEDED', 'NOT_FOUND', 'UNAVAILABLE']),
  message: z.string(),
  revision: z.number().int().nonnegative().optional(),
}).strict()

export const charterItemQueryResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    revision: z.number().int().nonnegative(),
    items: z.array(charterItemSchema),
    nextCursor: z.string().optional(),
    filterDigest: z.string(),
  }).strict(),
  itemQueryFailureSchema,
])

export const charterProposalQueryRequestSchema = z.object({
  limit: z.number().int().positive().max(64).optional(),
  cursor: z.string().optional(),
  sourceKind: z.enum(['manual', 'message', 'compaction-summary', 'agent-tool', 'fork', 'legacy-unknown']).optional(),
  review: z.enum(['pending', 'accepted', 'rejected']).optional(),
  batchId: z.string().optional(),
  candidateKind: z.enum(['item', 'objective']).optional(),
  objectiveCursor: z.string().optional(),
}).strict()

export const charterProposalQueryResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    revision: z.number().int().nonnegative(),
    batches: z.array(z.object({
      id: z.string(),
      source: z.object({ kind: z.string() }).passthrough(),
      sourceIntegrity: z.enum(['not-applicable', 'intact', 'unknown', 'unavailable']),
      capturedAtRevision: z.number().int().positive(),
      candidates: z.array(z.object({
        kind: z.enum(['item', 'objective', 'tombstone']),
        id: z.string(),
        text: z.string().optional(),
        review: z.enum(['pending', 'accepted', 'rejected', 'purged']).optional(),
        candidateKind: z.enum(['item', 'objective']).optional(),
        disposition: z.enum(['accepted', 'rejected', 'purged']).optional(),
        atRevision: z.number().int().positive().optional(),
      }).strict()),
    }).strict()),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: z.enum(['NOT_FOUND', 'UNAVAILABLE']),
    message: z.string(),
  }).strict(),
])

export const charterMessageListSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    messages: z.array(z.object({
      seq: z.number().int().nonnegative(),
      role: z.literal('user'),
      excerpt: z.string(),
      length: z.number().int().nonnegative(),
    }).strict()),
  }).strict(),
  z.object({ ok: z.literal(false), code: charterErrorCodeSchema, message: z.string() }).strict(),
])

export const charterMessageProposeRequestSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative().optional(),
  kind: z.enum(['invariant', 'deliverable']).optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
}).strict()

export const charterSourceIntegrityResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    revision: z.number().int().nonnegative(),
    items: z.array(z.object({
      itemId: z.string(),
      integrity: z.enum(['intact', 'changed', 'unavailable', 'not-applicable']),
    }).strict()),
    batches: z.array(z.object({
      batchId: z.string(),
      integrity: z.enum(['not-applicable', 'intact', 'missing', 'mismatch', 'unsupported']),
    }).strict()),
  }).strict(),
  z.object({ ok: z.literal(false), code: charterErrorCodeSchema, message: z.string() }).strict(),
])

export const charterValidatorRunRequestSchema = z.object({
  sessionId: z.string().min(1),
  requests: z.array(z.object({
    itemId: z.string().min(1),
    validator: z.object({
      kind: z.enum(['workspace.path-exists', 'workspace.file-digest', 'workspace.file-contains']),
      path: z.string().min(1),
      expectedDigest: z.string().optional(),
      contains: z.string().optional(),
    }).strict(),
  }).strict()).min(1).max(32),
}).strict()

export const charterValidatorRunResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    revision: z.number().int().nonnegative(),
    results: z.array(z.unknown()),
  }).strict(),
  z.object({ ok: z.literal(false), code: charterErrorCodeSchema, message: z.string() }).strict(),
])

export const charterChangeSetPreviewResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    previewDigest: z.string(),
    before: z.object({ revision: z.number(), promptBytes: z.number(), items: z.number(), pendingItems: z.number() }).strict(),
    after: z.object({ revision: z.number(), promptBytes: z.number(), items: z.number(), pendingItems: z.number() }).strict(),
    changes: z.array(charterChangeSchema),
    promptChanged: z.boolean(),
    metadataOnly: z.boolean(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: charterErrorCodeSchema,
    message: z.string(),
  }).strict(),
])

export const charterEditResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    replayed: z.boolean(),
    committedRevision: z.number().int().positive(),
    ids: z.record(z.string(), z.string()),
    view: charterViewSchema,
    changeSet: z.object({
      summaryDigest: z.string(),
      promptChanged: z.boolean(),
      metadataOnly: z.boolean(),
      before: z.object({ revision: z.number(), promptBytes: z.number(), items: z.number(), pendingItems: z.number() }).strict(),
      after: z.object({ revision: z.number(), promptBytes: z.number(), items: z.number(), pendingItems: z.number() }).strict(),
    }).strict().optional(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: charterErrorCodeSchema,
    message: z.string(),
    currentRevision: z.number().int().nonnegative().optional(),
    view: charterViewSchema.optional(),
  }).strict(),
])

export const charterRecordOperationResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    replayed: z.boolean(),
    committedRevision: z.number().int().nonnegative(),
    view: z.lazy(() => charterViewSchema),
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: charterErrorCodeSchema,
    message: z.string(),
    view: z.lazy(() => charterViewSchema).optional(),
  }).strict(),
])

export const charterRecordExportSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    filename: z.string().min(1),
    archive: charterRecordArchiveSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    code: charterErrorCodeSchema,
    message: z.string(),
  }).strict(),
])

export const charterInitializeRequestWireSchema = charterInitializeRequestSchema
export const charterRestoreRequestWireSchema = charterRestoreRequestSchema

export const charterBootstrapProposalSchema = z.object({
  draftHandle: z.string().optional(),
  objective: z.string().nullable(),
  invariants: z.array(z.string()),
  deliverables: z.array(z.string()),
  source: z.object({
    summarySeq: z.number().int().nonnegative(),
    at: z.number().int().nonnegative(),
    shadowedTokens: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict()

export const charterBootstrapResultSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    proposal: charterBootstrapProposalSchema,
  }).strict(),
  z.object({
    available: z.literal(false),
    reason: z.enum(['not-live', 'no-summary', 'unavailable']),
    message: z.string().optional(),
  }).strict(),
])

export const charterFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), value: charterViewSchema }).strict(),
  z.object({ type: z.literal('changed'), value: charterViewSchema }).strict(),
])

// The wire schema validates/defaults the payload; the TypeScript frame type
// stays the Host's `CharterView` so Host-side frame producers and the client
// share one contract.
export type CharterFrame =
  | { readonly type: 'snapshot'; readonly value: CharterView }
  | { readonly type: 'changed'; readonly value: CharterView }
export type CharterSummaryFrame =
  | { readonly type: 'snapshot'; readonly value: CharterSummary }
  | { readonly type: 'changed'; readonly value: CharterSummary }

export type CharterSnapshotFrame = Extract<CharterFrame, { type: 'snapshot' }>
export type CharterChangedFrame = Extract<CharterFrame, { type: 'changed' }>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'charter/watch': (
      sessionId: SessionId,
      signal?: AbortSignal,
    ) => RemoteStreamHandle<CharterFrame, never>
    'charter/watchSummary': (
      sessionId: SessionId,
      signal?: AbortSignal,
    ) => RemoteStreamHandle<CharterSummaryFrame, never>
    'charter/queryItems': (
      request: CharterItemQueryRequest & { readonly sessionId: SessionId },
    ) => Promise<RemoteResult<CharterItemQueryResult>>
    'charter/queryProposals': (
      sessionId: SessionId,
      options?: CharterProposalQueryRequest,
    ) => Promise<RemoteResult<CharterProposalQueryResult>>
    'charter/queryChanges': (
      request: CharterChangeQueryRequest & { readonly sessionId: SessionId },
    ) => Promise<RemoteResult<CharterChangeQueryResult>>
    'charter/sourceIntegrity': (sessionId: SessionId) => Promise<RemoteResult<CharterSourceIntegrityResult>>
    'charter/runValidators': (
      request: { readonly sessionId: SessionId; readonly requests: readonly CharterValidatorRequest[] },
    ) => Promise<RemoteResult<CharterValidatorRunResult>>
    'charter/queryMessages': (
      sessionId: SessionId,
    ) => Promise<RemoteResult<CharterMessageListResult>>
    'charter/proposeMessage': (
      request: import('../host/types.js').CharterMessageProposalOptions & { readonly sessionId: SessionId },
    ) => Promise<RemoteResult<CharterEditResult>>
    'charter/previewChangeSet': (
      request: CharterEditRequest,
    ) => Promise<RemoteResult<CharterChangeSetPreviewResult>>
    'charter/edit': (
      request: CharterEditRequest,
    ) => Promise<RemoteResult<CharterEditResult>>
    'charter/applyBootstrap': (
      request: CharterBootstrapApplyRequest,
    ) => Promise<RemoteResult<CharterEditResult>>
    'charter/bootstrap': (
      sessionId: SessionId,
    ) => Promise<RemoteResult<CharterBootstrapResult>>
    'charter/exportRecord': (
      sessionId: SessionId,
    ) => Promise<RemoteResult<CharterRecordExport>>
    'charter/initializeRecord': (
      request: CharterInitializeRequest,
    ) => Promise<RemoteResult<CharterRecordOperationResult>>
    'charter/restoreRecord': (
      request: CharterRestoreRequest,
    ) => Promise<RemoteResult<CharterRecordOperationResult>>
  }

  interface TypertRemoteNamespaceMap {
    charter: {
      watch: (
        sessionId: SessionId,
        signal?: AbortSignal,
      ) => RemoteStreamHandle<CharterFrame, never>
      watchSummary: (
        sessionId: SessionId,
        signal?: AbortSignal,
      ) => RemoteStreamHandle<CharterSummaryFrame, never>
      queryItems: (
        request: CharterItemQueryRequest & { readonly sessionId: SessionId },
      ) => Promise<RemoteResult<CharterItemQueryResult>>
      queryProposals: (
        sessionId: SessionId,
        options?: CharterProposalQueryRequest,
      ) => Promise<RemoteResult<CharterProposalQueryResult>>
      queryChanges: (
        request: CharterChangeQueryRequest & { readonly sessionId: SessionId },
      ) => Promise<RemoteResult<CharterChangeQueryResult>>
      sourceIntegrity: (sessionId: SessionId) => Promise<RemoteResult<CharterSourceIntegrityResult>>
      runValidators: (
        request: { readonly sessionId: SessionId; readonly requests: readonly CharterValidatorRequest[] },
      ) => Promise<RemoteResult<CharterValidatorRunResult>>
      queryMessages: (
        sessionId: SessionId,
      ) => Promise<RemoteResult<CharterMessageListResult>>
      proposeMessage: (
        request: import('../host/types.js').CharterMessageProposalOptions & { readonly sessionId: SessionId },
      ) => Promise<RemoteResult<CharterEditResult>>
      previewChangeSet: (
        request: CharterEditRequest,
      ) => Promise<RemoteResult<CharterChangeSetPreviewResult>>
      edit: (
        request: CharterEditRequest,
      ) => Promise<RemoteResult<CharterEditResult>>
      applyBootstrap: (
        request: CharterBootstrapApplyRequest,
      ) => Promise<RemoteResult<CharterEditResult>>
      bootstrap: (
        sessionId: SessionId,
      ) => Promise<RemoteResult<CharterBootstrapResult>>
      exportRecord: (
        sessionId: SessionId,
      ) => Promise<RemoteResult<CharterRecordExport>>
      initializeRecord: (
        request: CharterInitializeRequest,
      ) => Promise<RemoteResult<CharterRecordOperationResult>>
      restoreRecord: (
        request: CharterRestoreRequest,
      ) => Promise<RemoteResult<CharterRecordOperationResult>>
    }
  }
}

export type {
  CharterBootstrapResult,
  CharterEditRequest,
  CharterEditResult,
  CharterInitializeRequest,
  CharterRecordExport,
  CharterRecordOperationResult,
  CharterRestoreRequest,
  CharterView,
}
export type { CharterRecordState, CharterViewCapabilities }
export { charterBootstrapApplyRequestSchema, charterEditRequestSchema }
export type { CharterInitializeRequest as CharterInitializeRequestWire, CharterRestoreRequest as CharterRestoreRequestWire }
