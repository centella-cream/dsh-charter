import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CharterItem,
  CharterOp,
  DeliverableProgress,
} from '../core/schemas.js'
import type { CharterArchiveEntry } from '../host/types.js'
import type { CharterSource } from './store.js'
import type {
  CharterDraft,
  CharterSection,
  DraftEditor,
} from './draft-store.js'
import { CHARTER_LOCALE_NS } from './locales.js'
import { CHARTER_VERSION } from '../version.js'
import { dependencyConflictDiff, dependencyProjection, validateDependencyGraph, type DependencyConflictDiff } from '../core/dependencies.js'
import { buildRelationGraph, defaultFocus as defaultGraphFocus, layoutRelationGraph, type GraphInputItem, type RelationGraphModel } from './relation-graph.js'
import { ChangeSetPanel } from './ChangeSetPanel.js'
import { buildChangeSetConflicts } from './change-set-model.js'
import { focusSectionHeading, scrollToSectionAnchor } from './section-routing.js'
import { useChangeSetSheet } from './use-change-set-sheet.js'
import { SectionNav } from './SectionNav.js'
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
  type ProjectedItem,
} from './preview.js'
import { firstDraftTextIssue, type BootstrapPlan } from './bootstrap-plan.js'
import './charter.css'
import {
  countLabel,
  feedbackDetail,
  feedbackText,
  formatCharterPreview,
  progressLabel,
  errorLabel,
  formatBytes,
  normalizedBytes,
  normalizedNonEmpty,
  shortText,
  statusMessage,
  itemState,
  type CharterText,
  EMPTY_CONFLICT_DIFF,
} from './pane-format.js'
import { ActionButton, ErrorDetails, StateMark, StatusTag } from './pane-ui.js'
import type { ArchivePreview } from './pane-format.js'
import type { PaneScope } from './pane-scope.js'
import { WorkspacePage } from './WorkspacePage.js'
import { ReviewCenterPage } from './ReviewCenterPage.js'
import { DiagnosticsPage } from './DiagnosticsPage.js'

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


