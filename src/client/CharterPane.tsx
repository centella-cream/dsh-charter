import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import type {
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CharterErrorCode } from '../core/errors.js'
import type {
  CharterItem,
  CharterOp,
  DeliverableItem,
  DeliverableProgress,
  NewItemInput,
} from '../core/schemas.js'
import type { CharterBootstrapProposal, CharterView } from '../host/types.js'
import type { CharterSource } from './store.js'
import { CHARTER_LOCALE_NS, type CharterLocaleKey } from './locales.js'
import { displayItems, previewPrompt } from './preview.js'
import './charter.css'

type CharterText = TranslateNS<typeof CHARTER_LOCALE_NS>

export interface CharterPaneInjected {
  readonly source: CharterSource
}

type CharterPaneProps = PropsRuntime<'conversation.view'>
  & PropsLocale<typeof CHARTER_LOCALE_NS>
  & CharterPaneInjected

interface BootstrapDraftItem {
  readonly id: string
  readonly kind: 'invariant' | 'deliverable'
  readonly text: string
  readonly selected: boolean
}

type CharterSection = 'overview' | 'objective' | 'invariants' | 'deliverables' | 'history' | 'context'

type EditorMode =
  | { readonly kind: 'objective' }
  | { readonly kind: 'edit'; readonly item: CharterItem }
  | { readonly kind: 'supersede'; readonly item: CharterItem }
  | null

function mutationId(): string {
  return `ui-${globalThis.crypto.randomUUID()}`
}

