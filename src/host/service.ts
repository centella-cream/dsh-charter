import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DomainError, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionStartSource } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session/types'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  CharterError,
  charterError,
  type CharterErrorCode,
} from '../core/errors.js'
import { bootstrapFromEvents } from '../core/bootstrap.js'
import { readSessionEvents } from './session-events.js'
import { assertEditAuthorized } from '../core/authorization.js'
import {
  clampCharterLimits,
  DEFAULT_CHARTER_LIMITS,
  type CharterLimits,
} from '../core/limits.js'
import {
  charterRecordSchema,
  type CharterActor,
  type CharterEditRequest,
  type CharterRecord,
} from '../core/schemas.js'
import { clientRefsOf, normalizeEditRequest } from '../core/normalize.js'
import {
  assertRecordConsistency,
  commitRecord,
  createEmptyRecord,
  isRecordOverBudget,
  MutationReplay,
  requestDigestOf,
  RevisionConflict,
  type CharterIdentity,
} from '../core/record.js'
import { forkRecord } from '../core/fork.js'
import { isStandingItem } from '../core/state.js'
import {
  CHARTER_DOMAIN_NAME,
  CHARTER_SESSIONS_TABLE,
  charterDomainSpec,
} from './domain.js'
import { defineCharterReadTool } from './tool.js'
import type {
  CharterEditResult,
  CharterToolItem,
  CharterListener,
  CharterToolView,
  CharterBootstrapResult,
  CharterView,
  CharterViewLimits,
} from './types.js'

export interface CharterConfig extends CharterLimits {
  readonly contextOrder: number
}

export const DEFAULT_CHARTER_CONFIG: CharterConfig = {
  ...DEFAULT_CHARTER_LIMITS,
  contextOrder: 130,
}

export const Config: Schema<CharterConfig> = Schema.object({
  maxPromptBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxPromptBytes),
  maxObjectiveBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxObjectiveBytes),
  maxItemBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxItemBytes),
  maxItems: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxItems),
  maxPendingItems: Schema.number().step(1).min(0).default(DEFAULT_CHARTER_CONFIG.maxPendingItems),
  maxOps: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxOps),
  maxRecordBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxRecordBytes),
  historyLimit: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.historyLimit),
  maxHistoryBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxHistoryBytes),
  mutationLimit: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.mutationLimit),
  contextOrder: Schema.number().default(DEFAULT_CHARTER_CONFIG.contextOrder),
})

function lifecycleFingerprint(identity: CharterIdentity): string {
  return JSON.stringify({
    createdAt: identity.createdAt,
    cwd: identity.cwd ?? null,
    parentSession: identity.parentSession ?? null,
  })
}

function identityOf(session: Session): CharterIdentity {
  return {
    createdAt: session.header.createdAt,
    ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
    ...(session.header.parentSession === undefined ? {} : { parentSession: session.header.parentSession }),
  }
}

