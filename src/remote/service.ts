import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { CharterError } from '../core/errors.js'
import type { CharterActor, CharterEditRequest } from '../core/schemas.js'
import type { CharterBootstrapResult, CharterEditResult, CharterView } from '../host/types.js'
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