function clientRef(): string {
  return `draft-${globalThis.crypto.randomUUID()}`
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function formatBytes(bytes: number): string {
  return bytes < 1_024 ? `${bytes} B` : `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KiB`
}

function progressLabel(progress: DeliverableProgress, t: CharterText): string {
  return t(`progress.${progress}`)
}

function errorLabel(code: CharterErrorCode, t: CharterText): string {
  return t(`error.${code}`)
}

function countLabel(
  t: CharterText,
  count: number,
  one: CharterLocaleKey,
  other: CharterLocaleKey,
): string {
  return t(count === 1 ? one : other, { count })
}

function statusMessage(view: CharterView, t: CharterText): string | null {
  if (view.status === 'ready') return null
  if (view.status === 'initializing') return t('status.initializing')
  const message = view.message ?? ''
  if (message.includes('read-only')) return t('status.readOnly')
  if (message.includes('not live')) return t('status.notLive')
  if (message.includes('another Session lifecycle')) return t('status.lifecycle')
  if (message.includes('inconsistent') || message.includes('corrupt')) return t('status.corrupt')
  if (message.includes('storage') || message.includes('not ready')) return t('status.storage')
  return t('status.unavailable')
}

function itemState(item: CharterItem): 'done' | 'warning' | 'ongoing' | 'idle' {
  if (item.lifecycle === 'archived' || item.lifecycle === 'superseded') return 'idle'
  if (item.review === 'pending') return 'warning'
  if (item.kind === 'deliverable' && item.progress === 'done') return 'done'
  if (item.kind === 'deliverable' && item.progress === 'in-progress') return 'ongoing'
  return 'idle'
}

function CharterMark() {
  return (
    <span className="charter-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <defs>
          <linearGradient id="charter-mark-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4b6bfb" />
            <stop offset="1" stopColor="#2ec4b6" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="13" fill="url(#charter-mark-gradient)" />
        <path d="M15 10h12l7 7v18a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z" fill="#fff" opacity=".96" />
        <path d="M27 10v7h7" fill="none" stroke="#4b6bfb" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 24h11M18 29h8" fill="none" stroke="#4b6bfb" strokeWidth="2" strokeLinecap="round" />
        <path d="m18 35 2.6 2.6L28 30" fill="none" stroke="#2ec4b6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = 'ghost',
  ariaLabel,
}: {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: 'primary' | 'outline' | 'ghost'
  readonly ariaLabel?: string
}) {
  return (
    <button
      type="button"
      className={`charter-button charter-button--${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

function StateMark({ state }: { readonly state: ReturnType<typeof itemState> | 'error' }) {
  return <span className={`charter-state-mark charter-state-mark--${state}`} aria-hidden="true" />
}

function StatusTag({
  children,
  tone = 'quiet',
}: {
  readonly children: ReactNode
  readonly tone?: 'quiet' | 'info' | 'success' | 'warning' | 'danger'
}) {
  return <span className={`charter-tag charter-tag--${tone}`}>{children}</span>
}

function TextEditor({
  value,
  onChange,
  reason,
  onReasonChange,
  showReason,
  onSave,
  onCancel,
  maxBytes,
  t,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly reason?: string
  readonly onReasonChange?: (value: string) => void
  readonly showReason?: boolean
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly maxBytes: number
  readonly t: CharterText
}) {
  const bytes = utf8Bytes(value)
  const over = bytes > maxBytes
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSave()
    }
  }
  return (
    <>
      <textarea
        autoFocus
        className="charter-editor__input"
        value={value}
        aria-label={t('editor.charterTextAria')}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {showReason === true && (
        <input
          className="charter-editor__reason"
          value={reason ?? ''}
          placeholder={t('editor.reasonPlaceholder')}
          aria-label={t('editor.reasonAria')}
          onChange={event => onReasonChange?.(event.target.value)}
        />
      )}
      <div className="charter-editor__actions">
        <span className={over ? 'charter-budget is-over' : 'charter-budget'}>
          {over ? t('budget.editorOver', { limit: formatBytes(maxBytes) }) : `${formatBytes(bytes)} / ${formatBytes(maxBytes)}`}
        </span>
        <ActionButton variant="outline" disabled={over || value.trim().length === 0} onClick={onSave}>
          {t('editor.stage')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('editor.cancel')}</ActionButton>
      </div>
      <span className="charter-editor__hint">{t('editor.hint')}</span>
    </>
  )
}

function newItem(
  kind: 'invariant' | 'deliverable',
  text: string,
  order: number,
): NewItemInput {
  return kind === 'invariant'
    ? { clientRef: clientRef(), kind, text, order }
    : { clientRef: clientRef(), kind, text, order, progress: 'not-started' }
}

function buildBootstrapOps(
  view: CharterView,
  objective: string,
  items: readonly BootstrapDraftItem[],
): CharterOp[] {
  const ops: CharterOp[] = []
  if (view.objective === null && objective.trim().length > 0) {
    ops.push({ type: 'objective.initialize', text: objective.trim() })
  }
  let order = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  for (const item of items) {
    if (!item.selected || item.text.trim().length === 0) continue
    if (item.kind === 'invariant') {
      ops.push({
        type: 'item.add',
        item: { clientRef: `bootstrap-${item.id}`, kind: 'invariant', text: item.text.trim(), order },
      })
    } else {
      ops.push({
        type: 'item.add',
        item: {
          clientRef: `bootstrap-${item.id}`,
          kind: 'deliverable',
          text: item.text.trim(),
          order,
          progress: 'not-started',
        },
      })
    }
    order += 1
  }
  return ops
}

function ItemRow({
  item,
  queue,
  edit,
  supersede,
  disabled,
  t,
}: {
  readonly item: CharterItem
  readonly queue: (op: CharterOp) => void
  readonly edit: (item: CharterItem) => void
  readonly supersede: (item: CharterItem) => void
  readonly disabled: boolean
  readonly t: CharterText
}) {
  const [confirmPurge, setConfirmPurge] = useState(false)
  const inactive = item.lifecycle !== 'current' || item.review === 'rejected'
  // A superseded item still has a live successor pointing at it; the Host
  // rejects that purge. Offer Purge only for terminal, unreferenced items.
  const purgeable = (item.lifecycle === 'archived' || item.review === 'rejected')
    && item.supersededBy === undefined
  return (
    <article className={`charter-item${inactive ? ' charter-item--inactive' : ''}`}>
      <div className="charter-item__main">
        <StateMark state={itemState(item)} />
        <div className="charter-item__copy">
          <span className="charter-item__text">{item.text}</span>
          <div className="charter-item__meta">
            {item.review === 'pending' && <StatusTag tone="warning">{t('tag.proposal')}</StatusTag>}
            {item.review === 'rejected' && <StatusTag tone="danger">{t('tag.rejected')}</StatusTag>}
            {item.kind === 'deliverable' && <StatusTag>{progressLabel(item.progress, t)}</StatusTag>}
            {item.lifecycle === 'archived' && <StatusTag>{t('tag.archived')}</StatusTag>}
            {item.lifecycle === 'superseded' && <StatusTag>{t('tag.superseded')}</StatusTag>}
            {item.verification.state === 'verified' && <StatusTag tone="success">{t('tag.verified')}</StatusTag>}
            <span className="charter-item__bytes">{formatBytes(utf8Bytes(item.text))}</span>
          </div>
        </div>
      </div>
      <div className="charter-item__actions">
        {item.review === 'pending' && item.lifecycle === 'current' && (
          <>
            <ActionButton variant="outline" disabled={disabled} onClick={() => queue({
              type: 'item.accept',
              itemId: item.id,
            })}>
              {t('item.accept')}
            </ActionButton>
            <ActionButton disabled={disabled} onClick={() => queue({ type: 'item.reject', itemId: item.id })}>
              {t('item.reject')}
            </ActionButton>
          </>
        )}
        {item.review === 'accepted' && item.lifecycle === 'current' && (
          <>
            <ActionButton ariaLabel={t('item.editAria')} disabled={disabled} onClick={() => edit(item)}>
              {t('item.edit')}
            </ActionButton>
            <ActionButton disabled={disabled} onClick={() => supersede(item)}>{t('item.replace')}</ActionButton>
            <ActionButton disabled={disabled} onClick={() => queue({ type: 'item.archive', itemId: item.id })}>
              {t('item.archive')}
            </ActionButton>
            <ActionButton disabled={disabled} onClick={() => queue({
              type: 'item.verification.set',
              itemId: item.id,
              verification: item.verification.state === 'verified' ? 'unchecked' : 'verified',
            })}>
              {item.verification.state === 'verified' ? t('item.unverify') : t('item.verify')}
            </ActionButton>
          </>
        )}
        {item.review === 'accepted' && item.lifecycle === 'archived' && (
          <ActionButton disabled={disabled} onClick={() => queue({ type: 'item.restore', itemId: item.id })}>
            {t('item.restore')}
          </ActionButton>
        )}
        {purgeable && (confirmPurge
          ? (
              <>
                <ActionButton
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    queue({ type: 'item.purge', itemId: item.id, confirmed: true })
                    setConfirmPurge(false)
                  }}
                >
                  {t('item.confirmPurge')}
                </ActionButton>
                <ActionButton onClick={() => setConfirmPurge(false)}>{t('item.keep')}</ActionButton>
              </>
            )
          : (
              <ActionButton disabled={disabled} onClick={() => setConfirmPurge(true)}>{t('item.purge')}</ActionButton>
            ))}
      </div>
      {item.kind === 'deliverable' && item.review === 'accepted' && item.lifecycle === 'current' && (
        <label className="charter-progress">
          <span>{t('progress.label')}</span>
          <select
            value={item.progress}
            disabled={disabled}
            onChange={event => queue({
              type: 'deliverable.progress',
              itemId: item.id,
              progress: event.target.value as DeliverableProgress,
            })}
          >
            {(['not-started', 'in-progress', 'blocked', 'done', 'cancelled'] as const).map(value => (
              <option key={value} value={value}>{progressLabel(value, t)}</option>
            ))}
          </select>
        </label>
      )}
    </article>
  )
}

export function CharterPane({ sessionId, source, t }: CharterPaneProps) {
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const view = state.view
  const [ops, setOps] = useState<CharterOp[]>([])
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorMode>(null)
  const [editorText, setEditorText] = useState('')
  const [editorReason, setEditorReason] = useState('')
  const [editorNeedsReason, setEditorNeedsReason] = useState(false)
  const [newInvariant, setNewInvariant] = useState('')
  const [newDeliverable, setNewDeliverable] = useState('')
  const [section, setSection] = useState<CharterSection>('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<CharterBootstrapProposal | null>(null)
  const [bootstrapState, setBootstrapState] = useState<'idle' | 'loading' | 'ready' | 'dismissed'>('idle')
  const [bootstrapObjective, setBootstrapObjective] = useState('')
  const [bootstrapItems, setBootstrapItems] = useState<BootstrapDraftItem[]>([])
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [bootstrapSaving, setBootstrapSaving] = useState(false)
  const bootstrapRequested = useRef(false)

  useEffect(() => {
    bootstrapRequested.current = false
    setBootstrap(null)
    setBootstrapState('idle')
    setBootstrapObjective('')
    setBootstrapItems([])
    setBootstrapError(null)
    setSection('overview')
  }, [sessionId])

  useEffect(() => {
    if (view === null) return
    if (view.objective !== null || view.items.length > 0) {
      setBootstrap(null)
      setBootstrapState('dismissed')
    }
  }, [view])

  useEffect(() => {
    if (bootstrap !== null) setSection('history')
  }, [bootstrap])

  useEffect(() => {
    if (section === 'history' && bootstrap === null && bootstrapState !== 'loading') {
      setSection('overview')
    }
  }, [section, bootstrap, bootstrapState])

  useEffect(() => {
    if (bootstrapRequested.current) return
    if (state.status !== 'ready' || view === null || view.status !== 'ready') return
    if (view.objective !== null || view.items.length > 0 || ops.length > 0) return
    bootstrapRequested.current = true
    setBootstrapState('loading')
    void source.bootstrap()
      .then(result => {
        if (!result.available) {
          setBootstrapState('idle')
          return
        }
        setBootstrap(result.proposal)
        setBootstrapObjective(result.proposal.objective ?? '')
        setBootstrapItems([
          ...result.proposal.invariants.map((text, index) => ({
            id: `inv-${index}`,
            kind: 'invariant' as const,
            text,
            selected: true,
          })),
          ...result.proposal.deliverables.map((text, index) => ({
            id: `del-${index}`,
            kind: 'deliverable' as const,
            text,
            selected: true,
          })),
        ])
        setBootstrapState('ready')
      })
      .catch(error => {
        console.error('charter: bootstrap request failed', error)
        setBootstrapState('idle')
      })
  }, [state.status, view, ops.length, source])

  const queue = (op: CharterOp): void => {
    if (view === null || view.status !== 'ready' || saving) return
    setBaseRevision(current => current ?? view.revision)
    setOps(current => current.some(existing => JSON.stringify(existing) === JSON.stringify(op))
      ? current
      : [...current, op])
    setMessage(null)
  }

  const openEditor = (mode: Exclude<EditorMode, null>, text: string): void => {
    setEditor(mode)
    setEditorText(text)
    setEditorReason(mode.kind === 'objective' ? view?.objective?.current.reason ?? '' : '')
    setEditorNeedsReason(mode.kind === 'objective' && view?.objective !== null)
  }

  const closeEditor = (): void => {
    setEditor(null)
    setEditorText('')
    setEditorReason('')
    setEditorNeedsReason(false)
  }

  const saveEditor = (): void => {
    if (editor === null || editorText.trim().length === 0) return
    const maxBytes = editor.kind === 'objective' ? view?.limits.maxObjectiveBytes : view?.limits.maxItemBytes
    if (maxBytes !== undefined && utf8Bytes(editorText) > maxBytes) {
      setMessage(t('budget.editorOver', { limit: formatBytes(maxBytes) }))
      return
    }
    const nextText = editorText.trim()
    if (editor.kind === 'objective' && view?.objective?.current.text === nextText) {
      setMessage(t('editor.unchangedObjective'))
      return
    }
    if (editor.kind === 'edit' && editor.item.text === nextText) {
      setMessage(t('editor.unchangedItem'))
      return
    }
    if (editor.kind === 'objective') {
      if (view?.objective === null || view?.objective === undefined) {
        queue({ type: 'objective.initialize', text: editorText })
      } else {
        queue({
          type: 'objective.redirect',
          text: editorText,
          reason: editorReason.trim().length === 0
            ? t('editor.defaultReason')
            : editorReason,
        })
      }
    } else if (editor.kind === 'edit') {
      queue({ type: 'item.edit', itemId: editor.item.id, text: editorText })
    } else {
      const replacement = editor.item.kind === 'invariant'
        ? { clientRef: clientRef(), kind: 'invariant' as const, text: editorText, order: editor.item.order }
        : {
            clientRef: clientRef(), kind: 'deliverable' as const, text: editorText,
            order: editor.item.order, progress: editor.item.progress,
          }
      queue({ type: 'item.supersede', itemId: editor.item.id, replacement })
    }
    closeEditor()
  }

  const addItem = (kind: 'invariant' | 'deliverable', text: string, clear: () => void): void => {
    if (view === null || text.trim().length === 0) return
    if (utf8Bytes(text) > view.limits.maxItemBytes) {
      setMessage(t('budget.itemOver', { limit: formatBytes(view.limits.maxItemBytes) }))
      return
    }
    const maxOrder = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1)
    queue({ type: 'item.add', item: newItem(kind, text, maxOrder + 1 + ops.length) })
    clear()
  }

  const discard = (): void => {
    setOps([])
    setBaseRevision(null)
    setMessage(null)
    setNewInvariant('')
    setNewDeliverable('')
    closeEditor()
  }

  const applyDraft = async (): Promise<void> => {
    if (view === null || ops.length === 0 || baseRevision === null) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await source.edit({ sessionId, mutationId: mutationId(), baseRevision, ops })
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        setOps([])
        setBaseRevision(null)
        setMessage(result.replayed
          ? t('footer.replayed')
          : t('footer.saved', { revision: result.committedRevision }))
      } else {
        setMessage(errorLabel(result.code, t))
      }
    } catch (error) {
      console.error('charter: edit request failed', error)
      setMessage(t('error.connection'))
    } finally {
      setSaving(false)
    }
  }

  const updateBootstrapItem = (id: string, patch: Partial<BootstrapDraftItem>): void => {
    setBootstrapItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  const discardBootstrap = (): void => {
    setBootstrap(null)
    setBootstrapState('dismissed')
    setBootstrapObjective('')
    setBootstrapItems([])
    setBootstrapError(null)
  }

  const applyBootstrap = async (): Promise<void> => {
    if (view === null || bootstrap === null || bootstrapSaving || ops.length > 0 || editor !== null) return
    const bootstrapOps = buildBootstrapOps(view, bootstrapObjective, bootstrapItems)
    if (bootstrapOps.length === 0) return

    setBootstrapSaving(true)
    setBootstrapError(null)
    try {
      const result = await source.edit({
        sessionId,
        mutationId: mutationId(),
        baseRevision: view.revision,
        ops: bootstrapOps,
      })
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        setBootstrap(null)
        setBootstrapState('dismissed')
        setBootstrapObjective('')
        setBootstrapItems([])
        setMessage(t('footer.saved', { revision: result.committedRevision }))
      } else {
        setBootstrapError(errorLabel(result.code, t))
      }
    } catch (error) {
      console.error('charter: bootstrap apply failed', error)
      setBootstrapError(t('error.connection'))
    } finally {
      setBootstrapSaving(false)
    }
  }

  const notice = state.error !== null
    ? t('error.connection')
    : view === null ? null : statusMessage(view, t)

  if (state.status === 'connecting' && view === null) {
    return (
      <main className="charter-root charter-centered">
        <StateMark state="ongoing" />
        <span>{t('status.loading')}</span>
      </main>
    )
  }
  if (view === null) {
    return (
      <main className="charter-root charter-centered">
        <StateMark state="error" />
        <span>{t('error.connection')}</span>
        <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
      </main>
    )
  }

  const revisionConflict = baseRevision !== null && view.revision !== baseRevision
  const editable = view.status === 'ready' && !saving
  const activeCount = view.items.filter(item => item.review === 'accepted' && item.lifecycle === 'current').length
  const invariants = displayItems(view.items).filter(item => item.kind === 'invariant')
  const deliverables = displayItems(view.items).filter((item): item is DeliverableItem => item.kind === 'deliverable')
  const preview = previewPrompt(view, ops)
  const bootstrapInvariants = bootstrapItems.filter(item => item.kind === 'invariant')
  const bootstrapDeliverables = bootstrapItems.filter(item => item.kind === 'deliverable')
  const selectedBootstrapItems = bootstrapItems.filter(item => item.selected && item.text.trim().length > 0)
  const bootstrapOps = view === null ? [] : buildBootstrapOps(view, bootstrapObjective, bootstrapItems)
  const bootstrapPrompt = view === null ? '' : previewPrompt(view, bootstrapOps)
  const bootstrapBytes = utf8Bytes(bootstrapPrompt)
  const bootstrapObjectiveOver = view !== null
    && utf8Bytes(bootstrapObjective) > view.limits.maxObjectiveBytes
  const bootstrapItemsOver = view !== null
    && selectedBootstrapItems.some(item => utf8Bytes(item.text) > view.limits.maxItemBytes)
  const bootstrapBudgetOver = view !== null && bootstrapBytes > view.limits.maxPromptBytes
  const bootstrapCountOver = view !== null && (
    bootstrapOps.length > view.limits.maxOps
    || selectedBootstrapItems.filter(item => item.kind === 'invariant').length > view.limits.maxActiveInvariants
    || selectedBootstrapItems.filter(item => item.kind === 'deliverable').length > view.limits.maxActiveDeliverables
  )
  const canApplyBootstrap = bootstrap !== null
    && ops.length === 0
    && editor === null
    && !bootstrapSaving
    && bootstrapOps.length > 0
    && !bootstrapObjectiveOver
    && !bootstrapItemsOver
    && !bootstrapBudgetOver
    && !bootstrapCountOver
  const maxObjectiveBytes = view.limits.maxObjectiveBytes
  const maxItemBytes = view.limits.maxItemBytes
  const maxPromptBytes = view.limits.maxPromptBytes
  const objectiveBytes = utf8Bytes(view.objective?.current.text ?? '')
  const objectiveOver = objectiveBytes > maxObjectiveBytes
  const projectedBytes = ops.length > 0 ? utf8Bytes(preview) : utf8Bytes(view.promptText)
  const contextOver = projectedBytes > maxPromptBytes
  const budgetPercent = Math.min(100, Math.round((projectedBytes / maxPromptBytes) * 100))
  const newInvariantBytes = utf8Bytes(newInvariant)
  const newDeliverableBytes = utf8Bytes(newDeliverable)
  const newInvariantOver = newInvariantBytes > maxItemBytes
  const newDeliverableOver = newDeliverableBytes > maxItemBytes

  const navItems: Array<{
    id: CharterSection
    label: string
    badge?: number
    dot?: boolean
  }> = [
    { id: 'overview', label: t('nav.overview') },
    { id: 'objective', label: t('nav.objective'), dot: view.objective !== null },
    { id: 'invariants', label: t('nav.invariants'), badge: invariants.length },
    { id: 'deliverables', label: t('nav.deliverables'), badge: deliverables.length },
    ...(bootstrap !== null || bootstrapState === 'loading'
      ? [{
          id: 'history' as const,
          label: t('nav.history'),
          ...(bootstrap === null ? {} : { badge: selectedBootstrapItems.length }),
          dot: true,
        }]
      : []),
    { id: 'context', label: t('nav.context') },
  ]

  return (
    <main className="charter-root" data-dsh-part="charter-pane">
      <div className="charter-shell">
        <header className="charter-pagehead">
          <div className="charter-heading">
            <CharterMark />
            <div className="charter-heading__copy">
              <span className="charter-eyebrow">{t('header.eyebrow')}</span>
              <h2>{t('header.title')}</h2>
              <p className="charter-subtitle">{t('header.subtitle')}</p>
            </div>
          </div>
          <div className="charter-headside">
            <div className="charter-chips">
              <StatusTag tone={view.status === 'ready' ? 'success' : 'warning'}>
                {t('stats.revision', { revision: view.revision })}
              </StatusTag>
              <StatusTag>{t('stats.active', { count: activeCount })}</StatusTag>
              <StatusTag>{t('stats.stored', { count: view.items.length })}</StatusTag>
            </div>
            <div className={`charter-meter${contextOver ? ' is-over' : budgetPercent >= 80 ? ' is-warn' : ''}`}>
              <span>{t('stats.budget', {
                used: formatBytes(projectedBytes),
                limit: formatBytes(maxPromptBytes),
              })}</span>
              <span className="charter-meter__track" aria-hidden="true">
                <span className="charter-meter__fill" style={{ width: `${budgetPercent}%` }} />
              </span>
            </div>
          </div>
        </header>

        {notice !== null && (
          <div className="charter-notice charter-notice--warning" role="status">{notice}</div>
        )}
        {revisionConflict && (
          <div className="charter-notice charter-notice--warning" role="alert">
            {t('notice.conflict', { from: baseRevision, to: view.revision })}
          </div>
        )}
        {contextOver && (
          <div className="charter-notice charter-notice--danger" role="alert">
            {t('budget.contextOver', { limit: formatBytes(maxPromptBytes) })}
          </div>
        )}

        <footer className="charter-actionbar">
          <div className="charter-actionbar__status">
            <span className={`charter-dot${ops.length > 0 ? ' is-staged' : ''}`} aria-hidden="true" />
            <div>
              <strong>{ops.length === 0
                ? t('footer.none')
                : countLabel(t, ops.length, 'footer.one', 'footer.other')}</strong>
              {message !== null && <span className="charter-actionbar__message">{message}</span>}
            </div>
          </div>
          <div className="charter-actionbar__actions">
            <ActionButton onClick={() => setSection(current => current === 'context' ? 'overview' : 'context')}>
              {section === 'context' ? t('footer.hidePreview') : t('footer.preview')}
            </ActionButton>
            <ActionButton disabled={ops.length === 0 || saving} onClick={discard}>
              {t('footer.discard')}
            </ActionButton>
            <ActionButton
              variant="primary"
              disabled={ops.length === 0 || !editable || revisionConflict || contextOver}
              onClick={() => void applyDraft()}
            >
              {saving ? t('footer.applying') : t('footer.apply')}
            </ActionButton>
          </div>
        </footer>

        <div className="charter-body">
          <nav className="charter-nav" aria-label={t('nav.label')}>
            <span className="charter-nav__label">{t('nav.label')}</span>
            {navItems.map(item => (
              <button
                key={item.id}
                type="button"
                className={`charter-nav__item${section === item.id ? ' is-active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                <span className="charter-nav__text">{item.label}</span>
                {item.badge !== undefined && <span className="charter-nav__badge">{item.badge}</span>}
                {item.dot === true && <span className="charter-nav__dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>

          <div className="charter-content">
            {section === 'overview' && (
              <>
                {bootstrap !== null && (
                  <button
                    type="button"
                    className="charter-callout"
                    onClick={() => setSection('history')}
                  >
                    <span className="charter-kicker">{t('bootstrap.kicker')}</span>
                    <strong>{t('bootstrap.title')}</strong>
                    <span>{t('bootstrap.body')}</span>
                    <span className="charter-callout__link">{t('nav.open')}</span>
                  </button>
                )}

                {view.objective === null && view.items.length === 0
                  && bootstrap === null && bootstrapState !== 'loading' && (
                  <section className="charter-empty-state" role="note">
                    <span className="charter-kicker">{t('empty.kicker')}</span>
                    <h3>{t('empty.title')}</h3>
                    <p>{t('empty.body')}</p>
                    <div className="charter-empty-actions">
                      <ActionButton variant="primary" onClick={() => setSection('objective')}>
                        {t('objective.set')}
                      </ActionButton>
                      <ActionButton onClick={() => setSection('invariants')}>
                        {t('composer.addInvariant')}
                      </ActionButton>
                    </div>
                  </section>
                )}

                {bootstrapState === 'loading' && (
                  <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>
                )}

                <section className={`charter-card charter-objective${objectiveOver ? ' is-over' : ''}`}>
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('objective.kicker')}</span>
                      <h3>{view.objective?.current.text ?? t('objective.empty')}</h3>
                    </div>
                    <div className="charter-cardtools">
                      <span className={`charter-budget${objectiveOver ? ' is-over' : ''}`}>
                        {formatBytes(objectiveBytes)} / {formatBytes(maxObjectiveBytes)}
                      </span>
                      <ActionButton onClick={() => setSection('objective')}>{t('nav.open')}</ActionButton>
                    </div>
                  </div>
                  {view.objective !== null && view.objective.original.text !== view.objective.current.text && (
                    <p className="charter-original">
                      {t('objective.original', { text: view.objective.original.text })}
                    </p>
                  )}
                  {view.objective?.current.reason !== undefined && (
                    <p className="charter-original">
                      {t('objective.reason', { reason: view.objective.current.reason })}
                    </p>
                  )}
                </section>

                <div className="charter-overview-grid">
                  <button type="button" className="charter-card charter-statcard" onClick={() => setSection('invariants')}>
                    <span className="charter-kicker">{t('invariants.kicker')}</span>
                    <span className="charter-statcard__value">{invariants.length}</span>
                    <span className="charter-statcard__label">{countLabel(t, invariants.length, 'invariants.one', 'invariants.other')}</span>
                    <span className="charter-statcard__list">
                      {invariants.length === 0
                        ? t('invariants.empty')
                        : invariants.slice(0, 3).map(item => <span key={item.id}>{item.text}</span>)}
                    </span>
                    <span className="charter-statcard__link">{t('nav.open')}</span>
                  </button>
                  <button type="button" className="charter-card charter-statcard" onClick={() => setSection('deliverables')}>
                    <span className="charter-kicker">{t('deliverables.kicker')}</span>
                    <span className="charter-statcard__value">{deliverables.length}</span>
                    <span className="charter-statcard__label">{countLabel(t, deliverables.length, 'deliverables.one', 'deliverables.other')}</span>
                    <span className="charter-statcard__list">
                      {deliverables.length === 0
                        ? t('deliverables.empty')
                        : deliverables.slice(0, 3).map(item => (
                          <span key={item.id}>{item.text}<em>{progressLabel(item.progress, t)}</em></span>
                        ))}
                    </span>
                    <span className="charter-statcard__link">{t('nav.open')}</span>
                  </button>
                </div>

                <section className="charter-card charter-budgetcard">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('overview.budget')}</span>
                      <h3>{t('overview.budgetDetail')}</h3>
                    </div>
                  </div>
                  <div className="charter-budgetgrid">
                    <span>{t('stats.budget', { used: formatBytes(projectedBytes), limit: formatBytes(maxPromptBytes) })}</span>
                    <span>{t('objective.kicker')} {formatBytes(objectiveBytes)} / {formatBytes(maxObjectiveBytes)}</span>
                    <span>{t('invariants.kicker')} {invariants.length} / {view.limits.maxActiveInvariants}</span>
                    <span>{t('deliverables.kicker')} {deliverables.length} / {view.limits.maxActiveDeliverables}</span>
                  </div>
                </section>
              </>
            )}

            {section === 'objective' && (
              <>
                <section className={`charter-card charter-objective${objectiveOver ? ' is-over' : ''}`}>
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('objective.kicker')}</span>
                      <h3>{view.objective?.current.text ?? t('objective.empty')}</h3>
                    </div>
                    <div className="charter-cardtools">
                      <span className={`charter-budget${objectiveOver ? ' is-over' : ''}`}>
                        {formatBytes(objectiveBytes)} / {formatBytes(maxObjectiveBytes)}
                      </span>
                      <ActionButton
                        variant="outline"
                        disabled={!editable}
                        onClick={() => openEditor({ kind: 'objective' }, view.objective?.current.text ?? '')}
                      >
                        {view.objective === null ? t('objective.set') : t('objective.redirect')}
                      </ActionButton>
                    </div>
                  </div>
                  {view.objective !== null && view.objective.original.text !== view.objective.current.text && (
                    <p className="charter-original">
                      {t('objective.original', { text: view.objective.original.text })}
                    </p>
                  )}
                  {view.objective?.current.reason !== undefined && (
                    <p className="charter-original">
                      {t('objective.reason', { reason: view.objective.current.reason })}
                    </p>
                  )}
                  {editor?.kind === 'objective' && (
                    <div className="charter-inlineeditor">
                      <TextEditor
                        value={editorText}
                        onChange={setEditorText}
                        reason={editorReason}
                        onReasonChange={setEditorReason}
                        showReason={editorNeedsReason}
                        onSave={saveEditor}
                        onCancel={closeEditor}
                        maxBytes={maxObjectiveBytes}
                        t={t}
                      />
                    </div>
                  )}
                </section>
                <p className="charter-hint">{t('overview.objectiveHint')}</p>
              </>
            )}

            {section === 'invariants' && (
              <section className="charter-card charter-section">
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <span className="charter-kicker">{t('invariants.kicker')}</span>
                    <h3>{countLabel(t, invariants.length, 'invariants.one', 'invariants.other')}</h3>
                  </div>
                  <span className="charter-count">{invariants.length}</span>
                </div>
                <div className="charter-list">
                  {invariants.length === 0 && <p className="charter-empty">{t('invariants.empty')}</p>}
                  {invariants.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      disabled={!editable}
                      queue={queue}
                      edit={value => openEditor({ kind: 'edit', item: value }, value.text)}
                      supersede={value => openEditor({ kind: 'supersede', item: value }, value.text)}
                      t={t}
                    />
                  ))}
                </div>
                <div className={`charter-add${newInvariantOver ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newInvariant}
                    placeholder={t('composer.placeholderInvariant')}
                    aria-label={t('composer.inputAria')}
                    onChange={event => setNewInvariant(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        addItem('invariant', newInvariant, () => setNewInvariant(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${newInvariantOver ? ' is-over' : ''}`}>
                      {newInvariantOver
                        ? t('budget.itemOver', { limit: formatBytes(maxItemBytes) })
                        : `${formatBytes(newInvariantBytes)} / ${formatBytes(maxItemBytes)}`}
                    </span>
                    <ActionButton
                      variant="outline"
                      disabled={!editable || newInvariant.trim().length === 0 || newInvariantOver}
                      onClick={() => addItem('invariant', newInvariant, () => setNewInvariant(''))}
                    >
                      {t('composer.addInvariant')}
                    </ActionButton>
                  </div>
                </div>
              </section>
            )}

            {section === 'deliverables' && (
              <section className="charter-card charter-section">
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <span className="charter-kicker">{t('deliverables.kicker')}</span>
                    <h3>{countLabel(t, deliverables.length, 'deliverables.one', 'deliverables.other')}</h3>
                  </div>
                  <span className="charter-count">{deliverables.length}</span>
                </div>
                <div className="charter-list">
                  {deliverables.length === 0 && <p className="charter-empty">{t('deliverables.empty')}</p>}
                  {deliverables.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      disabled={!editable}
                      queue={queue}
                      edit={value => openEditor({ kind: 'edit', item: value }, value.text)}
                      supersede={value => openEditor({ kind: 'supersede', item: value }, value.text)}
                      t={t}
                    />
                  ))}
                </div>
                <div className={`charter-add${newDeliverableOver ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newDeliverable}
                    placeholder={t('composer.placeholderDeliverable')}
                    aria-label={t('composer.inputAria')}
                    onChange={event => setNewDeliverable(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        addItem('deliverable', newDeliverable, () => setNewDeliverable(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${newDeliverableOver ? ' is-over' : ''}`}>
                      {newDeliverableOver
                        ? t('budget.itemOver', { limit: formatBytes(maxItemBytes) })
                        : `${formatBytes(newDeliverableBytes)} / ${formatBytes(maxItemBytes)}`}
                    </span>
                    <ActionButton
                      variant="outline"
                      disabled={!editable || newDeliverable.trim().length === 0 || newDeliverableOver}
                      onClick={() => addItem('deliverable', newDeliverable, () => setNewDeliverable(''))}
                    >
                      {t('composer.addDeliverable')}
                    </ActionButton>
                  </div>
                </div>
              </section>
            )}

            {section === 'history' && (
              <>
                {bootstrapState === 'loading' && (
                  <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>
                )}
                {bootstrap !== null && (ops.length > 0 || editor !== null) && (
                  <div className="charter-notice charter-notice--warning" role="status">
                    {t('bootstrap.blocked')}
                  </div>
                )}
                {bootstrap !== null && ops.length === 0 && editor === null && (
                  <section className="charter-card charter-bootstrap" aria-labelledby="charter-bootstrap-title">
                    <div className="charter-cardhead">
                      <div className="charter-cardtitle">
                        <span className="charter-kicker">{t('bootstrap.kicker')}</span>
                        <h3 id="charter-bootstrap-title">{t('bootstrap.title')}</h3>
                      </div>
                      <span className={`charter-budget${bootstrapBudgetOver ? ' is-over' : ''}`}>
                        {t('bootstrap.budget', {
                          used: formatBytes(bootstrapBytes),
                          limit: formatBytes(maxPromptBytes),
                        })}
                      </span>
                    </div>
                    <p className="charter-copy">{t('bootstrap.body')}</p>
                    <span className="charter-source">
                      {bootstrap.source.shadowedTokens === undefined
                        ? t('bootstrap.sourcePlain')
                        : t('bootstrap.source', { tokens: bootstrap.source.shadowedTokens })}
                    </span>

                    {view.objective === null && (
                      <label className="charter-bootstrap__field">
                        <span>{t('bootstrap.objective')}</span>
                        <textarea
                          value={bootstrapObjective}
                          rows={2}
                          onChange={event => setBootstrapObjective(event.target.value)}
                        />
                        <span className={`charter-budget${bootstrapObjectiveOver ? ' is-over' : ''}`}>
                          {bootstrapObjectiveOver
                            ? t('budget.objectiveOver', { limit: formatBytes(maxObjectiveBytes) })
                            : `${formatBytes(utf8Bytes(bootstrapObjective))} / ${formatBytes(maxObjectiveBytes)}`}
                        </span>
                      </label>
                    )}

                    {bootstrapInvariants.length > 0 && (
                      <div className="charter-bootstrap__group">
                        <span className="charter-kicker">{t('bootstrap.invariants')}</span>
                        {bootstrapInvariants.map(item => {
                          const bytes = utf8Bytes(item.text)
                          return (
                            <label className="charter-bootstrap__item" key={item.id}>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                aria-label={t('bootstrap.selected')}
                                onChange={event => updateBootstrapItem(item.id, { selected: event.target.checked })}
                              />
                              <div className="charter-draftfield">
                                <textarea
                                  value={item.text}
                                  rows={2}
                                  onChange={event => updateBootstrapItem(item.id, { text: event.target.value })}
                                />
                                <span className={`charter-budget${bytes > maxItemBytes ? ' is-over' : ''}`}>
                                  {bytes > maxItemBytes
                                    ? t('bootstrap.itemOver', { limit: formatBytes(maxItemBytes) })
                                    : `${formatBytes(bytes)} / ${formatBytes(maxItemBytes)}`}
                                </span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {bootstrapDeliverables.length > 0 && (
                      <div className="charter-bootstrap__group">
                        <span className="charter-kicker">{t('bootstrap.deliverables')}</span>
                        {bootstrapDeliverables.map(item => {
                          const bytes = utf8Bytes(item.text)
                          return (
                            <label className="charter-bootstrap__item" key={item.id}>
                              <input
                                type="checkbox"
                                checked={item.selected}
                                aria-label={t('bootstrap.selected')}
                                onChange={event => updateBootstrapItem(item.id, { selected: event.target.checked })}
                              />
                              <div className="charter-draftfield">
                                <textarea
                                  value={item.text}
                                  rows={2}
                                  onChange={event => updateBootstrapItem(item.id, { text: event.target.value })}
                                />
                                <span className={`charter-budget${bytes > maxItemBytes ? ' is-over' : ''}`}>
                                  {bytes > maxItemBytes
                                    ? t('bootstrap.itemOver', { limit: formatBytes(maxItemBytes) })
                                    : `${formatBytes(bytes)} / ${formatBytes(maxItemBytes)}`}
                                </span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {bootstrapBudgetOver && (
                      <div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overBudget', { limit: formatBytes(maxPromptBytes) })}
                      </div>
                    )}
                    {bootstrapCountOver && (
                      <div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overItems')}
                      </div>
                    )}
                    {bootstrapError !== null && (
                      <div className="charter-notice charter-notice--warning" role="alert">{bootstrapError}</div>
                    )}

                    <div className="charter-bootstrap__actions">
                      <ActionButton
                        variant="primary"
                        disabled={!canApplyBootstrap}
                        onClick={() => void applyBootstrap()}
                      >
                        {bootstrapSaving ? t('footer.applying') : t('bootstrap.apply')}
                      </ActionButton>
                      <ActionButton disabled={bootstrapSaving} onClick={discardBootstrap}>
                        {t('bootstrap.discard')}
                      </ActionButton>
                    </div>
                  </section>
                )}
              </>
            )}

            {section === 'context' && (
              <section className="charter-card charter-preview">
                <div className="charter-preview__meta">
                  <div className="charter-cardtitle">
                    <span className="charter-kicker">{t('preview.title')}</span>
                    <h3>{t('overview.budgetDetail')}</h3>
                  </div>
                  <StatusTag tone="info">{t('preview.bytes', { bytes: utf8Bytes(preview) })}</StatusTag>
                </div>
                <pre>{preview || t('preview.empty')}</pre>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export type { SessionId }
