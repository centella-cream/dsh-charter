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
const CHARTER_VIEW_ORDER_STEP = 10

/**
 * Append after every Conversation View already registered.
 *
 * Chat uses order 0, Trajectory 10, and installed plugins commonly use 20/30.
 * Reading the live slot roster keeps this tab after them without reserving a
 * permanent magic number; a tab registered later can still follow it.
 */
function nextViewOrder(ctx: ClientContext): number {
  let order = 0
  for (const entry of ctx.slots.entries('conversation.view')) {
    if (entry.options.id === CHARTER_VIEW_ID) continue
    const candidate = entry.options.order
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      order = Math.max(order, candidate)
    }
  }
  return order + CHARTER_VIEW_ORDER_STEP
}

export function apply(ctx: ClientContext): void {
  const controller = new CharterClientController(ctx)
  const t = ctx.locale.bind(CHARTER_LOCALE_NS)

  ctx.effect(() => ctx.locale.register(CHARTER_LOCALE_NS, CHARTER_LOCALE), 'dsh-charter: locale')
  ctx.effect(() => {
    let disposed = false
    let adjusting = false
    let disposeView: (() => void) | undefined

    const registerView = (): void => {
      disposeView = ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: CHARTER_VIEW_ID,
        order: nextViewOrder(ctx),
        locale: CHARTER_LOCALE_NS,
        label: () => t('tab'),
        inject: sessionId => {
          const lease = controller.acquire(sessionId)
          return { source: lease.source, release: lease.release }
        },
      }, CharterPane))
    }

    const ensureLast = (): void => {
      if (disposed || adjusting) return
      const entries = ctx.slots.entries('conversation.view')
      const index = entries.findIndex(entry => entry.options.id === CHARTER_VIEW_ID)
      if (index !== -1 && index === entries.length - 1) return
      adjusting = true
      try {
        disposeView?.()
        disposeView = undefined
        registerView()
      } finally {
        adjusting = false
      }
    }

    ensureLast()
    const disposeSubscription = ctx.slots.subscribe('conversation.view', ensureLast)
    return () => {
      disposed = true
      disposeSubscription()
      disposeView?.()
    }
  }, 'dsh-charter: conversation view')

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
