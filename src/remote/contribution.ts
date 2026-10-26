import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  charterBootstrapResultSchema,
  charterEditRequestSchema,
  charterEditResultSchema,
  charterFrameSchema,
  charterInitializeRequestWireSchema,
  charterRecordExportSchema,
  charterRecordOperationResultSchema,
} from './wire.js'

/** Small outer restore contract: the archive is opaque until the Host gates it. */
const charterRestoreOuterSchema = z.object({
  sessionId: z.string().min(1).max(256),
  operationId: z.string().min(1).max(128),
  expectedLifecycle: z.string().min(1),
  expectedTarget: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('absent-unconfirmed') }).strict(),
    z.object({
      kind: z.literal('invalid'),
      reason: z.enum(['schema', 'consistency']),
      recordDigest: z.string(),
    }).strict(),
  ]),
  archive: z.unknown().refine(value => value !== undefined, 'archive is required'),
}).strict()

const sessionIdSchema = z.string().min(1)

export const charterRemoteContribution: TypertRemoteContribution = {
  package: 'dsh-charter',
  descriptors: [{
    id: 'dsh-charter#charter/watch',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'watch',
    mode: 'stream',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'sessionId',
      wire: 'sessionId',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/SessionId',
        create: () => sessionIdSchema,
      },
    }],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterFrame',
      create: () => charterFrameSchema,
    },
  }, {
    id: 'dsh-charter#charter/bootstrap',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'bootstrap',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'sessionId',
      wire: 'sessionId',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/SessionId',
        create: () => sessionIdSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterBootstrapResult',
      create: () => charterBootstrapResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/edit',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'edit',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterEditRequest',
        create: () => charterEditRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterEditResult',
      create: () => charterEditResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/exportRecord',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'exportRecord',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'sessionId',
      wire: 'sessionId',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/SessionId',
        create: () => sessionIdSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterRecordExport',
      create: () => charterRecordExportSchema,
    },
  }, {
    id: 'dsh-charter#charter/initializeRecord',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'initializeRecord',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterInitializeRequest',
        create: () => charterInitializeRequestWireSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterRecordOperationResult',
      create: () => charterRecordOperationResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/restoreRecord',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'restoreRecord',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterRestoreRequest',
        create: () => charterRestoreOuterSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterRecordOperationResult',
      create: () => charterRecordOperationResultSchema,
    },
  }],
}
