import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { inspectUserText, type UserTextIssue } from '../core/normalize.js'
import type { CharterErrorCode } from '../core/errors.js'
import type { CharterOp, NewItemInput } from '../core/schemas.js'
import type {
  CharterBootstrapProposal,
  CharterView,
} from '../host/types.js'
import type { CharterSessionSource } from './store.js'
import {
  buildBootstrapPlan,
  classifyBootstrapOutcome,
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

interface DraftAttempt {
  readonly kind: 'edit' | 'bootstrap'
  readonly request: import('../core/schemas.js').CharterEditRequest
}

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
  readonly attempt: DraftAttempt | null
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
    attempt: null,
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
    if (this.state.lifecycle === null) {
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
  }

  /**
   * Invalidate in-flight async results because the source instance they were
   * sent through no longer exists. Local staged content is preserved.
   */
  invalidateSource(): void {
    this.asyncGeneration += 1
    if (this.state.saving) {
      // Keep the same mutation id so a retry through the new source replays
      // the already-sent request instead of duplicating it.
      this.update({ saving: false, feedback: { kind: 'connection' } })
    } else if (this.state.bootstrapSaving) {
      this.update({
        bootstrapSaving: false,
        bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' },
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
    this.update({ newInvariant: value })
  }

  setNewDeliverable(value: string): void {
    this.update({ newDeliverable: value })
  }

  stage(view: CharterView, op: CharterOp): void {
    if (view.status !== 'ready' || this.state.saving) return
    const ops = this.state.ops.some(existing => sameOp(existing, op))
      ? this.state.ops
      : [...this.state.ops, op]
    this.update({
      ops,
      baseRevision: this.state.baseRevision ?? view.revision,
      feedback: null,
      attempt: null,
    })
  }

  unstage(itemId: string): void {
    const ops = this.state.ops.filter(op => !opTargets(op, itemId))
    this.update({
      ops,
      baseRevision: ops.length === 0 ? null : this.state.baseRevision,
      attempt: null,
    })
  }

  discard(): void {
    this.asyncGeneration += 1
    this.update({
      ops: [],
      baseRevision: null,
      editor: null,
      editorText: '',
      editorReason: '',
      editorNeedsReason: false,
      newInvariant: '',
      newDeliverable: '',
      feedback: null,
      attempt: null,
    })
  }

  openEditor(editor: DraftEditor, view: CharterView): void {
    const text = editor.kind === 'objective'
      ? view.objective?.current.text ?? ''
      : editor.item.text
    this.update({
      editor,
      editorText: text,
      editorReason: editor.kind === 'objective' ? view.objective?.current.reason ?? '' : '',
      editorNeedsReason: editor.kind === 'objective' && view.objective !== null,
    })
  }

  setEditorText(value: string): void {
    this.update({ editorText: value })
  }

  setEditorReason(value: string): void {
    this.update({ editorReason: value })
  }

  closeEditor(): void {
    this.update({ editor: null, editorText: '', editorReason: '', editorNeedsReason: false })
  }

  /** Validate and stage the open editor; keeps it open when the input is invalid. */
  saveEditor(view: CharterView): void {
    const editor = this.state.editor
    if (editor === null || this.state.editorText.trim().length === 0) return
    const text = this.state.editorText
    const inspection = inspectUserText(text)
    if (inspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: inspection.issue } })
      return
    }
    const reasonInspection = inspectUserText(this.state.editorReason)
    if (this.state.editorReason.trim().length > 0 && reasonInspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: reasonInspection.issue } })
      return
    }
    const bytes = new TextEncoder().encode(text).byteLength
    const maxBytes = editor.kind === 'objective' ? view.limits.maxObjectiveBytes : view.limits.maxItemBytes
    if (bytes > maxBytes) {
      this.update({ feedback: { kind: 'editorBudget', limit: maxBytes } })
      return
    }
    const nextText = text.trim()
    if (editor.kind === 'objective') {
      if (view.objective?.current.text === nextText) {
        this.update({ feedback: { kind: 'editorUnchanged', target: 'objective' } })
        return
      }
      const reason = this.state.editorReason.trim()
      this.stage(view, view.objective === null
        ? { type: 'objective.initialize', text }
        : {
            type: 'objective.redirect',
            text,
            ...(reason.length === 0 ? {} : { reason }),
          })
    } else if (editor.kind === 'edit') {
      if (editor.item.text === nextText) {
        this.update({ feedback: { kind: 'editorUnchanged', target: 'item' } })
        return
      }
      this.stage(view, { type: 'item.edit', itemId: editor.item.id, text })
    } else {
      const replacement = editor.item.kind === 'invariant'
        ? { clientRef: clientRef(), kind: 'invariant' as const, text, order: editor.item.order }
        : {
            clientRef: clientRef(), kind: 'deliverable' as const, text, order: editor.item.order,
            progress: editor.item.progress,
          }
      this.stage(view, { type: 'item.supersede', itemId: editor.item.id, replacement })
    }
    this.closeEditor()
  }

  addItem(view: CharterView, kind: 'invariant' | 'deliverable', text: string, clear: () => void): void {
    const inspection = inspectUserText(text)
    if (inspection.issue !== undefined) {
      this.update({ feedback: { kind: 'editorInvalid', issue: inspection.issue } })
      return
    }
    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > view.limits.maxItemBytes) {
      this.update({ feedback: { kind: 'itemBudget', limit: view.limits.maxItemBytes } })
      return
    }
    const maxOrder = view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1)
    this.stage(view, {
      type: 'item.add',
      item: newItem(kind, text, maxOrder + 1 + this.state.ops.length),
    })
    clear()
  }

  /** A request may be retried only when the previous attempt failed with an unknown outcome. */
  private retryableRequest(kind: 'edit' | 'bootstrap'): DraftAttempt | undefined {
    const attempt = this.state.attempt
    if (attempt === null || attempt.kind !== kind) return undefined
    const unknownOutcome = kind === 'edit'
      ? this.state.feedback?.kind === 'connection'
      : this.state.bootstrapProblem?.kind === 'save-failed'
        && this.state.bootstrapProblem.code === 'UNAVAILABLE'
    return unknownOutcome ? attempt : undefined
  }

  async applyDraft(view: CharterView): Promise<void> {
    if (this.state.saving || view.status !== 'ready') return
    const baseRevision = this.state.baseRevision
    if (baseRevision === null || this.state.ops.length === 0) return
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({ feedback: { kind: 'connection' } })
      return
    }
    const previous = this.retryableRequest('edit')
    const request = previous?.request ?? {
      sessionId: this.state.sessionId,
      mutationId: mutationId(),
      baseRevision,
      ops: [...this.state.ops],
    }
    this.update({ saving: true, feedback: null, attempt: { kind: 'edit', request } })
    const generation = this.asyncGeneration
    const requestOps = this.state.ops
    const current = (): boolean => this.asyncGeneration === generation
      && this.resolveSource() === source
      && this.state.ops === requestOps
    try {
      const result = await source.edit(request)
      if (!current()) return
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
        this.update({
          saving: false,
          attempt: null,
          feedback: { kind: 'error', code: result.code, ...(result.message === undefined ? {} : { detail: result.message }) },
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('charter: edit request failed', error)
      this.update({ saving: false, feedback: { kind: 'connection' } })
    }
  }

  /** Retarget the staged draft at the latest revision after a conflict. */
  rebase(view: CharterView): void {
    if (this.state.baseRevision === null || view.status !== 'ready') return
    this.update({ baseRevision: view.revision, attempt: null, feedback: null })
  }

  // ------------------------------------------------------------------
  // History bootstrap
  // ------------------------------------------------------------------

  setBootstrapObjective(value: string): void {
    this.update({ bootstrapObjective: value })
  }

  updateBootstrapItem(id: string, patch: Partial<BootstrapDraftItem>): void {
    this.update({
      bootstrapItems: this.state.bootstrapItems.map(item => item.id === id ? { ...item, ...patch } : item),
    })
  }

  setAllBootstrapSelected(selected: boolean): void {
    this.update({
      bootstrapItems: this.state.bootstrapItems.map(item => ({ ...item, selected })),
    })
  }

  bootstrapPlan(view: CharterView): BootstrapPlan {
    return buildBootstrapPlan(view, this.state.bootstrapObjective, this.state.bootstrapItems)
  }

  /** Ask for a draft when the Session is empty and no attempt has been made yet. */
  ensureBootstrap(view: CharterView, connectionReady: boolean): void {
    if (!connectionReady || view.status !== 'ready') return
    if (view.objective !== null || view.items.length > 0) {
      if (this.state.bootstrapPhase !== 'idle' && this.state.bootstrapPhase !== 'dismissed') {
        this.update({ bootstrapPhase: 'dismissed', bootstrap: null, bootstrapProblem: null })
      }
      return
    }
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
    const requestedRevision = view.revision
    this.update({ bootstrapPhase: 'checking', bootstrapProblem: null, feedback: null })
    try {
      const result = await source.bootstrap()
      if (generation !== this.bootstrapGeneration || source.sessionId !== this.state.sessionId) return
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
      if (generation !== this.bootstrapGeneration) return
      console.error('charter: bootstrap request failed', error)
      this.update({ bootstrapPhase: 'failed', bootstrapProblem: { kind: 'request-failed' } })
    }
  }

  dismissBootstrap(): void {
    this.bootstrapGeneration += 1
    this.update({
      bootstrapPhase: 'dismissed',
      bootstrap: null,
      bootstrapObjective: '',
      bootstrapItems: [],
      bootstrapProblem: null,
    })
  }

  async applyBootstrap(view: CharterView): Promise<void> {
    if (view.status !== 'ready' || this.state.bootstrap === null || this.state.bootstrapSaving) return
    if (this.state.ops.length > 0 || this.state.editor !== null) return
    const plan = this.bootstrapPlan(view)
    if (plan.ops.length === 0) return
    const source = this.resolveSource()
    if (source === undefined) {
      this.update({ bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' } })
      return
    }
    const previous = this.retryableRequest('bootstrap')
    const request = previous?.request ?? {
      sessionId: this.state.sessionId,
      mutationId: mutationId(),
      baseRevision: view.revision,
      ops: plan.ops,
    }
    this.update({
      bootstrapSaving: true,
      bootstrapProblem: null,
      attempt: { kind: 'bootstrap', request },
    })
    const generation = this.asyncGeneration
    const candidateGeneration = this.bootstrapGeneration
    const current = (): boolean => this.asyncGeneration === generation
      && this.bootstrapGeneration === candidateGeneration
      && this.resolveSource() === source
    try {
      const result = await source.edit(request)
      if (!current()) return
      if (result.view !== undefined) source.accept(result.view)
      if (result.ok) {
        this.update({
          bootstrapSaving: false,
          attempt: null,
          bootstrap: null,
          bootstrapPhase: 'dismissed',
          bootstrapObjective: '',
          bootstrapItems: [],
          feedback: plan.pending > 0
            ? {
                kind: 'bootstrapSaved',
                active: plan.active,
                pending: plan.pending,
                revision: result.committedRevision,
              }
            : { kind: 'saved', revision: result.committedRevision },
          ...(plan.pendingInvariants > 0
            ? { section: 'invariants' as const }
            : plan.pendingDeliverables > 0 ? { section: 'deliverables' as const } : {}),
        })
      } else {
        this.update({
          bootstrapSaving: false,
          attempt: null,
          bootstrapProblem: { kind: 'save-failed', code: result.code, ...(result.message === undefined ? {} : { detail: result.message }) },
        })
      }
    } catch (error) {
      if (!current()) return
      console.error('charter: bootstrap apply failed', error)
      this.update({ bootstrapSaving: false, bootstrapProblem: { kind: 'save-failed', code: 'UNAVAILABLE' } })
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

/** The synthetic or persisted id a staged operation targets. */
export function opTargets(op: CharterOp, itemId: string): boolean {
  switch (op.type) {
    case 'item.add':
    case 'item.propose':
      return `draft:${op.item.clientRef}` === itemId
    case 'item.supersede':
      return op.itemId === itemId || `draft:${op.replacement.clientRef}` === itemId
    case 'objective.initialize':
    case 'objective.redirect':
      return false
    default:
      return 'itemId' in op && op.itemId === itemId
  }
}
