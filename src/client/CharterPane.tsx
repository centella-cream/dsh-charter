import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
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
  DeliverableProgress,
} from '../core/schemas.js'
import type { CharterView } from '../host/types.js'
import type { CharterSource } from './store.js'
import type {
  BootstrapProblem,
  CharterDraft,
  CharterSection,
  DraftEditor,
  DraftFeedback,
} from './draft-store.js'
import { CHARTER_LOCALE_NS, type CharterLocaleKey } from './locales.js'
import {
  activeItems,
  itemCounts,
  pendingItems,
  previewPrompt,
  projectView,
  promptBudgetAdmission,
  utf8Bytes,
  type ProjectedItem,
} from './preview.js'
import { buildBootstrapPlan, firstDraftTextIssue, type BootstrapPlan } from './bootstrap-plan.js'
import './charter.css'

type CharterText = TranslateNS<typeof CHARTER_LOCALE_NS>

export interface CharterPaneInjected {
  readonly source: CharterSource
  readonly draft: CharterDraft
  /** Release the per-Session source lease when this view binding unmounts. */
  readonly release: () => void
}

type CharterPaneProps = PropsRuntime<'conversation.view'>
  & PropsLocale<typeof CHARTER_LOCALE_NS>
  & CharterPaneInjected

const EMPTY_PLAN: BootstrapPlan = {
  ops: [],
  active: 0,
  pending: 0,
  pendingInvariants: 0,
  pendingDeliverables: 0,
  outcomes: {},
}

function formatBytes(t: CharterText, bytes: number): string {
  return bytes < 1_024
    ? t('unit.bytes', { value: bytes })
    : t('unit.kib', { value: (bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0) })
}

function progressLabel(progress: DeliverableProgress | undefined, t: CharterText): string {
  return t(`progress.${progress ?? 'not-started'}`)
}

function errorLabel(code: CharterErrorCode, t: CharterText): string {
  return t(`error.${code}`)
}

function textIssueMessage(issue: 'empty' | 'control' | 'surrogate', t: CharterText): string {
  if (issue === 'control') return t('editor.issue.control')
  if (issue === 'surrogate') return t('editor.issue.surrogate')
  return t('editor.issue.empty')
}

function countLabel(
  t: CharterText,
  count: number,
  one: CharterLocaleKey,
  other: CharterLocaleKey,
): string {
  return t(count === 1 ? one : other, { count })
}

/** Resolve a stable feedback descriptor against the current locale. */
function feedbackText(feedback: DraftFeedback | null, t: CharterText): string | null {
  if (feedback === null) return null
  switch (feedback.kind) {
    case 'saved': return t('footer.saved', { revision: feedback.revision })
    case 'replayed': return t('footer.replayed')
    case 'bootstrapSaved':
      return t('footer.bootstrapSaved', {
        revision: feedback.revision,
        active: feedback.active,
        pending: feedback.pending,
      })
    case 'error': return errorLabel(feedback.code, t)
    case 'connection': return t('error.connection')
    case 'scope': return t('error.draftScope')
    case 'editorBudget': return t('budget.editorOver', { limit: formatBytes(t, feedback.limit) })
    case 'itemBudget': return t('budget.itemOver', { limit: formatBytes(t, feedback.limit) })
    case 'editorUnchanged':
      return feedback.target === 'objective' ? t('editor.unchangedObjective') : t('editor.unchangedItem')
    case 'editorInvalid': return textIssueMessage(feedback.issue, t)
    case 'discarded': return t('footer.discarded')
  }
}

function feedbackDetail(feedback: DraftFeedback | null): string | undefined {
  return feedback?.kind === 'error' ? feedback.detail : undefined
}

