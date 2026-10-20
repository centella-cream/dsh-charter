import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveActor } from '../host/service.js'
import type { CharterEditRequest } from '../core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../host/types.js'
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
    return this.ctx.charter.edit(request, resolveActor(this.ctx))
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

export default CharterRemoteService
export type { CharterView }
