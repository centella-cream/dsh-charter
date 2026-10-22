import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { charterRemoteContribution } from './remote/contribution.js'
import type {} from './remote/wire.js'
import { CharterClientController } from './client/store.js'
import { CharterPane } from './client/CharterPane.js'
import { CHARTER_LOCALE, CHARTER_LOCALE_NS } from './client/locales.js'

export const inject = ['remote', 'slots', 'locale']

const CHARTER_VIEW_ID = 'charter'
/**
 * Stable high order for the Charter conversation view.
 *
 * Chat uses order 0 and Trajectory 10; common plugin tabs use 20/30. A fixed
 * high order naturally follows them without ever re-registering the view, so
 * two plugins that both try to stay "last" cannot reorder each other forever.
 */
export const CHARTER_VIEW_ORDER = 1000

export function apply(ctx: ClientContext): void {
  const controller = new CharterClientController(ctx)
  const t = ctx.locale.bind(CHARTER_LOCALE_NS)

  ctx.effect(() => ctx.locale.register(CHARTER_LOCALE_NS, CHARTER_LOCALE), 'dsh-charter: locale')
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: CHARTER_VIEW_ID,
    order: CHARTER_VIEW_ORDER,
    locale: CHARTER_LOCALE_NS,
    label: () => t('tab'),
    inject: sessionId => {
      const lease = controller.acquire(sessionId)
      return { source: lease.source, draft: lease.draft, release: lease.release }
    },
  }, CharterPane)), 'dsh-charter: conversation view')

  ctx.effect(async () => {
    let cancelled = false
    let mountedRemote: typeof ctx.remote.charter | undefined
    const disposeMount = await ctx.remote.$mount(charterRemoteContribution)
    if (cancelled) {
      await disposeMount()
      return () => undefined
    }

    const remoteScope = ctx.inject(['remote.charter'], remoteCtx => {
      mountedRemote = remoteCtx.remote.charter
      controller.attach(remoteCtx.remote.charter)
    })
    await remoteScope

    return async () => {
      cancelled = true
      if (mountedRemote !== undefined) controller.detach(mountedRemote)
      await controller.dispose()
      await remoteScope.dispose()
      await disposeMount()
    }
  }, 'dsh-charter: remote')
}

export { CharterPane } from './client/CharterPane.js'
export { CharterClientController, CharterSessionSource } from './client/store.js'
