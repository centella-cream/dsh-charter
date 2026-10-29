import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
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
import { inspectUserText } from '../core/normalize.js'
import { draftAdmission } from './admission.js'
import {
  bootstrapReplayPending,
  crossLifecycleUnknown,
  editReplayPending,
  maintenanceAttempt,
  maintenanceReplayPending,
  rebaseAvailable,
} from './draft-store.js'
import { type CharterRecordArchive, type CharterRestoreRequest } from '../core/schemas.js'
import { previewArchive } from './archive-preview.js'
import {
  activeItems,
  itemCounts,
  pendingItems,
  previewPrompt,
  projectView,
  promptBudgetAdmission,
  utf8Bytes,
  visibleItems,
  type ProjectedItem,
} from './preview.js'
import { firstDraftTextIssue, type BootstrapPlan } from './bootstrap-plan.js'
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
  usedExactFallback: false,
  exactRenders: 0,
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

function ErrorDetails({ detail, t }: { readonly detail: string | undefined; readonly t: CharterText }): ReactNode {
  if (detail === undefined || detail.trim().length === 0) return null
  return (
    <details className="charter-error-details">
      <summary>{t('error.details')}</summary>
      <pre>{detail}</pre>
    </details>
  )
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

/** One exhaustive switch over the Host-derived record state. */
function statusMessage(view: CharterView, t: CharterText): string | null {
  if (view.status === 'ready') return null
  const state = view.recordState
  switch (state?.kind) {
    case 'absent-unconfirmed':
      return t('status.absent')
    case 'invalid':
      return state.reason === 'future-schema'
        ? t('status.futureSchema')
        : state.reason === 'schema' ? t('status.invalidSchema') : t('status.invalidConsistency')
    case 'lifecycle-mismatch':
      return t('status.lifecycle')
    case 'write-uncertain':
      return t('status.writeUncertain')
    case 'unknown':
      return state.reason === 'initializing'
        ? t('status.initializing')
        : state.reason === 'legacy-host' ? t('status.legacyHost') : t('status.storage')
    case 'healthy':
      return view.status === 'initializing' ? t('status.initializing') : t('status.unavailable')
    default:
      return view.status === 'initializing' ? t('status.initializing') : t('status.unavailable')
  }
}

interface ArchivePreview {
  readonly fileName: string
  readonly archive?: CharterRecordArchive
  readonly errorKey?: string
  readonly errorParams?: Readonly<Record<string, string>>
  readonly health?: 'healthy' | 'schema-invalid' | 'consistency-invalid' | 'lifecycle-mismatch'
  readonly revision?: number | null
  readonly lifecycle?: string | null
  readonly digest?: string
  readonly exportedAt?: number
  readonly sourceSession?: string
  readonly payloadDigestOk?: boolean
  readonly recordDigestOk?: boolean
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

/** Render the lifecycle fingerprint as a compact, stable date label for the UI. */
function lifecycleLabel(value: string | null | undefined): string {
  if (!value) return '-'
  try {
    const parsed = JSON.parse(value) as { createdAt?: unknown }
    if (typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)) {
      const date = new Date(parsed.createdAt)
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10)
    }
  } catch {
    // Non-fingerprint legacy value: fall through to a short text label.
  }
  return shortText(value, 24)
}

/** Render an archive timestamp without ever throwing on hostile values. */
function formatTimestamp(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '-'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toISOString().slice(0, 19).replace('T', ' ')
  } catch {
    return '-'
  }
}

