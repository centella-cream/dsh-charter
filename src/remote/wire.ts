import { z } from 'zod'
import type { RemoteResult, RemoteStreamHandle } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  charterEditRequestSchema,
  charterItemSchema,
  charterObjectiveSchema,
} from '../core/schemas.js'
import type { CharterEditRequest } from '../core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../host/types.js'

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
])

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
    maxActiveInvariants: z.number().int().positive(),
    maxActiveDeliverables: z.number().int().positive(),
    maxOps: z.number().int().positive(),
  }).strict(),
  message: z.string().optional(),
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

export type CharterFrame = z.infer<typeof charterFrameSchema>
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
    }
  }
}

export type {
  CharterBootstrapResult,
  CharterEditRequest,
  CharterEditResult,
  CharterView,
}
export { charterEditRequestSchema }
