import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inspectUserText, type UserTextIssue } from '../core/normalize.js'
import type { CharterErrorCode } from '../core/errors.js'
import type {
  CharterInitializeRequest,
  CharterRecordArchive,
  CharterRestoreRequest,
  CharterRestoreTarget,
} from '../core/schemas.js'
import { classifyRemoteFailure } from './remote-error.js'
import type { CharterOp, NewItemInput } from '../core/schemas.js'
import type {
  CharterBootstrapProposal,
  CharterView,
} from '../host/types.js'
import type { CharterSessionSource } from './store.js'
import { draftAdmission } from './admission.js'
import { opTargets } from './preview.js'
import {
  buildBootstrapPlan,
  classifyBootstrapOutcome,
  firstDraftTextIssue,
  type BootstrapDraftItem,
  type BootstrapPlan,
} from './bootstrap-plan.js'

export type CharterSection =
  | 'overview'
  | 'objective'
  | 'invariants'
  | 'deliverables'
  | 'history'
  | 'context'
  | 'recovery'

export type DraftEditor =
  | { readonly kind: 'objective' }
  | { readonly kind: 'edit'; readonly item: import('../core/schemas.js').CharterItem }
  | { readonly kind: 'supersede'; readonly item: import('../core/schemas.js').CharterItem }

/** Rendered feedback descriptors; the Pane resolves them with the live locale. */
export type DraftFeedback =
  | { readonly kind: 'saved'; readonly revision: number }
  | { readonly kind: 'replayed' }
  | {
      readonly kind: 'bootstrapSaved'
      readonly active: number
      readonly pending: number
      readonly revision: number
    }
  | { readonly kind: 'error'; readonly code: CharterErrorCode; readonly detail?: string }
  | { readonly kind: 'connection' }
  | { readonly kind: 'scope' }
  | { readonly kind: 'editorBudget'; readonly limit: number }
  | { readonly kind: 'editorUnchanged'; readonly target: 'objective' | 'item' }
  | { readonly kind: 'editorInvalid'; readonly issue: UserTextIssue }
  | { readonly kind: 'itemBudget'; readonly limit: number }
  | { readonly kind: 'discarded' }

export type BootstrapPhase =
  | 'idle'
  | 'checking'
  | 'draft'
  | 'no-summary'
  | 'not-live'
  | 'failed'
  | 'unavailable'
  | 'dismissed'

export interface BootstrapProblem {
  readonly kind: 'stale' | 'request-failed' | 'unavailable' | 'save-failed'
  readonly code?: CharterErrorCode
  readonly detail?: string
}

/**
 * One persisted request attempt. `in-flight` means the RPC is still awaited;
 * `unknown` means the outcome is genuinely unknown (transport failure, source
 * detached/unavailable) and the exact request must be replayed or explicitly
 * abandoned — never silently dropped or replaced. Edit, bootstrap, initialize
 * and restore share this one lifecycle.
 */
export interface EditAttempt {
  readonly kind: 'edit'
  readonly request: import('../core/schemas.js').CharterEditRequest
  readonly sourceGeneration: number
  readonly status: 'in-flight' | 'unknown'
}

export interface BootstrapAttempt {
  readonly kind: 'bootstrap'
  readonly request: import('../core/schemas.js').CharterEditRequest
  readonly sourceGeneration: number
  readonly status: 'in-flight' | 'unknown'
}

export interface MaintenanceAttempt {
  readonly kind: 'initialize' | 'restore'
  readonly request: CharterInitializeRequest | CharterRestoreRequest
  readonly sourceGeneration: number
  readonly status: 'in-flight' | 'unknown'
}

export type DraftAttempt = EditAttempt | BootstrapAttempt | MaintenanceAttempt

export interface CharterDraftState {
  readonly sessionId: SessionId
  /** Session lifecycle fingerprint; a different lifecycle resets the draft. */
  readonly lifecycle: string | null
  readonly section: CharterSection
  readonly ops: readonly CharterOp[]
  readonly baseRevision: number | null
  readonly editor: DraftEditor | null
  readonly editorText: string
  readonly editorReason: string
  readonly editorNeedsReason: boolean
  /** Revision the open editor's baseline was captured against. */
  readonly editorBaseRevision: number | null
  readonly newInvariant: string
  readonly newDeliverable: string
  readonly feedback: DraftFeedback | null
  readonly saving: boolean
  readonly bootstrapSaving: boolean
  readonly bootstrapPhase: BootstrapPhase
  readonly bootstrap: CharterBootstrapProposal | null
  readonly bootstrapObjective: string
  readonly bootstrapItems: readonly BootstrapDraftItem[]
  readonly bootstrapProblem: BootstrapProblem | null
  /** A stream frame made the reviewed draft stale while its RPC outcome was unknown. */
  readonly bootstrapNeedsStale: boolean
  /** View revision captured when the reviewed history draft was accepted. */
  readonly bootstrapBaseRevision: number | null
  readonly attempt: DraftAttempt | null
  /** A maintenance RPC (initialize/restore) is in flight. */
  readonly maintenanceSaving: boolean
  /** Last maintenance failure shown in the Storage & recovery section. */
  readonly maintenanceProblem: MaintenanceProblem | null
}

export interface MaintenanceProblem {
  readonly kind: 'request-failed' | 'unavailable'
  readonly code?: CharterErrorCode | string
  readonly detail?: string
}

export type ResolveSource = () => CharterSessionSource | undefined

function mutationId(): string {
  return `ui-${globalThis.crypto.randomUUID()}`
}

function clientRef(): string {
  return `draft-${globalThis.crypto.randomUUID()}`
}

function sameOp(left: CharterOp, right: CharterOp): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** The last edit Apply has an unknown outcome and must be replayed/abandoned. */
export function editReplayPending(state: Pick<CharterDraftState, 'attempt'>): boolean {
  return state.attempt?.kind === 'edit' && state.attempt.status === 'unknown'
}

/** Initialize/restore has an unknown outcome and must be replayed/abandoned. */
export function maintenanceReplayPending(state: Pick<CharterDraftState, 'attempt'>): boolean {
  return (state.attempt?.kind === 'initialize' || state.attempt?.kind === 'restore')
    && state.attempt.status === 'unknown'
}

