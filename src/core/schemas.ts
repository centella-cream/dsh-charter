import { z } from 'zod'

export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
export const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)
export const clientRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u)
export const mutationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)

export const charterReviewSchema = z.enum(['pending', 'accepted', 'rejected'])
export const charterLifecycleSchema = z.enum(['current', 'superseded', 'archived'])
export const deliverableProgressSchema = z.enum([
  'not-started',
  'in-progress',
  'blocked',
  'done',
  'cancelled',
])

export const charterVerificationSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unchecked') }).strict(),
  z.object({
    state: z.literal('verified'),
    by: z.enum(['user', 'validator']),
  }).strict(),
  z.object({ state: z.literal('failed'), reason: z.string() }).strict(),
  z.object({ state: z.literal('unavailable'), reason: z.string() }).strict(),
])

const itemBase = {
  id: identifierSchema,
  text: z.string(),
  review: charterReviewSchema,
  lifecycle: charterLifecycleSchema,
  verification: charterVerificationSchema,
  origin: z.enum(['user', 'agent', 'fork']),
  order: z.number().int().nonnegative(),
  createdRevision: z.number().int().positive(),
  supersedes: identifierSchema.optional(),
  supersededBy: identifierSchema.optional(),
}

export const invariantItemSchema = z.object({
  kind: z.literal('invariant'),
  ...itemBase,
}).strict()

export const deliverableItemSchema = z.object({
  kind: z.literal('deliverable'),
  ...itemBase,
  progress: deliverableProgressSchema,
}).strict()

export const charterItemSchema = z.discriminatedUnion('kind', [
  invariantItemSchema,
  deliverableItemSchema,
])

export const charterObjectiveSchema = z.object({
  original: z.object({
    text: z.string(),
    setAtRevision: z.number().int().positive(),
  }).strict(),
  current: z.object({
    text: z.string(),
    setAtRevision: z.number().int().positive(),
    reason: z.string().optional(),
  }).strict(),
}).strict()

export const charterSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  objective: charterObjectiveSchema.optional(),
  items: z.array(charterItemSchema),
  promptText: z.string(),
  promptDigest: digestSchema,
  stateDigest: digestSchema,
}).strict()

export const invariantInputSchema = z.object({
  clientRef: clientRefSchema,
  kind: z.literal('invariant'),
  text: z.string(),
  order: z.number().int().nonnegative(),
}).strict()

export const deliverableInputSchema = z.object({
  clientRef: clientRefSchema,
  kind: z.literal('deliverable'),
  text: z.string(),
  order: z.number().int().nonnegative(),
  progress: deliverableProgressSchema,
}).strict()

export const newItemInputSchema = z.discriminatedUnion('kind', [
  invariantInputSchema,
  deliverableInputSchema,
])

export const charterOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('objective.initialize'), text: z.string() }).strict(),
  z.object({
    type: z.literal('objective.redirect'),
    text: z.string(),
    // Optional: a redirect without a recorded reason is valid; clients render a
    // localized fallback instead of persisting UI copy in the record.
    reason: z.string().optional(),
  }).strict(),
  z.object({ type: z.literal('item.add'), item: newItemInputSchema }).strict(),
  z.object({ type: z.literal('item.propose'), item: newItemInputSchema }).strict(),
  z.object({
    type: z.literal('item.edit'),
    itemId: identifierSchema,
    text: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({ type: z.literal('item.accept'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.reject'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.archive'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.restore'), itemId: identifierSchema }).strict(),
  z.object({
    type: z.literal('item.supersede'),
    itemId: identifierSchema,
    replacement: newItemInputSchema,
  }).strict(),
  z.object({
    type: z.literal('item.purge'),
    itemId: identifierSchema,
    confirmed: z.literal(true),
  }).strict(),
  z.object({
    type: z.literal('deliverable.progress'),
    itemId: identifierSchema,
    progress: deliverableProgressSchema,
  }).strict(),
  z.object({
    type: z.literal('item.verification.set'),
    itemId: identifierSchema,
    verification: z.enum(['unchecked', 'verified']),
  }).strict(),
])

export const charterEditRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  mutationId: mutationIdSchema,
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(charterOpSchema).min(1),
}).strict()

export const charterActorSchema = z.object({
  kind: z.enum(['owner', 'user', 'host']),
  id: z.string().min(1).max(256).optional(),
}).strict()

export const charterChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('objective.initialized') }).strict(),
  z.object({ type: z.literal('objective.redirected') }).strict(),
  z.object({ type: z.literal('item.added'), itemId: identifierSchema }).strict(),
  z.object({
    type: z.literal('item.edited'),
    itemId: identifierSchema,
    fields: z.array(z.enum(['text', 'order'])),
  }).strict(),
  z.object({ type: z.literal('item.accepted'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.rejected'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.archived'), itemId: identifierSchema }).strict(),
  z.object({ type: z.literal('item.restored'), itemId: identifierSchema }).strict(),
  z.object({
    type: z.literal('item.superseded'),
    itemId: identifierSchema,
    replacementId: identifierSchema,
  }).strict(),
  z.object({ type: z.literal('item.purged'), itemId: identifierSchema }).strict(),
  z.object({
    type: z.literal('deliverable.progressed'),
    itemId: identifierSchema,
    from: deliverableProgressSchema,
    to: deliverableProgressSchema,
  }).strict(),
  z.object({
    type: z.literal('item.verification.changed'),
    itemId: identifierSchema,
  }).strict(),
  z.object({ type: z.literal('forked') }).strict(),
])