/** Localized health label for an archive preview. */
function archiveHealthLabel(
  health: 'healthy' | 'schema-invalid' | 'consistency-invalid' | 'lifecycle-mismatch',
  t: CharterText,
): string {
  if (health === 'healthy') return t('recovery.healthy')
  if (health === 'lifecycle-mismatch') return t('recovery.mismatch')
  return t('recovery.invalid')
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
  ariaDescribedBy,
  title,
  busy,
  className,
}: {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: 'primary' | 'outline' | 'ghost'
  readonly ariaLabel?: string
  readonly ariaDescribedBy?: string
  readonly title?: string
  readonly busy?: boolean
  readonly className?: string
}) {
  return (
    <button
      type="button"
      className={`charter-button charter-button--${variant}${className === undefined ? '' : ` ${className}`}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
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

/** Byte budget of the value the Host will store (normalized, not raw input). */
function normalizedBytes(value: string): number {
  return utf8Bytes(inspectUserText(value).value)
}

function normalizedNonEmpty(value: string): boolean {
  return inspectUserText(value).value.length > 0
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
  label,
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
  readonly label?: string | undefined
  readonly t: CharterText
}) {
  const budgetId = useId()
  const bytes = normalizedBytes(value)
  const shrinking = previousBytes !== undefined && bytes < previousBytes
  const over = bytes > maxBytes && !shrinking
  const overButShrinking = bytes > maxBytes && shrinking
  const save = (): void => {
    if (!over && normalizedNonEmpty(value)) onSave()
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
        aria-label={label ?? t('editor.charterTextAria')}
        aria-invalid={over}
        aria-describedby={budgetId}
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
        <span id={budgetId} className={over ? 'charter-budget is-over' : 'charter-budget'}>
          {overButShrinking
            ? t('budget.shrinking')
            : over
              ? t('budget.editorOver', { limit: formatBytes(t, maxBytes) })
              : `${formatBytes(t, bytes)} / ${formatBytes(t, maxBytes)}`}
        </span>
        <ActionButton variant="outline" disabled={over || !normalizedNonEmpty(value)} onClick={save}>
          {t('editor.stage')}
        </ActionButton>
        <ActionButton onClick={onCancel}>{t('editor.cancel')}</ActionButton>
      </div>
      <span className="charter-editor__hint">{t('editor.hint')}</span>
    </>
  )
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
  const rowRef = useRef<HTMLElement | null>(null)
  useEffect(() => { setConfirmPurge(false) }, [item.id, item.lifecycle, editable])
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const current = item.lifecycle === 'current'
  const terminalHead = item.lifecycle === 'superseded' && item.supersedes === undefined
  const purgeable = !item.staged
    && ((item.review === 'rejected' && item.lifecycle === 'current')
      || (item.lifecycle === 'archived' && item.review === 'accepted')
      || terminalHead)
  const unstageTarget = item.unstageTarget === null ? null : item.unstageTarget ?? item.id
  const menuLabel = t('item.actionsAria', { text: shortText(item.text) })
  const canMutate = editable && !item.staged
  const hasMenu = canMutate && (current || purgeable)
  // A queued action can remove the control that had focus; park focus on the
  // row (or the disclosure trigger) so it never falls back to <body>.
  const focusRow = (): void => {
    requestAnimationFrame(() => {
      const details = menuRef.current
      const summary = details?.querySelector('summary')
      if (details?.isConnected === true && summary !== null && summary !== undefined) {
        ;(summary as HTMLElement).focus()
      } else {
        rowRef.current?.focus()
      }
    })
  }
  const queueFromMenu = (op: CharterOp): void => {
    menuRef.current?.removeAttribute('open')
    onQueue(op)
    focusRow()
  }
  const openInEditor = (open: () => void): void => {
    menuRef.current?.removeAttribute('open')
    // The editor autofocuses; keep the row as the return target so closing the
    // editor restores focus inside the pane.
    rowRef.current?.focus()
    open()
  }
  return (
    <article
      ref={rowRef}
      tabIndex={-1}
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
            {item.supersedes !== undefined && <StatusTag>{t('tag.replacement')}</StatusTag>}
            {item.verification.state === 'verified' && (
              <StatusTag tone="success">
                {item.verification.by === 'validator' ? t('tag.verifiedValidator') : t('tag.verifiedUser')}
              </StatusTag>
            )}
            {item.verification.state === 'failed' && (
              <StatusTag tone="danger">
                {t('tag.verificationFailedReason', { reason: item.verification.reason })}
              </StatusTag>
            )}
            {item.verification.state === 'unavailable' && (
              <StatusTag tone="warning">
                {t('tag.verificationUnavailableReason', { reason: item.verification.reason })}
              </StatusTag>
            )}
            {successor !== undefined && <StatusTag>{t('tag.replacedBy', { text: shortText(successor.text) })}</StatusTag>}
            <span className="charter-item__bytes">{formatBytes(t, utf8Bytes(item.text))}</span>
          </div>
          {item.supersedes !== undefined && (
            <span className="charter-item__hint">{t('item.replacementHint')}</span>
          )}
          {terminalHead && <span className="charter-item__hint">{t('item.purgeDetaches')}</span>}
        </div>
      </div>
      <div className="charter-item__actions">
        {item.staged && unstageTarget !== null && (
          <ActionButton
            ariaLabel={`${menuLabel}: ${t('item.unstage')}`}
            disabled={!editable}
            onClick={() => {
              onUnstage(unstageTarget)
              focusRow()
            }}
          >
            {t('item.unstage')}
          </ActionButton>
        )}
        {item.review === 'pending' && current && !item.staged && (
          <>
            <ActionButton
              disabled={!editable}
              onClick={() => {
                onQueue({ type: 'item.accept', itemId: item.id })
                focusRow()
              }}
            >
              {t('item.accept')}
            </ActionButton>
            <ActionButton
              disabled={!editable}
              onClick={() => {
                onQueue({ type: 'item.reject', itemId: item.id })
                focusRow()
              }}
            >
              {t('item.reject')}
            </ActionButton>
          </>
        )}
        {hasMenu && (
          <details className="charter-item__menu" ref={menuRef}>
            {/*
              A plain disclosure: the summary toggles the menu, and its normal
              buttons are reachable with Tab. No `menu`/`menuitem` roles are
              claimed because the widget does not implement menu-button arrow
              navigation or roving focus.
            */}
            <summary className="charter-button charter-button--ghost" aria-label={menuLabel}>
              {t('item.actions')}
            </summary>
            <div className="charter-item__menulist">
              {current && item.review === 'accepted' && (
                <>
                  <button type="button" onClick={() => openInEditor(() => onEdit(item))}>
                    {t('item.edit')}
                  </button>
                  {item.supersedes === undefined && (
                    <button type="button" onClick={() => openInEditor(() => onSupersede(item))}>
                      {t('item.replace')}
                    </button>
                  )}
                  {item.supersedes === undefined && (
                    <button
                      type="button"
                      onClick={() => queueFromMenu({ type: 'item.archive', itemId: item.id })}
                    >
                      {t('item.archive')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => queueFromMenu({
                      type: 'item.verification.set',
                      itemId: item.id,
                      verification: item.verification.state === 'verified' ? 'unchecked' : 'verified',
                    })}
                  >
                    {item.verification.state === 'verified' ? t('item.unverify') : t('item.verify')}
                  </button>
                </>
              )}
              {item.lifecycle === 'archived' && item.review === 'accepted' && (
                <button
                  type="button"
                  onClick={() => queueFromMenu({ type: 'item.restore', itemId: item.id })}
                >
                  {t('item.restore')}
                </button>
              )}
              {purgeable && (confirmPurge
                ? (
                    <>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => {
                          setConfirmPurge(false)
                          queueFromMenu({ type: 'item.purge', itemId: item.id, confirmed: true })
                        }}
                      >
                        {t('item.confirmPurge')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmPurge(false)
                          focusRow()
                        }}
                      >
                        {t('item.keep')}
                      </button>
                    </>
                  )
                : (
                    <button
                      type="button"
                      onClick={() => setConfirmPurge(true)}
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
            onChange={event => {
              onQueue({
                type: 'deliverable.progress',
                itemId: item.id,
                progress: event.target.value as DeliverableProgress,
              })
              focusRow()
            }}
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
    bootstrapVisibleCount,
    bootstrapProblem,
    bootstrapBaseRevision,
  } = draftState
  const [showHistoryItems, setShowHistoryItems] = useState(false)
  const bootstrapId = useId()
  const applyHintId = useId()
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null)
  const [confirmRecovery, setConfirmRecovery] = useState<'initialize' | 'restore' | null>(null)
  const [confirmRestoreKey, setConfirmRestoreKey] = useState<string | null>(null)
  const [exportProblem, setExportProblem] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const archiveGenerationRef = useRef(0)
  const exportEpochRef = useRef(0)
  const exportInFlightRef = useRef(false)
  const viewRef = useRef(view)
  const archiveInputRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => {
    archiveGenerationRef.current += 1
    exportEpochRef.current += 1
    // The lease is instance-bound: releasing it is idempotent and a shared
    // Session is only disposed after the last view binding is gone. Draft
    // state lives on the controller, so switching tabs no longer loses work.
    release()
  }, [release])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    // Any Session/lifecycle/source transition invalidates an async archive
    // preview or export started against the previous authority.
    archiveGenerationRef.current += 1
    exportEpochRef.current += 1
    exportInFlightRef.current = false
    setArchivePreview(null)
    setConfirmRecovery(null)
    setExportProblem(null)
    setExporting(false)
    if (archiveInputRef.current !== null) archiveInputRef.current.value = ''
  }, [source, view?.sessionId, view?.lifecycle, draftState.lifecycle])

  useEffect(() => {
    // ONE atomic view reaction: bind lifecycle, start extraction when idle, and
    // reconcile a reviewed draft without ever half-cleaning in-flight/unknown
    // work. Keeping this in the store means the Pane cannot create invisible
    // replay locks with a second effect.
    if (view !== null) draft.syncView(view, state.status === 'ready')
  }, [view, state.status, draft])

  useEffect(() => {
    if (editor === null) triggerRef.current?.focus?.()
  }, [editor])

  const projected = view === null ? null : projectView(view, ops)
  const projectedObjective = projected?.objective ?? null
  const projectedItems = projected?.items ?? []
  const invariants = projectedItems.filter(item => item.kind === 'invariant')
  const deliverables = projectedItems.filter((item): item is ProjectedItem & { kind: 'deliverable' } => item.kind === 'deliverable')
  const counts = itemCounts(projectedItems)
  const committedActive = (view?.items ?? []).filter(item =>
    item.lifecycle === 'current' && item.review === 'accepted').length
  const committedStored = view?.items.length ?? 0
  const activeInvariants = activeItems(invariants)
  const pendingInvariants = pendingItems(invariants)
  // The Pane renders the single sorted projected list (filtered to the working
  // rows), never active-then-pending groups: an order-1 pending row must stay
  // above an order-2 active row just as the prompt renders it.
  const currentInvariants = visibleItems(invariants)
  const historyInvariants = invariants.filter(item => item.lifecycle !== 'current' || item.review === 'rejected')
  const activeDeliverables = activeItems(deliverables)
  const pendingDeliverables = pendingItems(deliverables)
  const currentDeliverables = visibleItems(deliverables)
  const historyDeliverables = deliverables.filter(item => item.lifecycle !== 'current' || item.review === 'rejected')
  const successorOf = (item: ProjectedItem): ProjectedItem | undefined =>
    item.supersededBy === undefined ? undefined : projectedItems.find(candidate => candidate.id === item.supersededBy)

  const bootstrapPlan = useMemo(
    () => (view !== null && bootstrapPhase === 'draft'
      ? draft.bootstrapPlan(view)
      : EMPTY_PLAN),
    [view, bootstrapPhase, draft, bootstrapObjective, bootstrapItems, bootstrapVisibleCount],
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
  const selectedBootstrapItems = bootstrapItems.filter(item => item.selected && normalizedNonEmpty(item.text))
  const bootstrapObjectiveOver = view !== null && normalizedBytes(bootstrapObjective) > view.limits.maxObjectiveBytes
  const bootstrapItemsOver = view !== null
    && selectedBootstrapItems.some(item => normalizedBytes(item.text) > view.limits.maxItemBytes)
  const bootstrapBudgetOver = view !== null && bootstrapPromptBytes > view.limits.maxPromptBytes
  const bootstrapStorageOver = view !== null && (
    bootstrapPlan.ops.length > view.limits.maxOps
    || view.items.length + bootstrapPlan.active + bootstrapPlan.pending > view.limits.maxItems
    || view.items.filter(item => item.review === 'pending').length + bootstrapPlan.pending > view.limits.maxPendingItems
  )
  const bootstrapTextIssue = bootstrapPhase === 'draft' && bootstrap !== null
    ? firstDraftTextIssue(bootstrapObjective, bootstrapItems.slice(0, bootstrapVisibleCount))
    : undefined
  const localWork = {
    stagedOps: ops.length,
    editorOpen: editor !== null,
    nonEmptyComposers: (newInvariant.trim().length > 0 ? 1 : 0)
      + (newDeliverable.trim().length > 0 ? 1 : 0),
  }
  const hasLocalWork = localWork.stagedOps > 0 || localWork.editorOpen || localWork.nonEmptyComposers > 0
  const objectiveStaged = ops.some(op => op.type === 'objective.initialize' || op.type === 'objective.redirect')
  const discardAll = (): void => {
    if (!confirmDiscardAll) {
      setConfirmDiscardAll(true)
      return
    }
    if (draft.discardAllLocalWork()) statusRef.current?.focus()
    setConfirmDiscardAll(false)
  }

  const bootstrapStale = bootstrapPhase === 'draft'
    && (bootstrapBaseRevision === null
      || view === null
      || view.revision !== bootstrapBaseRevision
      || view.objective !== null
      || view.items.length > 0)
  const unknownBlocked = draftState.attempt?.status === 'unknown'
  const canApplyBootstrap = bootstrap !== null
    && bootstrapPhase === 'draft'
    && state.status === 'ready'
    && ops.length === 0
    && editor === null
    && !bootstrapSaving
    && !unknownBlocked
    && bootstrapPlan.ops.length > 0
    && !bootstrapObjectiveOver
    && !bootstrapItemsOver
    && !bootstrapBudgetOver
    && !bootstrapStorageOver
    && !bootstrapStale
    && bootstrapTextIssue === undefined

  // Replay state and its reset hook live ABOVE every early return: hook order
  // must be invariant across connecting/null → ready and error/null → ready.
  const editReplay = editReplayPending(draftState)
  const bootstrapReplay = bootstrapReplayPending(draftState)
  const oldLifecycleUnknown = crossLifecycleUnknown(draftState)
  useEffect(() => {
    if (!hasLocalWork || unknownBlocked || saving || bootstrapSaving) setConfirmDiscardAll(false)
  }, [hasLocalWork, unknownBlocked, saving, bootstrapSaving])

  const unknownReplay = unknownBlocked
  useEffect(() => {
    if (!unknownReplay) setConfirmAbandon(false)
  }, [unknownReplay])

  const recordState = view?.recordState
  const capabilities = view?.capabilities
  const maintenanceReplay = maintenanceReplayPending(draftState)
  const retainedMaintenance = maintenanceAttempt(draftState)
  const retainedArchive = retainedMaintenance?.kind === 'restore'
    ? (retainedMaintenance.request as CharterRestoreRequest).archive as CharterRecordArchive | null | undefined
    : undefined
  const recoveryBusy = draftState.maintenanceSaving || maintenanceReplay
  const maintenanceProblem = draftState.maintenanceProblem
  // Capability gates the whole recovery section; a raw record must also exist
  // (or be diagnosed) before export makes sense.
  const maintenanceEnabled = capabilities?.recordMaintenance === true
  const exportableState = recordState?.kind === 'healthy'
    || recordState?.kind === 'invalid'
    || recordState?.kind === 'lifecycle-mismatch'
  const canExport = maintenanceEnabled && exportableState
  const restoreTarget = recordState?.kind === 'absent-unconfirmed'
    || (recordState?.kind === 'invalid' && recordState.recoverable)
  const restoreArchiveReady = archivePreview?.archive !== undefined && archivePreview.health === 'healthy'
  const recordDigest = recordState?.kind === 'healthy'
    || recordState?.kind === 'invalid'
    || recordState?.kind === 'lifecycle-mismatch'
    ? recordState.recordDigest
    : undefined

  // A confirmation names the exact target and archive, not just the current
  // view. A stream update with the same reason but another digest must reset it.
  const restoreConfirmationKey = JSON.stringify({
    sessionId: view?.sessionId,
    lifecycle: view?.lifecycle,
    target: recordState === undefined
      ? null
      : {
          kind: recordState.kind,
          reason: recordState.kind === 'invalid' ? recordState.reason : null,
          digest: recordState.kind === 'healthy'
            || recordState.kind === 'invalid'
            || recordState.kind === 'lifecycle-mismatch'
            ? recordState.recordDigest
            : null,
        },
    archive: archivePreview?.archive === undefined
      ? null
      : {
          payloadDigest: archivePreview.archive.payloadDigest,
          recordDigest: archivePreview.archive.source.recordDigest,
          sourceSession: archivePreview.archive.source.sessionId,
          sourceLifecycle: archivePreview.archive.source.lifecycle,
        },
  })

  const initAdmission = view === null
    ? { ok: false as const, reason: 'busy' }
    : draft.maintenanceAdmission(view, 'initialize')
  const restoreAdmission = view === null
    ? { ok: false as const, reason: 'busy' }
    : draft.maintenanceAdmission(view, 'restore')

  // Destructive confirmation never survives a section/target/archive change,
  // an in-flight request, success, or abandon.
  useEffect(() => {
    setConfirmRecovery(null)
    setConfirmRestoreKey(null)
  }, [section, restoreConfirmationKey, recoveryBusy])

  useEffect(() => {
    setConfirmAbandon(false)
  }, [view?.sessionId, view?.lifecycle, draftState.attempt])

  useEffect(() => {
    setConfirmDiscardAll(false)
  }, [view?.sessionId, view?.lifecycle, draftState.ops, draftState.editor, draftState.editorText, draftState.newInvariant, draftState.newDeliverable])

  useEffect(() => {
    if (draftState.maintenanceSaving || maintenanceReplay) return
    if (archiveInputRef.current !== null) archiveInputRef.current.value = ''
  }, [draftState.maintenanceSaving, maintenanceReplay, recordState?.kind])

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
        {state.errorKind !== undefined && <span>{t(`error.connectionKind.${state.errorKind}` as never)}</span>}
        <ErrorDetails detail={state.error ?? undefined} t={t} />
        <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
      </main>
    )
  }

  const online = state.status === 'ready'
  // Only an edit batch can be rebased; a history draft has its own extraction
  // baseline and is re-extracted instead (see bootstrap stale handling).
  const revisionConflict = ops.length > 0 && baseRevision !== null && view.revision !== baseRevision
  // Shared with the store: an unknown-outcome Apply freezes the whole draft and
  // is recovered through an explicit Retry, never through fresh edits.
  const editable = view.status === 'ready'
    && !saving
    && !bootstrapSaving
    && online
    && editor === null
    && state.status === 'ready'
    && !unknownBlocked
  const promptBudget = promptBudgetAdmission(view.promptText, preview, view.limits.maxPromptBytes)
  const previewBytes = promptBudget.previewBytes
  const contextOver = promptBudget.over
  const contextBlocksApply = promptBudget.blocksApply
  // Same pure preflight as `applyDraft`, so the button and the store cannot
  // disagree about maxOps/maxItems/maxPendingItems/prompt admission.
  const admission = draftAdmission(view, ops)
  const applyBlocked = !admission.ok
  const applyBlockReason: 'retry' | 'lifecycle-abandon' | 'unknown' | 'busy' | 'read-only' | 'no-changes' | 'editor-open'
    | 'revision-conflict' | 'connection' | 'quota' | 'stale' | null = editReplay
    ? 'retry'
    : unknownBlocked
      ? oldLifecycleUnknown ? 'lifecycle-abandon' : 'unknown'
      : saving
      ? 'busy'
      : editor !== null
        ? 'editor-open'
        : revisionConflict
          ? 'revision-conflict'
          : !online
            ? 'connection'
            : !editable
              ? 'read-only'
              : ops.length === 0
                ? 'no-changes'
                : applyBlocked
                  ? 'quota'
                  : null
  const applyHint = applyBlockReason === null
    ? t('footer.applyHint')
    : t(`apply.block.${applyBlockReason}` as never)
  const bootstrapHint = bootstrapReplay
    ? t('apply.block.retry')
    : bootstrapSaving
      ? t('apply.block.busy')
      : canApplyBootstrap
        ? t('bootstrap.applyHint')
        : t('apply.block.bootstrap-blocked')
  const footerHint = (bootstrapPhase === 'draft' || bootstrapReplay) ? bootstrapHint : applyHint
  const canRebaseNow = rebaseAvailable(draftState)
  const budgetPercent = Math.min(100, Math.round((previewBytes / view.limits.maxPromptBytes) * 100))
  const message = feedbackText(feedback, t)
  const messageDetail = feedbackDetail(feedback)
  const notice = view.status === 'ready' ? null : statusMessage(view, t)
  const disconnected = state.status === 'error'
  const overBudget = view.overBudget
  const showEmpty = !overBudget
    && projectedObjective === null
    && projectedItems.length === 0
    && bootstrapPhase !== 'draft'
    && bootstrapPhase !== 'checking'
  const draftOpen = bootstrapPhase === 'draft'
  // One consolidated budget alert with one remedy: a blocking staged draft wins,
  // then the stored over-budget state, then an admitted over-budget render.
  const budgetNotice = admission.reason === 'max-ops'
    ? { tone: 'danger' as const, text: t('budget.opsOver', { limit: String(view.limits.maxOps) }) }
    : admission.reason === 'max-objective'
      ? {
          tone: 'danger' as const,
          text: t('budget.objectiveOver', { limit: formatBytes(t, view.limits.maxObjectiveBytes) }),
        }
      : admission.reason === 'max-item'
        ? { tone: 'danger' as const, text: t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) }) }
        : admission.reason === 'max-items'
          ? { tone: 'danger' as const, text: t('budget.itemsOver', { limit: String(view.limits.maxItems) }) }
          : admission.reason === 'max-pending'
            ? {
                tone: 'danger' as const,
                text: t('budget.pendingOver', { limit: String(view.limits.maxPendingItems) }),
              }
            : contextBlocksApply
              ? {
                  tone: 'danger' as const,
                  text: t('budget.contextOver', { limit: formatBytes(t, view.limits.maxPromptBytes) }),
                }
              : overBudget
                ? { tone: 'warning' as const, text: t('status.overBudget') }
                : contextOver
                  ? {
                      tone: 'warning' as const,
                      text: promptBudget.shrinking ? t('budget.shrinking') : t('budget.notGrowing'),
                    }
                  : null

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
  const errorText = (code: string | undefined): string => {
    if (code === undefined) return t('recovery.exportFailed')
    const key = `error.${code}`
    return t(key as never) === key ? t('recovery.exportFailed') : t(key as never)
  }

  const downloadArchive = (filename: string, archive: CharterRecordArchive): void => {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    setTimeout(() => {
      anchor.remove()
      URL.revokeObjectURL(url)
    }, 0)
  }

  const exportArchive = (): void => {
    if (exportInFlightRef.current) return
    const epoch = ++exportEpochRef.current
    exportInFlightRef.current = true
    setExportProblem(null)
    setExporting(true)
    void source.exportRecord().then(result => {
      if (epoch !== exportEpochRef.current) return
      exportInFlightRef.current = false
      setExporting(false)
      if (result.ok) downloadArchive(result.filename, result.archive)
      else setExportProblem(errorText(result.code))
    }).catch(() => {
      if (epoch !== exportEpochRef.current) return
      exportInFlightRef.current = false
      setExporting(false)
      setExportProblem(t('recovery.exportFailed'))
    })
  }

  const chooseArchive = (file: File): void => {
    if (recoveryBusy || unknownBlocked) return
    const generation = ++archiveGenerationRef.current
    const expectedSessionId = view?.sessionId
    const expectedLifecycle = draftState.lifecycle ?? view?.lifecycle ?? null
    const isCurrent = (): boolean => generation === archiveGenerationRef.current
      && viewRef.current?.sessionId === expectedSessionId
      && (draft.getSnapshot().lifecycle ?? null) === expectedLifecycle
    setArchivePreview({ fileName: file.name })
    setExportProblem(null)
    setConfirmRecovery(null)
    if (view === null) return
    const maxBytes = view.limits.maxRecoveryBytes ?? 4 * 1_024 * 1_024
    if (file.size > maxBytes) {
      setArchivePreview({
        fileName: file.name,
        errorKey: 'recovery.fileTooLargeLimit',
        errorParams: { limit: formatBytes(t, maxBytes) },
      })
      return
    }
    const lifecycle = draftState.lifecycle ?? view.lifecycle ?? null
    void file.text().then(async text => {
      if (!isCurrent()) return
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        if (isCurrent()) setArchivePreview({ fileName: file.name, errorKey: 'recovery.invalidJson' })
        return
      }
      const preview = await previewArchive(parsed, {
        sessionId: view.sessionId,
        lifecycle,
        maxRecoveryBytes: maxBytes,
      })
      if (!isCurrent()) return
      if (!preview.ok) {
        const key = preview.reason === 'fileTooLarge'
          ? 'recovery.fileTooLargeLimit'
          : preview.reason === 'invalidJson'
            ? 'recovery.invalidJson'
            : preview.reason === 'invalidArchive'
              ? 'recovery.invalidArchive'
              : preview.reason === 'sessionMismatch'
                ? 'recovery.sessionMismatchPreview'
                : preview.reason === 'lifecycleMismatch'
                  ? 'recovery.lifecycleMismatchPreview'
                  : preview.reason === 'cryptoUnavailable'
                    ? 'recovery.cryptoUnavailable'
                    : 'recovery.digestMismatchPreview'
        setArchivePreview({
          fileName: file.name,
          errorKey: key,
          ...(preview.reason === 'fileTooLarge' ? { errorParams: { limit: formatBytes(t, maxBytes) } } : {}),
        })
        return
      }
      if (!isCurrent()) return
      setArchivePreview({
        fileName: file.name,
        archive: preview.archive,
        health: preview.health,
        revision: preview.revision,
        lifecycle: preview.lifecycle,
        digest: preview.digest,
        exportedAt: preview.exportedAt,
        sourceSession: preview.sourceSession,
        payloadDigestOk: preview.payloadDigestOk,
        recordDigestOk: preview.recordDigestOk,
      })
    }).catch(() => {
      if (isCurrent()) setArchivePreview({ fileName: file.name, errorKey: 'recovery.invalidArchive' })
    })
  }

  const initializeEmpty = (): void => {
    if (view === null || !maintenanceEnabled || !initAdmission.ok) return
    if (confirmRecovery !== 'initialize') {
      setConfirmRecovery('initialize')
      return
    }
    setConfirmRecovery(null)
    setConfirmRestoreKey(null)
    void draft.initializeEmpty(view)
  }

  const restoreArchive = (): void => {
    if (view === null || archivePreview?.archive === undefined) return
    if (!maintenanceEnabled || !restoreTarget || !restoreAdmission.ok) return
    if (archivePreview.health !== 'healthy') return
    if (confirmRecovery !== 'restore' || confirmRestoreKey !== restoreConfirmationKey) {
      setConfirmRecovery('restore')
      setConfirmRestoreKey(restoreConfirmationKey)
      return
    }
    setConfirmRecovery(null)
    setConfirmRestoreKey(null)
    void draft.restoreArchive(view, archivePreview.archive)
  }

  const abandonUnknown = (): void => {
    if (!confirmAbandon) {
      setConfirmAbandon(true)
      return
    }
    draft.abandonUnknown()
    setConfirmAbandon(false)
    statusRef.current?.focus()
  }
  const applyBootstrapDraft = (): void => {
    void draft.applyBootstrap(view).finally(() => statusRef.current?.focus())
  }
  const openHistory = (): void => {
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
            key={`${view?.sessionId ?? ''}:${view?.lifecycle ?? ''}:${item.id}`}
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
              <StatusTag>{t('stats.revision', { revision: view.revision })}</StatusTag>
              <StatusTag>{t('stats.active', { count: committedActive })}</StatusTag>
              <StatusTag>{t('stats.stored', { count: committedStored })}</StatusTag>
              {ops.length > 0 && (
                <StatusTag tone="info">
                  {t('stats.afterApply', { active: counts.active, stored: projectedItems.length })}
                </StatusTag>
              )}
            </div>
            <div
              className={`charter-meter${contextOver ? ' is-over' : budgetPercent >= 80 ? ' is-warn' : ''}`}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={view.limits.maxPromptBytes}
              aria-valuenow={Math.min(previewBytes, view.limits.maxPromptBytes)}
              aria-valuetext={t('stats.budget', {
                used: formatBytes(t, previewBytes),
                limit: formatBytes(t, view.limits.maxPromptBytes),
              })}
            >
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
          <div className="charter-notice">
            <span role="status">{t('status.reconnecting')}</span>
          </div>
        )}
        {disconnected && (
          <div className="charter-notice charter-notice--danger">
            <span role="alert">{t('error.connection')}</span>
            {state.errorKind !== undefined && <span className="charter-hint">{t(`error.kind.${state.errorKind}` as never)}</span>}
            <ErrorDetails detail={state.error ?? undefined} t={t} />
            <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
          </div>
        )}
        {notice !== null && (
          <div className="charter-notice charter-notice--warning">
            <span role="status">{notice}</span>
            {view.message !== undefined && view.message !== notice && (
              <ErrorDetails detail={view.message} t={t} />
            )}
          </div>
        )}
        {(editReplay || bootstrapReplay) && (
          <div className="charter-notice charter-notice--warning">
            <span role="alert">{t('footer.replayPending')}</span>
          </div>
        )}
        {oldLifecycleUnknown && (
          <div className="charter-notice charter-notice--warning">
            <span role="alert">{t('footer.lifecyclePending')}</span>
          </div>
        )}
        {revisionConflict && (
          <div className="charter-notice charter-notice--warning">
            <span role="alert">{t('notice.conflict', { from: baseRevision ?? 0, to: view.revision })}</span>
            {canRebaseNow
              ? (
                  <ActionButton
                    variant="outline"
                    onClick={() => draft.rebase(view)}
                  >
                    {t('conflict.rebase', { revision: view.revision })}
                  </ActionButton>
                )
              : <span>{t('conflict.rebaseBlocked')}</span>}
          </div>
        )}
        {budgetNotice !== null && (
          <div className={`charter-notice charter-notice--${budgetNotice.tone}`}>
            <span role="alert">{budgetNotice.text}</span>
          </div>
        )}

        <footer className="charter-actionbar">
          <div
            ref={statusRef}
            className="charter-actionbar__status"
            tabIndex={-1}
            title={messageDetail}
          >
            <span className={`charter-dot${ops.length > 0 || draftOpen ? ' is-staged' : ''}`} aria-hidden="true" />
            <div>
              <strong>
                {ops.length === 0
                  ? draftOpen ? t('footer.draftStatus') : t('footer.none')
                  : countLabel(t, ops.length, 'footer.one', 'footer.other')}
              </strong>
              {message !== null && (
                <span
                  className="charter-actionbar__message"
                  role={feedback?.kind === 'error' || feedback?.kind === 'connection' ? 'alert' : 'status'}
                >
                  {message}
                </span>
              )}
              {messageDetail !== undefined && <ErrorDetails detail={messageDetail} t={t} />}
              <span className="charter-actionbar__hint" id={applyHintId}>{footerHint}</span>
            </div>
          </div>
          <div className="charter-actionbar__actions">
            <ActionButton
              onClick={() => goSection(section === 'context' ? 'overview' : 'context')}
            >
              {section === 'context' ? t('footer.hidePreview') : t('footer.preview')}
            </ActionButton>
            {(draftOpen || bootstrapReplay) && ops.length === 0
              ? (
                  <>
                    <ActionButton
                      disabled={bootstrapReplay ? bootstrapSaving : !canApplyBootstrap}
                      ariaDescribedBy={applyHintId}
                      onClick={applyBootstrapDraft}
                      busy={bootstrapSaving}
                    >
                      {bootstrapSaving
                        ? t('footer.applying')
                        : bootstrapReplay ? t('footer.retryApply') : t('bootstrap.apply')}
                    </ActionButton>
                    <ActionButton
                      disabled={bootstrapSaving || unknownBlocked}
                      onClick={() => draft.dismissBootstrap()}
                    >
                      {t('bootstrap.discard')}
                    </ActionButton>
                    {unknownReplay && (
                      <ActionButton variant="outline" onClick={abandonUnknown}>
                        {confirmAbandon ? t('footer.abandonConfirm') : t('footer.abandon')}
                      </ActionButton>
                    )}
                  </>
                )
              : (
                  <>
                    <ActionButton
                      disabled={ops.length === 0 || saving || unknownBlocked}
                      onClick={() => { draft.discardStaged(); statusRef.current?.focus() }}
                    >
                      {t('footer.discard')}
                    </ActionButton>
                    {hasLocalWork && (
                      <>
                      <ActionButton
                        variant="outline"
                        disabled={saving || bootstrapSaving || unknownBlocked || maintenanceReplay}
                        onClick={discardAll}
                      >
                        {confirmDiscardAll
                          ? t('discard.confirmAll', {
                              ops: localWork.stagedOps,
                              editor: localWork.editorOpen ? 1 : 0,
                              composers: localWork.nonEmptyComposers,
                            })
                          : t('discard.all')}
                      </ActionButton>
                      {confirmDiscardAll && (
                        <ActionButton variant="outline" onClick={() => setConfirmDiscardAll(false)}>
                          {t('discard.cancel')}
                        </ActionButton>
                      )}
                      </>
                    )}
                    <ActionButton
                      variant="primary"
                      className="charter-actionbar__primary"
                      ariaDescribedBy={applyHintId}
                      disabled={editReplay ? saving : applyBlockReason !== null}
                      onClick={applyDraft}
                      busy={saving}
                    >
                      {saving
                        ? t('footer.applying')
                        : editReplay ? t('footer.retryApply') : t('footer.apply')}
                    </ActionButton>
                    {unknownReplay && (
                      <ActionButton variant="outline" onClick={abandonUnknown}>
                        {confirmAbandon ? t('footer.abandonConfirm') : t('footer.abandon')}
                      </ActionButton>
                    )}
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
              { id: 'recovery' as const, label: t('nav.recovery') },
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
                    <span role="status">{bootstrapProblemText(bootstrapProblem, t)
                      ?? (bootstrapPhase === 'no-summary' ? t('bootstrap.noSummary')
                        : bootstrapPhase === 'not-live' ? t('bootstrap.notLive')
                          : t('bootstrap.overviewFailed'))}</span>
                    <ErrorDetails detail={bootstrapProblem?.detail} t={t} />
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
                      <ActionButton variant="primary" disabled={!editable} onClick={() => goSection('objective')}>
                        {t('objective.set')}
                      </ActionButton>
                      <ActionButton disabled={!editable} onClick={() => goSection('invariants')}>
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
                      {objectiveStaged && (
                        <span className="charter-tag charter-tag--info">{t('tag.staged')}</span>
                      )}
                    </div>
                    <div className="charter-cardtools">
                      <span className="charter-budget">
                        {formatBytes(t, utf8Bytes(projectedObjective?.current.text ?? ''))} / {formatBytes(t, view.limits.maxObjectiveBytes)}
                      </span>
                      {objectiveStaged && (
                        <ActionButton
                          variant="outline"
                          disabled={!editable || saving || unknownBlocked}
                          onClick={() => { draft.unstageObjective(); statusRef.current?.focus() }}
                        >
                          {t('discard.unstageObjective')}
                        </ActionButton>
                      )}
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
                    {ops.length > 0 && <span className="charter-kicker" role="note">{t('overview.afterApply')}</span>}
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
                    {ops.length > 0 && <span className="charter-kicker" role="note">{t('overview.afterApply')}</span>}
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
                      {objectiveStaged && (
                        <ActionButton
                          variant="outline"
                          disabled={!editable || saving || unknownBlocked}
                          onClick={() => { draft.unstageObjective(); statusRef.current?.focus() }}
                        >
                          {t('discard.unstageObjective')}
                        </ActionButton>
                      )}
                      <ActionButton
                        variant="outline"
                        disabled={!editable || projectedObjective !== null && objectiveStaged}
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
                        previousBytes={normalizedBytes(projectedObjective?.current.text ?? '')}
                        label={t('editor.objectiveAria')}
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
                <div className={`charter-add${normalizedBytes(newInvariant) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newInvariant}
                    placeholder={t('composer.placeholderInvariant')}
                    aria-label={t('composer.invariantAria')}
                    aria-invalid={normalizedBytes(newInvariant) > view.limits.maxItemBytes}
                    onChange={event => draft.setNewInvariant(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        draft.addItem(view, 'invariant', newInvariant, () => draft.setNewInvariant(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${normalizedBytes(newInvariant) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                      {normalizedBytes(newInvariant) > view.limits.maxItemBytes
                        ? t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                        : `${formatBytes(t, normalizedBytes(newInvariant))} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                    </span>
                    {newInvariant.length > 0 && (
                      <ActionButton
                        variant="outline"
                        disabled={!editable || saving || unknownBlocked}
                        onClick={() => draft.clearComposer('invariant')}
                      >
                        {t('composer.clear')}
                      </ActionButton>
                    )}
                    <ActionButton
                      variant="outline"
                      disabled={!editable || !normalizedNonEmpty(newInvariant) || normalizedBytes(newInvariant) > view.limits.maxItemBytes}
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
                      previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined}
                      label={t('editor.invariantAria')}
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
                <div className={`charter-add${normalizedBytes(newDeliverable) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                  <textarea
                    rows={2}
                    disabled={!editable}
                    value={newDeliverable}
                    placeholder={t('composer.placeholderDeliverable')}
                    aria-label={t('composer.deliverableAria')}
                    aria-invalid={normalizedBytes(newDeliverable) > view.limits.maxItemBytes}
                    onChange={event => draft.setNewDeliverable(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        draft.addItem(view, 'deliverable', newDeliverable, () => draft.setNewDeliverable(''))
                      }
                    }}
                  />
                  <div className="charter-add__foot">
                    <span className={`charter-budget${normalizedBytes(newDeliverable) > view.limits.maxItemBytes ? ' is-over' : ''}`}>
                      {normalizedBytes(newDeliverable) > view.limits.maxItemBytes
                        ? t('budget.itemOver', { limit: formatBytes(t, view.limits.maxItemBytes) })
                        : `${formatBytes(t, normalizedBytes(newDeliverable))} / ${formatBytes(t, view.limits.maxItemBytes)}`}
                    </span>
                    {newDeliverable.length > 0 && (
                      <ActionButton
                        variant="outline"
                        disabled={!editable || saving || unknownBlocked}
                        onClick={() => draft.clearComposer('deliverable')}
                      >
                        {t('composer.clear')}
                      </ActionButton>
                    )}
                    <ActionButton
                      variant="outline"
                      disabled={!editable || !normalizedNonEmpty(newDeliverable) || normalizedBytes(newDeliverable) > view.limits.maxItemBytes}
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
                      previousBytes={editor.kind === 'edit' ? normalizedBytes(editor.item.text) : undefined}
                      label={t('editor.deliverableAria')}
                      t={t}
                    />
                  </div>
                )}
              </section>
            )}

            {section === 'history' && (
              <>
                {bootstrapPhase === 'checking' && (
                  <div className="charter-notice">
                    <span role="status">{t('bootstrap.loading')}</span>
                  </div>
                )}
                {bootstrapPhase === 'failed' && (
                  <div className="charter-notice charter-notice--danger">
                    <span role="alert">
                      {bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.requestFailed')}
                    </span>
                    <ErrorDetails detail={bootstrapProblem?.detail} t={t} />
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>
                )}
                {bootstrapPhase === 'unavailable' && (
                  <div className="charter-notice">
                    <span role="status">
                      {bootstrapProblemText(bootstrapProblem, t) ?? t('bootstrap.unavailable')}
                    </span>
                    <ErrorDetails detail={bootstrapProblem?.detail} t={t} />
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('button.retry')}</ActionButton>
                  </div>
                )}
                {(bootstrapPhase === 'no-summary' || bootstrapPhase === 'not-live' || bootstrapPhase === 'idle') && (
                  <div className="charter-notice">
                    <span role="status">
                      {bootstrapPhase === 'no-summary'
                        ? t('bootstrap.noSummary')
                        : bootstrapPhase === 'not-live' ? t('bootstrap.notLive') : t('bootstrap.idle')}
                    </span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>
                )}
                {bootstrapPhase === 'dismissed' && (
                  <div className="charter-notice">
                    <span role="status">{t('bootstrap.dismissed')}</span>
                    <ActionButton onClick={() => draft.retryBootstrap(view)}>{t('bootstrap.checkAgain')}</ActionButton>
                  </div>
                )}
                {ops.length > 0 && (
                  <div className="charter-notice charter-notice--warning">
                    <span role="status">{t('bootstrap.blocked')}</span>
                  </div>
                )}
                {bootstrap !== null && ops.length === 0 && editor !== null && (
                  <div className="charter-notice charter-notice--warning">
                    <span role="alert">{t('bootstrap.blockedEditor')}</span>
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
                      <span role="status">
                        {t('bootstrap.reviewCounts', {
                          total: bootstrapItems.length,
                          visible: Math.min(bootstrapItems.length, bootstrapVisibleCount),
                          selected: bootstrapItems.filter(item => item.selected).length,
                        })}
                      </span>
                      <ActionButton
                        disabled={bootstrapSaving || unknownBlocked}
                        onClick={() => draft.setVisibleBootstrapSelected(true)}
                      >
                        {t('bootstrap.selectShown', { count: Math.min(bootstrapItems.length, bootstrapVisibleCount) })}
                      </ActionButton>
                      <ActionButton
                        disabled={bootstrapSaving || unknownBlocked}
                        onClick={() => draft.setVisibleBootstrapSelected(false)}
                      >
                        {t('bootstrap.clearShown')}
                      </ActionButton>
                    </div>
                    {view.objective === null && (
                      <label className="charter-bootstrap__field">
                        <span>{t('bootstrap.objective')}</span>
                        <textarea
                          id={`${bootstrapId}-objective`}
                          value={bootstrapObjective}
                          rows={2}
                          disabled={bootstrapSaving || unknownBlocked}
                          aria-label={t('bootstrap.objective')}
                          aria-invalid={bootstrapObjectiveOver || inspectUserText(bootstrapObjective).issue !== undefined}
                          aria-describedby={`${bootstrapId}-objective-budget`}
                          onChange={event => draft.setBootstrapObjective(event.target.value)}
                        />
                        <span id={`${bootstrapId}-objective-budget`} className={`charter-budget${bootstrapObjectiveOver ? ' is-over' : ''}`}>
                          {bootstrapObjectiveOver
                            ? t('budget.objectiveOver', { limit: formatBytes(t, view.limits.maxObjectiveBytes) })
                            : `${formatBytes(t, normalizedBytes(bootstrapObjective))} / ${formatBytes(t, view.limits.maxObjectiveBytes)}`}
                        </span>
                      </label>
                    )}
                    {(() => {
                      const ordered = [
                        ...bootstrapItems.filter(item => item.kind === 'invariant').map(item => ({ item, kind: 'invariant' as const })),
                        ...bootstrapItems.filter(item => item.kind === 'deliverable').map(item => ({ item, kind: 'deliverable' as const })),
                      ]
                      const visible = ordered.slice(0, bootstrapVisibleCount)
                      const groups = [
                        { kind: 'invariant' as const, label: t('bootstrap.groupInvariants'), items: visible.filter(entry => entry.kind === 'invariant') },
                        { kind: 'deliverable' as const, label: t('bootstrap.groupDeliverables'), items: visible.filter(entry => entry.kind === 'deliverable') },
                      ]
                      return (
                        <>
                          {groups.map(group => group.items.length === 0 ? null : (
                            <div className="charter-bootstrap__group" key={group.kind}>
                              <h4>{group.label} ({group.items.length})</h4>
                              {group.items.map(({ item }) => {
                                const index = ordered.findIndex(entry => entry.item.id === item.id)
                                const bytes = normalizedBytes(item.text)
                                const outcome = bootstrapPlan.outcomes[item.id]
                                const checkboxId = `${bootstrapId}-include-${item.id}`
                                const textId = `${bootstrapId}-text-${item.id}`
                                return (
                                  <div className="charter-bootstrap__item" key={item.id}>
                                    <input
                                      id={checkboxId}
                                      type="checkbox"
                                      checked={item.selected}
                                      disabled={bootstrapSaving || unknownBlocked}
                                      aria-label={t('bootstrap.includeAria', { index: index + 1 })}
                                      onChange={event => draft.updateBootstrapItem(item.id, { selected: event.target.checked })}
                                    />
                                    <label className="charter-bootstrap__checklabel" htmlFor={checkboxId}>{t('bootstrap.selected')}</label>
                                    <div className="charter-draftfield">
                                      <label className="charter-bootstrap__textlabel" htmlFor={textId}>{t('bootstrap.editAria', { index: index + 1 })}</label>
                                      <textarea
                                        id={textId}
                                        value={item.text}
                                        rows={2}
                                        disabled={bootstrapSaving || unknownBlocked}
                                        aria-invalid={item.text.trim().length === 0 || normalizedBytes(item.text) > view.limits.maxItemBytes || inspectUserText(item.text).issue !== undefined}
                                        aria-describedby={`${textId}-meta`}
                                        onChange={event => draft.updateBootstrapItem(item.id, { text: event.target.value })}
                                      />
                                      <span className="charter-draftfield__meta" id={`${textId}-meta`}>
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
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                          {ordered.length > visible.length && (
                            <ActionButton disabled={bootstrapSaving || unknownBlocked} onClick={() => draft.showMoreBootstrapCandidates(40)}>
                              {t('bootstrap.showMore', { count: Math.min(40, ordered.length - visible.length) })}
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
                        className="charter-actionbar__primary"
                        disabled={bootstrapReplay ? bootstrapSaving : !canApplyBootstrap}
                        ariaDescribedBy={applyHintId}
                        onClick={applyBootstrapDraft}
                        busy={bootstrapSaving}
                      >
                        {bootstrapSaving
                          ? t('footer.applying')
                          : bootstrapReplay ? t('footer.retryApply') : t('bootstrap.apply')}
                      </ActionButton>
                      <ActionButton
                        disabled={bootstrapSaving || unknownBlocked}
                        onClick={() => draft.dismissBootstrap()}
                      >
                        {t('bootstrap.discard')}
                      </ActionButton>
                      {unknownReplay && (
                        <ActionButton variant="outline" onClick={abandonUnknown}>
                          {confirmAbandon ? t('footer.abandonConfirm') : t('footer.abandon')}
                        </ActionButton>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}

            {section === 'recovery' && (
              <>
                <section className="charter-card charter-recovery" aria-labelledby="charter-recovery-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.title')}</span>
                      <h3 id="charter-recovery-title">{t('recovery.recordTitle')}</h3>
                    </div>
                    <StatusTag tone={recordState?.kind === 'healthy' ? 'success' : 'warning'}>
                      {recordState?.kind === 'healthy'
                        ? t('recovery.healthy')
                        : recordState?.kind === 'absent-unconfirmed'
                          ? t('recovery.absent')
                          : recordState?.kind === 'invalid'
                            ? recordState.reason === 'future-schema'
                              ? t('recovery.futureSchema')
                              : t('recovery.invalid')
                            : recordState?.kind === 'lifecycle-mismatch'
                              ? t('recovery.mismatch')
                              : recordState?.kind === 'write-uncertain'
                                ? t('recovery.uncertain')
                                : t('recovery.unknown')}
                    </StatusTag>
                  </div>
                  <dl className="charter-recovery__facts">
                    <div>
                      <dt>{t('recovery.revision')}</dt>
                      <dd>{view.revision}</dd>
                    </div>
                    <div>
                      <dt>{t('recovery.lifecycle')}</dt>
                      <dd><code>{lifecycleLabel(view.lifecycle)}</code></dd>
                    </div>
                    <div>
                      <dt>{t('recovery.digest')}</dt>
                      <dd><code>{recordDigest === undefined ? '-' : shortText(recordDigest.replace('sha256:', ''), 20)}</code></dd>
                    </div>
                    {view.overBudget && <div><dt>{t('recovery.overBudget')}</dt><dd>!</dd></div>}
                  </dl>
                  <p className="charter-hint">{t('recovery.subtitle')}</p>
                </section>

                <section className="charter-card charter-recovery" aria-labelledby="charter-export-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.exportTitle')}</span>
                      <h3 id="charter-export-title">{t('recovery.export')}</h3>
                    </div>
                  </div>
                  <p className="charter-hint">{t('recovery.exportHint')}</p>
                  <div className="charter-notice charter-notice--warning" role="note">
                    <span>{t('recovery.sensitive')}</span>
                  </div>
                  <div className="charter-recovery__actions">
                    <ActionButton
                      variant="primary"
                      disabled={!canExport || recoveryBusy || exporting}
                      onClick={exportArchive}
                      busy={exporting}
                    >
                      {t('recovery.export')}
                    </ActionButton>
                    {!maintenanceEnabled && (
                      <span className="charter-hint" role="note">
                        {capabilities?.recordMaintenanceReason === 'record-limit'
                          ? t('recovery.recordLimit')
                          : t('recovery.capabilityUnavailable')}
                      </span>
                    )}
                    {maintenanceEnabled && !exportableState && (
                      <span className="charter-hint" role="note">{t('recovery.noRawRecord')}</span>
                    )}
                  </div>
                  {exportProblem !== null && (
                    <p className="charter-hint" role="alert">{exportProblem}</p>
                  )}
                </section>

                <section className="charter-card charter-recovery" aria-labelledby="charter-restore-title">
                  <div className="charter-cardhead">
                    <div className="charter-cardtitle">
                      <span className="charter-kicker">{t('recovery.title')}</span>
                      <h3 id="charter-restore-title">{t('recovery.restore')}</h3>
                    </div>
                  </div>
                  {recordState?.kind === 'write-uncertain' && (
                    <div className="charter-notice charter-notice--warning" role="alert">
                      <span>{t('recovery.writeUncertain')}</span>
                    </div>
                  )}
                  {recordState?.kind === 'absent-unconfirmed' && (
                    <div className="charter-notice" role="note">
                      <span>{t('recovery.absentHint')}</span>
                    </div>
                  )}
                  {recordState?.kind === 'healthy' && (
                    <p className="charter-hint">{t('recovery.replaceHint')}</p>
                  )}
                  {maintenanceProblem !== null && (
                    <div className="charter-recovery__problem">
                      <div className="charter-notice charter-notice--warning" role="alert">
                        <span>
                          {t('recovery.problem')}
                          {maintenanceProblem.code === undefined ? '' : ` (${errorText(String(maintenanceProblem.code))})`}
                        </span>
                        <ErrorDetails detail={maintenanceProblem.detail} t={t} />
                      </div>
                      <ActionButton variant="outline" onClick={() => draft.dismissMaintenanceProblem()}>
                        {t('recovery.dismiss')}
                      </ActionButton>
                    </div>
                  )}
                  {draftState.maintenanceSaving && (
                    <div className="charter-notice" role="status">
                      <span>{t('recovery.inFlight')}</span>
                    </div>
                  )}
                  {(maintenanceReplay || (unknownBlocked && (draftState.attempt?.kind === 'initialize' || draftState.attempt?.kind === 'restore'))) && (
                    <div className="charter-recovery__problem">
                      <div className="charter-notice" role="status">
                        <span>{t('recovery.unknownOutcome')}</span>
                      </div>
                      {retainedArchive != null && (
                        <dl className="charter-recovery__retained">
                          <div><dt>{t('recovery.sourceSession')}</dt><dd>{retainedArchive.source.sessionId}</dd></div>
                          <div><dt>{t('recovery.lifecycle')}</dt><dd>{retainedArchive.source.lifecycle}</dd></div>
                          <div><dt>{t('recovery.previewRevision')}</dt><dd>{retainedArchive.source.revision ?? '-'}</dd></div>
                          <div><dt>{t('recovery.previewDigest')}</dt><dd>{retainedArchive.source.recordDigest}</dd></div>
                          <div><dt>{t('recovery.payloadDigest')}</dt><dd>{retainedArchive.payloadDigest}</dd></div>
                        </dl>
                      )}
                      <div className="charter-recovery__actions">
                        {maintenanceReplay && (
                          <ActionButton variant="primary" onClick={() => void draft.retryMaintenance()}>
                            {t('recovery.retry')}
                          </ActionButton>
                        )}
                        <ActionButton variant="outline" onClick={abandonUnknown}>
                          {confirmAbandon ? t('footer.abandonConfirm') : t('recovery.abandon')}
                        </ActionButton>
                      </div>
                    </div>
                  )}
                  <label className="charter-recovery__file">
                    <span className="charter-kicker">{t('recovery.chooseFile')}</span>
                    <input
                      ref={archiveInputRef}
                      type="file"
                      accept="application/json,.json"
                      disabled={recoveryBusy || unknownBlocked}
                      onChange={event => {
                        const file = event.currentTarget.files?.[0]
                        if (file !== undefined) chooseArchive(file)
                      }}
                    />
                  </label>
                  {archivePreview !== null && (
                    <div className="charter-recovery__preview">
                      <strong>{t('recovery.previewTitle')}</strong>
                      <span>{t('recovery.selected')}: {archivePreview.fileName}</span>
                      {archivePreview.errorKey !== undefined
                        ? <span role="alert">{t(archivePreview.errorKey as never, archivePreview.errorParams as never)}</span>
                        : (
                          <dl>
                            <div><dt>{t('recovery.previewHealth')}</dt><dd>{archivePreview.health === undefined ? '-' : archiveHealthLabel(archivePreview.health, t)}</dd></div>
                            <div><dt>{t('recovery.previewRevision')}</dt><dd>{archivePreview.revision ?? '-'}</dd></div>
                            <div><dt>{t('recovery.previewLifecycle')}</dt><dd><code>{lifecycleLabel(archivePreview.lifecycle)}</code></dd></div>
                            <div><dt>{t('recovery.previewDigest')}</dt><dd><code>{archivePreview.digest === undefined ? '-' : shortText(archivePreview.digest.replace('sha256:', ''), 20)}</code></dd></div>
                            <div><dt>{t('recovery.exportedAt')}</dt><dd>{formatTimestamp(archivePreview.exportedAt)}</dd></div>
                            <div><dt>{t('recovery.sourceSession')}</dt><dd><code>{shortText(archivePreview.sourceSession ?? '-', 24)}</code></dd></div>
                            <div><dt>{t('recovery.payloadDigest')}</dt><dd>{archivePreview.payloadDigestOk === true ? t('recovery.verified') : t('recovery.unverified')}</dd></div>
                          </dl>
                        )}
                    </div>
                  )}
                  {recordState?.kind === 'absent-unconfirmed' && (
                    <div className="charter-recovery__danger">
                      <p className="charter-hint" role="note">{t('recovery.initializeWarning')}</p>
                      <ActionButton
                        variant={confirmRecovery === 'initialize' ? 'primary' : 'outline'}
                        disabled={!maintenanceEnabled || recoveryBusy || !initAdmission.ok}
                        onClick={initializeEmpty}
                      >
                        {confirmRecovery === 'initialize' ? t('recovery.initializeConfirm') : t('recovery.initialize')}
                      </ActionButton>
                      {confirmRecovery === 'initialize' && (
                        <ActionButton variant="outline" onClick={() => setConfirmRecovery(null)}>
                          {t('recovery.cancel')}
                        </ActionButton>
                      )}
                      {!initAdmission.ok && (
                        <span className="charter-hint" role="note">
                          {t(`recovery.reason.${initAdmission.reason}` as never)}
                        </span>
                      )}
                    </div>
                  )}
                  {restoreTarget && (
                    <div className="charter-recovery__actions">
                      <ActionButton
                        variant={confirmRecovery === 'restore' ? 'primary' : 'outline'}
                        disabled={!maintenanceEnabled || recoveryBusy || !restoreAdmission.ok || !restoreArchiveReady}
                        onClick={restoreArchive}
                      >
                        {confirmRecovery === 'restore' ? t('recovery.restoreConfirm') : t('recovery.restore')}
                      </ActionButton>
                      {confirmRecovery === 'restore' && (
                        <ActionButton variant="outline" onClick={() => setConfirmRecovery(null)}>
                          {t('recovery.cancel')}
                        </ActionButton>
                      )}
                      <span className="charter-hint">
                        {archivePreview?.archive === undefined
                          ? t('recovery.noPreview')
                          : restoreArchiveReady
                            ? t('recovery.readyToRestore')
                            : t('recovery.diagnosticOnly')}
                      </span>
                      {!restoreAdmission.ok && (
                        <span className="charter-hint" role="note">
                          {t(`recovery.reason.${restoreAdmission.reason}` as never)}
                        </span>
                      )}
                    </div>
                  )}
                </section>
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
                {(draftOpen || bootstrapReplay) && ops.length === 0 && (
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
