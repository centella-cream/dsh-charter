import { z } from 'zod'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  charterEditRequestSchema,
  charterInitializeRequestSchema,
  charterItemSchema,
  charterObjectiveSchema,
  charterRecordArchiveSchema,
  charterRestoreRequestSchema,
} from '../core/schemas.js'
import type {
  CharterEditRequest,
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
} from '../host/types.js'

const charterErrorCodeSchema = z.enum([
  'INVALID_ARGUMENT',
  'FORBIDDEN',
  'NOT_FOUND',
  'LIFECYCLE_MISMATCH',
  'REVISION_CONFLICT',
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
}).strict()

export const charterEditResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    replayed: z.boolean(),
    committedRevision: z.number().int().positive(),
    ids: z.record(z.string(), z.string()),
    view: charterViewSchema,
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
export type CharterSnapshotFrame = Extract<CharterFrame, { type: 'snapshot' }>
export type CharterChangedFrame = Extract<CharterFrame, { type: 'changed' }>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'charter/watch': (
      sessionId: SessionId,
      signal?: AbortSignal,
    ) => RemoteStreamHandle<CharterFrame, never>
    'charter/edit': (
      request: CharterEditRequest,
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
      edit: (
        request: CharterEditRequest,
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
export { charterEditRequestSchema }
export type { CharterInitializeRequest as CharterInitializeRequestWire, CharterRestoreRequest as CharterRestoreRequestWire }
