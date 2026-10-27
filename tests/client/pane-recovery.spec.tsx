import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CharterClientState, CharterSessionSource } from '../../src/client/store.js'
import type { CharterView } from '../../src/host/types.js'
import type { CharterRecordArchive, CharterInitializeRequest, CharterRecord, CharterRestoreRequest } from '../../src/core/schemas.js'
import { CharterDraft } from '../../src/client/draft-store.js'
import { CharterPane } from '../../src/client/CharterPane.js'
import { buildRecordArchive } from '../../src/core/archive.js'
import { createEmptyRecord } from '../../src/core/record.js'
import { DEFAULT_CHARTER_LIMITS } from '../../src/core/limits.js'

const sessionId = SessionId('pane-recovery-session')
const lifecycle = JSON.stringify({ createdAt: 1_700_000_000_000, cwd: '/work', parentSession: null })

function baseView(): CharterView {
  return {
    status: 'ready',
    sessionId,
    revision: 1,
    objective: null,
    items: [],
    promptText: '',
    promptDigest: '',
    limits: {
      maxPromptBytes: 8_192,
      maxObjectiveBytes: 4_096,
      maxItemBytes: 1_024,
      maxItems: 512,
      maxPendingItems: 512,
      maxOps: 1_024,
      maxRecordBytes: 1_048_576,
      maintenanceLimit: 16,
      maxRecoveryBytes: 4_194_304,
    },
    overBudget: false,
    lifecycle,
    recordState: { kind: 'healthy', recordDigest: `sha256:${'a'.repeat(64)}` },
    capabilities: { recordMaintenance: true },
  }
}

function absentView(): CharterView {
  return {
    ...baseView(),
    status: 'unavailable',
    revision: 0,
    recordState: { kind: 'absent-unconfirmed', source: 'resume' },
  }
}

function invalidView(): CharterView {
  return {
    ...baseView(),
    status: 'unavailable',
    revision: 0,
    recordState: {
      kind: 'invalid',
      reason: 'schema',
      recordDigest: `sha256:${'b'.repeat(64)}`,
      recoverable: true,
    },
  }
}

interface Harness {
  readonly source: CharterSessionSource
  readonly state: () => CharterClientState
  readonly calls: { export: number; initialize: CharterInitializeRequest[]; restore: CharterRestoreRequest[] }
  readonly setView: (view: CharterView) => void
}

function harness(initial: CharterView): Harness {
  let current = initial
  let snapshot: CharterClientState = { status: 'ready', view: current, error: null }
  const listeners = new Set<() => void>()
  const calls = { export: 0, initialize: [] as CharterInitializeRequest[], restore: [] as CharterRestoreRequest[] }
  const source = {
    sessionId,
    connectionGeneration: 1,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    edit: async () => ({ ok: false as const, code: 'UNAVAILABLE' as const, message: 'unused' }),
    bootstrap: async () => ({ available: false as const, reason: 'unavailable' as const }),
    accept: (view: CharterView) => {
      current = view
      snapshot = { status: 'ready', view: current, error: null }
      for (const listener of [...listeners]) listener()
    },
    retry: () => undefined,
    exportRecord: async () => {
      calls.export += 1
      return { ok: true as const, filename: 'record.json', archive: archiveFor(createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS)) }
    },
    initializeRecord: async (request: CharterInitializeRequest) => {
      calls.initialize.push(request)
      return { ok: true as const, replayed: false, committedRevision: 0, view: baseView() }
    },
    restoreRecord: async (request: CharterRestoreRequest) => {
      calls.restore.push(request)
      return { ok: true as const, replayed: false, committedRevision: 1, view: baseView() }
    },
  } as unknown as CharterSessionSource
  return {
    source,
    calls,
    state: () => source.getSnapshot(),
    setView: (view: CharterView) => {
      current = view
      snapshot = { status: 'ready', view: current, error: null }
      for (const listener of [...listeners]) listener()
    },
  }
}

function archiveFor(record: CharterRecord): CharterRecordArchive {
  return buildRecordArchive({
    sessionId,
    lifecycle,
    health: 'healthy',
    revision: record.current.revision,
    record,
    exportedAt: 1_700_000_000_500,
  })
}

function textOf(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('')
}

function buttonByLabel(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const buttons = tree.root.findAll(node => node.type === 'button')
  const match = buttons.find(button => textOf(button) === label)
  if (match === undefined) throw new Error(`no button labelled ${label}: ${buttons.map(textOf).join(' | ')}`)
  return match
}

function click(tree: ReactTestRenderer, label: string): void {
  const button = buttonByLabel(tree, label)
  act(() => button.props.onClick?.({ preventDefault: () => undefined } as never))
}

const trees: ReactTestRenderer[] = []

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const tree of trees) act(() => tree.unmount())
  trees.length = 0
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})

