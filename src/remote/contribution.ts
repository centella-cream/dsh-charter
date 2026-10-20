import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  charterBootstrapResultSchema,
  charterEditRequestSchema,
  charterEditResultSchema,
  charterFrameSchema,
} from './wire.js'

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
  }],
}
