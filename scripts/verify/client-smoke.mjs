import { readFileSync } from 'node:fs'

const bundleSource = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
if (/\bBuffer\b/u.test(bundleSource)) {
  throw new Error('client bundle references Node-only Buffer')
}

/**
 * Verify the browser entry is a self-contained factory-form bundle:
 * it registers exactly one module with the Web module loader, synchronously
 * requires only baseline/external modules, and materializes its exports.
 *
 * This is a structural smoke test. The real browser check happens against a
 * packaged profile; see docs/verification.zh.md.
 */
let registration

globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      if (registration !== undefined) throw new Error('client bundle registered more than once')
      registration = value
    },
  },
}
globalThis.document = undefined

await import('../../lib/client.js')

if (registration === undefined) throw new Error('client bundle did not register a module')
if (registration.id !== 'dsh-charter') {
  throw new Error(`unexpected client module id: ${String(registration.id)}`)
}

const requested = []
const stubs = {
  'react': { useState: () => [], useSyncExternalStore: () => null },
  'react/jsx-runtime': { Fragment: {}, jsx: () => null, jsxs: () => null },
  '@deepseek-ai/dsh-api-gateway/client': { RemoteSnapshotStream: class {} },
}
const exports = registration.factory(specifier => {
  requested.push(specifier)
  const stub = stubs[specifier]
  if (stub === undefined) throw new Error(`unexpected external request: ${specifier}`)
  return stub
})

if (requested.some(specifier => specifier === 'zod')) {
  throw new Error('client bundle still externalizes zod')
}
if (requested.some(specifier => specifier.startsWith('./') || specifier.startsWith('../'))) {
  throw new Error(`client bundle requires a relative chunk: ${requested.join(', ')}`)
}
if (typeof exports.apply !== 'function') throw new Error('client bundle does not export apply')
if (!Array.isArray(exports.inject) || !exports.inject.includes('locale')) {
  throw new Error('client bundle does not inject the locale service')
}

const pending = []
const registrations = {
  view: undefined,
  viewCount: 0,
  contribution: undefined,
  localeNamespace: undefined,
  localeDictionaries: undefined,
}
let viewEntries = [
  { options: { id: 'chat', order: 0 } },
  { options: { id: 'trajectory', order: 10 } },
  { options: { id: 'context', order: 20 } },
]
let slotSubscriptions = 0
let slotQueries = 0
const addExternalView = (id, order) => {
  // No notify: the stable-order design must not require a slot subscription.
  viewEntries = [...viewEntries, { options: { id, order } }]
}
let activeLocale = 'zh'
const fakeContext = {
  effect(execute) {
    const result = execute()
    if (result !== undefined && typeof result.then === 'function') pending.push(result)
    return async () => {}
  },
  locale: {
    register(namespace, dictionaries) {
      registrations.localeNamespace = namespace
      registrations.localeDictionaries = dictionaries
      return () => {}
    },
    bind(namespace) {
      return key => registrations.localeDictionaries?.[activeLocale]?.[key] ?? key
    },
  },
  slots: {
    entries(name) {
      slotQueries += 1
      throw new Error(`unexpected slot query: ${name}`)
    },
    subscribe(name) {
      slotSubscriptions += 1
      throw new Error(`unexpected slot subscription: ${name}`)
    },
    inject(name, setup) {
      if (name !== 'conversation.view') throw new Error(`unexpected slot injection: ${name}`)
      const disposer = setup()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register(definition, component) {
      registrations.viewCount += 1
      const entry = {
        options: { id: definition.id, order: definition.order, label: definition.label },
        definition,
        component,
      }
      viewEntries = [...viewEntries, entry]
      registrations.view = entry
      return () => {
        viewEntries = viewEntries.filter(candidate => candidate !== entry)
      }
    },
  },
  remote: {
    async $mount(contribution) {
      registrations.contribution = contribution
      fakeContext.remote.charter = {
        watch: () => undefined,
        edit: async () => ({ ok: false }),
        bootstrap: async () => ({ ok: true, value: { available: false, reason: 'no-summary' } }),
      }
      return async () => {}
    },
  },
  inject(_deps, callback) {
    const scope = {
      dispose: async () => {},
      then(resolve) {
        resolve(undefined)
      },
    }
    callback(fakeContext)
    return scope
  },
}
exports.apply(fakeContext)
await Promise.all(pending)

const view = registrations.view
if (registrations.viewCount !== 1) {
  throw new Error(`client apply registered ${registrations.viewCount} conversation views instead of exactly one`)
}
if (view?.definition?.name !== 'conversation.view' || view.definition.id !== 'charter') {
  throw new Error('client apply did not register the charter conversation view')
}
if (slotQueries !== 0 || slotSubscriptions !== 0) {
  throw new Error('client apply queried or subscribed to the conversation.view roster')
}
const order = view.definition.order
if (typeof order !== 'number' || !Number.isFinite(order)) {
  throw new Error(`charter view order ${String(order)} is not a finite number`)
}
if (order !== 1000) {
  throw new Error(`charter view order ${String(order)} is not the stable CHARTER_VIEW_ORDER (1000)`)
}
const existingMaxOrder = Math.max(...viewEntries
  .filter(entry => entry !== view)
  .map(entry => (typeof entry.options.order === 'number' ? entry.options.order : 0)))
if (order <= existingMaxOrder) {
  throw new Error(`charter view order ${String(order)} does not follow existing tabs (max ${String(existingMaxOrder)})`)
}
if (view.definition.locale !== registrations.localeNamespace) {
  throw new Error('charter view locale namespace does not match its dictionary')
}
if (view.definition.label() !== '会话契约') {
  throw new Error(`unexpected Chinese tab label: ${view.definition.label()}`)
}
activeLocale = 'en'
if (view.definition.label() !== 'Charter') {
  throw new Error(`unexpected English tab label: ${view.definition.label()}`)
}
if (typeof view.component !== 'function') {
  throw new Error('client apply did not register the charter view body')
}
if (typeof view.definition.inject !== 'function') {
  throw new Error('charter view does not provide per-binding source/draft injection')
}

// Later plugin tabs must neither duplicate nor reorder the Charter view: the
// single registration keeps its stable order even against a higher-order tab.
const registered = registrations.view
addExternalView('fleet', 25)
addExternalView('future-plugin', 5000)
viewEntries = [...viewEntries]
if (registrations.view !== registered || registrations.viewCount !== 1) {
  throw new Error('charter view was re-registered or duplicated after external views registered')
}
if (viewEntries.filter(entry => entry.options.id === 'charter').length !== 1) {
  throw new Error('charter view was duplicated after external views registered')
}
if (registrations.view.definition.order !== order) {
  throw new Error('charter view order changed after external views registered')
}
if (slotQueries !== 0 || slotSubscriptions !== 0) {
  throw new Error('charter view reacted to external registrations through the slot roster')
}
if (registrations.contribution?.package !== 'dsh-charter') {
  throw new Error('client apply did not mount the charter Remote contribution')
}
console.log(
  `client-smoke: ${registration.id} registers conversation view "${view.definition.id}" `
  + `once at stable order ${String(order)} as 会话契约/Charter (no reorder/subscription), plus the Remote contribution`,
)