function mount(_view: CharterView, h: Harness): ReactTestRenderer {
  const draft = new CharterDraft(sessionId, () => h.source)
  const Pane = CharterPane as unknown as React.ComponentType<Record<string, unknown>>
  let tree: ReactTestRenderer | undefined
  act(() => {
    tree = create(<Pane source={h.source} draft={draft} release={() => undefined} t={(key: string) => key} />)
  })
  if (tree === undefined) throw new Error('pane did not render')
  const rendered = tree
  trees.push(rendered)
  act(() => click(rendered, 'nav.recovery'))
  return rendered
}

function fileInput(tree: ReactTestRenderer): ReactTestInstance {
  return tree.root.findAll(node => node.type === 'input' && node.props.type === 'file')[0]!
}

function selectArchive(tree: ReactTestRenderer, archive: CharterRecordArchive): void {
  const input = fileInput(tree)
  const file = {
    name: 'backup.json',
    size: JSON.stringify(archive).length,
    text: async () => JSON.stringify(archive),
  }
  act(() => input.props.onChange({ currentTarget: { files: [file] } } as never))
}

describe('Storage & recovery Pane section', () => {
  it('exports a healthy record with a sensitive-data notice and a preview flow', async () => {
    const h = harness(baseView())
    const tree = mount(baseView(), h)
    expect(textOf(tree.root)).toContain('recovery.sensitive')
    click(tree, 'recovery.export')
    await act(async () => { await Promise.resolve() })
    expect(h.calls.export).toBe(1)
    // A healthy target must not offer restore.
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.restore')).toHaveLength(0)
  })

  it('offers a diagnostic export for an invalid record', async () => {
    const h = harness(invalidView())
    const tree = mount(invalidView(), h)
    expect(textOf(tree.root)).toContain('recovery.invalid')
    click(tree, 'recovery.export')
    await act(async () => { await Promise.resolve() })
    expect(h.calls.export).toBe(1)
  })

  it('requires a second confirmation to initialize an empty Charter', async () => {
    const h = harness(absentView())
    const tree = mount(absentView(), h)
    expect(textOf(tree.root)).toContain('recovery.absentHint')
    click(tree, 'recovery.initialize')
    expect(h.calls.initialize).toHaveLength(0)
    expect(buttonByLabel(tree, 'recovery.initializeConfirm')).toBeDefined()
    click(tree, 'recovery.initializeConfirm')
    await act(async () => { await Promise.resolve() })
    expect(h.calls.initialize).toHaveLength(1)
    expect(h.calls.initialize[0]).toMatchObject({ sessionId, expectedLifecycle: lifecycle })
  })

  it('previews an archive and requires a second confirmation to restore it', async () => {
    const h = harness(absentView())
    const tree = mount(absentView(), h)
    const archive = archiveFor(createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS))
    selectArchive(tree, archive)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      if (textOf(tree.root).includes('recovery.verified')) break
    }
    expect(textOf(tree.root)).toContain('recovery.previewTitle')
    click(tree, 'recovery.restore')
    expect(h.calls.restore).toHaveLength(0)
    expect(buttonByLabel(tree, 'recovery.restoreConfirm')).toBeDefined()
    click(tree, 'recovery.restoreConfirm')
    await act(async () => { await Promise.resolve() })
    expect(h.calls.restore).toHaveLength(1)
    expect(h.calls.restore[0]).toMatchObject({
      sessionId,
      expectedLifecycle: lifecycle,
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive,
    })
  })

  it('shows the initialized healthy state after a confirmed empty initialization', async () => {
    const h = harness(absentView())
    const tree = mount(absentView(), h)
    click(tree, 'recovery.initialize')
    click(tree, 'recovery.initializeConfirm')
    await act(async () => { await Promise.resolve() })
    expect(h.calls.initialize).toHaveLength(1)
    expect(textOf(tree.root)).toContain('recovery.healthy')
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.initialize'))
      .toHaveLength(0)
  })

  it('renders a decoded legacy-host frame safely (maintenance unavailable)', () => {
    const legacyValue = {
      status: 'unavailable' as const,
      sessionId,
      revision: 0,
      objective: null,
      items: [],
      promptText: '',
      promptDigest: '',
      limits: baseView().limits,
      overBudget: false,
      lifecycle,
    }
    // Same defaults an old Host frame receives at the wire boundary.
    const view = {
      ...legacyValue,
      recordState: { kind: 'unknown' as const, reason: 'legacy-host' as const },
      capabilities: { recordMaintenance: false, recordMaintenanceReason: 'legacy-host' as const },
    }
    const h = harness(view as CharterView)
    const tree = mount(view as CharterView, h)
    expect(textOf(tree.root)).toContain('recovery.capabilityUnavailable')
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.initialize'))
      .toHaveLength(0)
  })

  it('guards the export download path when no DOM document exists', async () => {
    const h = harness(baseView())
    const tree = mount(baseView(), h)
    click(tree, 'recovery.export')
    await act(async () => { await Promise.resolve() })
    // Node has no document: the download helper must be a safe no-op.
    expect(h.calls.export).toBe(1)
    expect(textOf(tree.root)).toContain('recovery.title')
  })

  it('keeps recovery disabled on legacy/record-limit capability and shows the restart copy', () => {
    const legacy = { ...baseView(), capabilities: { recordMaintenance: false, recordMaintenanceReason: 'legacy-host' as const } }
    const h = harness(legacy)
    const tree = mount(legacy, h)
    expect(textOf(tree.root)).toContain('recovery.capabilityUnavailable')
    const exportButton = buttonByLabel(tree, 'recovery.export')
    expect(exportButton.props.disabled).toBe(true)

    const uncertain = { ...baseView(), status: 'unavailable' as const, recordState: { kind: 'write-uncertain' as const, operation: 'edit' as const } }
    const h2 = harness(uncertain)
    const tree2 = mount(uncertain, h2)
    expect(textOf(tree2.root)).toContain('recovery.writeUncertain')
  })
})