export const charterReceiptSchema = z.object({
  revision: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  mutationId: mutationIdSchema,
  requestDigest: digestSchema,
  resultDigest: digestSchema,
  actor: charterActorSchema,
  at: z.number().int().nonnegative(),
  changes: z.array(charterChangeSchema),
}).strict()

export const mutationReceiptSchema = z.object({
  mutationId: mutationIdSchema,
  requestDigest: digestSchema,
  committedRevision: z.number().int().positive(),
  resultDigest: digestSchema,
  ids: z.record(clientRefSchema, identifierSchema),
}).strict()

export const charterIdentitySchema = z.object({
  createdAt: z.number().int().nonnegative(),
  cwd: z.string().optional(),
  parentSession: z.string().optional(),
}).strict()

export const maintenanceKindSchema = z.enum(['initialize', 'restore'])

/**
 * Bounded initialize/restore receipt. Optional in the version-1 record: old
 * records without it stay valid and are never rewritten on startup.
 */
export const charterMaintenanceReceiptSchema = z.object({
  operationId: identifierSchema,
  kind: maintenanceKindSchema,
  requestDigest: digestSchema,
  resultRevision: z.number().int().nonnegative(),
  resultStateDigest: digestSchema,
  sourceRecordDigest: digestSchema.optional(),
  at: z.number().int().nonnegative(),
}).strict()

/** The only record schema version written by this plugin release. */
export const CHARTER_RECORD_SCHEMA_VERSION = 1 as const

export const charterRecordSchema = z.object({
  recordSchemaVersion: z.literal(CHARTER_RECORD_SCHEMA_VERSION),
  identity: charterIdentitySchema,
  forkedFrom: z.object({
    sessionId: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict().optional(),
  current: charterSnapshotSchema,
  history: z.array(charterReceiptSchema),
  recentMutations: z.array(mutationReceiptSchema),
  recentMaintenance: z.array(charterMaintenanceReceiptSchema).optional(),
}).strict()

export const charterRecordArchiveSourceSchema = z.object({
  domain: z.literal('dsh_charter_v1'),
  domainVersion: z.literal(1),
  sessionId: z.string().min(1).max(256),
  lifecycle: z.string().nullable(),
  health: z.enum(['healthy', 'schema-invalid', 'consistency-invalid', 'lifecycle-mismatch']),
  revision: z.number().int().nonnegative().nullable(),
  recordDigest: digestSchema,
}).strict()

export const charterRecordArchiveSchema = z.object({
  format: z.literal('dsh-charter-record'),
  formatVersion: z.literal(1),
  // JS Date has a finite representable range; a larger value would make
  // `new Date(value).toISOString()` throw RangeError in recovery previews.
  exportedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  source: charterRecordArchiveSourceSchema,
  /** Raw stored value; validated after payload-digest verification. */
  record: z.unknown(),
  payloadDigest: digestSchema,
}).strict()

export const charterInitializeRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  operationId: mutationIdSchema,
  expectedLifecycle: z.string().min(1),
}).strict()

export const charterRestoreRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  operationId: mutationIdSchema,
  expectedLifecycle: z.string().min(1),
  expectedTarget: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('absent-unconfirmed') }).strict(),
    z.object({
      kind: z.literal('invalid'),
      reason: z.enum(['schema', 'consistency']),
      recordDigest: digestSchema,
    }).strict(),
  ]),
  archive: z.unknown(),
}).strict()

export type CharterReview = z.infer<typeof charterReviewSchema>
export type CharterLifecycle = z.infer<typeof charterLifecycleSchema>
export type CharterVerification = z.infer<typeof charterVerificationSchema>
export type DeliverableProgress = z.infer<typeof deliverableProgressSchema>
export type InvariantItem = z.infer<typeof invariantItemSchema>
export type DeliverableItem = z.infer<typeof deliverableItemSchema>
export type CharterItem = z.infer<typeof charterItemSchema>
export type CharterObjective = z.infer<typeof charterObjectiveSchema>
export type CharterSnapshot = z.infer<typeof charterSnapshotSchema>
export type NewItemInput = z.infer<typeof newItemInputSchema>
export type CharterOp = z.infer<typeof charterOpSchema>
export type CharterEditRequest = z.infer<typeof charterEditRequestSchema>
export type CharterActor = z.infer<typeof charterActorSchema>
export type CharterChange = z.infer<typeof charterChangeSchema>
export type CharterReceipt = z.infer<typeof charterReceiptSchema>
export type MutationReceipt = z.infer<typeof mutationReceiptSchema>
export type CharterRecord = z.infer<typeof charterRecordSchema>
export type MaintenanceKind = z.infer<typeof maintenanceKindSchema>
export type CharterMaintenanceReceipt = z.infer<typeof charterMaintenanceReceiptSchema>
export type CharterRecordArchiveSource = z.infer<typeof charterRecordArchiveSourceSchema>
export type CharterRecordArchive = z.infer<typeof charterRecordArchiveSchema>
export type CharterInitializeRequest = z.infer<typeof charterInitializeRequestSchema>
export type CharterRestoreRequest = z.infer<typeof charterRestoreRequestSchema>
export type CharterRestoreTarget = CharterRestoreRequest['expectedTarget']
