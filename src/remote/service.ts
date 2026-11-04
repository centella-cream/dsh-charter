import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CharterError } from '../core/errors.js'
import type {
  CharterActor,
  CharterEditRequest,
  CharterInitializeRequest,
  CharterRestoreRequest,
} from '../core/schemas.js'
import type {
  CharterBootstrapResult,
  CharterEditResult,
  CharterRecordExport,
  CharterRecordOperationResult,
  CharterView,
  CharterSummary,
  CharterItemQueryResult,
  CharterProposalQueryResult,
  CharterChangeQueryResult,
} from '../host/types.js'
import { resolveRemoteActor } from './actor.js'
import { remoteMethod } from './compat.js'
import { watchCharter, type CharterWatchSource } from './watch.js'
import type { CharterFrame } from './wire.js'

export class CharterRemoteService extends TypertRemoteService {
  static inject = ['charter', 'sessions']

  constructor(ctx: Context) {
    super(ctx, 'charterRemote', { namespace: 'charter' })
  }

  @remoteMethod({
    mode: 'stream',
    resources: {
      session: (sessionId: SessionId, _signal: AbortSignal): SessionId => sessionId,
    },
  })
  watch(sessionId: SessionId, signal: AbortSignal): AsyncIterable<CharterFrame> {
    return this.openWatch(sessionId, signal)
  }

  @remoteMethod({
    resources: {
      session: (sessionId: SessionId): SessionId => sessionId,
    },
  })
  bootstrap(sessionId: SessionId): Promise<CharterBootstrapResult> {
    return Promise.resolve(this.ctx.charter.bootstrap(sessionId))
  }

  @remoteMethod({
    resources: {
      session: (request: CharterEditRequest): SessionId => request.sessionId as SessionId,
    },
  })
  edit(request: CharterEditRequest): Promise<CharterEditResult> {
    let actor: CharterActor
    try {
      actor = resolveRemoteActor(this.ctx)
    } catch (error) {
      // A missing Peer principal on a principal-aware runtime is an
      // authorization failure, not an internal error: return the normal
      // edit-result envelope so the client can show it.
      if (error instanceof CharterError) {
        return Promise.resolve({ ok: false, code: error.code, message: error.message })
      }
      throw error
    }
    return this.ctx.charter.edit(request, actor)
  }

  @remoteMethod({
    resources: {
      session: (request: CharterEditRequest): SessionId => request.sessionId as SessionId,
    },
  })
  applyBootstrap(request: CharterEditRequest): Promise<CharterEditResult> {
    let actor: CharterActor
    try {
      actor = resolveRemoteActor(this.ctx)
    } catch (error) {
      if (error instanceof CharterError) {
        return Promise.resolve({ ok: false, code: error.code, message: error.message })
      }
      throw error
    }
    return this.ctx.charter.applyBootstrap(request, actor)
  }

  @remoteMethod({
    resources: {
      session: (sessionId: SessionId): SessionId => sessionId,
    },
  })
  exportRecord(sessionId: SessionId): Promise<CharterRecordExport> {
    const actor = this.maintenanceActor()
    if ('ok' in actor) return Promise.resolve(actor)
    return Promise.resolve(this.ctx.charter.exportRecord(sessionId, actor.actor))
  }

  @remoteMethod({
    resources: {
      session: (request: CharterInitializeRequest): SessionId => request.sessionId as SessionId,
    },
  })
  initializeRecord(request: CharterInitializeRequest): Promise<CharterRecordOperationResult> {
    const actor = this.maintenanceActor()
    if ('ok' in actor) return Promise.resolve(actor)
    return this.ctx.charter.initializeRecord(request, actor.actor)
  }

  @remoteMethod({
    resources: {
      session: (request: CharterRestoreRequest): SessionId => request.sessionId as SessionId,
    },
  })
  restoreRecord(request: CharterRestoreRequest): Promise<CharterRecordOperationResult> {
    // Capability/owner fail closed BEFORE the Host parses the archive deeply.
    const actor = this.maintenanceActor()
    if ('ok' in actor) return Promise.resolve(actor)
    return this.ctx.charter.restoreRecord(request, actor.actor)
  }

  @remoteMethod({
    resources: {
      session: (sessionId: SessionId): SessionId => sessionId,
    },
  })
  summary(sessionId: SessionId): Promise<CharterSummary> {
    resolveRemoteActor(this.ctx)
    return Promise.resolve(this.ctx.charter.summaryById(sessionId))
  }