describe('Storage & recovery async ownership', () => {
  function selectFile(tree: ReactTestRenderer, file: {
    name: string
    size: number
    text: () => Promise<string>
  }): void {
    const input = fileInput(tree)
    act(() => input.props.onChange({ currentTarget: { files: [file] } } as never))
  }

  async function flushPreview(tree: ReactTestRenderer, expected: string): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      const text = textOf(tree.root)
      if (text.includes(expected)) return text
    }
    return textOf(tree.root)
  }

  it('ignores a slower archive selection after a newer file completed', async () => {
    const h = harness(absentView())
    const tree = mount(absentView(), h)
    const archive = JSON.stringify(archiveFor(createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS)))
    let resolveSlow!: (text: string) => void
    selectFile(tree, {
      name: 'A-slow.json',
      size: archive.length,
      text: () => new Promise<string>(resolve => { resolveSlow = resolve }),
    })
    selectFile(tree, { name: 'B-fast.json', size: archive.length, text: async () => archive })
    const afterFast = await flushPreview(tree, 'recovery.selected: B-fast.json')
    expect(afterFast).toContain('B-fast.json')
    resolveSlow(archive)
    const afterSlow = await flushPreview(tree, 'recovery.verified')
    expect(afterSlow).toContain('B-fast.json')
    expect(afterSlow).not.toContain('A-slow.json')
  })

  it('drops an archive preview started under the previous lifecycle', async () => {
    const h = harness(absentView())
    const tree = mount(absentView(), h)
    const archive = JSON.stringify(archiveFor(createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS)))
    let resolveSlow!: (text: string) => void
    selectFile(tree, {
      name: 'old-life.json',
      size: archive.length,
      text: () => new Promise<string>(resolve => { resolveSlow = resolve }),
    })
    act(() => h.setView({
      ...absentView(),
      lifecycle: JSON.stringify({ createdAt: 1_700_000_000_900, cwd: '/work', parentSession: null }),
    }))
    resolveSlow(archive)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(textOf(tree.root)).not.toContain('old-life.json')
  })
})

describe('rc.5 restore confirmation binding', () => {
  it('resets a pending restore confirmation when the target digest changes', async () => {
    const h = harness(invalidView())
    const tree = mount(invalidView(), h)
    const archive = archiveFor(createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS))
    selectArchive(tree, archive)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      if (textOf(tree.root).includes('recovery.verified')) break
    }
    click(tree, 'recovery.restore')
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.restoreConfirm')).toHaveLength(1)
    act(() => h.setView({
      ...invalidView(),
      recordState: {
        kind: 'invalid',
        reason: 'schema',
        recordDigest: `sha256:${'c'.repeat(64)}`,
        recoverable: true,
      },
    }))
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.restoreConfirm')).toHaveLength(0)
  })
})

describe('rc.5 archive confirmation binding', () => {
  it('resets confirmation when the same filename carries a different archive', async () => {
    const h = harness(invalidView())
    const tree = mount(invalidView(), h)
    const recordA = createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS)
    const recordB = createEmptyRecord({ createdAt: 1_700_000_000_000 }, DEFAULT_CHARTER_LIMITS)
    recordB.current.revision = 2
    selectArchive(tree, archiveFor(recordA))
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      if (textOf(tree.root).includes('recovery.verified')) break
    }
    click(tree, 'recovery.restore')
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.restoreConfirm')).toHaveLength(1)
    selectArchive(tree, archiveFor(recordB))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(tree.root.findAll(node => node.type === 'button' && textOf(node) === 'recovery.restoreConfirm')).toHaveLength(0)
  })
})