/** The edit/bootstrap mutation id of an attempt (undefined for maintenance). */
export function attemptMutationId(
  attempt: DraftAttempt | null,
): string | undefined {
  return attempt !== null && (attempt.kind === 'edit' || attempt.kind === 'bootstrap')
    ? attempt.request.mutationId
    : undefined
}

/** The edit/bootstrap request of an attempt (undefined for maintenance). */
export function attemptEditRequest(
  attempt: DraftAttempt | null,
): import('../core/schemas.js').CharterEditRequest | undefined {
  return attempt !== null && (attempt.kind === 'edit' || attempt.kind === 'bootstrap')
    ? attempt.request
    : undefined
}

/** The unresolved maintenance attempt, if one exists. */
export function maintenanceAttempt(
  state: Pick<CharterDraftState, 'attempt'>,
): MaintenanceAttempt | undefined {
  const attempt = state.attempt
  return attempt?.kind === 'initialize' || attempt?.kind === 'restore' ? attempt : undefined
}

/** The last bootstrap Apply has an unknown outcome and must be replayed/abandoned. */
export function bootstrapReplayPending(state: Pick<CharterDraftState, 'attempt'>): boolean {
  return state.attempt?.kind === 'bootstrap' && state.attempt.status === 'unknown'
}

/** Either kind of unknown-outcome attempt is unresolved. */
export function unknownAttempt(state: Pick<CharterDraftState, 'attempt'>):
  | DraftAttempt
  | undefined {
  return state.attempt?.status === 'unknown' ? state.attempt : undefined
}

/** Lock every draft edit while any durable request is unresolved/in-flight. */
function replayLocked(state: CharterDraftState): boolean {
  return unknownAttempt(state) !== undefined || state.maintenanceSaving
}

/**
 * The single classification of a non-ok edit result: `UNAVAILABLE` (source not
 * attached, remote unavailable, transient storage failure) is NEVER a
 * definitive answer — the request may have committed, so the attempt stays
 * unknown with its exact credentials. Every other business code is definitive.
 */
function isUnknownOutcomeResult(result: { readonly ok: false; readonly code: string }): boolean {
  return result.code === 'UNAVAILABLE'
}

function initialState(sessionId: SessionId): CharterDraftState {
  return {
    sessionId,
    lifecycle: null,
    section: 'overview',
    ops: [],
    baseRevision: null,
    editor: null,
    editorText: '',
    editorReason: '',
    editorNeedsReason: false,
    editorBaseRevision: null,
    newInvariant: '',
    newDeliverable: '',
    feedback: null,
    saving: false,
    bootstrapSaving: false,
    bootstrapPhase: 'idle',
    bootstrap: null,
    bootstrapObjective: '',
    bootstrapItems: [],
    bootstrapProblem: null,
    bootstrapNeedsStale: false,
    bootstrapBaseRevision: null,
    attempt: null,
    maintenanceSaving: false,
    maintenanceProblem: null,
  }
}

/**
 * Per-Session draft ownership.
 *
 * The Pane is mounted only while its Conversation View is active, but staged
 * edits, inline editors and reviewed history drafts must survive switching to
 * Chat and back. This store lives on the client controller, keyed by Session,
 * so the same isolation guarantees as the source lease apply while the draft
 * no longer dies on unmount.
 */
export class CharterDraft {
  private state: CharterDraftState
  private readonly listeners = new Set<() => void>()
  private bootstrapGeneration = 0
  private asyncGeneration = 0

  constructor(
    private readonly sessionId: SessionId,
    private readonly resolveSource: ResolveSource,
  ) {
    this.state = initialState(sessionId)
  }