function CharterMark() {
  return (
    <span className="charter-mark" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
      </svg>
    </span>
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
  localKey,
  byteCount,
  t,
}: {
  readonly item: ProjectedItem
  readonly successor: ProjectedItem | undefined
  readonly editable: boolean
  readonly onUnstage: (itemId: string) => void
  readonly onEdit: (item: ProjectedItem) => void
  readonly onSupersede: (item: ProjectedItem) => void
  readonly onQueue: (op: CharterOp) => void
  readonly localKey: string | undefined
  readonly byteCount: string | undefined
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
          <div className="charter-item__sub">
      {item.kind === 'deliverable' && item.review === 'accepted' && current && !item.staged && (
        <label className="charter-progress">
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

            {item.staged && <StatusTag tone="info">{t('tag.staged')}</StatusTag>}
            {item.review === 'pending' && <StatusTag tone="warning">{t('tag.proposal')}</StatusTag>}
            {item.review === 'rejected' && <StatusTag tone="danger">{t('tag.rejected')}</StatusTag>}
            {item.lifecycle === 'archived' && <StatusTag>{t('tag.archived')}</StatusTag>}
            {item.lifecycle === 'superseded' && <StatusTag>{t('tag.superseded')}</StatusTag>}
            {item.supersedes !== undefined && <StatusTag>{t('tag.replacement')}</StatusTag>}
            {item.verification.state === 'verified' && (
              <StatusTag tone="success">
                {item.verification.by === 'validator' ? t('tag.verifiedValidator') : t('tag.verifiedUser')}
              </StatusTag>
            )}
            {item.validity !== undefined && item.validity.state !== 'unassessed' && (
              <StatusTag tone={item.validity.state === 'valid' || item.validity.state === 'attested' ? 'success' : item.validity.state === 'invalid' ? 'danger' : 'warning'}>
                {t(`validity.${item.validity.state}` as never)}
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
          </div>
          {item.supersedes !== undefined && (
            <span className="charter-item__hint">{t('item.replacementHint')}</span>
          )}
          {terminalHead && <span className="charter-item__hint">{t('item.purgeDetaches')}</span>}
        </div>
        <div className="charter-item__side">
        <span className="charter-item__meta">
          {localKey !== undefined && <span>{localKey}</span>}
          {byteCount !== undefined && <span>{byteCount}</span>}
        </span>
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
            <summary className="charter-item__menu-trigger" aria-label={menuLabel}>
              <span aria-hidden="true">⋯</span>
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
                    onClick={() => queueFromMenu({ type: 'item.attest', itemId: item.id })}
                  >
                    {t('item.attest')}
                  </button>
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
        </div>
      </div>
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
  const [visibleCounts, setVisibleCounts] = useState({ invariants: 50, deliverables: 50 })
  const [validatorItemId, setValidatorItemId] = useState('')
  const [validatorKind, setValidatorKind] = useState<'workspace.path-exists' | 'workspace.file-digest' | 'workspace.file-contains'>('workspace.path-exists')
  const [validatorPath, setValidatorPath] = useState('')
  const [validatorExpectation, setValidatorExpectation] = useState('')
  const [validatorFeedback, setValidatorFeedback] = useState<string | null>(null)
  const [validatorRunning, setValidatorRunning] = useState(false)
  const [reviewLimit, setReviewLimit] = useState(50)
  const [integrityFeedback, setIntegrityFeedback] = useState<string | null>(null)
  const [messageCandidates, setMessageCandidates] = useState<readonly import('../host/types.js').CharterMessageCandidate[]>([])
  const [messageSeq, setMessageSeq] = useState<number | undefined>(undefined)
  const [messageKind, setMessageKind] = useState<'invariant' | 'deliverable'>('invariant')
  const [messageDraft, setMessageDraft] = useState('')
  const [messageMenuOpen, setMessageMenuOpen] = useState(false)
  const bootstrapId = useId()
  const applyHintId = useId()
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false)
  // §6.5: a Change Set that introduces or worsens a readiness conflict needs an
  // explicit second confirmation; the flag never survives a change of the batch.
  const [confirmConflictApply, setConfirmConflictApply] = useState(false)
  const [dependencyGraphHidden, setDependencyGraphHidden] = useState(false)
  const [dependencyGraphDepth, setDependencyGraphDepth] = useState<1 | 2>(1)
  const [dependencyGraphSupersedes, setDependencyGraphSupersedes] = useState(true)
  const [dependencyGraphFocusId, setDependencyGraphFocusId] = useState<string | undefined>(undefined)
  const [dependencyGraphActiveKey, setDependencyGraphActiveKey] = useState<string | undefined>(undefined)
  const [dependencyGraphProblem, setDependencyGraphProblem] = useState<string | null>(null)
  const [dependencyVisibleCount, setDependencyVisibleCount] = useState(50)
  const [dependencyEditorId, setDependencyEditorId] = useState<string | null>(null)
  const [pendingListFocusId, setPendingListFocusId] = useState<string | null>(null)
  const [pendingProposalFocusId, setPendingProposalFocusId] = useState<string | null>(null)
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null)
  const [archiveEntries, setArchiveEntries] = useState<readonly CharterArchiveEntry[]>([])
  const [archiveCacheProblem, setArchiveCacheProblem] = useState<string | null>(null)
  const [activeArchiveKey, setActiveArchiveKey] = useState<string | null>(null)
  const [archiveSource, setArchiveSource] = useState<'cache' | 'file' | null>(null)
  const [previewMode, setPreviewMode] = useState<'formatted' | 'exact'>('formatted')
  const [confirmRecovery, setConfirmRecovery] = useState<'initialize' | 'restore' | null>(null)
  const [confirmRestoreKey, setConfirmRestoreKey] = useState<string | null>(null)
  const [exportProblem, setExportProblem] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [proposalReasons, setProposalReasons] = useState<Record<string, string>>({})
  const changeSetSheet = useChangeSetSheet()
  const archiveGenerationRef = useRef(0)
  const exportEpochRef = useRef(0)
  const exportInFlightRef = useRef(false)
  const viewRef = useRef(view)
  const archiveInputRef = useRef<HTMLInputElement | null>(null)
  const messageMenuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const pendingNavRef = useRef<CharterSection | null>(null)

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
    setActiveArchiveKey(null)
    setArchiveSource(null)
    setMessageCandidates([])
    setMessageSeq(undefined)
    setMessageDraft('')
    setMessageKind('invariant')
    setMessageMenuOpen(false)
    setValidatorItemId('')
    setValidatorKind('workspace.path-exists')
    setValidatorPath('')
    setValidatorExpectation('')
    setValidatorFeedback(null)
    setIntegrityFeedback(null)
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
  const activeInvariants = activeItems(invariants)
  const pendingInvariants = pendingItems(invariants)
  // The Pane renders the single sorted projected list (filtered to the working
  // rows), never active-then-pending groups: an order-1 pending row must stay
  // above an order-2 active row just as the prompt renders it.
  const currentInvariants = activeItems(invariants)
  const historyInvariants = invariants.filter(item => item.lifecycle !== 'current' || item.review === 'rejected')
  const activeDeliverables = activeItems(deliverables)
  const pendingDeliverables = pendingItems(deliverables)
  const pendingObjectiveProposals = (projected?.objectiveProposals ?? []).filter(proposal => proposal.review === 'pending')
  const closedObjectiveProposals = (projected?.objectiveProposals ?? []).filter(proposal => proposal.review !== 'pending')
  const inactiveItems = projectedItems.filter(item =>
    item.lifecycle !== 'current' || item.review === 'rejected')
  const totalPending = pendingInvariants.length + pendingDeliverables.length + pendingObjectiveProposals.length
  const pendingItemProposals = [...pendingInvariants, ...pendingDeliverables]
    .filter(item => !item.synthetic && (view?.items ?? []).some(committed => committed.id === item.id))
  const batchByItem = new Map<string, { readonly batchId: string; readonly sourceKind: string }>()
  for (const batch of view?.proposalBatches ?? []) {
    for (const candidate of batch.candidates) {
      if (candidate.kind === 'item') {
        batchByItem.set(candidate.id, { batchId: batch.id, sourceKind: batch.source.kind })
      }
    }
  }
  const dependencyPlanResult = useMemo(() => {
    try {
      return { ok: true as const, plan: dependencyProjection(projectedItems as unknown as CharterItem[]) }
    } catch {
      return { ok: false as const, plan: [] }
    }
  }, [projectedItems])
  const dependencyPlan = dependencyPlanResult.plan
  const dependencyByItemId = useMemo(() => new Map(dependencyPlan.map(row => [row.id, row])), [dependencyPlan])
  const dependencyConflict = !dependencyPlanResult.ok
  const currentDeliverables = activeItems(deliverables)
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
  const previewResult = useMemo(() => {
    if (view === null) return { ok: true as const, text: '' }
    try {
      return { ok: true as const, text: previewPrompt(view, effectiveOps) }
    } catch {
      return { ok: false as const, text: '' }
    }
  }, [view, effectiveOps])
  const preview = previewResult.text
  const previewInvalid = !previewResult.ok
  const planInvalid = dependencyConflict || previewInvalid
  // Same before/after comparison the Host planner uses (§6.5), computed locally so
  // the confirmation gate does not wait for a preview round-trip.
  const conflictDiff = useMemo<DependencyConflictDiff>(
    () => view === null
      ? EMPTY_CONFLICT_DIFF
      : dependencyConflictDiff(view.items, projectedItems as unknown as CharterItem[]),
    [view, projectedItems],
  )
  const conflictTotal = conflictDiff.added.length + conflictDiff.worsened.length
  const relationGraph = useMemo<RelationGraphModel | null>(() => {
    if (view === null || !dependencyPlanResult.ok) return null
    return buildRelationGraph({
      committed: view.items as unknown as GraphInputItem[],
      projected: projectedItems as unknown as GraphInputItem[],
      showSupersedes: true,
    })
  }, [view, projectedItems, dependencyPlanResult.ok])
  const relationFocusId = relationGraph === null
    ? undefined
    : dependencyGraphFocusId !== undefined && relationGraph.nodes.some(node => node.id === dependencyGraphFocusId)
      ? dependencyGraphFocusId
      : defaultGraphFocus(relationGraph)
  const relationLayout = useMemo(() => relationGraph === null
    ? null
    : layoutRelationGraph(relationGraph, {
      focusId: relationFocusId,
      depth: dependencyGraphDepth,
      supersedesHidden: !dependencyGraphSupersedes,
    }), [relationGraph, relationFocusId, dependencyGraphDepth, dependencyGraphSupersedes])
  const relationGraphAvailable = relationGraph !== null && relationGraph.nodes.length > 0
  const formattedPreview = useMemo(() => formatCharterPreview(preview), [preview])
  const bootstrapPromptBytes = useMemo(() => {
    if (view === null || bootstrapPhase !== 'draft') return 0
    try {
      return utf8Bytes(previewPrompt(view, bootstrapPlan.ops))
    } catch {
      return view.limits.maxPromptBytes + 1
    }
  }, [view, bootstrapPhase, bootstrapPlan.ops])
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
    if (draft.discardAllLocalWork()) focusStatus()
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
    setDependencyGraphHidden(false)
    setDependencyGraphFocusId(undefined)
    setDependencyGraphActiveKey(undefined)
    setDependencyVisibleCount(50)
    setDependencyEditorId(null)
    setPendingListFocusId(null)
    setPendingProposalFocusId(null)
  }, [view?.sessionId])

  useEffect(() => {
    setConfirmDiscardAll(false)
    setConfirmConflictApply(false)
    setDependencyGraphProblem(null)
  }, [view?.sessionId, view?.lifecycle, view?.revision, baseRevision, conflictTotal, draftState.ops, draftState.editor, draftState.editorText, draftState.newInvariant, draftState.newDeliverable])

  useEffect(() => {
    if (!maintenanceEnabled || (section !== 'context' && section !== 'recovery' && section !== 'diagnostics') || source.listArchives === undefined) return
    let active = true
    setArchiveCacheProblem(null)
    void source.listArchives().then(result => {
      if (!active) return
      if (result.ok) {
        setArchiveEntries(result.archives)
      } else {
        setArchiveCacheProblem(errorLabel(result.code, t))
      }
    }).catch(() => {
      if (active) setArchiveCacheProblem(t('recovery.cacheUnavailable'))
    })
    return () => { active = false }
  }, [maintenanceEnabled, section, source, view?.revision, draftState.maintenanceSaving, recoveryBusy, t])
  useEffect(() => {
    if (draftState.maintenanceSaving || maintenanceReplay) return
    if (archiveInputRef.current !== null) archiveInputRef.current.value = ''
  }, [draftState.maintenanceSaving, maintenanceReplay, recordState?.kind])

  useEffect(() => {
    if (section !== 'history' || source.queryMessages === undefined) return
    let active = true
    void source.queryMessages().then(result => {
      if (!active || !result.ok) return
      setMessageCandidates(result.messages)
      const last = result.messages.at(-1)
      setMessageSeq(last?.seq)
      setMessageDraft(last?.text ?? '')
    }).catch(() => undefined)
    return () => { active = false }
  }, [section, source, view?.sessionId])


  useEffect(() => {
    if (pendingListFocusId === null) return
    if (typeof document === 'undefined') {
      setPendingListFocusId(null)
      return
    }
    const row = document.querySelector<HTMLElement>(`[data-dependency-id="${CSS.escape(pendingListFocusId)}"]`)
    if (row !== null) {
      row.focus()
      row.scrollIntoView({ block: 'nearest' })
    }
    setPendingListFocusId(null)
  }, [pendingListFocusId, dependencyVisibleCount, dependencyPlan.length, section])

  useEffect(() => {
    if (pendingProposalFocusId === null || section !== 'history') return
    const index = pendingItemProposals.findIndex(item => item.id === pendingProposalFocusId)
    if (index < 0) {
      setPendingProposalFocusId(null)
      return
    }
    if (index >= reviewLimit) {
      setReviewLimit(index + 1)
      return
    }
    if (typeof document === 'undefined') {
      setPendingProposalFocusId(null)
      return
    }
    const row = document.querySelector<HTMLElement>(`[data-proposal-id="${CSS.escape(pendingProposalFocusId)}"]`)
    if (row !== null) {
      row.focus()
      row.scrollIntoView({ block: 'nearest' })
    }
    setPendingProposalFocusId(null)
  }, [pendingProposalFocusId, section, reviewLimit, pendingItemProposals])

  // 0.3.0 W2: section state is a real route. Scroll the host scrollBody to the
  // target anchor and move focus to its heading after the area commits. This
  // hook must stay before the early returns so the hook order is stable.
  useEffect(() => {
    const next = pendingNavRef.current
    if (next === null) return
    pendingNavRef.current = null
    if (typeof document === 'undefined') return
    const run = (): void => {
      const target = scrollToSectionAnchor(next, document)
      focusSectionHeading(target, headingRef.current)
    }
    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(run)
      return () => cancelAnimationFrame(frame)
    }
    const timer = setTimeout(run, 0)
    return () => clearTimeout(timer)
  }, [section])

  if (state.status === 'connecting' && view === null) {
    return (
      <section className="charter-root charter-skeleton-root" aria-label={t('header.title')} aria-busy="true">
        <div className="charter-skeleton" role="status" aria-label={t('status.loading')}>
          <span className="charter-skeleton__row charter-skeleton__row--title" />
          <span className="charter-skeleton__row" />
          <span className="charter-skeleton__row charter-skeleton__row--short" />
        </div>
      </section>
    )
  }
  if (view === null) {
    return (
      <section className="charter-root charter-centered" aria-label={t('header.title')}>
        <StateMark state="error" />
        <span>{t('error.connection')}</span>
        {state.errorKind !== undefined && <span>{t(`error.connectionKind.${state.errorKind}` as never)}</span>}
        <ErrorDetails detail={state.error ?? undefined} t={t} />
        <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
      </section>
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
    | 'revision-conflict' | 'connection' | 'quota' | 'stale' | 'dependency-conflict' | null = editReplay
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
                  ? admission.reason === 'invalid-dependencies' ? 'dependency-conflict' : 'quota'
                  : planInvalid
                    ? 'dependency-conflict'
                    : null
  const applyHint = applyBlockReason !== null
    ? t(`apply.block.${applyBlockReason}` as never)
    : conflictTotal > 0
      ? t(confirmConflictApply ? 'changeset.conflictConfirmHint' : 'changeset.conflictHint', { count: conflictTotal })
      : t('footer.applyHint')
  const bootstrapHint = bootstrapReplay
    ? t('apply.block.retry')
    : bootstrapSaving
      ? t('apply.block.busy')
      : canApplyBootstrap
        ? t('bootstrap.applyHint')
        : t('apply.block.bootstrap-blocked')
  const footerHint = (bootstrapPhase === 'draft' || bootstrapReplay) ? bootstrapHint : applyHint
  const showActionBar = hasLocalWork || bootstrapPhase === 'draft' || bootstrapReplay || unknownReplay || saving
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

  // 0.3.0 W3: one prioritized notice instead of up to seven stacked banners.
  const paneNotice: {
    readonly tone: 'neutral' | 'warning' | 'danger'
    readonly role: 'status' | 'alert'
    readonly text: string
    readonly hint?: string
    readonly detail?: string
    readonly action?: 'retry' | 'rebase'
    readonly blockedText?: string
  } | null = disconnected
    ? {
        tone: 'danger', role: 'alert', text: t('error.connection'),
        ...(state.errorKind !== undefined ? { hint: t(`error.kind.${state.errorKind}` as never) } : {}),
        ...(state.error !== null ? { detail: state.error } : {}),
        action: 'retry',
      }
    : revisionConflict
      ? {
          tone: 'warning', role: 'alert',
          text: t('notice.conflict', { from: baseRevision ?? 0, to: view.revision }),
          ...(canRebaseNow ? { action: 'rebase' as const } : { blockedText: t('conflict.rebaseBlocked') }),
        }
      : budgetNotice !== null
        ? {
            tone: budgetNotice.tone === 'danger' ? 'danger' : 'warning',
            role: 'alert',
            text: budgetNotice.text,
          }
        : editReplay || bootstrapReplay
          ? { tone: 'warning', role: 'alert', text: t('footer.replayPending') }
          : oldLifecycleUnknown
            ? { tone: 'warning', role: 'alert', text: t('footer.lifecyclePending') }
            : notice !== null
              ? {
                  tone: 'warning', role: 'status', text: notice,
                  ...(view.message !== undefined && view.message !== notice ? { detail: view.message } : {}),
                }
              : state.status === 'connecting'
                ? { tone: 'neutral', role: 'status', text: t('status.reconnecting') }
                : null

  const area = section === 'history'
    ? 'review'
    : section === 'context' || section === 'recovery' || section === 'diagnostics'
      ? 'diagnostics'
      : 'workspace'
  const goSection = (next: CharterSection): void => {
    pendingNavRef.current = next
    draft.setSection(next)
  }


  const selectedMessage = messageCandidates.find(message => message.seq === messageSeq)
  const messageBytes = normalizedBytes(messageDraft)
  const messageOverBudget = messageBytes > view.limits.maxItemBytes
  const messageTextAvailable = selectedMessage?.text !== undefined
  const messageCanSave = messageSeq !== undefined && messageTextAvailable
    && normalizedNonEmpty(messageDraft) && !messageOverBudget
  const queue = (op: CharterOp): void => {
    if (!online || view.status !== 'ready' || saving) return
    draft.stage(view, op)
  }
  const openEditor = (target: DraftEditor): void => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    draft.openEditor(target, view)
  }
  const focusStatus = (): void => {
    (statusRef.current ?? headingRef.current)?.focus()
  }
  const applyDraft = (): void => {
    if (conflictTotal > 0 && !confirmConflictApply) {
      setConfirmConflictApply(true)
      return
    }
    setConfirmConflictApply(false)
    void draft.applyDraft(view).finally(focusStatus)
  }
  const stageGraphRequires = (targetId: string, nextRequires: readonly string[]): void => {
    if (view === null || !editable) return
    const candidateItems = projectedItems.map(item => item.id === targetId
      ? { ...item, requires: [...nextRequires] }
      : item)
    try {
      const projected = candidateItems as unknown as CharterItem[]
      validateDependencyGraph(projected)
      dependencyProjection(projected)
    } catch {
      setDependencyGraphProblem(t('deps.conflict'))
      return
    }
    setDependencyGraphProblem(null)
    draft.setDeliverableRequires(view, targetId, nextRequires)
  }
  const locateGraphNodeInList = (id: string): void => {
    if (id === '') return
    const index = dependencyPlan.findIndex(row => row.id === id)
    if (index < 0) return
    setDependencyVisibleCount(count => Math.max(count, index + 1))
    setPendingListFocusId(id)
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
      if (result.ok) {
        downloadArchive(result.filename, result.archive)
        void source.listArchives?.().then(list => {
          if (list.ok) setArchiveEntries(list.archives)
        }).catch(() => undefined)
      } else setExportProblem(errorText(result.code))
    }).catch(() => {
      if (epoch !== exportEpochRef.current) return
      exportInFlightRef.current = false
      setExporting(false)
      setExportProblem(t('recovery.exportFailed'))
    })
  }

  const chooseCachedArchive = (entry: CharterArchiveEntry): void => {
    if (recoveryBusy || unknownBlocked || source.readArchive === undefined) return
    const generation = ++archiveGenerationRef.current
    const expectedSessionId = view?.sessionId
    const expectedLifecycle = draftState.lifecycle ?? view?.lifecycle ?? null
    const label = t('recovery.cacheRevision', { revision: entry.revision })
    const isCurrent = (): boolean => generation === archiveGenerationRef.current
      && viewRef.current?.sessionId === expectedSessionId
      && (draft.getSnapshot().lifecycle ?? null) === expectedLifecycle
    setActiveArchiveKey(entry.key)
    setArchiveSource('cache')
    setArchivePreview({ fileName: label })
    setExportProblem(null)
    setConfirmRecovery(null)
    if (view === null) return
    const maxBytes = view.limits.maxRecoveryBytes ?? 4 * 1_024 * 1_024
    const lifecycle = draftState.lifecycle ?? view.lifecycle ?? null
    void source.readArchive(entry.key).then(async result => {
      if (!isCurrent()) return
      if (!result.ok) {
        setArchivePreview({ fileName: label, errorKey: 'recovery.invalidArchive' })
        return
      }
      const preview = await previewArchive(result.archive, {
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
          fileName: label,
          errorKey: key,
          ...(preview.reason === 'fileTooLarge' ? { errorParams: { limit: formatBytes(t, maxBytes) } } : {}),
        })
        return
      }
      if (!isCurrent()) return
      setArchivePreview({
        fileName: label,
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
      if (isCurrent()) setArchivePreview({ fileName: label, errorKey: 'recovery.invalidArchive' })
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
    setArchiveSource('file')
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
    focusStatus()
  }
  const applyBootstrapDraft = (): void => {
    void draft.applyBootstrap(view).finally(() => focusStatus())
  }
  const openHistory = (): void => {
    goSection('history')
  }

  const changeSetConflicts = buildChangeSetConflicts(conflictDiff, { dependencyPlan, projectedItems })
  const unstageOp = (op: CharterOp): void => {
    if (op.type.startsWith('objective.')) {
      draft.unstageObjective()
      focusStatus()
      return
    }
    if ('itemId' in op) {
      draft.unstage(op.itemId)
      focusStatus()
      return
    }
    if (op.type === 'item.add' || op.type === 'item.propose') {
      const added = projectedItems.find(item => item.text === op.item.text && item.kind === op.item.kind)
      if (added !== undefined) {
        draft.unstage(added.id)
        focusStatus()
      }
      return
    }
  }

  const renderItems = (
    items: readonly ProjectedItem[],
    history: readonly ProjectedItem[],
    emptyKey: 'invariants.empty' | 'deliverables.empty',
    windowKey: 'invariants' | 'deliverables',
  ): ReactNode => {
    const allVisible = showHistoryItems ? [...items, ...history] : items
    const limit = visibleCounts[windowKey]
    const visible = allVisible.slice(0, limit)
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
            localKey={dependencyByItemId.get(item.id)?.localKey}
            byteCount={formatBytes(t, utf8Bytes(item.text))}
            t={t}
          />
        ))}
        {allVisible.length > visible.length && (
          <button
            type="button"
            className="charter-historytoggle"
            onClick={() => setVisibleCounts(current => ({
              ...current,
              [windowKey]: current[windowKey] + 50,
            }))}
          >
            {t('history.showMore', { count: allVisible.length - visible.length })}
          </button>
        )}
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

  // W5 page split: explicit, typed contract consumed by Workspace/Review/Diagnostics pages.
  const paneScope: PaneScope = {
activeDeliverables,
  activeInvariants,
  area,
  bootstrapPhase,
  bootstrapProblem,
  counts,
  currentDeliverables,
  currentInvariants,
  deliverables,
  dependencyByItemId,
  dependencyEditorId,
  dependencyGraphActiveKey,
  dependencyGraphDepth,
  dependencyGraphHidden,
  dependencyGraphProblem,
  dependencyGraphSupersedes,
  dependencyPlan,
  dependencyVisibleCount,
  draft,
  editable,
  editor,
  editorNeedsReason,
  editorReason,
  editorText,
  focusStatus,
  goSection,
  historyDeliverables,
  historyInvariants,
  invariants,
  locateGraphNodeInList,
  newDeliverable,
  newInvariant,
  objectiveStaged,
  openEditor,
  openHistory,
  pendingDeliverables,
  pendingInvariants,
  planInvalid,
  projectedItems,
  projectedObjective,
  relationFocusId,
  relationGraph,
  relationGraphAvailable,
  relationLayout,
  release,
  renderItems,
  saving,
  section,
  setDependencyEditorId,
  setDependencyGraphActiveKey,
  setDependencyGraphDepth,
  setDependencyGraphFocusId,
  setDependencyGraphHidden,
  setDependencyGraphSupersedes,
  setDependencyVisibleCount,
  setPendingProposalFocusId,
  showEmpty,
  source,
  stageGraphRequires,
  t,
  unknownBlocked,
  view,
  abandonUnknown,
  applyBootstrapDraft,
  applyHintId,
  batchByItem,
  bootstrap,
  bootstrapBudgetOver,
  bootstrapId,
  bootstrapItems,
  bootstrapObjective,
  bootstrapObjectiveOver,
  bootstrapPlan,
  bootstrapPromptBytes,
  bootstrapReplay,
  bootstrapSaving,
  bootstrapStorageOver,
  bootstrapTextIssue,
  bootstrapVisibleCount,
  canApplyBootstrap,
  closedObjectiveProposals,
  confirmAbandon,
  inactiveItems,
  messageBytes,
  messageCanSave,
  messageCandidates,
  messageDraft,
  messageKind,
  messageMenuOpen,
  messageMenuRef,
  messageOverBudget,
  messageSeq,
  messageTextAvailable,
  ops,
  pendingItemProposals,
  pendingObjectiveProposals,
  proposalReasons,
  reviewLimit,
  selectedMessage,
  setMessageDraft,
  setMessageKind,
  setMessageMenuOpen,
  setMessageSeq,
  setProposalReasons,
  setReviewLimit,
  unknownReplay,
  activeArchiveKey,
  archiveCacheProblem,
  archiveEntries,
  archiveInputRef,
  archivePreview,
  archiveSource,
  canExport,
  capabilities,
  chooseArchive,
  chooseCachedArchive,
  confirmRecovery,
  draftOpen,
  draftState,
  errorText,
  exportArchive,
  exportProblem,
  exportableState,
  exporting,
  formattedPreview,
  initAdmission,
  initializeEmpty,
  integrityFeedback,
  maintenanceEnabled,
  maintenanceProblem,
  maintenanceReplay,
  overBudget,
  preview,
  previewBytes,
  previewMode,
  recordDigest,
  recordState,
  recoveryBusy,
  restoreAdmission,
  restoreArchive,
  restoreArchiveReady,
  restoreTarget,
  retainedArchive,
  setConfirmRecovery,
  setIntegrityFeedback,
  setPreviewMode,
  setValidatorExpectation,
  setValidatorFeedback,
  setValidatorItemId,
  setValidatorKind,
  setValidatorPath,
  setValidatorRunning,
  validatorExpectation,
  validatorFeedback,
  validatorItemId,
  validatorKind,
  validatorPath,
  validatorRunning,
  }


  return (
    <section className="charter-root" data-dsh-part="charter-pane" aria-label={t('header.title')}>
      <div className="charter-shell">{showActionBar && (
        <div className="charter-actionbar" role="group" aria-label={t('changeset.title')}>
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
                      onClick={() => { draft.discardStaged(); focusStatus() }}
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
                        : editReplay
                          ? t('footer.retryApply')
                          : confirmConflictApply && conflictTotal > 0
                            ? t('footer.applyConfirmConflicts', { count: conflictTotal })
                            : t('footer.apply')}
                    </ActionButton>
                    {unknownReplay && (
                      <ActionButton variant="outline" onClick={abandonUnknown}>
                        {confirmAbandon ? t('footer.abandonConfirm') : t('footer.abandon')}
                      </ActionButton>
                    )}
                  </>
                )}
          </div>
        </div>
        )}


        <div className={`charter-layout${hasLocalWork ? ' is-rail' : ''}`}>
          <div className="charter-doc">
            <header className="charter-pagehead">
            <CharterMark />
            <h2 ref={headingRef} tabIndex={-1}>{t('header.title')}</h2>
            <div className="charter-headmeta">
              <span className="charter-version"><StatusTag tone="info">{t('header.version', { version: CHARTER_VERSION })}</StatusTag></span>
              <span className="charter-rev">{t('stats.revision', { revision: view.revision })}</span>
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
                <span className="charter-meter__track" aria-hidden="true">
                  <span className="charter-meter__fill" style={{ width: `${budgetPercent}%` }} />
                </span>
                <span className="charter-meter__text">
                  {ops.length > 0
                    ? t('stats.budgetDelta', {
                        before: formatBytes(t, utf8Bytes(view.promptText)),
                        after: formatBytes(t, previewBytes),
                        limit: formatBytes(t, view.limits.maxPromptBytes),
                      })
                    : t('stats.budget', {
                        used: formatBytes(t, previewBytes),
                        limit: formatBytes(t, view.limits.maxPromptBytes),
                      })}
                </span>
              </div>
              {hasLocalWork && (
                <button
                  type="button"
                  ref={changeSetSheet.triggerRef}
                  className="charter-changeset-trigger"
                  aria-haspopup="dialog"
                  aria-controls="charter-changeset-sheet"
                  onClick={() => changeSetSheet.setOpen(true)}
                >
                  {t('changeset.open')}
                </button>
              )}
              {message !== null && !showActionBar && (
                <span
                  className="charter-headmessage"
                  role={feedback?.kind === 'error' || feedback?.kind === 'connection' ? 'alert' : 'status'}
                >
                  {message}
                </span>
              )}
            </div>
          </header>
            <div className="charter-headrule" />
            <SectionNav t={t} area={area} totalPending={totalPending} onNavigate={goSection} />
            {paneNotice !== null && (
          <div className={`charter-notice${paneNotice.tone === 'danger'
            ? ' charter-notice--danger'
            : paneNotice.tone === 'warning' ? ' charter-notice--warning' : ''}`}>
            <span role={paneNotice.role}>{paneNotice.text}</span>
            {paneNotice.hint !== undefined && <span className="charter-hint">{paneNotice.hint}</span>}
            {paneNotice.detail !== undefined && <ErrorDetails detail={paneNotice.detail} t={t} />}
            {paneNotice.blockedText !== undefined && <span>{paneNotice.blockedText}</span>}
            {paneNotice.action === 'retry' && (
              <ActionButton variant="outline" onClick={source.retry}>{t('button.retry')}</ActionButton>
            )}
            {paneNotice.action === 'rebase' && (
              <ActionButton variant="outline" onClick={() => draft.rebase(view)}>
                {t('conflict.rebase', { revision: view.revision })}
              </ActionButton>
            )}
          </div>
        )}


            <div className="charter-content" id={area === 'workspace' ? 'charter-workspace-top' : area === 'review' ? 'charter-review-pending' : 'charter-diagnostics-top'}>
            {area === 'workspace' && <WorkspacePage scope={paneScope} />}
            {area === 'review' && <ReviewCenterPage scope={paneScope} />}
            {area === 'diagnostics' && <DiagnosticsPage scope={paneScope} />}
          </div>

          </div>
          {hasLocalWork && (
            <aside
              id="charter-changeset"
              className="charter-changeset-panel"
              role="complementary"
              aria-labelledby="charter-changeset-title"
            >
              <ChangeSetPanel
                t={t}
                headingId="charter-changeset-title"
                ops={ops}
                stagedOps={localWork.stagedOps}
                promptBefore={formatBytes(t, utf8Bytes(view.promptText))}
                promptAfter={formatBytes(t, previewBytes)}
                itemsBefore={view.items.length}
                itemsAfter={projectedItems.length}
                editorOpen={editor !== null}
                conflicts={changeSetConflicts}
                diffContext={{
                  objectiveBefore: view.objective?.current.text ?? null,
                  objectiveAfter: projectedObjective?.current.text ?? null,
                  itemsBefore: view.items,
                  projectedItems,
                }}
                canUnstage={editable && !saving && !unknownBlocked}
                hint={footerHint}
                onUnstage={unstageOp}
              />
            </aside>
          )}
        </div>
        {changeSetSheet.open && hasLocalWork && (
          <div className="charter-sheet-backdrop" onClick={() => changeSetSheet.setOpen(false)}>
            <section
              id="charter-changeset-sheet"
              ref={changeSetSheet.sheetRef}
              className="charter-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="charter-changeset-sheet-title"
              tabIndex={-1}
              onClick={event => event.stopPropagation()}
            >
              <div className="charter-sheet__head">
                <span className="charter-kicker">{t('changeset.kicker')}</span>
                <ActionButton onClick={() => changeSetSheet.setOpen(false)}>{t('changeset.close')}</ActionButton>
              </div>
              <ChangeSetPanel
                t={t}
                headingId="charter-changeset-sheet-title"
                ops={ops}
                stagedOps={localWork.stagedOps}
                promptBefore={formatBytes(t, utf8Bytes(view.promptText))}
                promptAfter={formatBytes(t, previewBytes)}
                itemsBefore={view.items.length}
                itemsAfter={projectedItems.length}
                editorOpen={editor !== null}
                conflicts={changeSetConflicts}
                diffContext={{
                  objectiveBefore: view.objective?.current.text ?? null,
                  objectiveAfter: projectedObjective?.current.text ?? null,
                  itemsBefore: view.items,
                  projectedItems,
                }}
                canUnstage={editable && !saving && !unknownBlocked}
                hint={footerHint}
                onUnstage={unstageOp}
              />
            </section>
          </div>
        )}
      </div>
    </section>
  )
}

export type { SessionId }
