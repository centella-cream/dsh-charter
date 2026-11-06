import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  charterBootstrapResultSchema,
  charterEditRequestSchema,
  charterBootstrapApplyRequestSchema,
  charterEditResultSchema,
  charterChangeSetPreviewResultSchema,
  charterValidatorRunRequestSchema,
  charterSourceIntegrityResultSchema,
  charterMessageListSchema,
  charterMessageProposeRequestSchema,
  charterArchiveListRequestSchema,
  charterArchiveListResultSchema,
  charterArchiveReadRequestSchema,
  charterArchiveReadResultSchema,
  charterValidatorRunResultSchema,
  charterFrameSchema,
  charterInitializeRequestWireSchema,
  charterRecordExportSchema,
  charterRecordOperationResultSchema,
  charterSummarySchema,
  charterSummaryFrameSchema,
  charterItemQueryRequestSchema,
  charterItemQueryResultSchema,
  charterProposalQueryRequestSchema,
  charterProposalQueryResultSchema,
  charterChangeQueryRequestSchema,
  charterChangeQueryResultSchema,
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
    id: 'dsh-charter#charter/watchSummary',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'watchSummary',
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
      typeSymbol: 'dsh-charter/CharterSummaryFrame',
      create: () => charterSummaryFrameSchema,
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
    id: 'dsh-charter#charter/sourceIntegrity',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'sourceIntegrity',
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
      typeSymbol: 'dsh-charter/CharterSourceIntegrityResult',
      create: () => charterSourceIntegrityResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/runValidators',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'runValidators',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterValidatorRunRequest',
        create: () => charterValidatorRunRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterValidatorRunResult',
      create: () => charterValidatorRunResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/queryMessages',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'queryMessages',
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
      typeSymbol: 'dsh-charter/CharterMessageListResult',
      create: () => charterMessageListSchema,
    },
  }, {
    id: 'dsh-charter#charter/listArchives',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'listArchives',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterArchiveListRequest',
        create: () => charterArchiveListRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterArchiveListResult',
      create: () => charterArchiveListResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/readArchive',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'readArchive',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterArchiveReadRequest',
        create: () => charterArchiveReadRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterArchiveReadResult',
      create: () => charterArchiveReadResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/proposeMessage',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'proposeMessage',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterMessageProposeRequest',
        create: () => charterMessageProposeRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterEditResult',
      create: () => charterEditResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/previewChangeSet',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'previewChangeSet',
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
      typeSymbol: 'dsh-charter/CharterChangeSetPreviewResult',
      create: () => charterChangeSetPreviewResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/applyBootstrap',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'applyBootstrap',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterBootstrapApplyRequest',
        create: () => charterBootstrapApplyRequestSchema,
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
  }, {
    id: 'dsh-charter#charter/summary',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'summary',
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
      typeSymbol: 'dsh-charter/CharterSummary',
      create: () => charterSummarySchema,
    },
  }, {
    id: 'dsh-charter#charter/queryItems',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'queryItems',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterItemQueryRequest',
        create: () => charterItemQueryRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterItemQueryResult',
      create: () => charterItemQueryResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/queryProposals',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'queryProposals',
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
    }, {
      name: 'options',
      wire: 'options',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterProposalQueryRequest',
        create: () => charterProposalQueryRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterProposalQueryResult',
      create: () => charterProposalQueryResultSchema,
    },
  }, {
    id: 'dsh-charter#charter/queryChanges',
    service: 'charterRemote',
    namespace: 'charter',
    method: 'queryChanges',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: 'dsh-charter/CharterChangeQueryRequest',
        create: () => charterChangeQueryRequestSchema,
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: 'dsh-charter/CharterChangeQueryResult',
      create: () => charterChangeQueryResultSchema,
    },
  }],
}