  /**
   * Bind the draft to the Session lifecycle reported by the authority.
   *
   * A reused Session id with a different lifecycle must not inherit staged
   * operations, editors or reviewed history from the previous life.
   */
  bindLifecycle(lifecycle: string | undefined): void {
    if (lifecycle === undefined || this.state.lifecycle === lifecycle) return
    // An unresolved attempt must survive view/lifecycle frames: its exact
    // mutation credentials are the only way to replay idempotently. Bind the
    // fingerprint but keep the payload/attempt visible (reconcile marks stale).
    if (this.state.attempt !== null) {
      // Invalidate the in-flight outcome of the old lifecycle while keeping the
      // exact attempt/payload: a late success must not be accepted, and the
      // request stays replayable/abandonable in the new lifecycle.
      this.bootstrapGeneration += 1
      this.asyncGeneration += 1
      const attempt = this.state.attempt
      this.update({
        lifecycle,
        saving: false,
        bootstrapSaving: false,
        // A maintenance RPC invalidated by a lifecycle change must become an
        // explicit unknown outcome, never a permanent in-flight/busy state.
        maintenanceSaving: false,
        ...(attempt !== null && (attempt.kind === 'initialize' || attempt.kind === 'restore')
          ? { attempt: { ...attempt, status: 'unknown' as const } }
          : {}),
        ...(this.state.bootstrapPhase === 'draft' && !this.state.bootstrapNeedsStale
          ? { bootstrapNeedsStale: true }
          : {}),
        ...(attempt?.kind === 'edit'
          ? { feedback: { kind: 'connection' } }
          : attempt?.kind === 'bootstrap'
            ? { bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' } }
            : { maintenanceProblem: { kind: 'unavailable', code: 'UNAVAILABLE' } }),
      })
      return
    }
    // The first fingerprint after an older Host (which reported none) is a
    // lifecycle transition: an empty draft simply adopts it, but dirty work was
    // reviewed against the unknown old lifecycle and must not be claimed by the
    // new one.
    // An in-flight extraction belongs to the lifecycle it started under; it
    // must be invalidated (not merely re-bound) when the first real fingerprint
    // arrives, and the Pane then starts a fresh extraction for this lifecycle.
    const extractionInFlight = this.state.bootstrapPhase === 'checking'
      || this.state.bootstrapSaving
    if (this.state.lifecycle === null && this.isEmpty && !extractionInFlight) {
      this.update({ lifecycle })
      return
    }
    this.bootstrapGeneration += 1
    this.asyncGeneration += 1
    this.state = { ...initialState(this.sessionId), lifecycle, section: this.state.section }
    for (const listener of [...this.listeners]) listener()
  }

  readonly getSnapshot = (): CharterDraftState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<CharterDraftState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  /** True when the draft holds no unsaved user work and can be dropped on release. */
  get isEmpty(): boolean {
    return this.state.ops.length === 0
      && this.state.editor === null
      && this.state.newInvariant.trim().length === 0
      && this.state.newDeliverable.trim().length === 0
      && this.state.attempt === null
      && this.state.bootstrapPhase !== 'draft'
      && this.state.bootstrap === null
      && this.state.bootstrapItems.length === 0
      && this.state.bootstrapObjective.trim().length === 0
  }

  /**
   * Invalidate in-flight async results because the source instance they were
   * sent through no longer exists. Local staged content is preserved.
   */
  invalidateSource(): void {
    this.asyncGeneration += 1
    const attempt = this.state.attempt
    if (this.state.saving) {
      // The connection epoch changed under an in-flight edit: the outcome is now
      // unknown. Keep the exact request/mutation id for an idempotent replay.
      this.update({
        saving: false,
        attempt: attempt?.kind === 'edit' ? { ...attempt, status: 'unknown' } : attempt,
        feedback: { kind: 'connection' },
      })
    } else if (this.state.bootstrapSaving) {
      this.update({
        bootstrapSaving: false,
        attempt: attempt?.kind === 'bootstrap' ? { ...attempt, status: 'unknown' } : attempt,
        bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
      })
    } else if (this.state.maintenanceSaving) {
      this.update({
        maintenanceSaving: false,
        attempt: attempt?.kind === 'initialize' || attempt?.kind === 'restore'
          ? { ...attempt, status: 'unknown' }
          : attempt,
        maintenanceProblem: { kind: 'unavailable', code: 'UNAVAILABLE' },
      })
    }
  }

  get userBusy(): boolean {
    return this.state.ops.length > 0
      || this.state.editor !== null
      || this.state.newInvariant.trim().length > 0
      || this.state.newDeliverable.trim().length > 0
  }

  setSection(section: CharterSection): void {
    this.update({ section })
  }

  setFeedback(feedback: DraftFeedback | null): void {
    this.update({ feedback })
  }

  setNewInvariant(value: string): void {
    if (replayLocked(this.state)) return
    this.update({ newInvariant: value })
  }

  setNewDeliverable(value: string): void {
    if (replayLocked(this.state)) return
    this.update({ newDeliverable: value })
  }

  stage(view: CharterView, op: CharterOp, fallbackBaseRevision?: number): void {
    if (view.status !== 'ready' || this.state.saving || this.state.bootstrapSaving) return
    if (replayLocked(this.state)) return
    const ops = this.state.ops.some(existing => sameOp(existing, op))
      ? this.state.ops
      : [...this.state.ops, op]
    // Once a draft is staged its baseline is frozen; new/edited content must not
    // silently retarget the batch at a newer revision. Callers that captured a
    // baseline earlier (the editor) may provide it as the fallback.
    this.update({
      ops,
      baseRevision: this.state.baseRevision
        ?? fallbackBaseRevision
        ?? view.revision,
      feedback: null,
      attempt: null,
    })
  }

  unstage(itemId: string): void {
    if (this.state.saving || this.state.bootstrapSaving || replayLocked(this.state)) return
    const ops = this.state.ops.filter(op => !opTargets(op, itemId))
    this.update({
      ops,
      baseRevision: ops.length === 0 ? null : this.state.baseRevision,
      attempt: null,
    })
  }

  discard(force = false): void {
    // Discarding while an unknown-outcome request is unresolved would drop the
    // only evidence needed for an idempotent replay; the Pane disables discard.
    if (!force && replayLocked(this.state)) return
    this.asyncGeneration += 1
    this.update({
      ops: [],
      baseRevision: null,
      editor: null,
      editorText: '',
      editorReason: '',
      editorNeedsReason: false,
      editorBaseRevision: null,
      newInvariant: '',
      newDeliverable: '',
      feedback: null,
      attempt: null,
    })
  }

  /**
   * Explicit, confirmed recovery decision: give up on an unknown-outcome
   * request and unlock editing. This is the ONLY action that clears an unknown
   * attempt; ordinary discard/dismiss stay locked so recovery evidence cannot be
   * dropped by accident. Staged ops / the reviewed payload are preserved.
   */
  abandonUnknown(): boolean {
    const attempt = unknownAttempt(this.state)
    if (attempt === undefined) return false
    this.asyncGeneration += 1
    if (attempt.kind === 'bootstrap') this.bootstrapGeneration += 1
    this.update({
      saving: false,
      bootstrapSaving: false,
      attempt: null,
      ...(attempt.kind === 'edit'
        ? { feedback: null }
        : attempt.kind === 'bootstrap'
          ? { bootstrapProblem: null }
          : { maintenanceProblem: null }),
    })
    return true
  }

  /** Pure shared admission for initialize/restore (Pane uses the same rule). */
  maintenanceAdmission(
    view: CharterView,
    operation: 'initialize' | 'restore',
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (this.state.maintenanceSaving) return { ok: false, reason: 'busy' }
    if (unknownAttempt(this.state) !== undefined) return { ok: false, reason: 'replayPending' }
    if (this.state.saving || this.state.bootstrapSaving) return { ok: false, reason: 'busy' }
    if (this.state.ops.length > 0) return { ok: false, reason: 'stagedOps' }
    if (this.state.editor !== null) return { ok: false, reason: 'editorOpen' }
    if (this.state.bootstrap !== null || this.state.bootstrapPhase === 'checking') {
      return { ok: false, reason: 'historyDraft' }
    }
    const lifecycle = view.lifecycle
    if (lifecycle === undefined || lifecycle === '') return { ok: false, reason: 'lifecycleUnknown' }
    if (this.state.lifecycle !== null && this.state.lifecycle !== lifecycle) {
      return { ok: false, reason: 'lifecycleMismatch' }
    }
    const state = view.recordState
    if (state === undefined) return { ok: false, reason: 'legacyHost' }
    if (view.capabilities?.recordMaintenance !== true) return { ok: false, reason: 'capability' }
    const permitted = operation === 'initialize'
      ? state.kind === 'absent-unconfirmed'
      : state.kind === 'absent-unconfirmed' || state.kind === 'invalid'
    return permitted ? { ok: true } : { ok: false, reason: 'recordHealthy' }
  }

  private async runMaintenance(attempt: MaintenanceAttempt): Promise<void> {
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({
        maintenanceSaving: false,
        attempt: { ...attempt, status: 'unknown' },
        maintenanceProblem: { kind: 'unavailable', code: 'UNAVAILABLE' },
      })
      return
    }
    this.update({
      maintenanceSaving: true,
      maintenanceProblem: null,
      attempt: { ...attempt, sourceGeneration: source.connectionGeneration, status: 'in-flight' },
    })
    const generation = this.asyncGeneration
    const sourceGeneration = source.connectionGeneration
    const current = (): boolean => this.asyncGeneration === generation
      && this.resolveSource() === source
      && source.connectionGeneration === sourceGeneration
    try {
      const result = attempt.kind === 'initialize'
        ? await source.initializeRecord(attempt.request as CharterInitializeRequest)
        : await source.restoreRecord(attempt.request as CharterRestoreRequest)
      if (!current()) return
      // A failure may still carry the authoritative view (for example the
      // write-uncertain fence). Accept it before classifying the result so the
      // Pane cannot keep showing the pre-write state.
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        this.update({
          maintenanceSaving: false,
          attempt: null,
          maintenanceProblem: null,
          ops: [],
          baseRevision: null,
          editor: null,
          editorBaseRevision: null,
          feedback: null,
        })
        return
      }
      const unresolved = result.code === 'UNAVAILABLE'
      this.update({
        maintenanceSaving: false,
        attempt: unresolved ? { ...attempt, status: 'unknown' } : null,
        maintenanceProblem: unresolved
          ? { kind: 'unavailable', code: result.code }
          : { kind: 'request-failed', code: result.code, detail: result.message },
      })
    } catch (error) {
      if (!current()) return
      const disposition = classifyRemoteFailure(error)
      if (disposition.kind === 'known') {
        this.update({
          maintenanceSaving: false,
          attempt: null,
          maintenanceProblem: { kind: 'request-failed', code: disposition.code },
        })
        return
      }
      // Possibly executed (carrier loss / internal / unclassified): retain the
      // exact request for replay or the explicit abandon decision.
      this.update({
        maintenanceSaving: false,
        attempt: { ...attempt, status: 'unknown' },
        maintenanceProblem: { kind: 'unavailable', code: 'UNAVAILABLE' },
      })
    }
  }

  /** Explicitly create an empty record for an absent-unconfirmed target. */
  async initializeEmpty(view: CharterView): Promise<void> {
    if (this.state.maintenanceSaving) return
    const retained = this.retryableMaintenance()
    if (retained?.kind === 'initialize') {
      await this.runMaintenance(retained)
      return
    }
    if (retained !== undefined) return
    const admission = this.maintenanceAdmission(view, 'initialize')
    if (!admission.ok) return
    const lifecycle = view.lifecycle
    if (lifecycle === undefined) return
    const request: CharterInitializeRequest = {
      sessionId: this.sessionId,
      operationId: mutationId(),
      expectedLifecycle: lifecycle,
    }
    await this.runMaintenance({ kind: 'initialize', request, sourceGeneration: 0, status: 'in-flight' })
  }

  /** Restore a validated archive over the current absent/invalid target. */
  async restoreArchive(
    view: CharterView,
    archive: CharterRecordArchive,
  ): Promise<void> {
    if (this.state.maintenanceSaving) return
    const retained = this.retryableMaintenance()
    if (retained?.kind === 'restore') {
      await this.runMaintenance(retained)
      return
    }
    if (retained !== undefined) return
    const admission = this.maintenanceAdmission(view, 'restore')
    if (!admission.ok) return
    const lifecycle = view.lifecycle
    const state = view.recordState
    if (lifecycle === undefined || state === undefined) return
    let expectedTarget: CharterRestoreTarget
    if (state.kind === 'absent-unconfirmed') {
      expectedTarget = { kind: 'absent-unconfirmed' }
    } else if (state.kind === 'invalid' && state.recoverable) {
      expectedTarget = { kind: 'invalid', reason: state.reason, recordDigest: state.recordDigest }
    } else {
      return
    }
    const request: CharterRestoreRequest = {
      sessionId: this.sessionId,
      operationId: mutationId(),
      expectedLifecycle: lifecycle,
      expectedTarget,
      archive,
    }
    await this.runMaintenance({ kind: 'restore', request, sourceGeneration: 0, status: 'in-flight' })
  }

  /** Retry the retained maintenance request verbatim (same operation id). */
  async retryMaintenance(): Promise<void> {
    if (this.state.maintenanceSaving) return
    const retained = this.retryableMaintenance()
    if (retained === undefined) return
    await this.runMaintenance(retained)
  }

  /** Dismiss the last maintenance failure text (the attempt itself stays). */
  dismissMaintenanceProblem(): void {
    if (this.state.maintenanceProblem === null) return
    this.update({ maintenanceProblem: null })
  }

  openEditor(editor: DraftEditor, view: CharterView): void {
    if (replayLocked(this.state)) return
    const text = editor.kind === 'objective'
      ? view.objective?.current.text ?? ''
      : editor.item.text
    this.update({
      editor,
      editorText: text,
      editorReason: editor.kind === 'objective' ? view.objective?.current.reason ?? '' : '',
      editorNeedsReason: editor.kind === 'objective' && view.objective !== null,
      // Capture the baseline now: an unrelated remote commit while the editor
      // is open must not silently retarget the eventual edit to a newer
      // revision (the Host would accept it without review).
      editorBaseRevision: this.state.baseRevision ?? view.revision,
    })
  }

  setEditorText(value: string): void {
    if (replayLocked(this.state)) return
    this.update({ editorText: value })
  }

  setEditorReason(value: string): void {
    if (replayLocked(this.state)) return
    this.update({ editorReason: value })
  }

  closeEditor(): void {
    this.update({
      editor: null,
      editorText: '',
      editorReason: '',
      editorNeedsReason: false,
      editorBaseRevision: null,
    })
  }

  /** Validate and stage the open editor; keeps it open when the input is invalid. */
  saveEditor(view: CharterView): void {
    if (replayLocked(this.state)) return
    const editor = this.state.editor
    if (editor === null || this.state.editorText.trim().length === 0) return
    // Validate and measure the normalized value the Host will actually store,
    // so CRLF/NFD input cannot bypass (or waste) the byte budget and the
    // unchanged check compares apples to apples.
    const inspection = inspectUserText(this.state.editorText)
    if (inspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: inspection.issue } })
      return
    }
    const reasonInspection = inspectUserText(this.state.editorReason)
    if (this.state.editorReason.trim().length > 0 && reasonInspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: reasonInspection.issue } })
      return
    }
    const text = inspection.value
    const bytes = utf8Bytes(text)
    const maxBytes = editor.kind === 'objective' ? view.limits.maxObjectiveBytes : view.limits.maxItemBytes
    const previousText = inspectUserText(editor.kind === 'objective'
      ? view.objective?.current.text ?? ''
      : editor.kind === 'edit' ? editor.item.text : '').value
    const previousBytes = utf8Bytes(previousText)
    // An already over-budget field may still be shortened step by step; only
    // growth beyond the limit is rejected by the Host.
    if (bytes > maxBytes && bytes >= previousBytes) {
      this.update({ feedback: { kind: 'editorBudget', limit: maxBytes } })
      return
    }
    // The editor captured its baseline when it opened; an unrelated remote
    // commit must not silently move the staged batch to a newer revision.
    const baseline = this.state.editorBaseRevision ?? view.revision
    if (editor.kind === 'objective') {
      if (previousText === text) {
        this.update({ feedback: { kind: 'editorUnchanged', target: 'objective' } })
        return
      }
      const reason = reasonInspection.value
      this.stage(view, view.objective === null
        ? { type: 'objective.initialize', text }
        : {
            type: 'objective.redirect',
            text,
            ...(reason.length === 0 ? {} : { reason }),
          }, baseline)
    } else if (editor.kind === 'edit') {
      if (previousText === text) {
        this.update({ feedback: { kind: 'editorUnchanged', target: 'item' } })
        return
      }
      this.stage(view, { type: 'item.edit', itemId: editor.item.id, text }, baseline)
    } else {
      const replacement = editor.item.kind === 'invariant'
        ? { clientRef: clientRef(), kind: 'invariant' as const, text, order: editor.item.order }
        : {
            clientRef: clientRef(), kind: 'deliverable' as const, text, order: editor.item.order,
            progress: editor.item.progress,
          }
      this.stage(view, { type: 'item.supersede', itemId: editor.item.id, replacement }, baseline)
    }
    this.closeEditor()
  }

  addItem(view: CharterView, kind: 'invariant' | 'deliverable', text: string, clear: () => void): void {
    if (this.state.saving || this.state.bootstrapSaving || replayLocked(this.state)) return
    const inspection = inspectUserText(text)
    if (inspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: inspection.issue } })
      return
    }
    const normalized = inspection.value
    const bytes = utf8Bytes(normalized)
    if (bytes > view.limits.maxItemBytes) {
      this.update({ feedback: { kind: 'itemBudget', limit: view.limits.maxItemBytes } })
      return
    }
    // Order must clear every live committed AND staged row: reuse of an order
    // after an unstage would make the sorted projection ambiguous.
    this.stage(view, {
      type: 'item.add',
      item: newItem(kind, normalized, nextItemOrder(view, this.state.ops)),
    })
    clear()
  }

  /** A request may be retried only when the previous attempt failed with an unknown outcome. */
  private retryableEdit(): EditAttempt | undefined {
    const attempt = unknownAttempt(this.state)
    return attempt?.kind === 'edit' ? attempt : undefined
  }

  private retryableBootstrap(): BootstrapAttempt | undefined {
    const attempt = unknownAttempt(this.state)
    return attempt?.kind === 'bootstrap' ? attempt : undefined
  }

  private retryableMaintenance(): MaintenanceAttempt | undefined {
    return maintenanceAttempt(this.state)
  }

  async applyDraft(view: CharterView): Promise<void> {
    if (this.state.saving || view.status !== 'ready') return
    const baseRevision = this.state.baseRevision
    if (baseRevision === null || this.state.ops.length === 0) return
    // Resolve a retryable unknown-outcome request FIRST: it must be replayed
    // verbatim (same mutationId/baseRevision/ops) even when the current view or
    // limits would now reject a fresh batch — otherwise a committed-but-lost
    // request would be dropped or duplicated.
    const previous = this.retryableEdit()
    if (previous === undefined && unknownAttempt(this.state) !== undefined) return
    if (previous === undefined) {
      // Only a fresh request runs the shared admission preflight. The Pane
      // disables Apply from the same pure function.
      const admission = draftAdmission(view, this.state.ops)
      if (!admission.ok) {
        this.update({
          feedback: {
            kind: 'error',
            code: 'QUOTA_EXCEEDED',
            ...(admission.reason === undefined ? {} : { detail: admission.reason }),
          },
        })
        return
      }
    }
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({ feedback: { kind: 'connection' } })
      return
    }
    const request = previous?.request ?? {
      sessionId: this.state.sessionId,
      mutationId: mutationId(),
      baseRevision,
      ops: [...this.state.ops],
    }
    this.update({
      saving: true,
      feedback: null,
      attempt: { kind: 'edit', request, sourceGeneration: source.connectionGeneration, status: 'in-flight' },
    })
    const generation = this.asyncGeneration
    const sourceGeneration = source.connectionGeneration
    const requestOps = this.state.ops
    const current = (): boolean => this.asyncGeneration === generation
      && this.resolveSource() === source
      && source.connectionGeneration === sourceGeneration
      && this.state.ops === requestOps
    try {
      const result = await source.edit(request)
      if (!current()) {
        // The source/generation/lifecycle moved under the request: the outcome
        // is unknown, so keep the exact attempt (never clear mutation
        // credentials). Only the attempt that matches this request is touched.
        const attempt = this.state.attempt
        if (attempt?.kind === 'edit' && attempt.request.mutationId === request.mutationId) {
          this.update({
            saving: false,
            attempt: { ...attempt, status: 'unknown' },
            feedback: { kind: 'connection' },
          })
        }
        return
      }
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        this.update({
          saving: false,
          ops: [],
          baseRevision: null,
          attempt: null,
          feedback: result.replayed
            ? { kind: 'replayed' }
            : { kind: 'saved', revision: result.committedRevision },
        })
      } else {
        // Any UNAVAILABLE (including source-not-attached/remote unavailable) is
        // an unknown outcome: keep the exact request replayable. Only a
        // deterministic business code resolves the attempt.
        const unresolved = isUnknownOutcomeResult(result)
        this.update({
          saving: false,
          attempt: unresolved
            ? { kind: 'edit', request, sourceGeneration, status: 'unknown' }
            : null,
          feedback: unresolved
            ? { kind: 'connection' }
            : { kind: 'error', code: result.code, ...(result.message === undefined ? {} : { detail: result.message }) },
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('charter: edit request failed', error)
      const attempt = this.state.attempt
      this.update({
        saving: false,
        attempt: attempt?.kind === 'edit' ? { ...attempt, status: 'unknown' } : attempt,
        feedback: { kind: 'connection' },
      })
    }
  }

  /** Retarget the staged draft at the latest revision after a conflict. */
  rebase(view: CharterView): void {
    if (!rebaseAvailable(this.state)) return
    if (this.state.baseRevision === null || view.status !== 'ready') return
    // Explicit conflict resolution is the only place the frozen baseline moves.
    this.update({
      baseRevision: view.revision,
      editorBaseRevision: null,
      attempt: null,
      feedback: null,
    })
  }

  // ------------------------------------------------------------------
  // History bootstrap
  // ------------------------------------------------------------------

  setBootstrapObjective(value: string): void {
    if (this.state.bootstrapSaving || replayLocked(this.state)) return
    this.update({ bootstrapObjective: value, attempt: null, bootstrapProblem: null })
  }

  updateBootstrapItem(id: string, patch: Partial<BootstrapDraftItem>): void {
    if (this.state.bootstrapSaving || replayLocked(this.state)) return
    this.update({
      bootstrapItems: this.state.bootstrapItems.map(item => item.id === id ? { ...item, ...patch } : item),
      attempt: null,
      bootstrapProblem: null,
    })
  }

  setAllBootstrapSelected(selected: boolean): void {
    if (this.state.bootstrapSaving || replayLocked(this.state)) return
    this.update({
      bootstrapItems: this.state.bootstrapItems.map(item => ({ ...item, selected })),
      attempt: null,
      bootstrapProblem: null,
    })
  }

  bootstrapPlan(view: CharterView): BootstrapPlan {
    return buildBootstrapPlan(view, this.state.bootstrapObjective, this.state.bootstrapItems)
  }

  /** Ask for a draft when the Session is empty and no attempt has been made yet. */
  ensureBootstrap(view: CharterView, connectionReady: boolean): void {
    // This method only STARTS an extraction; every reactive dismissal/cleanup is
    // owned by reconcileBootstrapView, so it can never half-clean live work.
    if (!connectionReady || view.status !== 'ready') return
    if (view.objective !== null || view.items.length > 0) return
    if (this.state.bootstrapPhase !== 'idle') return
    void this.runBootstrap(view)
  }

  retryBootstrap(view: CharterView): void {
    if (this.state.bootstrapPhase === 'checking') return
    void this.runBootstrap(view)
  }

  private async runBootstrap(view: CharterView): Promise<void> {
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({
        bootstrapPhase: 'failed',
        bootstrapProblem: { kind: 'request-failed' },
      })
      return
    }
    const generation = ++this.bootstrapGeneration
    const asyncGeneration = this.asyncGeneration
    const sourceGeneration = source.connectionGeneration
    const requestedRevision = view.revision
    // The extraction request is only valid for the lifecycle it was issued
    // under; a lifecycle bind invalidates it even when source/generations match.
    const requestedLifecycle = this.state.lifecycle
    this.update({ bootstrapPhase: 'checking', bootstrapProblem: null, feedback: null })
    const current = (): boolean => generation === this.bootstrapGeneration
      && this.asyncGeneration === asyncGeneration
      && this.state.lifecycle === requestedLifecycle
      && source.sessionId === this.state.sessionId
      && this.resolveSource() === source
      && source.connectionGeneration === sourceGeneration
    try {
      const result = await source.bootstrap()
      if (!current()) {
        // Reconnected/lifecycle-changed while the extraction was in flight.
        if (generation === this.bootstrapGeneration) {
          this.update({ bootstrapPhase: 'failed', bootstrapProblem: { kind: 'request-failed' } })
        }
        return
      }
      const outcome = classifyBootstrapOutcome(
        result,
        source.getSnapshot(),
        requestedRevision,
        this.state.ops.length,
      )
      if (outcome.kind === 'discard') {
        this.update({ bootstrapPhase: 'dismissed' })
        return
      }
      if (outcome.kind === 'stale') {
        this.update({ bootstrapPhase: 'failed', bootstrapProblem: { kind: 'stale' } })
        return
      }
      if (outcome.kind === 'unavailable') {
        this.update({
          bootstrapPhase: outcome.reason === 'not-live' ? 'not-live' : outcome.reason === 'no-summary' ? 'no-summary' : 'unavailable',
          bootstrapProblem: outcome.reason === 'unavailable'
            ? { kind: 'unavailable', ...(outcome.message === undefined ? {} : { detail: outcome.message }) }
            : null,
        })
        return
      }
      const proposal = outcome.proposal
      this.update({
        bootstrapPhase: 'draft',
        bootstrap: proposal,
        // Freeze the revision the extraction was requested against: the
        // eventual Apply must use it, never a newer view revision.
        bootstrapBaseRevision: requestedRevision,
        bootstrapObjective: proposal.objective ?? '',
        bootstrapItems: [
          ...proposal.invariants.map((text, index) => ({
            id: `inv-${index}`,
            kind: 'invariant' as const,
            text,
            selected: true,
          })),
          ...proposal.deliverables.map((text, index) => ({
            id: `del-${index}`,
            kind: 'deliverable' as const,
            text,
            selected: true,
          })),
        ],
        bootstrapProblem: null,
        // Do not steal the user's current section while they are working.
        ...(this.userBusy ? {} : { section: 'history' as const }),
      })
    } catch (error) {
      if (!current()) return
      console.error('charter: bootstrap request failed', error)
      this.update({ bootstrapPhase: 'failed', bootstrapProblem: { kind: 'request-failed' } })
    }
  }

  /** Explicit dismissal: one full cleanup of the draft and any replay evidence. */
  dismissBootstrap(): void {
    // Ordinary dismiss never discards unknown-outcome recovery evidence; the
    // explicit abandonUnknown() action is the only path that clears the attempt.
    if (unknownAttempt(this.state)?.kind === 'bootstrap') return
    this.bootstrapGeneration += 1
    this.update({
      bootstrapPhase: 'dismissed',
      bootstrap: null,
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapProblem: null,
      bootstrapNeedsStale: false,
      bootstrapBaseRevision: null,
      bootstrapSaving: false,
      attempt: null,
    })
  }

  /**
   * A live view moved away from the reviewed history draft. The proposal was
   * extracted against the old empty state, so it must be re-extracted rather
   * than silently applied to the new revision. While an Apply is in flight (or
   * its outcome is unknown) the payload must stay visible and replayable: only
   * remember that the view moved, and let the RPC outcome or an explicit
   * dismiss decide what happens next.
   */
  /** One full stale cleanup for a reviewed draft; never called mid-flight. */
  private markBootstrapStaleCleanup(): void {
    this.bootstrapGeneration += 1
    this.update({
      bootstrapPhase: 'failed',
      bootstrapProblem: { kind: 'stale' },
      bootstrap: null,
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapNeedsStale: false,
      bootstrapBaseRevision: null,
      bootstrapSaving: false,
      attempt: null,
    })
  }

  /**
   * Public view-reaction helper (also used by tests): an in-flight/unknown Apply
   * only marks needs-stale and keeps the visible payload; a settled reviewed
   * draft is fully cleaned up.
   */
  markBootstrapStale(view: CharterView): void {
    if (this.state.bootstrapPhase !== 'draft' || this.state.bootstrapBaseRevision === null) return
    const stale = view.revision !== this.state.bootstrapBaseRevision
      || view.objective !== null
      || view.items.length > 0
    if (!stale) return
    if (this.state.bootstrapSaving || this.state.attempt !== null) {
      if (!this.state.bootstrapNeedsStale) this.update({ bootstrapNeedsStale: true })
      return
    }
    this.markBootstrapStaleCleanup()
  }

  /**
   * The single atomic view-reaction for the Pane: lifecycle bind first, then
   * bootstrap extraction start, then reconcile a reviewed draft against the
   * current view. No other method performs dismissal/stale cleanup reactively,
   * so an in-flight/unknown Apply can never become invisible.
   */
  syncView(view: CharterView, connectionReady: boolean): void {
    this.bindLifecycle(view.lifecycle)
    this.ensureBootstrap(view, connectionReady)
    this.reconcileBootstrapView(view)
  }

  /** Keep a reviewed draft coherent with the view without hiding live work. */
  reconcileBootstrapView(view: CharterView): void {
    if (view.status !== 'ready') return
    if (this.state.bootstrapPhase !== 'draft') return
    const baseRevision = this.state.bootstrapBaseRevision
    const stale = baseRevision === null
      || view.revision !== baseRevision
      || view.objective !== null
      || view.items.length > 0
    if (!stale) return
    if (this.state.bootstrapSaving || this.state.attempt !== null) {
      if (!this.state.bootstrapNeedsStale) this.update({ bootstrapNeedsStale: true })
      return
    }
    this.markBootstrapStaleCleanup()
  }

  /** Counts derived from the retained request (never from a fresh re-plan). */
  private bootstrapRequestCounts(request: import('../core/schemas.js').CharterEditRequest): {
    readonly active: number
    readonly pending: number
    readonly pendingInvariants: number
    readonly pendingDeliverables: number
  } {
    let active = 0
    let pending = 0
    let pendingInvariants = 0
    let pendingDeliverables = 0
    for (const op of request.ops) {
      if (op.type === 'item.add') active += 1
      else if (op.type === 'item.propose') {
        pending += 1
        if (op.item.kind === 'invariant') pendingInvariants += 1
        else pendingDeliverables += 1
      }
    }
    return { active, pending, pendingInvariants, pendingDeliverables }
  }

  private finishBootstrapSuccess(
    committedRevision: number,
    request: import('../core/schemas.js').CharterEditRequest,
  ): void {
    const counts = this.bootstrapRequestCounts(request)
    this.update({
      bootstrapSaving: false,
      attempt: null,
      bootstrap: null,
      bootstrapPhase: 'dismissed',
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapProblem: null,
      bootstrapNeedsStale: false,
      bootstrapBaseRevision: null,
      feedback: counts.pending > 0
        ? {
            kind: 'bootstrapSaved',
            active: counts.active,
            pending: counts.pending,
            revision: committedRevision,
          }
        : { kind: 'saved', revision: committedRevision },
      ...(counts.pendingInvariants > 0
        ? { section: 'invariants' as const }
        : counts.pendingDeliverables > 0 ? { section: 'deliverables' as const } : {}),
    })
  }

  private async replayBootstrap(retained: BootstrapAttempt): Promise<void> {
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({
        bootstrapSaving: false,
        attempt: { ...retained, status: 'unknown' },
        bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
      })
      return
    }
    const request = retained.request
    this.update({
      bootstrapSaving: true,
      bootstrapProblem: null,
      attempt: {
        kind: 'bootstrap',
        request,
        sourceGeneration: source.connectionGeneration,
        status: 'in-flight',
      },
    })
    const generation = this.asyncGeneration
    const candidateGeneration = this.bootstrapGeneration
    const sourceGeneration = source.connectionGeneration
    const current = (): boolean => this.asyncGeneration === generation
      && this.bootstrapGeneration === candidateGeneration
      && this.resolveSource() === source
      && source.connectionGeneration === sourceGeneration
    try {
      const result = await source.edit(request)
      if (!current()) {
        // Preserve the exact attempt across source/generation/lifecycle changes.
        const attempt = this.state.attempt
        if (attempt?.kind === 'bootstrap' && attempt.request.mutationId === request.mutationId) {
          this.update({
            bootstrapSaving: false,
            attempt: { ...attempt, status: 'unknown' },
            bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
          })
        }
        return
      }
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        this.finishBootstrapSuccess(result.committedRevision, request)
      } else if (isUnknownOutcomeResult(result)) {
        this.update({
          bootstrapSaving: false,
          attempt: { kind: 'bootstrap', request, sourceGeneration, status: 'unknown' },
          bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
        })
      } else {
        this.update({
          bootstrapSaving: false,
          attempt: null,
          bootstrapProblem: {
            kind: 'save-failed',
            code: result.code,
            ...(result.message === undefined ? {} : { detail: result.message }),
          },
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('charter: bootstrap replay failed', error)
      // The outcome is still unknown: keep the visible reviewed payload and the
      // replayable attempt so an explicit Retry can recover.
      const attempt = this.state.attempt
      this.update({
        bootstrapSaving: false,
        attempt: attempt?.kind === 'bootstrap' ? { ...attempt, status: 'unknown' } : attempt,
        bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
      })
    }
  }

  async applyBootstrap(view: CharterView): Promise<void> {
    if (view.status !== 'ready' || this.state.bootstrapSaving) return
    // Unknown-outcome replay comes FIRST: resend the retained request before any
    // stale/text/plan/limit checks, because the Host may already have committed
    // it and a fresh admission failure must not block recovery.
    const retained = this.retryableBootstrap()
    if (retained !== undefined) {
      await this.replayBootstrap(retained)
      return
    }
    if (unknownAttempt(this.state) !== undefined) return
    if (this.state.bootstrap === null) return
    if (this.state.ops.length > 0 || this.state.editor !== null) return
    const baseRevision = this.state.bootstrapBaseRevision
    // Admission is gated on the extraction baseline: a different revision or a
    // non-empty charter means the reviewed draft no longer describes the state.
    if (baseRevision === null
      || view.revision !== baseRevision
      || view.objective !== null
      || view.items.length > 0) {
      this.markBootstrapStale(view)
      return
    }
    const plan = this.bootstrapPlan(view)
    if (plan.ops.length === 0) return
    // Preflight the reviewed draft through the same text validation and shared
    // admission the Pane uses, before any Remote call: an invalid character or
    // limit failure must keep the draft reviewable instead of round-tripping a
    // request the Host is known to reject.
    const textIssue = firstDraftTextIssue(this.state.bootstrapObjective, this.state.bootstrapItems)
    if (textIssue !== undefined) {
      this.update({
        bootstrapProblem: { kind: 'save-failed', code: 'INVALID_ARGUMENT', detail: textIssue.issue },
      })
      return
    }
    const admission = draftAdmission(view, plan.ops)
    if (!admission.ok) {
      this.update({
        bootstrapProblem: {
          kind: 'save-failed',
          code: 'QUOTA_EXCEEDED',
          ...(admission.reason === undefined ? {} : { detail: admission.reason }),
        },
      })
      return
    }
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({ bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' } })
      return
    }
    const request: import('../core/schemas.js').CharterEditRequest = {
      sessionId: this.state.sessionId,
      mutationId: mutationId(),
      // Always send the extraction baseline, never the current view revision.
      baseRevision,
      ops: plan.ops,
    }
    this.update({
      bootstrapSaving: true,
      bootstrapProblem: null,
      attempt: {
        kind: 'bootstrap',
        request,
        sourceGeneration: source.connectionGeneration,
        status: 'in-flight',
      },
    })
    const generation = this.asyncGeneration
    const candidateGeneration = this.bootstrapGeneration
    const sourceGeneration = source.connectionGeneration
    const current = (): boolean => this.asyncGeneration === generation
      && this.bootstrapGeneration === candidateGeneration
      && this.resolveSource() === source
      && source.connectionGeneration === sourceGeneration
    try {
      const result = await source.edit(request)
      if (!current()) {
        // Preserve the exact attempt across source/generation/lifecycle changes.
        const attempt = this.state.attempt
        if (attempt?.kind === 'bootstrap' && attempt.request.mutationId === request.mutationId) {
          this.update({
            bootstrapSaving: false,
            attempt: { ...attempt, status: 'unknown' },
            bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
          })
        }
        return
      }
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        this.finishBootstrapSuccess(result.committedRevision, request)
      } else if (isUnknownOutcomeResult(result)) {
        this.update({
          bootstrapSaving: false,
          attempt: { kind: 'bootstrap', request, sourceGeneration, status: 'unknown' },
          bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
        })
      } else {
        this.update({
          bootstrapSaving: false,
          attempt: null,
          bootstrapProblem: {
            kind: 'save-failed',
            code: result.code,
            ...(result.message === undefined ? {} : { detail: result.message }),
          },
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('charter: bootstrap apply failed', error)
      // Unknown outcome: keep the reviewed payload and the replayable attempt.
      const attempt = this.state.attempt
      this.update({
        bootstrapSaving: false,
        attempt: attempt?.kind === 'bootstrap' ? { ...attempt, status: 'unknown' } : attempt,
        bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
      })
    }
  }

  dispose(): void {
    this.bootstrapGeneration += 1
    this.asyncGeneration += 1
    this.listeners.clear()
  }
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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/** Item orders explicitly occupied by staged operations. */
function stagedOrders(ops: readonly CharterOp[]): number[] {
  const orders: number[] = []
  for (const op of ops) {
    if (op.type === 'item.add' || op.type === 'item.propose') orders.push(op.item.order)
    else if (op.type === 'item.supersede') orders.push(op.replacement.order)
    else if (op.type === 'item.edit' && op.order !== undefined) orders.push(op.order)
  }
  return orders
}

/** Next order above every committed item and every staged item. */
function nextItemOrder(view: CharterView, ops: readonly CharterOp[]): number {
  let maximum = view.items.reduce((current, item) => Math.max(current, item.order), -1)
  for (const order of stagedOrders(ops)) maximum = Math.max(maximum, order)
  return maximum + 1
}

/** The synthetic or persisted id a staged operation targets (shared with preview). */
export { opTargets }

/**
 * A staged edit batch may be retargeted only while no editor and no reviewed
 * history draft owns a different baseline. The Pane uses the same predicate, so
 * the visible Rebase action and the store cannot disagree.
 */
export function rebaseAvailable(state: Pick<
  CharterDraftState,
  'editor' | 'bootstrap' | 'saving' | 'bootstrapSaving' | 'attempt'
>): boolean {
  return state.editor === null
    && state.bootstrap === null
    && state.attempt === null
    && !state.saving
    && !state.bootstrapSaving
}