function sameIdentity(record: CharterRecord, session: Session): boolean {
  return record.identity.createdAt === session.header.createdAt
    && record.identity.cwd === session.header.cwd
    && record.identity.parentSession === session.header.parentSession
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function itemId(): string {
  return `item-${randomUUID()}`
}

function forkMutationId(): string {
  return `fork-${randomUUID()}`
}

function unavailableResult(
  code: CharterErrorCode,
  message: string,
  view?: CharterView,
): CharterEditResult {
  return {
    ok: false,
    code,
    message,
    ...(view === undefined ? {} : { view, currentRevision: view.revision }),
  }
}

export class CharterService extends Service {
  static inject = ['agents', 'sessions', 'storageDomain', 'systemPrompt', 'tools']
  static Config = Config

  private readonly config: CharterConfig
  private sessionsTable: KvTable<SessionIdType, CharterRecord> | undefined
  private globalFailure?: string
  private admissionOpen = true
  private readonly unavailable = new Map<SessionIdType, string>()
  /** Schema-invalid stored documents; preserved untouched for diagnosis. */
  private readonly invalidRecords = new Set<SessionIdType>()
  private readonly waitingForParent = new Map<SessionIdType, SessionIdType>()
  private readonly initializations = new Map<SessionIdType, Promise<void>>()
  private readonly initializationControllers = new Map<SessionIdType, AbortController>()
  private readonly initializationOwners = new Map<SessionIdType, Session>()
  private readonly initializationParents = new Map<SessionIdType, SessionIdType>()
  private readonly listeners = new Map<SessionIdType, Set<CharterListener>>()

  constructor(ctx: Context, config: CharterConfig) {
    super(ctx, 'charter')
    const clamped = clampCharterLimits(config)
    this.config = { ...config, ...clamped.limits }
    if (clamped.adjusted.length > 0) {
      this.ctx.logger.warn(`charter: config values below the viable minimum were raised: ${clamped.adjusted.join('; ')}`)
    }
  }

  protected async [Service.init](): Promise<void> {
    const opening = this.openDomain()
    const createdDuringOpen = new Set<Session>()
    let domainReady = false

    this.ctx.on('session/created', session => {
      if (!domainReady) {
        createdDuringOpen.add(session)
        return
      }
      void this.initializeSessionSafely(session, 'startup')
    }, { global: true })

    this.ctx.on('agent/created', async ({ agent, source, signal }) => {
      await opening
      await this.initializeSessionSafely(agent.session, source, signal)
      return undefined
    }, { global: true })

    this.ctx.on('agent/disposed', ({ agent }) => {
      // A Session can outlive one Agent (and get a new Agent later), so keep
      // its watchers; each stream removes its own listener on cleanup.
      this.initializationControllers.get(agent.session.id)?.abort(
        new Error('Agent disposed during Charter initialization'),
      )
    }, { global: true })

    this.ctx.on('session/disposed', session => {
      this.listeners.delete(session.id)
      this.waitingForParent.delete(session.id)
      this.unavailable.delete(session.id)
      this.initializationControllers.get(session.id)?.abort(
        new Error('Session disposed during Charter initialization'),
      )
    }, { global: true })

    this.ctx.on('domain/changed', change => {
      if (change.domain !== CHARTER_DOMAIN_NAME
        || change.table !== CHARTER_SESSIONS_TABLE
        || change.key.length === 0) return
      const changedId = SessionId(change.key)
      this.publish(changedId)
      for (const [childId, parentId] of this.waitingForParent) {
        if (parentId !== changedId) continue
        const child = this.ctx.sessions.get(childId)
        if (child !== undefined) void this.initializeSessionSafely(child, 'startup')
      }
    }, { global: true })

    await opening
    domainReady = true
    for (const session of createdDuringOpen) {
      await this.initializeSessionSafely(session, 'startup')
    }
    for (const session of this.ctx.sessions.list()) {
      if (!createdDuringOpen.has(session)) {
        await this.initializeSessionSafely(session, 'startup')
      }
    }

    const registration = {
      name: 'charter:standing',
      order: this.config.contextOrder,
      // DSH 0.2.1+ honors these; 0.1.7/0.2.0 ignore the extra fields. The
      // renderer additionally escapes brace runs so the older interpolator
      // cannot rewrite user-authored text either way.
      interpolate: false,
      required: true,
      text: (context: AssembleContext) => {
        const session = context.agent?.session
        return session === undefined ? '' : this.promptText(session)
      },
    }
    this.ctx.systemPrompt.context(registration)
    this.ctx.tools.register(defineCharterReadTool(this))

    await Promise.all(this.ctx.agents.list().map(agent => this.initializeSessionSafely(agent.session, 'startup')))
  }

  private async openDomain(): Promise<void> {
    try {
      const domain = await this.ctx.storageDomain.open(charterDomainSpec)
      const rawTable = domain.table(CHARTER_SESSIONS_TABLE) as unknown as KvTable<SessionIdType, unknown>
      this.sessionsTable = rawTable as unknown as KvTable<SessionIdType, CharterRecord>
      for (const [id, stored] of rawTable.entries()) {
        const parsed = charterRecordSchema.safeParse(stored)
        if (!parsed.success) {
          // One unreadable or forward-skewed document must degrade only its
          // own Session; keep the raw document untouched for diagnosis.
          this.invalidRecords.add(id)
          const message = `Stored charter cannot be read by this version: ${parsed.error.message}`
          this.unavailable.set(id, message)
          this.ctx.logger.error(`charter: ${id}: ${message}`)
          continue
        }
        try {
          assertRecordConsistency(parsed.data, this.config)
        } catch (error) {
          this.unavailable.set(id, `Stored charter is inconsistent: ${describeError(error)}`)
          this.ctx.logger.error(`charter: stored record for ${id} is inconsistent and has been disabled: ${describeError(error)}`)
        }
      }
      this.ctx.effect(() => async () => {
        this.admissionOpen = false
        for (const controller of this.initializationControllers.values()) {
          controller.abort(new Error('Charter service is shutting down'))
        }
        await Promise.allSettled(this.initializations.values())
        this.initializationControllers.clear()
        this.initializationOwners.clear()
        this.waitingForParent.clear()
        this.listeners.clear()
        await domain.close()
        this.sessionsTable = undefined
      }, 'charter.domain')
    } catch (error) {
      this.globalFailure = `Charter storage is unavailable: ${describeError(error)}`
      this.admissionOpen = false
      this.ctx.logger.error(`charter: failed to open ${CHARTER_DOMAIN_NAME}; ordinary sessions remain usable. ${describeError(error)}`)
    }
  }

  private async initializeSessionSafely(
    session: Session,
    source: SessionStartSource,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.ensureSession(session, source, signal)
    } catch (error) {
      if (this.ctx.sessions.get(session.id) !== session) return
      const owner = this.initializationOwners.get(session.id)
      if (owner !== undefined && owner !== session) return
      const message = `Charter initialization failed: ${describeError(error)}`
      this.unavailable.set(session.id, message)
      this.ctx.logger.error(`charter: ${session.id}: ${message}`)
      this.publish(session.id)
    }
  }

  ensureSession(
    session: Session,
    _source: SessionStartSource,
    signal?: AbortSignal,
    ancestors: ReadonlySet<SessionIdType> = new Set(),
  ): Promise<void> {
    if (ancestors.has(session.id)) {
      return Promise.reject(charterError('CORRUPT_STATE', `Session ${session.id} forms a parent cycle in the charter ancestry`))
    }
    if (ancestors.size >= 64) {
      return Promise.reject(charterError('CORRUPT_STATE', `Session ${session.id} exceeds the charter ancestry depth limit`))
    }
    const existing = this.initializations.get(session.id)
    const existingOwner = this.initializationOwners.get(session.id)
    if (existing !== undefined && existingOwner === session) return existing
    if (existing !== undefined && existingOwner !== session) {
      this.initializationControllers.get(session.id)?.abort(
        new Error('Session lifecycle was replaced during Charter initialization'),
      )
    }
    const controller = new AbortController()
    const effectiveSignal = signal === undefined
      ? controller.signal
      : AbortSignal.any([signal, controller.signal])
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(session.id)
    const initialization = this.initializeSession(session, effectiveSignal, nextAncestors)
      .finally(() => {
        if (this.initializations.get(session.id) === initialization) {
          this.initializations.delete(session.id)
          this.initializationControllers.delete(session.id)
          this.initializationOwners.delete(session.id)
          this.initializationParents.delete(session.id)
        }
      })
    this.initializations.set(session.id, initialization)
    this.initializationControllers.set(session.id, controller)
    this.initializationOwners.set(session.id, session)
    return initialization
  }

  /**
   * Detect a parent cycle across independently started initialization chains.
   * The ancestry set alone is insufficient when both Sessions are already
   * initializing and each awaits the other's cached promise.
   */
  private assertInitializationAcyclic(sessionId: SessionIdType, parentId: SessionIdType): void {
    let cursor: SessionIdType | undefined = parentId
    const seen = new Set<SessionIdType>()
    while (cursor !== undefined) {
      if (cursor === sessionId) {
        throw charterError('CORRUPT_STATE', `Session ${sessionId} forms a parent cycle in the charter ancestry`)
      }
      if (seen.has(cursor) || seen.size >= 64) {
        throw charterError('CORRUPT_STATE', `Session ${sessionId} exceeds the charter ancestry safety limit`)
      }
      seen.add(cursor)
      cursor = this.initializationParents.get(cursor)
    }
  }

  private async initializeSession(
    session: Session,
    signal?: AbortSignal,
    ancestors: ReadonlySet<SessionIdType> = new Set(),
  ): Promise<void> {
    signal?.throwIfAborted()
    if (this.ctx.sessions.get(session.id) !== session) return
    // Preserve the raw schema-invalid document instead of overwriting it.
    if (this.invalidRecords.has(session.id)) return
    const table = this.requireTable()
    if (session.header.parentSession !== undefined) {
      if (session.header.parentSession === session.id) {
        throw charterError('CORRUPT_STATE', `Session ${session.id} cannot be its own Charter parent`)
      }
      const parentId = SessionId(session.header.parentSession)
      this.assertInitializationAcyclic(session.id, parentId)
      this.initializationParents.set(session.id, parentId)
      const parentSession = this.ctx.sessions.get(parentId)
      if (parentSession !== undefined) {
        await this.ensureSession(parentSession, 'startup', signal, ancestors)
      }
    }
    const storedExisting = table.get(session.id)
    const existing = storedExisting === undefined ? undefined : this.parseStoredRecord(session.id, storedExisting)
    if (storedExisting !== undefined && existing === undefined) return
    if (existing !== undefined) {
      if (!sameIdentity(existing, session)) {
        throw charterError('LIFECYCLE_MISMATCH', `stored charter for ${session.id} belongs to another Session lifecycle`)
      }
      assertRecordConsistency(existing, this.config)
      this.unavailable.delete(session.id)
      this.publish(session.id)
      return
    }

    let record: CharterRecord
    if (session.header.parentSession !== undefined) {
      const storedParent = table.get(session.header.parentSession)
      const parent = storedParent === undefined
        ? undefined
        : this.parseStoredRecord(SessionId(session.header.parentSession), storedParent)
      if (parent === undefined) {
        this.waitingForParent.set(session.id, SessionId(session.header.parentSession))
        throw charterError('NOT_FOUND', `parent charter ${session.header.parentSession} is unavailable`)
      }
      assertRecordConsistency(parent, this.config)
      const ids = Object.fromEntries(parent.current.items.map(item => [item.id, itemId()]))
      record = forkRecord({
        parentSessionId: session.header.parentSession,
        parent,
        childIdentity: identityOf(session),
        ids,
        mutationId: forkMutationId(),
        at: Date.now(),
        limits: this.config,
      })
    } else {
      record = createEmptyRecord(identityOf(session), this.config)
    }
    signal?.throwIfAborted()
    if (this.ctx.sessions.get(session.id) !== session) return
    // `put` emits `domain/changed` before it resolves, so clear the transient
    // failure first; otherwise the only published frame is the stale error.
    this.unavailable.delete(session.id)
    await table.put(session.id, record)
    this.waitingForParent.delete(session.id)
    this.publish(session.id)
  }

  private requireTable(): KvTable<SessionIdType, CharterRecord> {
    if (!this.admissionOpen || this.sessionsTable === undefined) {
      throw charterError('UNAVAILABLE', this.globalFailure ?? 'Charter storage is not ready')
    }
    return this.sessionsTable
  }

  /** Parse a stored document at the client-integrity boundary. */
  private parseStoredRecord(sessionId: SessionIdType, stored: unknown): CharterRecord | undefined {
    const parsed = charterRecordSchema.safeParse(stored)
    if (!parsed.success) {
      this.invalidRecords.add(sessionId)
      const message = `Stored charter cannot be read by this version: ${parsed.error.message}`
      this.unavailable.set(sessionId, message)
      this.ctx.logger.error(`charter: ${sessionId}: ${message}`)
      return undefined
    }
    return parsed.data
  }

  private recordFor(session: Session): CharterRecord | undefined {
    if (this.invalidRecords.has(session.id)) return undefined
    const stored = this.sessionsTable?.get(session.id)
    if (stored === undefined) return undefined
    const record = this.parseStoredRecord(session.id, stored)
    if (record === undefined) return undefined
    if (!sameIdentity(record, session)) {
      this.unavailable.set(
        session.id,
        'Stored charter belongs to another Session lifecycle',
      )
      return undefined
    }
    try {
      assertRecordConsistency(record, this.config)
    } catch (error) {
      const message = `Stored charter is inconsistent: ${describeError(error)}`
      this.unavailable.set(session.id, message)
      this.ctx.logger.error(`charter: ${session.id}: ${message}`)
      return undefined
    }
    // A successful read clears only transient initialization/availability
    // state. Schema-invalid documents stay in `invalidRecords` and are never
    // reachable through this path.
    this.unavailable.delete(session.id)
    return record
  }

  /**
   * Extract a read-only draft from the latest compaction summary.
   *
   * This is a proposal only: it never writes the record and never enters the
   * prompt. The user reviews and applies it through the normal atomic edit.
   */
  bootstrap(sessionId: SessionIdType): CharterBootstrapResult {
    if (this.globalFailure !== undefined) {
      return { available: false, reason: 'unavailable', message: this.globalFailure }
    }
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      return { available: false, reason: 'not-live' }
    }
    const events = readSessionEvents(session).map(event => ({
      type: event.type,
      seq: event.seq,
      time: event.time,
      data: event.data,
    }))
    const extraction = bootstrapFromEvents(events, this.config)
    if (extraction === undefined) {
      return { available: false, reason: 'no-summary' }
    }
    return {
      available: true,
      proposal: {
        ...extraction.draft,
        source: extraction.source,
      },
    }
  }

  private viewLimits(): CharterViewLimits {
    const limits = {
      maxPromptBytes: this.config.maxPromptBytes,
      maxObjectiveBytes: this.config.maxObjectiveBytes,
      maxItemBytes: this.config.maxItemBytes,
      maxItems: this.config.maxItems,
      maxPendingItems: this.config.maxPendingItems,
      maxOps: this.config.maxOps,
      maxRecordBytes: this.config.maxRecordBytes,
      // Keep an older browser client rendering while the new Host loads.
      maxActiveInvariants: this.config.maxItems,
      maxActiveDeliverables: this.config.maxItems,
    }
    return limits
  }

  /**
   * View a Session by id even when it is not live in this Host process.
   *
   * A Web process can show a session persisted by another process (for
   * example the Desktop app). The conversation view must not fail with a raw
   * "not live" error before the user can see anything: return a read-only
   * stored view and let a later `publish()` upgrade it when the session
   * becomes live.
   */
  viewById(sessionId: SessionIdType): CharterView {
    const session = this.ctx.sessions.get(sessionId)
    if (session !== undefined) return this.view(session)
    if (this.invalidRecords.has(sessionId)) {
      return this.unavailableView(
        sessionId,
        this.unavailable.get(sessionId) ?? 'Stored charter cannot be read by this version',
      )
    }

    const failure = this.globalFailure
      ?? (this.sessionsTable === undefined ? 'Charter storage is not ready' : undefined)
    if (failure !== undefined) {
      return {
        status: 'unavailable',
        sessionId,
        revision: 0,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: this.viewLimits(),
        overBudget: false,
        message: failure,
      }
    }

    const stored = this.sessionsTable?.get(sessionId)
    const record = stored === undefined ? undefined : this.parseStoredRecord(sessionId, stored)
    if (stored === undefined) {
      return {
        status: 'unavailable',
        sessionId,
        revision: 0,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: this.viewLimits(),
        overBudget: false,
        message: 'This Session is not live in the current Host process. '
          + 'Open or start it in this Web UI; the Charter tab will update automatically.',
      }
    }

    if (record === undefined) {
      return this.unavailableView(
        sessionId,
        this.unavailable.get(sessionId) ?? 'Stored charter cannot be read by this version',
      )
    }
    try {
      assertRecordConsistency(record, this.config)
    } catch (error) {
      return {
        status: 'unavailable',
        sessionId,
        revision: 0,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: this.viewLimits(),
        overBudget: false,
        message: `Stored charter is inconsistent: ${describeError(error)}`,
      }
    }

    return {
      status: 'unavailable',
      sessionId,
      revision: record.current.revision,
      objective: record.current.objective ?? null,
      items: [...record.current.items],
      promptText: record.current.promptText,
      promptDigest: record.current.promptDigest,
      limits: this.viewLimits(),
      overBudget: isRecordOverBudget(record, this.config),
      lifecycle: lifecycleFingerprint(record.identity),
      message: 'This Session is not live in the current Host process; '
        + 'showing the stored charter read-only. Open or start the Session here to edit it.',
    }
  }

  private unavailableView(
    sessionId: SessionIdType,
    message: string,
    revision = 0,
    lifecycle?: string,
  ): CharterView {
    return {
      status: 'unavailable',
      sessionId,
      revision,
      ...(lifecycle === undefined ? {} : { lifecycle }),
      objective: null,
      items: [],
      promptText: '',
      promptDigest: '',
      limits: this.viewLimits(),
      overBudget: false,
      message,
    }
  }

  view(session: Session): CharterView {
    if (this.globalFailure !== undefined) {
      return this.unavailableView(session.id, this.globalFailure, 0, lifecycleFingerprint(identityOf(session)))
    }
    if (this.invalidRecords.has(session.id)) {
      return this.unavailableView(
        session.id,
        this.unavailable.get(session.id) ?? 'Stored charter cannot be read by this version',
        0,
        lifecycleFingerprint(identityOf(session)),
      )
    }
    const record = this.recordFor(session)
    const recordFailure = this.unavailable.get(session.id)
    if (recordFailure !== undefined) {
      return this.unavailableView(session.id, recordFailure, 0, lifecycleFingerprint(identityOf(session)))
    }
    if (record === undefined) {
      return {
        status: 'initializing',
        sessionId: session.id,
        revision: 0,
        lifecycle: lifecycleFingerprint(identityOf(session)),
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: this.viewLimits(),
        overBudget: false,
      }
    }
    return {
      status: 'ready',
      sessionId: session.id,
      revision: record.current.revision,
      objective: record.current.objective ?? null,
      items: [...record.current.items],
      promptText: record.current.promptText,
      promptDigest: record.current.promptDigest,
      limits: this.viewLimits(),
      overBudget: isRecordOverBudget(record, this.config),
      lifecycle: lifecycleFingerprint(identityOf(session)),
    }
  }

  promptText(session: Session): string {
    const view = this.view(session)
    // Never inject a charter that exceeds the current budget configuration;
    // the UI exposes the over-budget state so the user can trim it down.
    return view.status === 'ready' && !view.overBudget ? view.promptText : ''
  }

  readForModel(session: Session, mode: 'standing' | 'all'): CharterToolView {
    const record = this.recordFor(session)
    if (record === undefined) {
      throw charterError('UNAVAILABLE', this.globalFailure ?? this.unavailable.get(session.id) ?? 'Charter is not initialized')
    }
    const relevant = mode === 'standing'
      ? record.current.items.filter(isStandingItem)
      : record.current.items
    const objective = record.current.objective?.current.text ?? null
    if (mode === 'standing') {
      // `standing` is the model's working set: metadata that does not help the
      // model (ids, review, lifecycle are constant for standing rows) only
      // inflates the tool result.
      return {
        revision: record.current.revision,
        objective,
        items: relevant.map(item => ({
          kind: item.kind,
          text: item.text,
          verification: item.verification.state,
          progress: item.kind === 'deliverable' ? item.progress : null,
        })),
        truncated: 0,
      }
    }

    // `all` is the bounded debugging projection. The cap applies to the final
    // tool envelope (revision/objective/items/truncated), not only item JSON.
    const maxItems = 64
    const maxEnvelopeBytes = 32 * 1_024
    const toToolItem = (item: typeof relevant[number]): CharterToolItem => ({
      id: item.id,
      kind: item.kind,
      text: item.text,
      review: item.review,
      lifecycle: item.lifecycle,
      verification: item.verification.state,
      ...(item.verification.state === 'verified' ? { verificationBy: item.verification.by } : {}),
      ...(item.verification.state === 'failed' || item.verification.state === 'unavailable'
        ? { verificationReason: item.verification.reason }
        : {}),
      progress: item.kind === 'deliverable' ? item.progress : null,
      origin: item.origin,
      order: item.order,
      createdRevision: item.createdRevision,
      ...(item.supersedes === undefined ? {} : { supersedes: item.supersedes }),
      ...(item.supersededBy === undefined ? {} : { supersededBy: item.supersededBy }),
    })
    const envelopeBytes = (items: readonly CharterToolItem[]): number => Buffer.byteLength(
      JSON.stringify({
        revision: record.current.revision,
        objective,
        items,
        truncated: relevant.length - items.length,
      }),
      'utf8',
    )
    const page: CharterToolItem[] = []
    for (const item of relevant) {
      const candidate = [...page, toToolItem(item)]
      if (candidate.length > maxItems || envelopeBytes(candidate) > maxEnvelopeBytes) break
      page.push(candidate.at(-1)!)
    }
    return {
      revision: record.current.revision,
      objective,
      items: page,
      truncated: relevant.length - page.length,
    }
  }

  async edit(
    untrustedRequest: unknown,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterEditResult> {
    let request: CharterEditRequest
    try {
      request = normalizeEditRequest(untrustedRequest)
    } catch (error) {
      if (error instanceof CharterError) return unavailableResult(error.code, error.message)
      return unavailableResult('INVALID_ARGUMENT', describeError(error))
    }
    if (!this.admissionOpen) return unavailableResult('UNAVAILABLE', this.globalFailure ?? 'Charter is closing')
    try {
      assertEditAuthorized(actor, request.ops)
    } catch (error) {
      if (error instanceof CharterError) return unavailableResult(error.code, error.message)
      throw error
    }

    const session = this.ctx.sessions.get(SessionId(request.sessionId))
    if (session === undefined) return unavailableResult('NOT_FOUND', 'The Session is not live')
    let currentView = this.view(session)
    if (currentView.status === 'unavailable'
      && !this.invalidRecords.has(session.id)
      && this.sessionsTable?.get(session.id) === undefined) {
      try {
        await this.ensureSession(session, 'startup')
      } catch {
        // The current view below carries the refreshed failure.
      }
      currentView = this.view(session)
    }
    if (currentView.status === 'unavailable') {
      return unavailableResult('UNAVAILABLE', currentView.message ?? 'Charter is unavailable', currentView)
    }

    try {
      const table = this.requireTable()
      let current = this.recordFor(session)
      if (current === undefined && this.unavailable.get(session.id) !== undefined) {
        return unavailableResult(
          'UNAVAILABLE',
          this.unavailable.get(session.id) ?? 'Charter is unavailable',
          this.view(session),
        )
      }
      if (current === undefined) {
        await this.ensureSession(session, 'startup')
        current = this.recordFor(session)
      }
      if (current === undefined) throw charterError('NOT_FOUND', 'Charter record is missing')
      if (!sameIdentity(current, session)) {
        throw charterError('LIFECYCLE_MISMATCH', 'Stored charter belongs to another Session lifecycle')
      }

      const ids = Object.fromEntries(clientRefsOf(request.ops).map(ref => [ref, itemId()]))
      const requestDigest = requestDigestOf(request, current.identity, actor)
      try {
        const next = await table.update(session.id, stored => {
          const record = this.parseStoredRecord(session.id, stored)
          if (record === undefined) {
            throw charterError('UNAVAILABLE', 'Stored charter cannot be read by this version')
          }
          if (!sameIdentity(record, session)) {
            throw charterError('LIFECYCLE_MISMATCH', 'Stored charter belongs to another Session lifecycle')
          }
          return commitRecord({
            record,
            request,
            requestDigest,
            ids,
            actor,
            at: Date.now(),
            limits: this.config,
          })
        })
        return {
          ok: true,
          replayed: false,
          committedRevision: next.current.revision,
          ids,
          view: this.view(session),
        }
      } catch (error) {
        if (error instanceof MutationReplay) {
          return {
            ok: true,
            replayed: true,
            committedRevision: error.receipt.committedRevision,
            ids: error.receipt.ids,
            view: this.view(session),
          }
        }
        if (error instanceof RevisionConflict) {
          return unavailableResult('REVISION_CONFLICT', error.message, this.view(session))
        }
        throw error
      }
    } catch (error) {
      if (error instanceof CharterError) return unavailableResult(error.code, error.message, this.view(session))
      if (error instanceof DomainError && error.code === 'missing-key') {
        return unavailableResult('NOT_FOUND', 'Charter record is missing', this.view(session))
      }
      this.ctx.logger.error(`charter: edit failed for ${request.sessionId}: ${describeError(error)}`)
      return unavailableResult('UNAVAILABLE', 'Charter persistence failed; no state was published', this.view(session))
    }
  }

  subscribe(sessionId: SessionIdType, listener: CharterListener): () => void {
    let listeners = this.listeners.get(sessionId)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(sessionId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(sessionId)
    }
  }

  private publish(sessionId: SessionIdType): void {
    const listeners = this.listeners.get(sessionId)
    if (listeners === undefined || listeners.size === 0) return
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return
    const view = this.view(session)
    for (const listener of [...listeners]) {
      try {
        listener(view)
      } catch (error) {
        this.ctx.logger.warn(`charter: listener for ${sessionId} failed: ${describeError(error)}`)
      }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    charter: CharterService
  }
}

export interface ResolveActorOptions {
  /**
   * Whether a Remote call must carry a `PeerScope.principal`.
   *
   * DSH 0.2.1 and later make the field required. A confirmed legacy runtime
   * (0.1.7/0.2.0) has no such field, so only that generation may fall back to
   * the in-process owner. The default is the fail-closed policy: an absent
   * principal on a principal-aware runtime is denied instead of elevated.
   */
  readonly requirePrincipal?: boolean
}

export function resolveActor(ctx: Context, options: ResolveActorOptions = {}): CharterActor {
  const invocation = (ctx as Context & {
    invocation?: {
      readonly peer?: { readonly principal?: { readonly kind?: string } }
    }
  }).invocation
  // No invocation means in-process Host code, not a Remote call.
  if (invocation === undefined) return { kind: 'owner' }
  const principal = invocation.peer?.principal
  if (principal !== undefined) {
    return principal.kind === 'owner' ? { kind: 'owner' } : { kind: 'user' }
  }
  if (options.requirePrincipal === false) {
    // DSH 0.1.7/0.2.0: every Gateway peer is the in-process operator and the
    // protocol carries no principal field.
    return { kind: 'owner' }
  }
  throw charterError('FORBIDDEN', 'The Remote caller has no Peer principal; editing is denied')
}

export default CharterService