  @remoteMethod({
    resources: {
      session: (request: { readonly sessionId: string }): SessionId => request.sessionId as SessionId,
    },
  })
  queryItems(request: {
    readonly sessionId: string
    readonly kind?: 'invariant' | 'deliverable'
    readonly review?: 'pending' | 'accepted' | 'rejected'
    readonly lifecycle?: 'current' | 'superseded' | 'archived'
    readonly search?: string
    readonly sourceKind?: 'manual' | 'message' | 'compaction-summary' | 'agent-tool' | 'fork' | 'legacy-unknown'
    readonly batchId?: string
    readonly verification?: 'unchecked' | 'verified' | 'failed' | 'unavailable'
    readonly execution?: 'ready' | 'waiting' | 'dependency-conflict' | 'in-progress' | 'blocked' | 'terminal'
    readonly prerequisite?: 'satisfied' | 'waiting' | 'dependency-conflict'
    readonly cursor?: string
    readonly limit?: number
  }): Promise<CharterItemQueryResult> {
    resolveRemoteActor(this.ctx)
    return Promise.resolve(this.ctx.charter.queryItemsById(request.sessionId as SessionId, {
      ...(request.kind === undefined ? {} : { kind: request.kind }),
      ...(request.review === undefined ? {} : { review: request.review }),
      ...(request.lifecycle === undefined ? {} : { lifecycle: request.lifecycle }),
      ...(request.search === undefined ? {} : { search: request.search }),
      ...(request.sourceKind === undefined ? {} : { sourceKind: request.sourceKind }),
      ...(request.batchId === undefined ? {} : { batchId: request.batchId }),
      ...(request.verification === undefined ? {} : { verification: request.verification }),
      ...(request.execution === undefined ? {} : { execution: request.execution }),
      ...(request.prerequisite === undefined ? {} : { prerequisite: request.prerequisite }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    }))
  }

  @remoteMethod({
    resources: {
      session: (sessionId: SessionId): SessionId => sessionId,
    },
  })
  queryProposals(
    sessionId: SessionId,
    options: {
      readonly limit?: number
      readonly cursor?: string
      readonly sourceKind?: 'manual' | 'message' | 'compaction-summary' | 'agent-tool' | 'fork' | 'legacy-unknown'
      readonly review?: 'pending' | 'accepted' | 'rejected'
      readonly batchId?: string
      readonly candidateKind?: 'item' | 'objective'
    } = {},
  ): Promise<CharterProposalQueryResult> {
    resolveRemoteActor(this.ctx)
    return Promise.resolve(this.ctx.charter.queryProposalsById(sessionId, {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.sourceKind === undefined ? {} : { sourceKind: options.sourceKind }),
      ...(options.review === undefined ? {} : { review: options.review }),
      ...(options.batchId === undefined ? {} : { batchId: options.batchId }),
      ...(options.candidateKind === undefined ? {} : { candidateKind: options.candidateKind }),
    }))
  }

  @remoteMethod({
    mode: 'stream',
    resources: {
      session: (sessionId: SessionId, _signal: AbortSignal): SessionId => sessionId,
    },
  })
  watchSummary(sessionId: SessionId, signal: AbortSignal): AsyncIterable<{ readonly type: 'snapshot' | 'changed'; readonly value: import('../host/types.js').CharterSummary }> {
    return this.openSummaryWatch(sessionId, signal)
  }

  private async *openSummaryWatch(
    sessionId: SessionId,
    signal: AbortSignal,
  ): AsyncGenerator<{ readonly type: 'snapshot' | 'changed'; readonly value: import('../host/types.js').CharterSummary }> {
    const source: CharterWatchSource = {
      read: () => this.ctx.charter.viewById(sessionId),
      subscribe: listener => this.ctx.charter.subscribe(sessionId, listener),
    }
    for await (const frame of watchCharter(source, signal)) {
      yield { type: frame.type, value: this.ctx.charter.summaryById(sessionId) }
    }
  }

  @remoteMethod({
    resources: {
      session: (request: { readonly sessionId: string }): SessionId => request.sessionId as SessionId,
    },
  })
  queryChanges(request: {
    readonly sessionId: string
    readonly limit?: number
    readonly cursor?: string
    readonly changeSetId?: string
    readonly operationKind?: import('../core/schemas.js').CharterChange['type']
    readonly itemId?: string
    readonly proposalId?: string
  }): Promise<CharterChangeQueryResult> {
    resolveRemoteActor(this.ctx)
    return Promise.resolve(this.ctx.charter.queryChangesById(request.sessionId as SessionId, {
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.changeSetId === undefined ? {} : { changeSetId: request.changeSetId }),
      ...(request.operationKind === undefined ? {} : { operationKind: request.operationKind }),
      ...(request.itemId === undefined ? {} : { itemId: request.itemId }),
      ...(request.proposalId === undefined ? {} : { proposalId: request.proposalId }),
    }))
  }

  private maintenanceActor():
    | { readonly actor: CharterActor }
    | { readonly ok: false; readonly code: 'FORBIDDEN'; readonly message: string } {
    try {
      return { actor: resolveRemoteActor(this.ctx) }
    } catch (error) {
      if (error instanceof CharterError) {
        return { ok: false, code: 'FORBIDDEN', message: error.message }
      }
      throw error
    }
  }

  private async *openWatch(sessionId: SessionId, signal: AbortSignal): AsyncGenerator<CharterFrame> {
    signal.throwIfAborted()
    const source: CharterWatchSource = {
      // A session persisted by another process (for example the Desktop app)
      // can be visible in the Web UI before it is live here. Show its stored
      // charter read-only and upgrade in place when the session becomes live.
      read: () => this.ctx.charter.viewById(sessionId),
      subscribe: listener => this.ctx.charter.subscribe(sessionId, listener),
    }
    yield* watchCharter(source, signal)
  }
}

export { resolveRemoteActor } from './actor.js'

export default CharterRemoteService
export type { CharterView }