function bootstrapProblemText(problem: BootstrapProblem | null, t: CharterText): string | null {
  if (problem === null) return null
  switch (problem.kind) {
    case 'stale': return t('bootstrap.stale')
    case 'request-failed': return t('bootstrap.requestFailed')
    case 'unavailable': return t('bootstrap.unavailable')
    case 'save-failed':
      return problem.code === undefined ? t('bootstrap.saveFailed') : errorLabel(problem.code, t)
  }
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

function itemState(item: ProjectedItem): 'done' | 'warning' | 'ongoing' | 'idle' {
  if (item.lifecycle === 'archived' || item.lifecycle === 'superseded') return 'idle'
  if (item.review === 'pending') return 'warning'
  if (item.kind === 'deliverable' && item.progress === 'done') return 'done'
  if (item.kind === 'deliverable' && item.progress === 'in-progress') return 'ongoing'
  return 'idle'
}

function shortText(text: string, length = 48): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length <= length ? normalized : `${normalized.slice(0, length)}...`
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
  title,
  busy,
}: {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: 'primary' | 'outline' | 'ghost'
  readonly ariaLabel?: string
  readonly title?: string
  readonly busy?: boolean
}) {
  return (
    <button
      type="button"
      className={`charter-button charter-button--${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      aria-busy={busy === true ? true : undefined}
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
  title,
}: {
  readonly children: ReactNode
  readonly tone?: 'quiet' | 'info' | 'success' | 'warning' | 'danger'
  readonly title?: string
}) {
  return <span className={`charter-tag charter-tag--${tone}`} title={title}>{children}</span>
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
  previousBytes,
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
  readonly previousBytes?: number | undefined
  readonly t: CharterText
}) {
  const bytes = utf8Bytes(value)
  const shrinking = previousBytes !== undefined && bytes < previousBytes
  const over = bytes > maxBytes && !shrinking
  const overButShrinking = bytes > maxBytes && shrinking
  const save = (): void => {
    if (!over && value.trim().length > 0) onSave()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      save()
    }
  }
  const onReasonKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      save()
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
        <label className="charter-editor__reasonfield">
          <span>{t('editor.reasonLabel')}</span>
          <input
            className="charter-editor__reason"
            value={reason ?? ''}
            placeholder={t('editor.reasonPlaceholder')}
            aria-label={t('editor.reasonLabel')}
            onChange={event => onReasonChange?.(event.target.value)}
            onKeyDown={onReasonKeyDown}
          />
        </label>
      )}
      <div className="charter-editor__actions">
        <span className={over ? 'charter-budget is-over' : 'charter-budget'}>
          {overButShrinking
            ? t('budget.shrinking')
            : over
              ? t('budget.editorOver', { limit: formatBytes(t, maxBytes) })
              : `${formatBytes(t, bytes)} / ${formatBytes(t, maxBytes)}`}
        </span>
        <ActionButton variant="outline" disabled={over || value.trim().length === 0} onClick={save}>
          {t('editor.stage')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('editor.cancel')}</ActionButton>
      </div>
      <span className="charter-editor__hint">{t('editor.hint')}</span>
    </>
  )
}

function closeMenu(event: { currentTarget: EventTarget }): void {
  const target = event.currentTarget as HTMLElement | null
  target?.closest('details')?.removeAttribute('open')
}

function ItemRow({
  item,
  successor,
  editable,
  onUnstage,
  onEdit,
  onSupersede,
  onQueue,
  t,
}: {
  readonly item: ProjectedItem
  readonly successor: ProjectedItem | undefined
  readonly editable: boolean
  readonly onUnstage: (itemId: string) => void
  readonly onEdit: (item: ProjectedItem) => void
  readonly onSupersede: (item: ProjectedItem) => void
  readonly onQueue: (op: CharterOp) => void
  readonly t: CharterText
}) {
  const [confirmPurge, setConfirmPurge] = useState(false)
  const current = item.lifecycle === 'current'
  const terminalHead = item.lifecycle === 'superseded' && item.supersedes === undefined
  const purgeable = !item.staged
    && ((item.review === 'rejected' && item.lifecycle === 'current')
      || (item.lifecycle === 'archived' && item.review === 'accepted')
      || terminalHead)
  const menuLabel = t('item.actionsAria', { text: shortText(item.text) })
  const canMutate = editable && !item.staged
  const hasMenu = canMutate && (current || purgeable)
  return (
    <article
      className={`charter-item${item.lifecycle !== 'current' || item.review === 'rejected' ? ' charter-item--inactive' : ''}${item.staged ? ' is-staged' : ''}`}
    >
      <div className="charter-item__main">
        <StateMark state={itemState(item)} />
        <div className="charter-item__copy">
          <span className="charter-item__text">{item.text}</span>
          <div className="charter-item__meta">
            {item.staged && <StatusTag tone="info">{t('tag.staged')}</StatusTag>}
            {item.review === 'pending' && <StatusTag tone="warning">{t('tag.proposal')}</StatusTag>}
            {item.review === 'rejected' && <StatusTag tone="danger">{t('tag.rejected')}</StatusTag>}
            {item.kind === 'deliverable' && <StatusTag>{progressLabel(item.progress, t)}</StatusTag>}
            {item.lifecycle === 'archived' && <StatusTag>{t('tag.archived')}</StatusTag>}
            {item.lifecycle === 'superseded' && <StatusTag>{t('tag.superseded')}</StatusTag>}
            {item.supersedes !== undefined && <StatusTag title={t('item.replacementHint')}>{t('tag.replacement')}</StatusTag>}
            {item.verification.state === 'verified' && (
              <StatusTag tone="success">
                {item.verification.by === 'validator' ? t('tag.verifiedValidator') : t('tag.verifiedUser')}
              </StatusTag>
            )}
            {item.verification.state === 'failed' && (
              <StatusTag tone="danger" title={item.verification.reason}>
                {t('tag.verificationFailedReason', { reason: item.verification.reason })}
              </StatusTag>
            )}
            {item.verification.state === 'unavailable' && (
              <StatusTag tone="warning" title={item.verification.reason}>
                {t('tag.verificationUnavailableReason', { reason: item.verification.reason })}
              </StatusTag>
            )}
            {successor !== undefined && <StatusTag>{t('tag.replacedBy', { text: shortText(successor.text) })}</StatusTag>}
            <span className="charter-item__bytes">{formatBytes(t, utf8Bytes(item.text))}</span>
          </div>
        </div>
      </div>
      <div className="charter-item__actions">
        {item.staged && (
          <ActionButton
            ariaLabel={`${menuLabel}: ${t('item.unstage')}`}
            disabled={!editable}
            onClick={() => onUnstage(item.id)}
          >
            {t('item.unstage')}
          </ActionButton>
        )}
        {item.review === 'pending' && current && !item.staged && (
          <>
            <ActionButton disabled={!editable} onClick={() => onQueue({ type: 'item.accept', itemId: item.id })}>
              {t('item.accept')}
            </ActionButton>
            <ActionButton disabled={!editable} onClick={() => onQueue({ type: 'item.reject', itemId: item.id })}>
              {t('item.reject')}
            </ActionButton>
          </>
        )}
        {hasMenu && (
          <details className="charter-item__menu">
            <summary className="charter-button charter-button--ghost" aria-label={menuLabel}>{t('item.actions')}</summary>
            <div className="charter-item__menulist" role="menu">
              {current && item.review === 'accepted' && (
                <>
                  <button type="button" role="menuitem" onClick={event => { closeMenu(event); onEdit(item) }}>
                    {t('item.edit')}
                  </button>
                  {item.supersedes === undefined && (
                    <button type="button" role="menuitem" onClick={event => { closeMenu(event); onSupersede(item) }}>
                      {t('item.replace')}
                    </button>
                  )}
                  {item.supersedes === undefined && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={event => {
                        closeMenu(event)
                        onQueue({ type: 'item.archive', itemId: item.id })
                      }}
                    >
                      {t('item.archive')}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={event => {
                      closeMenu(event)
                      onQueue({
                        type: 'item.verification.set',
                        itemId: item.id,
                        verification: item.verification.state === 'verified' ? 'unchecked' : 'verified',
                      })
                    }}
                  >
                    {item.verification.state === 'verified' ? t('item.unverify') : t('item.verify')}
                  </button>
                </>
              )}
              {item.lifecycle === 'archived' && item.review === 'accepted' && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={event => {
                    closeMenu(event)
                    onQueue({ type: 'item.restore', itemId: item.id })
                  }}
                >
                  {t('item.restore')}
                </button>
              )}
              {purgeable && (confirmPurge
                ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={event => {
                          closeMenu(event)
                          setConfirmPurge(false)
                          onQueue({ type: 'item.purge', itemId: item.id, confirmed: true })
                        }}
                      >
                        {t('item.confirmPurge')}
                      </button>
                      <button type="button" role="menuitem" onClick={() => setConfirmPurge(false)}>
                        {t('item.keep')}
                      </button>
                    </>
                  )
                : (
                    <button
                      type="button"
                      role="menuitem"
                      title={terminalHead ? t('item.purgeDetaches') : undefined}
                      onClick={event => { closeMenu(event); setConfirmPurge(true) }}
                    >
                      {t('item.purge')}
                    </button>
                  ))}
            </div>
          </details>
        )}
      </div>
      {item.kind === 'deliverable' && item.review === 'accepted' && current && !item.staged && (
        <label className="charter-progress">
          <span>{t('progress.label')}</span>
          <select
            value={item.progress}
            disabled={!editable}
            aria-label={`${t('progress.label')}: ${shortText(item.text)}`}
            onChange={event => onQueue({
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

export function CharterPane({ source, draft, release, t }: CharterPaneProps) {
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const view = state.view
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot)
  const {
    section,
    ops,
    baseRevision,
    editor,
    editorText,
    editorReason,
    editorNeedsReason,
    newInvariant,
    newDeliverable,
    feedback,
    saving,
    bootstrapSaving,
    bootstrapPhase,
    bootstrap,
    bootstrapObjective,
    bootstrapItems,
    bootstrapProblem,
  } = draftState
  const [showHistoryItems, setShowHistoryItems] = useState(false)
  const [visibleCandidates, setVisibleCandidates] = useState(40)
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => {
    // The lease is instance-bound: releasing it is idempotent and a shared
    // Session is only disposed after the last view binding is gone. Draft
    // state lives on the controller, so switching tabs no longer loses work.
    release()
  }, [release])

  useEffect(() => {
    if (view !== null) draft.ensureBootstrap(view, state.status === 'ready')
  }, [view, state.status, draft])

  useEffect(() => {
    draft.bindLifecycle(view?.lifecycle)
  }, [view?.lifecycle, draft])

  useEffect(() => {
    if (editor === null) triggerRef.current?.focus?.()
  }, [editor])

  const projected = view === null ? null : projectView(view, ops)
  const projectedObjective = projected?.objective ?? null
  const projectedItems = projected?.items ?? []
  const invariants = projectedItems.filter(item => item.kind === 'invariant')
  const deliverables = projectedItems.filter((item): item is ProjectedItem & { kind: 'deliverable' } => item.kind === 'deliverable')
  const counts = itemCounts(projectedItems)
  const activeInvariants = activeItems(invariants)
  const pendingInvariants = pendingItems(invariants)
  const currentInvariants = [...activeInvariants, ...pendingInvariants]
  const historyInvariants = invariants.filter(item => item.lifecycle !== 'current' || item.review === 'rejected')
  const activeDeliverables = activeItems(deliverables)
  const pendingDeliverables = pendingItems(deliverables)
  const currentDeliverables = [...activeDeliverables, ...pendingDeliverables]
  const historyDeliverables = deliverables.filter(item => item.lifecycle !== 'current' || item.review === 'rejected')
  const successorOf = (item: ProjectedItem): ProjectedItem | undefined =>
    item.supersededBy === undefined ? undefined : projectedItems.find(candidate => candidate.id === item.supersededBy)

  const bootstrapPlan = useMemo(
    () => (view !== null && bootstrapPhase === 'draft'
      ? buildBootstrapPlan(view, bootstrapObjective, bootstrapItems)
      : EMPTY_PLAN),
    [view, bootstrapPhase, bootstrapObjective, bootstrapItems],
  )
  const effectiveOps = ops.length > 0
    ? ops
    : bootstrapPhase === 'draft' ? bootstrapPlan.ops : []
  const preview = useMemo(
    () => (view === null ? '' : previewPrompt(view, effectiveOps)),
    [view, effectiveOps],
  )
  const bootstrapPromptBytes = useMemo(
    () => (view === null || bootstrapPhase !== 'draft' ? 0 : utf8Bytes(previewPrompt(view, bootstrapPlan.ops))),
    [view, bootstrapPhase, bootstrapPlan.ops],
  )
  const selectedBootstrapItems = bootstrapItems.filter(item => item.selected && item.text.trim().length > 0)
  const bootstrapObjectiveOver = view !== null && utf8Bytes(bootstrapObjective) > view.limits.maxObjectiveBytes
  const bootstrapItemsOver = view !== null
    && selectedBootstrapItems.some(item => utf8Bytes(item.text) > view.limits.maxItemBytes)
  const bootstrapBudgetOver = view !== null && bootstrapPromptBytes > view.limits.maxPromptBytes
  const bootstrapStorageOver = view !== null && (
    bootstrapPlan.ops.length > view.limits.maxOps
    || view.items.length + bootstrapPlan.active + bootstrapPlan.pending > view.limits.maxItems
    || view.items.filter(item => item.review === 'pending').length + bootstrapPlan.pending > view.limits.maxPendingItems
  )
  const bootstrapTextIssue = bootstrapPhase === 'draft' && bootstrap !== null
    ? firstDraftTextIssue(bootstrapObjective, bootstrapItems)
    : undefined
  const canApplyBootstrap = bootstrap !== null
    && bootstrapPhase === 'draft'
    && state.status === 'ready'
    && ops.length === 0
    && editor === null
    && !bootstrapSaving
    && bootstrapPlan.ops.length > 0
    && !bootstrapObjectiveOver
    && !bootstrapItemsOver
    && !bootstrapBudgetOver
    && !bootstrapStorageOver
    && bootstrapTextIssue === undefined

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

  const online = state.status === 'ready'
  const revisionConflict = baseRevision !== null && view.revision !== baseRevision
  const editable = view.status === 'ready' && !saving && !bootstrapSaving && online && editor === null && state.status === 'ready'
  const promptBudget = promptBudgetAdmission(view.promptText, preview, view.limits.maxPromptBytes)
  const previewBytes = promptBudget.previewBytes
  const contextOver = promptBudget.over
  const contextBlocksApply = promptBudget.blocksApply
  const budgetPercent = Math.min(100, Math.round((previewBytes / view.limits.maxPromptBytes) * 100))
  const message = feedbackText(feedback, t)
  const messageDetail = feedbackDetail(feedback)
  const notice = view.status === 'ready' ? null : statusMessage(view, t)
  const disconnected = state.status === 'error'
  const overBudget = view.overBudget
  const showEmpty = view.status === 'ready'
    && !overBudget
    && projectedObjective === null
    && projectedItems.length === 0
    && (bootstrapPhase === 'idle' || bootstrapPhase === 'dismissed')
  const draftOpen = bootstrapPhase === 'draft'

  const goSection = (next: CharterSection): void => draft.setSection(next)
  const queue = (op: CharterOp): void => {
    if (!online || view.status !== 'ready' || saving) return
    draft.stage(view, op)
  }
  const openEditor = (target: DraftEditor): void => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    draft.openEditor(target, view)
  }
  const applyDraft = (): void => {
    void draft.applyDraft(view).finally(() => statusRef.current?.focus())
  }
  const applyBootstrapDraft = (): void => {
    void draft.applyBootstrap(view).finally(() => statusRef.current?.focus())
  }
  const openHistory = (): void => {
    setVisibleCandidates(40)
    goSection('history')
  }

  const renderItems = (
    items: readonly ProjectedItem[],
    history: readonly ProjectedItem[],
    emptyKey: 'invariants.empty' | 'deliverables.empty',
  ): ReactNode => {
    const visible = showHistoryItems ? [...items, ...history] : items
    return (
      <>
        {visible.length === 0 && <p className="charter-empty">{t(emptyKey)}</p>}
        {visible.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            successor={successorOf(item)}
            editable={editable}
            onUnstage={itemId => draft.unstage(itemId)}
            onEdit={value => openEditor({ kind: 'edit', item: value as unknown as CharterItem })}
            onSupersede={value => openEditor({ kind: 'supersede', item: value as unknown as CharterItem })}
            onQueue={queue}
            t={t}
          />
        ))}
        {history.length > 0 && (
          <button
            type="button"
            className="charter-historytoggle"
            onClick={() => setShowHistoryItems(current => !current)}
          >
            {showHistoryItems
              ? t('history.hide')
              : t('history.show', { count: history.length })}
          </button>
        )}
      </>
    )
  }

  return (
    <main className="charter-root" data-dsh-part="charter-pane">
      <div className="charter-shell">
        <header className="charter-pagehead">
          <div className="charter-heading">
            <CharterMark />
            <div className="charter-heading__copy">
              <h2>{t('header.title')}</h2>
              <p className="charter-subtitle">{t('header.subtitle')}</p>
              <p className="charter-disclaimer">{t('header.disclaimer')}</p>
            </div>
          </div>
          <div className="charter-headside">
            <div className="charter-chips">
              <StatusTag tone={view.status === 'ready' && !overBudget ? 'success' : 'warning'}>
                {t('stats.revision', { revision: view.revision })}
              </StatusTag>
              <StatusTag>{t('stats.active', { count: counts.active })}</StatusTag>
              <StatusTag>{t('stats.stored', { count: projectedItems.length })}</StatusTag>
            </div>
            <div className={`charter-meter${contextOver ? ' is-over' : budgetPercent >= 80 ? ' is-warn' : ''}`}>
              <span>
                {t('stats.budget', {
                  used: formatBytes(t, previewBytes),
                  limit: formatBytes(t, view.limits.maxPromptBytes),
                })}
              </span>
              <span className="charter-meter__track" aria-hidden="true">
                <span className="charter-meter__fill" style={{ width: `${budgetPercent}%` }} />
              </span>
            </div>
          </div>
        </header>

        {state.status === 'connecting' && view !== null && (
          <div className="charter-notice" role="status">{t('status.reconnecting')}</div>
        )}
        {disconnected && (
          <div className="charter-notice charter-notice--danger" role="alert">
            <span>{t('error.connection')}</span>
            <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
          </div>
        )}
        {notice !== null && (
          <div className="charter-notice charter-notice--warning" role="status">{notice}</div>
        )}
        {overBudget && (
          <div className="charter-notice charter-notice--warning" role="alert">
            {t('status.overBudget')}
          </div>
        )}
        {revisionConflict && (
          <div className="charter-notice charter-notice--warning" role="alert">
            <span>{t('notice.conflict', { from: baseRevision ?? 0, to: view.revision })}</span>
            <ActionButton
              variant="outline"
              disabled={saving || bootstrapSaving}
              onClick={() => draft.rebase(view)}
            >
              {t('conflict.rebase', { revision: view.revision })}
            </ActionButton>
          </div>
        )}
        {contextOver && (
          <div
            className={`charter-notice${contextBlocksApply ? ' charter-notice--danger' : ' charter-notice--warning'}`}
            role="alert"
          >
            {contextBlocksApply
              ? t('budget.contextOver', { limit: formatBytes(t, view.limits.maxPromptBytes) })
              : t('budget.shrinking')}
          </div>
        )}

        <footer className="charter-actionbar">
          <div
            ref={statusRef}
            className="charter-actionbar__status"
            tabIndex={-1}
            role={feedback?.kind === 'error' || feedback?.kind === 'connection' ? 'alert' : 'status'}
            aria-live="polite"
            title={messageDetail}
          >
            <span className={`charter-dot${ops.length > 0 || draftOpen ? ' is-staged' : ''}`} aria-hidden="true" />
            <div>
              <strong>
                {ops.length === 0
                  ? draftOpen ? t('footer.draftStatus') : t('footer.none')
                  : countLabel(t, ops.length, 'footer.one', 'footer.other')}
              </strong>
              {message !== null && <span className="charter-actionbar__message">{message}</span>}
              <span className="charter-actionbar__hint">{t('footer.applyHint')}</span>
            </div>
          </div>
          <div className="charter-actionbar__actions">
            <ActionButton
              onClick={() => goSection(section === 'context' ? 'overview' : 'context')}
            >
              {section === 'context' ? t('footer.hidePreview') : t('footer.preview')}
            </ActionButton>
            {draftOpen && ops.length === 0
              ? (
                  <>
                    <ActionButton
                      disabled={!canApplyBootstrap}
                      onClick={applyBootstrapDraft}
                      busy={bootstrapSaving}
                    >
                      {bootstrapSaving ? t('footer.applying') : t('bootstrap.apply')}
                    </ActionButton>
                    <ActionButton disabled={bootstrapSaving} onClick={() => draft.dismissBootstrap()}>
                      {t('bootstrap.discard')}
                    </ActionButton>
                  </>
                )
              : (
                  <>
                    <ActionButton disabled={ops.length === 0 || saving} onClick={() => { draft.discard(); statusRef.current?.focus() }}>
                      {t('footer.discard')}
                    </ActionButton>
                    <ActionButton
                      variant="primary"
                      disabled={ops.length === 0 || !editable || revisionConflict || contextBlocksApply || disconnected}
                      onClick={applyDraft}
                      busy={saving}
                    >
                      {saving ? t('footer.applying') : t('footer.apply')}
                    </ActionButton>
                  </>
                )}
          </div>
        </footer>

        <div className="charter-body">
          <nav className="charter-nav" aria-label={t('nav.label')}>
            <span className="charter-nav__label">{t('nav.label')}</span>
            {([
              { id: 'overview' as const, label: t('nav.overview') },
              { id: 'objective' as const, label: t('nav.objective'), dot: projectedObjective !== null },
              { id: 'invariants' as const, label: t('nav.invariants'), badge: invariants.length },
              { id: 'deliverables' as const, label: t('nav.deliverables'), badge: deliverables.length },
              { id: 'history' as const, label: t('nav.history'), dot: bootstrapPhase !== 'idle' },
              { id: 'context' as const, label: t('nav.context') },
            ] as const).map(item => (
              <button
                key={item.id}
                type="button"
                className={`charter-nav__item${section === item.id ? ' is-active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => goSection(item.id)}
              >
                <span className="charter-nav__text">{item.label}</span>
                {'badge' in item && item.badge !== undefined && <span className="charter-nav__badge">{item.badge}</span>}
                {'dot' in item && item.dot === true && <span className="charter-nav__dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>

          <div className="charter-content">
            {section === 'overview' && (
              <>
                {bootstrapPhase === 'draft' && (
                  <button type="button" className="charter-callout" onClick={openHistory}>
                    <span className="charter-kicker">{t('bootstrap.kicker')}</span>
                    <strong>{t('bootstrap.ready')}</strong>
                    <span>{t('bootstrap.body')}</span>
                    <span className="charter-callout__link">{t('bootstrap.reviewNow')}</span>
                  </button>
                )}
                {bootstrapPhase === 'checking' && (
                  <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>
                )}
                {(bootstrapPhase === 'failed' || bootstrapPhase === 'unavailable' || bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live') && (
                  <div className="charter-callout charter-callout--static">
                    <span className="charter-kicker">{t('bootstrap.kicker')}</span>
                    <span>{bootstrapProblemText(bootstrapProblem, t)
                      ?? (bootstrapPhase === 'no-summary' ? t('bootstrap.noSummary')
                        : bootstrapPhase === 'not-live' ? t('bootstrap.notLive')
                          : t('bootstrap.overviewFailed'))}</span>
                    <span className="charter-callout__actions">
                      <ActionButton variant="outline" onClick={() => draft.retryBootstrap(view)}>
                        {t('bootstrap.checkAgain')}
                      </ActionButton>
                      <ActionButton onClick={openHistory}>{t('nav.open')}</ActionButton>
                    </span>
                  </div>
                )}

                {showEmpty && (
                  <section className="charter-empty-state" role="note">
                    <span className="charter-kicker">{t('empty.kicker')}</span>
                    <h3>{t('empty.title')}</h3>
                    <p>{t('empty.body')}</p>
                    <div className="charter-empty-actions">
                      <ActionButton variant="primary" onClick={() => goSection('objective')}>
                        {t('objective.set')}
                      </ActionButton>
                      <ActionButton onClick={() => goSection('invariants')}>
                        {t('composer.addInvariant')}
                      </ActionButton>
                    </div>
                  </section>
                )}

                <section className={`charter-card charter-objective${utf8Bytes(projectedObjective?.current.text ?? '') > view.limits.maxObjectiveBytes ? ' is-over' : ''}`}>
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('objective.kicker')}</span>
                      <h3>{projectedObjective?.current.text ?? t('objective.empty')}</h3>
                      {projectedObjective === null && ops.some(op => op.type === 'objective.initialize' || op.type === 'objective.redirect') && (
                        <span className="charter-tag charter-tag--info">{t('tag.staged')}</span>
                      )}
                    </div>
                    <div className="charter-cardtools">
                      <span className="charter-budget">
                        {formatBytes(t, utf8Bytes(projectedObjective?.current.text ?? ''))} / {formatBytes(t, view.limits.maxObjectiveBytes)}
                      </span>
                      <ActionButton onClick={() => goSection('objective')}>{t('nav.open')}</ActionButton>
                    </div>
                  </div>
                  {projectedObjective !== null && projectedObjective.original.text !== projectedObjective.current.text && (
                    <p className="charter-original">{t('objective.original', { text: projectedObjective.original.text })}</p>
                  )}
                  {projectedObjective?.current.reason !== undefined && (
                    <p className="charter-original">{t('objective.reason', { reason: projectedObjective.current.reason })}</p>
                  )}
                  {projectedObjective !== null && projectedObjective.original.text !== projectedObjective.current.text
                    && projectedObjective.current.reason === undefined && (
                    <p className="charter-original">{t('objective.reason', { reason: t('objective.reasonDefault') })}</p>
                  )}
                </section>

                <div className="charter-overview-grid">
                  <button type="button" className="charter-card charter-statcard" onClick={() => goSection('invariants')}>
                    <span className="charter-kicker">{t('invariants.kicker')}</span>
                    <span className="charter-statcard__value">{activeInvariants.length}</span>
                    <span className="charter-statcard__label">{countLabel(t, activeInvariants.length, 'invariants.one', 'invariants.other')}</span>
                    <span className="charter-statcard__list">
                      {activeInvariants.length === 0
                        ? t('invariants.empty')
                        : activeInvariants.slice(0, 3).map(item => <span key={item.id}>{item.text}</span>)}
                    </span>
                    <span className="charter-statcard__link">{t('nav.open')}</span>
                  </button>
                  <button type="button" className="charter-card charter-statcard" onClick={() => goSection('deliverables')}>
                    <span className="charter-kicker">{t('deliverables.kicker')}</span>
                    <span className="charter-statcard__value">{activeDeliverables.length}</span>
                    <span className="charter-statcard__label">{countLabel(t, activeDeliverables.length, 'deliverables.one', 'deliverables.other')}</span>
                    <span className="charter-statcard__list">
                      {activeDeliverables.length === 0
                        ? t('deliverables.empty')
                        : activeDeliverables.slice(0, 3).map(item => (
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
                      <h3>{t('counts.summary', { active: counts.active, pending: counts.pending })}</h3>
                    </div>
                  </div>
                  <div className="charter-budgetgrid">
                    <span>{t('stats.budget', { used: formatBytes(t, previewBytes), limit: formatBytes(t, view.limits.maxPromptBytes) })}</span>
                    <span>{t('objective.kicker')} {formatBytes(t, utf8Bytes(projectedObjective?.current.text ?? ''))} / {formatBytes(t, view.limits.maxObjectiveBytes)}</span>
                    <span>{t('invariants.kicker')} {activeInvariants.length}</span>
                    <span>{t('deliverables.kicker')} {activeDeliverables.length}</span>
                    <span>{t('budget.recordLimit', { limit: formatBytes(t, view.limits.maxRecordBytes) })}</span>
                  </div>
                </section>
              </>
            )}

            {section === 'objective' && (
              <>
                <section className={`charter-card charter-objective${utf8Bytes(projectedObjective?.current.text ?? '') > view.limits.maxObjectiveBytes ? ' is-over' : ''}`}>
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('objective.kicker')}</span>
                      <h3>{projectedObjective?.current.text ?? t('objective.empty')}</h3>
                    </div>
                    <div className="charter-cardtools">
                      <span className="charter-budget">
                        {formatBytes(t, utf8Bytes(projectedObjective?.current.text ?? ''))} / {formatBytes(t, view.limits.maxObjectiveBytes)}
                      </span>
                      <ActionButton
                        variant="outline"
                        disabled={!editable || projectedObjective !== null && ops.some(op => op.type === 'objective.initialize' || op.type === 'objective.redirect')}
                        onClick={() => openEditor({ kind: 'objective' })}
                      >
                        {projectedObjective === null ? t('objective.set') : t('objective.redirect')}
                      </ActionButton>
                    </div>
                  </div>
                  {projectedObjective !== null && projectedObjective.original.text !== projectedObjective.current.text && (
                    <p className="charter-original">{t('objective.original', { text: projectedObjective.original.text })}</p>
                  )}
                  {projectedObjective?.current.reason !== undefined && (
                    <p className="charter-original">{t('objective.reason', { reason: projectedObjective.current.reason })}</p>
                  )}
                  {projectedObjective !== null && projectedObjective.original.text !== projectedObjective.current.text
                    && projectedObjective.current.reason === undefined && (
                    <p className="charter-original">{t('objective.reason', { reason: t('objective.reasonDefault') })}</p>
                  )}
                  {editor?.kind === 'objective' && (
                    <div className="charter-inlineeditor">
                      <TextEditor
                        value={editorText}
                        onChange={value => draft.setEditorText(value)}
                        reason={editorReason}
                        onReasonChange={value => draft.setEditorReason(value)}
                        showReason={editorNeedsReason}
                        onSave={() => draft.saveEditor(view)}
                        onCancel={() => draft.closeEditor()}
                        maxBytes={view.limits.maxObjectiveBytes}
                        previousBytes={utf8Bytes(projectedObjective?.current.text ?? '')}
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
                    <h3>{t('counts.summary', { active: activeInvariants.length, pending: pendingInvariants.length })}</h3>
                  </div>
                  <span className="charter-count">{invariants.length}</span>
                </div>
                <p className="charter-hint">{t('invariants.hint')}</p>
                {counts.pending > 0 && <p className="charter-hint">{t('pending.hint')}</p>}
                <div className="charter-list">
                  {renderItems(currentInvariants, historyInvariants, 'invariants.empty')}
                </div>
                <div className={`charter-add${utf8Bytes(newInvariant) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newInvariant}
                    placeholder={t('composer.placeholderInvariant')}
                    aria-label={t('composer.inputAria')}
                    onChange={event => draft.setNewInvariant(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        draft.addItem(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${utf8Bytes(newInvariant) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                      {utf8Bytes(newInvariant) > view.limits.maxItemBytes
                        ? t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                        : `${formatBytes(t, utf8Bytes(newInvariant))} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                    </span>
                    <ActionButton
                      variant="outline"
                      disabled={!editable || newInvariant.trim().length === 0 || utf8Bytes(newInvariant) > view.limits.maxItemBytes}
                      onClick={() => draft.addItem(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))}
                    >
                      {t('composer.addInvariant')}
                    </ActionButton>
                  </div>
                </div>
                {editor !== null && editor.kind !== 'objective' && invariants.some(item => item.id === editor.item.id) && (
                  <div className="charter-inlineeditor">
                    <TextEditor
                      value={editorText}
                      onChange={value => draft.setEditorText(value)}
                      onSave={() => draft.saveEditor(view)}
                      onCancel={() => draft.closeEditor()}
                      maxBytes={view.limits.maxItemBytes}
                      previousBytes={editor.kind === 'edit' ? utf8Bytes(editor.item.text) : undefined}
                      t={t}
                    />
                  </div>
                )}
              </section>
            )}

            {section === 'deliverables' && (
              <section className="charter-card charter-section">
                <div className="charter-cardhead">
                  <div className="charter-cardtitle">
                    <span className="charter-kicker">{t('deliverables.kicker')}</span>
                    <h3>{t('counts.summary', { active: activeDeliverables.length, pending: pendingDeliverables.length })}</h3>
                  </div>
                  <span className="charter-count">{deliverables.length}</span>
                </div>
                <div className="charter-list">
                  {renderItems(currentDeliverables, historyDeliverables, 'deliverables.empty')}
                </div>
                <div className={`charter-add${utf8Bytes(newDeliverable) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newDeliverable}
                    placeholder={t('composer.placeholderDeliverable')}
                    aria-label={t('composer.inputAria')}
                    onChange={event => draft.setNewDeliverable(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        draft.addItem(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${utf8Bytes(newDeliverable) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                      {utf8Bytes(newDeliverable) > view.limits.maxItemBytes
                        ? t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                        : `${formatBytes(t, utf8Bytes(newDeliverable))} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                    </span>
                    <ActionButton
                      variant="outline"
                      disabled={!editable || newDeliverable.trim().length === 0 || utf8Bytes(newDeliverable) > view.limits.maxItemBytes}
                      onClick={() => draft.addItem(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))}
                    >
                      {t('composer.addDeliverable')}
                    </ActionButton>
                  </div>
                </div>
                {editor !== null && editor.kind !== 'objective' && deliverables.some(item => item.id === editor.item.id) && (
                  <div className="charter-inlineeditor">
                    <TextEditor
                      value={editorText}
                      onChange={value => draft.setEditorText(value)}
                      onSave={() => draft.saveEditor(view)}
                      onCancel={() => draft.closeEditor()}
                      maxBytes={view.limits.maxItemBytes}
                      previousBytes={editor.kind === 'edit' ? utf8Bytes(editor.item.text) : undefined}
                      t={t}
                    />
                  </div>
                )}
              </section>
            )}

            {section === 'history' && (
              <>
                {bootstrapPhase === 'checking' && (
                  <div className="charter-notice" role="status">{t('bootstrap.loading')}</div>
                )}
                {bootstrapPhase === 'failed' && (
                  <div className="charter-notice charter-notice--danger" role="alert">
                    <span>{bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.requestFailed')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>
                )}
                {bootstrapPhase === 'unavailable' && (
                  <div className="charter-notice" role="status">
                    <span>{bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.unavailable')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>
                )}
                {(bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live' || bootstrapPhase === 'idle') && (
                  <div className="charter-notice" role="status">
                    <span>{bootstrapPhase === 'no-summary'
                      ? t('bootstrap.noSummary')
                      : bootstrapPhase === 'not-live' ? t('bootstrap.notLive') : t('bootstrap.body')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>
                )}
                {bootstrapPhase === 'dismissed' && (
                  <div className="charter-notice" role="status">
                    <span>{t('bootstrap.dismissed')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>
                )}
                {ops.length > 0 && (
                  <div className="charter-notice charter-notice--warning" role="status">
                    {t('bootstrap.blocked')}
                  </div>
                )}
                {bootstrap !== null && ops.length === 0 && editor !== null && (
                  <div className="charter-notice charter-notice--warning" role="status">
                    {t('bootstrap.blockedEditor')}
                    <ActionButton onClick={() => draft.closeEditor()}>{t('editor.cancel')}</ActionButton>
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
                          used: formatBytes(t, bootstrapPromptBytes),
                          limit: formatBytes(t, view.limits.maxPromptBytes),
                        })}
                      </span>
                    </div>
                    <p className="charter-copy">{t('bootstrap.body')}</p>
                    <span className="charter-source">
                      {bootstrap.source.shadowedTokens === undefined
                        ? t('bootstrap.sourcePlain')
                        : t('bootstrap.source', { tokens: bootstrap.source.shadowedTokens })}
                    </span>
                    <div className="charter-bootstrap__summary">
                      <StatusTag tone="info">{t('bootstrap.summary', { active: bootstrapPlan.active, pending: bootstrapPlan.pending })}</StatusTag>
                      <ActionButton disabled={bootstrapSaving} onClick={() => draft.setAllBootstrapSelected(true)}>{t('bootstrap.selectAll')}</ActionButton>
                      <ActionButton disabled={bootstrapSaving} onClick={() => draft.setAllBootstrapSelected(false)}>{t('bootstrap.selectNone')}</ActionButton>
                    </div>
                    {view.objective === null && (
                      <label className="charter-bootstrap__field">
                        <span>{t('bootstrap.objective')}</span>
                        <textarea
                          value={bootstrapObjective}
                          rows={2}
                          disabled={bootstrapSaving}
                          aria-label={t('bootstrap.objective')}
                          onChange={event => draft.setBootstrapObjective(event.target.value)}
                        />
                        <span className={`charter-budget${bootstrapObjectiveOver ? ' is-over' : ''}`}>
                          {bootstrapObjectiveOver
                            ? t('budget.objectiveOver', { limit: formatBytes(t, view.limits.maxObjectiveBytes) })
                            : `${formatBytes(t, utf8Bytes(bootstrapObjective))} / ${formatBytes(t, view.limits.maxObjectiveBytes)}`}
                        </span>
                      </label>
                    )}
                    {(() => {
                      const ordered = [
                        ...bootstrapItems.filter(item => item.kind === 'invariant').map(item => ({ item, kind: 'invariant' as const })),
                        ...bootstrapItems.filter(item => item.kind === 'deliverable').map(item => ({ item, kind: 'deliverable' as const })),
                      ]
                      const visible = ordered.slice(0, visibleCandidates)
                      return (
                        <>
                          {visible.map(({ item }, index) => {
                            const bytes = utf8Bytes(item.text)
                            const outcome = bootstrapPlan.outcomes[item.id]
                            return (
                              <label className="charter-bootstrap__item" key={item.id}>
                                <input
                                  type="checkbox"
                                  checked={item.selected}
                                  disabled={bootstrapSaving}
                                  aria-label={t('bootstrap.includeAria', { index: index + 1 })}
                                  onChange={event => draft.updateBootstrapItem(item.id, { selected: event.target.checked })}
                                />
                                <div className="charter-draftfield">
                                  <textarea
                                    value={item.text}
                                    rows={2}
                                    disabled={bootstrapSaving}
                                    aria-label={t('bootstrap.editAria', { index: index + 1 })}
                                    onChange={event => draft.updateBootstrapItem(item.id, { text: event.target.value })}
                                  />
                                  <span className="charter-draftfield__meta">
                                    {outcome !== undefined && (
                                      <StatusTag tone={outcome === 'active' ? 'success' : 'warning'}>
                                        {outcome === 'active' ? t('bootstrap.outcomeActive') : t('bootstrap.outcomePending')}
                                      </StatusTag>
                                    )}
                                    <span className={`charter-budget${bytes > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                                      {bytes > view.limits.maxItemBytes
                                        ? t('bootstrap.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                                        : `${formatBytes(t, bytes)} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                                    </span>
                                  </span>
                                </div>
                              </label>
                            )
                          })}
                          {ordered.length > visible.length && (
                            <ActionButton onClick={() => setVisibleCandidates(current => current + 40)}>
                              {t('bootstrap.showMore', { count: ordered.length - visible.length })}
                            </ActionButton>
                          )}
                        </>
                      )
                    })()}
                    {bootstrapTextIssue !== undefined && (
                      <div className="charter-notice charter-notice--danger" role="alert">
                        {textIssueMessage(bootstrapTextIssue.issue, t)}
                        {bootstrapTextIssue.where === 'candidate'
                          ? ` (${t('bootstrap.editAria', { index: (bootstrapTextIssue.index ?? 0) + 1 })})`
                          : ''}
                      </div>
                    )}
                    {bootstrapBudgetOver && (
                      <div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overBudget', { limit: formatBytes(t, view.limits.maxPromptBytes) })}
                      </div>
                    )}
                    {bootstrapPlan.pending > 0 && (
                      <div className="charter-notice charter-notice--warning" role="note">
                        {bootstrapPlan.pending === 1
                          ? t('bootstrap.pendingOne')
                          : t('bootstrap.pendingOther', { count: bootstrapPlan.pending })}
                      </div>
                    )}
                    {bootstrapStorageOver && (
                      <div className="charter-notice charter-notice--danger" role="alert">
                        {t('bootstrap.overItems')}
                      </div>
                    )}
                    {bootstrapProblem !== null && bootstrapProblem.kind === 'save-failed' && (
                      <div className="charter-notice charter-notice--warning" role="alert">
                        {bootstrapProblemText(bootstrapProblem, t)}
                      </div>
                    )}
                    <div className="charter-bootstrap__actions">
                      <ActionButton
                        variant="primary"
                        disabled={!canApplyBootstrap}
                        onClick={applyBootstrapDraft}
                        busy={bootstrapSaving}
                      >
                        {bootstrapSaving ? t('footer.applying') : t('bootstrap.apply')}
                      </ActionButton>
                      <ActionButton disabled={bootstrapSaving} onClick={() => draft.dismissBootstrap()}>
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
                    <h3>{t('preview.subtitle')}</h3>
                  </div>
                  <StatusTag tone="info">{t('preview.bytesLabel', { bytes: formatBytes(t, previewBytes) })}</StatusTag>
                </div>
                {draftOpen && ops.length === 0 && (
                  <div className="charter-notice" role="note">{t('footer.draftStatus')}</div>
                )}
                <pre>{preview || t('preview.empty')}</pre>
                <p className="charter-hint">{t('budget.recordLimit', { limit: formatBytes(t, view.limits.maxRecordBytes) })}</p>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export type { SessionId }
