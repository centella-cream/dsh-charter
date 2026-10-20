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
  contribution: undefined,
  localeNamespace: undefined,
  localeDictionaries: undefined,
}
let viewEntries = [
  { options: { id: 'chat', order: 0 } },
  { options: { id: 'trajectory', order: 10 } },
  { options: { id: 'context', order: 20 } },
]
const viewSubscribers = new Set()
const notifyViews = () => { for (const listener of [...viewSubscribers]) listener() }
const addExternalView = (id, order) => {
  viewEntries = [...viewEntries, { options: { id, order } }]
  notifyViews()
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
      if (name !== 'conversation.view') throw new Error(`unexpected slot query: ${name}`)
      return viewEntries
    },
    subscribe(name, listener) {
      if (name !== 'conversation.view') throw new Error(`unexpected slot subscription: ${name}`)
      viewSubscribers.add(listener)
      return () => { viewSubscribers.delete(listener) }
    },
    inject(name, setup) {
      if (name !== 'conversation.view') throw new Error(`unexpected slot injection: ${name}`)
      const disposer = setup()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register(definition, component) {
      const entry = {
        options: { id: definition.id, order: definition.order, label: definition.label },
        definition,
        component,
      }
      viewEntries = [...viewEntries, entry]
      registrations.view = entry
      notifyViews()
      return () => {
        viewEntries = viewEntries.filter(candidate => candidate !== entry)
        notifyViews()
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

let view = registrations.view
if (view?.definition?.name !== 'conversation.view' || view.definition.id !== 'charter') {
  throw new Error('client apply did not register the charter conversation view')
}
if (viewEntries.at(-1) !== view) {
  throw new Error('charter view is not the last registered conversation view')
}
if (typeof view.definition.order !== 'number' || view.definition.order <= 20) {
  throw new Error(`charter view order ${String(view.definition.order)} does not follow existing tabs`)
}
if (view.definition.locale !== registrations.localeNamespace) {
  throw new Error('charter view locale namespace does not match its dictionary')
}
if (view.definition.label() !== '章程') {
  throw new Error(`unexpected Chinese tab label: ${view.definition.label()}`)
}
activeLocale = 'en'
if (view.definition.label() !== 'Charter') {
  throw new Error(`unexpected English tab label: ${view.definition.label()}`)
}
if (typeof view.component !== 'function') {
  throw new Error('client apply did not register the charter view body')
}

// A plugin that registers its tab after us must force ours to the end again.
addExternalView('fleet', 25)
view = registrations.view
if (viewEntries.at(-1) !== view || viewEntries.at(-1).options.id !== 'charter') {
  throw new Error('charter view did not follow a later-registered tab')
}
if (viewEntries.filter(entry => entry.options.id === 'charter').length !== 1) {
  throw new Error('charter view was duplicated during reordering')
}
if (registrations.contribution?.package !== 'dsh-charter') {
  throw new Error('client apply did not mount the charter Remote contribution')
}
console.log(
  `client-smoke: ${registration.id} registers conversation view "${view.definition.id}" `
  + `last at order ${String(view.definition.order)} as 章程/Charter, plus the Remote contribution`,
)
