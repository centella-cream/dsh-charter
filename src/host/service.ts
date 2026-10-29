import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DomainError, type KvTable } from '@deepseek-ai/dsh-storage-domain'
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
  CHARTER_RECORD_SCHEMA_VERSION,
  charterRecordSchema,
  type CharterActor,
  type CharterEditRequest,
  type CharterRecord,
} from '../core/schemas.js'
import { clientRefsOf, normalizeEditRequest } from '../core/normalize.js'
import {
  appendMaintenanceReceipt,
  assertRecordConsistency,
  assertRecoveryRecordAdmission,
  commitRecord,
  createEmptyRecord,
  isRecordOverBudget,
  maintenanceRequestDigestOf,
  MutationReplay,
  requestDigestOf,
  restoredRecord,
  RevisionConflict,
  type CharterIdentity,
} from '../core/record.js'
import {
  assertArchiveAdmission,
  assertRecoveryRequestAdmission,
  assertRestorableArchive,
  buildRecordArchive,
  recordDigestOf,
  validateArchiveEnvelope,
} from '../core/archive.js'
import {
  charterIdentitySchema,
  charterInitializeRequestSchema,
  charterRestoreRequestSchema,
  type CharterInitializeRequest,
  type CharterMaintenanceReceipt,
  type CharterRestoreRequest,
} from '../core/schemas.js'
import { peerPrincipalRequired } from '../remote/compat.js'
import { recordMaintenanceAvailable } from '../core/limits.js'
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
  CharterRecordExport,
  CharterRecordOperationResult,
  CharterRecordState,
  CharterView,
  CharterViewCapabilities,
  CharterViewLimits,
} from './types.js'
import type { SessionStartSource as StartSource } from '@deepseek-ai/dsh-agent'

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
  maintenanceLimit: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maintenanceLimit),
  maxRecoveryBytes: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxRecoveryBytes),
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

function sameIdentityValue(identity: CharterIdentity, session: Session): boolean {
  return identity.createdAt === session.header.createdAt
    && identity.cwd === session.header.cwd
    && identity.parentSession === session.header.parentSession
}

function sameIdentity(record: CharterRecord, session: Session): boolean {
  return record.identity.createdAt === session.header.createdAt
    && record.identity.cwd === session.header.cwd
    && record.identity.parentSession === session.header.parentSession
}

type InitSource = StartSource | 'reattach' | 'unknown'

/** Read only a finite non-negative integer schema version from raw JSON. */
function finiteRecordSchemaVersion(stored: unknown): number | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const value = (stored as { recordSchemaVersion?: unknown }).recordSchemaVersion
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function futureSchemaRecordState(
  digest: `sha256:${string}`,
  stored: unknown,
): import('./types.js').CharterRecordState {
  const observed = looseIdentityRevision(stored)
  return {
    kind: 'invalid',
    reason: 'future-schema',
    recordDigest: digest,
    recoverable: false,
    ...(observed === undefined ? {} : { observedRevision: observed }),
  }
}

interface Inspection {
  readonly digest: `sha256:${string}`
  readonly state: CharterRecordState
  readonly record?: CharterRecord
  readonly raw: unknown
}

function looseIdentityOf(value: unknown): CharterIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const parsed = charterIdentitySchema.safeParse((value as { identity?: unknown }).identity)
  return parsed.success ? parsed.data : undefined
}

function looseIdentityRevision(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const current = (value as { current?: unknown }).current
  if (typeof current !== 'object' || current === null) return undefined
  const revision = (current as { revision?: unknown }).revision
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : undefined
}

function isKnownEditFailure(error: unknown): boolean {
  if (error instanceof CharterError || error instanceof MutationReplay || error instanceof RevisionConflict) return true
  return error instanceof DomainError && (error.code === 'missing-key' || error.code === 'closed')
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
  /** Host-derived record health; never persisted. */
  private readonly recordStates = new Map<SessionIdType, CharterRecordState>()
  /** Sessions created during this Host lifetime (weak startup intent until agent/created). */
  private readonly createdSessions = new WeakSet<Session>()
  /** Authoritative/inferred start intent per Session for coalescing and retry. */
  private readonly startSources = new Map<SessionIdType, InitSource>()
  /** Unknown-outcome writes; the Session is fenced until restart. */
  private readonly writeUncertain = new Map<SessionIdType, 'startup' | 'edit' | 'initialize' | 'restore'>()
  /** One mutation queue per Session (init/initialize/edit/restore). */
  private readonly mutationQueues = new Map<SessionIdType, Promise<unknown>>()
  private readonly lastInitSource = new Map<SessionIdType, InitSource>()

  private inspectionOf(session: Session, stored: unknown): Inspection {
    const digest = recordDigestOf(stored)
    const parsed = charterRecordSchema.safeParse(stored)
    if (!parsed.success) {
      const observedVersion = finiteRecordSchemaVersion(stored)
      if (observedVersion !== undefined && observedVersion > CHARTER_RECORD_SCHEMA_VERSION) {
        return { digest, state: futureSchemaRecordState(digest, stored), raw: stored }
      }
      const loose = looseIdentityOf(stored)
      const observed = looseIdentityRevision(stored)
      const recoverable = loose !== undefined && sameIdentityValue(loose, session)
      if (loose !== undefined && !recoverable) {
        return { digest, state: { kind: 'lifecycle-mismatch', recordDigest: digest }, raw: stored }
      }
      return {
        digest,
        raw: stored,
        state: {
          kind: 'invalid',
          reason: 'schema',
          recordDigest: digest,
          recoverable,
          ...(observed === undefined ? {} : { observedRevision: observed }),
        },
      }
    }
    try {
      assertRecordConsistency(parsed.data, this.config)
    } catch {
      return {
        digest,
        raw: stored,
        state: {
          kind: 'invalid',
          reason: 'consistency',
          recordDigest: digest,
          recoverable: sameIdentity(parsed.data, session),
          observedRevision: parsed.data.current.revision,
        },
      }
    }
    if (!sameIdentity(parsed.data, session)) {
      return { digest, state: { kind: 'lifecycle-mismatch', recordDigest: digest }, raw: stored }
    }
    return { digest, state: { kind: 'healthy', recordDigest: digest }, record: parsed.data, raw: stored }
  }

  private recordStateFor(session: Session): CharterRecordState {
    const uncertain = this.writeUncertain.get(session.id)
    if (uncertain !== undefined) {
      const stored = this.sessionsTable?.get(session.id)
      return {
        kind: 'write-uncertain',
        operation: uncertain,
        ...(stored === undefined
          ? {}
          : { lastKnownRecordDigest: recordDigestOf(stored) }),
      }
    }
    if (this.globalFailure !== undefined || this.sessionsTable === undefined) {
      return { kind: 'unknown', reason: 'storage-unavailable' }
    }
    const stored = this.sessionsTable.get(session.id)
    const cached = this.recordStates.get(session.id)
    if (stored === undefined) {
      // The cache is the authoritative Host classification between domain
      // changes; a raw absence only becomes absent-unconfirmed on first access.
      if (cached !== undefined) return cached
      if (this.initializations.has(session.id)) return { kind: 'unknown', reason: 'initializing' }
      return { kind: 'absent-unconfirmed', source: this.absentSource(session.id) }
    }
    return cached ?? this.inspectionOf(session, stored).state
  }

  private absentSource(id: SessionIdType): 'resume' | 'clear' | 'compact' | 'reattach' | 'unknown' {
    const source = this.startSources.get(id)
    if (source === 'startup' || source === undefined) return 'unknown'
    return source
  }

  private recordMaintenanceCapability(): CharterViewCapabilities {
    if (!peerPrincipalRequired()) {
      return { recordMaintenance: false, recordMaintenanceReason: 'legacy-host' }
    }
    if (!recordMaintenanceAvailable(this.config)) {
      return { recordMaintenance: false, recordMaintenanceReason: 'record-limit' }
    }
    return { recordMaintenance: true }
  }

  private async runMutationQueue<T>(session: Session, task: () => Promise<T>): Promise<T> {
    const sessionId = session.id
    const previous = this.mutationQueues.get(sessionId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    const slot = run.catch(() => undefined)
    this.mutationQueues.set(sessionId, slot)
    try {
      return await run
    } finally {
      if (this.mutationQueues.get(sessionId) === slot) this.mutationQueues.delete(sessionId)
    }
  }

  /** Fence a Session after a backend rejection that may have landed. */
  private fenceWrite(sessionId: SessionIdType, operation: 'startup' | 'edit' | 'initialize' | 'restore'): void {
    const stored = this.sessionsTable?.get(sessionId)
    this.writeUncertain.set(sessionId, operation)
    this.recordStates.set(sessionId, {
      kind: 'write-uncertain',
      operation,
      ...(stored === undefined ? {} : { lastKnownRecordDigest: recordDigestOf(stored) }),
    })
    if (this.ctx.sessions.get(sessionId) !== undefined) this.publish(sessionId)
  }

  private assertNotFenced(sessionId: SessionIdType): void {
    if (this.writeUncertain.has(sessionId)) {
      throw charterError('UNAVAILABLE', 'The last storage write outcome is uncertain; restart the Host before touching this Charter')
    }
  }

  /**
   * Read-triggered inspection ONLY. A client read must never infer a startup
   * source: sessions created in-process stay absent-unconfirmed until the
   * authoritative `agent/created(startup)` arrives. Healthy documents open;
   * malformed/version-rejected documents are classified without a write; a
   * missing fork child is never rebuilt here.
   */
  private ensureLazy(session: Session): void {
    if (this.writeUncertain.has(session.id)) return
    if (this.initializations.has(session.id) || this.recordStates.has(session.id)) return
    if (this.globalFailure !== undefined || this.sessionsTable === undefined) return
    const stored = this.sessionsTable.get(session.id)
    if (stored === undefined) {
      this.recordStates.set(session.id, {
        kind: 'absent-unconfirmed',
        source: this.absentSource(session.id),
      })
      return
    }
    this.recordStates.set(session.id, this.inspectionOf(session, stored).state)
  }

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
      // session/created never writes storage: it only records the startup
      // intent. agent/created is authoritative for a new Agent lifecycle.
      this.createdSessions.add(session)
      this.startSources.set(session.id, 'unknown')
      if (!domainReady) createdDuringOpen.add(session)
    }, { global: true })

    this.ctx.on('agent/created', async ({ agent, source, signal }) => {
      // The authoritative source always runs, even when an inferred
      // reattach/unknown initialization already loaded (or decided absence).
      this.startSources.set(agent.session.id, source)
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
      this.closeListeners(session.id)
      this.waitingForParent.delete(session.id)
      this.unavailable.delete(session.id)
      this.invalidRecords.delete(session.id)
      this.initializationParents.delete(session.id)
      this.initializationControllers.get(session.id)?.abort(
        new Error('Session disposed during Charter initialization'),
      )
    }, { global: true })

    this.ctx.on('domain/changed', change => {
      if (change.domain !== CHARTER_DOMAIN_NAME
        || change.table !== CHARTER_SESSIONS_TABLE
        || change.key.length === 0) return
      const changedId = SessionId(change.key)
      this.recordStates.delete(changedId)
      this.publish(changedId)
      for (const [childId, parentId] of this.waitingForParent) {
        if (parentId !== changedId) continue
        const child = this.ctx.sessions.get(childId)
        if (child !== undefined) {
          const source = this.startSources.get(childId) ?? 'unknown'
          void this.initializeSessionSafely(child, source === 'startup' ? 'startup' : 'reattach')
        }
      }
      for (const child of this.ctx.sessions.list()) {
        if (child.header.parentSession !== changedId) continue
        const state = this.recordStates.get(child.id)
        if (state?.kind !== 'unknown') continue
        const source = this.startSources.get(child.id) ?? 'unknown'
        void this.initializeSessionSafely(child, source === 'startup' ? 'startup' : 'reattach')
      }
    }, { global: true })

    await opening
    domainReady = true
    // Sessions created before the domain opened wait for their authoritative
    // agent/created; everything already mounted when the plugin starts is a
    // reattach: existing records open, absence is never auto-created.
    for (const session of this.ctx.sessions.list()) {
      if (createdDuringOpen.has(session)) continue
      await this.initializeSessionSafely(session, 'reattach')
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

    await Promise.all(this.ctx.agents.list().map(agent => this.initializeSessionSafely(agent.session, 'reattach')))
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
        // Drain every admitted per-Session mutation slot before the medium
        // closes. Admission is already closed, so no new slots can appear.
        for (let round = 0; round < 100 && this.mutationQueues.size > 0; round += 1) {
          const pending = [...this.mutationQueues.values()]
          if (pending.length === 0) break
          await Promise.allSettled(pending)
          if (this.mutationQueues.size === 0) break
          await new Promise(resolve => setTimeout(resolve, 1))
        }
        this.mutationQueues.clear()
        for (const sessionId of [...this.listeners.keys()]) this.closeListeners(sessionId)
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
    source: InitSource,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.ensureSession(session, source, signal)
    } catch (error) {
      if (this.ctx.sessions.get(session.id) !== session) return
      const owner = this.initializationOwners.get(session.id)
      if (owner !== undefined && owner !== session) return
      if (this.writeUncertain.has(session.id)) return
      const message = `Charter initialization failed: ${describeError(error)}`
      this.unavailable.set(session.id, message)
      this.recordStates.set(session.id, { kind: 'unknown', reason: 'storage-unavailable' })
      this.ctx.logger.error(`charter: ${session.id}: ${message}`)
      this.publish(session.id)
    }
  }

  ensureSession(
    session: Session,
    source: InitSource = 'reattach',
    signal?: AbortSignal,
    ancestors: ReadonlySet<SessionIdType> = new Set(),
  ): Promise<void> {
    if (ancestors.has(session.id)) {
      return Promise.reject(charterError('CORRUPT_STATE', `Session ${session.id} forms a parent cycle in the charter ancestry`))
    }
    if (ancestors.size >= 64) {
      return Promise.reject(charterError('CORRUPT_STATE', `Session ${session.id} exceeds the charter ancestry depth limit`))
    }
    this.assertNotFenced(session.id)
    this.startSources.set(session.id, source)
    const existing = this.initializations.get(session.id)
    const existingOwner = this.initializationOwners.get(session.id)
    if (existing !== undefined && existingOwner === session) {
      // Coalesce: an authoritative startup must re-inspect after an inferred
      // reattach/unknown run instead of reusing its (weaker) result. The
      // current source was just recorded above, so no second lookup is needed.
      if (source === 'startup' && this.lastInitSource.get(session.id) !== 'startup') {
        const rerun = existing.catch(() => undefined)
          .then(() => this.initializeSession(session, source, signal, new Set(ancestors)))
        this.initializations.set(session.id, rerun)
        this.lastInitSource.set(session.id, source)
        return rerun
      }
      return existing
    }
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
    const initialization = this.initializeSession(session, source, effectiveSignal, nextAncestors)
      .finally(() => {
        if (this.initializations.get(session.id) === initialization) {
          this.initializations.delete(session.id)
          this.initializationControllers.delete(session.id)
          this.initializationOwners.delete(session.id)
          this.lastInitSource.delete(session.id)
          this.initializationParents.delete(session.id)
        }
      })
    this.initializations.set(session.id, initialization)
    this.initializationControllers.set(session.id, controller)
    this.initializationOwners.set(session.id, session)
    this.lastInitSource.set(session.id, source)
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
    source: InitSource,
    signal?: AbortSignal,
    ancestors: ReadonlySet<SessionIdType> = new Set(),
  ): Promise<void> {
    signal?.throwIfAborted()
    if (this.ctx.sessions.get(session.id) !== session) return
    if (this.writeUncertain.has(session.id)) return
    const table = this.requireTable()
    const inspect = (): Inspection | undefined => {
      const stored = table.get(session.id)
      return stored === undefined ? undefined : this.inspectionOf(session, stored)
    }

    // Stored health is source-independent: open, isolate, or fence exactly once.
    let inspection = inspect()
    if (inspection !== undefined) {
      this.recordStates.set(session.id, inspection.state)
      if (inspection.state.kind === 'healthy') this.unavailable.delete(session.id)
      this.publish(session.id)
      if (inspection.state.kind !== 'healthy') return
    }

    if (session.header.parentSession !== undefined) {
      if (session.header.parentSession === session.id) {
        throw charterError('CORRUPT_STATE', `Session ${session.id} cannot be its own Charter parent`)
      }
      const parentId = SessionId(session.header.parentSession)
      this.assertInitializationAcyclic(session.id, parentId)
      this.initializationParents.set(session.id, parentId)
      if (source === 'startup') {
        const parentSession = this.ctx.sessions.get(parentId)
        if (parentSession !== undefined) await this.ensureSession(parentSession, 'startup', signal, ancestors)
      }
    }

    if (inspection !== undefined) return
    if (source !== 'startup') {
      this.recordStates.set(session.id, { kind: 'absent-unconfirmed', source })
      this.publish(session.id)
      return
    }

    // Authoritative startup: create the empty root or fork exactly once. The
    // parent is initialized *before* entering the child queue; the child slot
    // re-reads the table so a concurrent initialize/restore cannot be
    // overwritten by this startup put.
    this.recordStates.set(session.id, { kind: 'unknown', reason: 'initializing' })
    let putMayHaveLanded = false
    try {
      await this.runMutationQueue(session, async () => {
        signal?.throwIfAborted()
        if (this.ctx.sessions.get(session.id) !== session) return
        const current = table.get(session.id)
        if (current !== undefined) {
          // Another writer landed first: adopt the existing record.
          this.recordStates.set(session.id, this.inspectionOf(session, current).state)
          this.waitingForParent.delete(session.id)
          this.publish(session.id)
          return
        }
        let record: CharterRecord
        if (session.header.parentSession !== undefined) {
          const parentId = SessionId(session.header.parentSession)
          const storedParent = table.get(session.header.parentSession)
          const parentSession = this.ctx.sessions.get(parentId)
          const parentInspection = storedParent === undefined || parentSession === undefined
            ? undefined
            : this.inspectionOf(parentSession, storedParent)
          if (parentInspection?.state.kind !== 'healthy' || parentInspection.record === undefined) {
            this.waitingForParent.set(session.id, parentId)
            this.recordStates.set(session.id, { kind: 'unknown', reason: 'initializing' })
            throw charterError('NOT_FOUND', `parent charter ${session.header.parentSession} is unavailable`)
          }
          const ids = Object.fromEntries(
            parentInspection.record.current.items.map(item => [item.id, itemId()]),
          )
          record = forkRecord({
            parentSessionId: session.header.parentSession,
            parent: parentInspection.record,
            childIdentity: identityOf(session),
            ids,
            mutationId: forkMutationId(),
            at: Date.now(),
            limits: this.config,
          })
        } else {
          record = createEmptyRecord(identityOf(session), this.config)
        }
        putMayHaveLanded = true
        await table.put(session.id, record)
        putMayHaveLanded = false
        if (this.ctx.sessions.get(session.id) !== session) {
          this.fenceWrite(session.id, 'startup')
          return
        }
        if (this.writeUncertain.has(session.id)) return
        this.waitingForParent.delete(session.id)
        this.recordStates.set(session.id, { kind: 'healthy', recordDigest: recordDigestOf(record) })
        this.publish(session.id)
      })
    } catch (error) {
      if (putMayHaveLanded && !(error instanceof DomainError && (error.code === 'closed' || error.code === 'missing-key'))) {
        this.fenceWrite(session.id, 'startup')
        this.ctx.logger.error(`charter: startup write for ${session.id} has an uncertain outcome: ${describeError(error)}`)
        return
      }
      throw error
    }
  }

  private requireTable(): KvTable<SessionIdType, CharterRecord> {
    if (!this.admissionOpen || this.sessionsTable === undefined) {
      throw charterError('UNAVAILABLE', this.globalFailure ?? 'Charter storage is not ready')
    }
    return this.sessionsTable
  }

  private recordFor(session: Session): CharterRecord | undefined {
    if (this.writeUncertain.has(session.id)) return undefined
    const stored = this.sessionsTable?.get(session.id)
    if (stored === undefined) {
      this.ensureLazy(session)
      return undefined
    }
    const inspection = this.inspectionOf(session, stored)
    this.recordStates.set(session.id, inspection.state)
    if (inspection.state.kind === 'healthy') {
      this.unavailable.delete(session.id)
      return inspection.record
    }
    return undefined
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
      maintenanceLimit: this.config.maintenanceLimit,
      maxRecoveryBytes: this.config.maxRecoveryBytes,
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

    const limits = this.viewLimits()
    const capabilities = this.recordMaintenanceCapability()
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
        limits,
        overBudget: false,
        recordState: { kind: 'unknown', reason: 'storage-unavailable' },
        capabilities,
        message: failure,
      }
    }
    const stored = this.sessionsTable?.get(sessionId)
    if (stored === undefined) {
      return {
        status: 'unavailable',
        sessionId,
        revision: 0,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits,
        overBudget: false,
        recordState: { kind: 'absent-unconfirmed', source: 'unknown' },
        capabilities,
        message: 'This Session is not live in the current Host process. '
          + 'Open or start it in this Web UI; the Charter tab will update automatically.',
      }
    }
    // A not-live Session can only be shown read-only; identity checks need the
    // live Session object, so classify the document shape only.
    const parsed = charterRecordSchema.safeParse(stored)
    const digest = recordDigestOf(stored)
    const limitsBody = {
      status: 'unavailable' as const,
      sessionId,
      revision: 0,
      objective: null,
      items: [],
      promptText: '',
      promptDigest: '',
      limits,
      overBudget: false,
      capabilities,
      message: 'This Session is not live in the current Host process; '
        + 'showing the stored charter read-only. Open or start the Session here to edit it.',
    }
    if (!parsed.success) {
      const observedVersion = finiteRecordSchemaVersion(stored)
      return {
        ...limitsBody,
        recordState: observedVersion !== undefined && observedVersion > CHARTER_RECORD_SCHEMA_VERSION
          ? futureSchemaRecordState(digest, stored)
          : { kind: 'invalid', reason: 'schema', recordDigest: digest, recoverable: false },
      }
    }
    try {
      assertRecordConsistency(parsed.data, this.config)
    } catch {
      return {
        ...limitsBody,
        recordState: {
          kind: 'invalid',
          reason: 'consistency',
          recordDigest: digest,
          recoverable: true,
          observedRevision: parsed.data.current.revision,
        },
      }
    }
    return {
      status: 'unavailable',
      sessionId,
      revision: parsed.data.current.revision,
      objective: parsed.data.current.objective ?? null,
      items: [...parsed.data.current.items],
      promptText: parsed.data.current.promptText,
      promptDigest: parsed.data.current.promptDigest,
      limits,
      overBudget: isRecordOverBudget(parsed.data, this.config),
      lifecycle: lifecycleFingerprint(parsed.data.identity),
      recordState: { kind: 'healthy', recordDigest: digest },
      capabilities,
      message: 'This Session is not live in the current Host process; '
        + 'showing the stored charter read-only. Open or start the Session here to edit it.',
    }
  }

  private unavailableView(
    sessionId: SessionIdType,
    message: string,
    revision = 0,
    lifecycle?: string,
    recordState?: CharterRecordState,
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
      recordState: recordState ?? { kind: 'unknown', reason: 'storage-unavailable' },
      capabilities: this.recordMaintenanceCapability(),
      message,
    }
  }

  view(session: Session): CharterView {
    const lifecycle = lifecycleFingerprint(identityOf(session))
    const limits = this.viewLimits()
    const capabilities = this.recordMaintenanceCapability()
    if (this.globalFailure !== undefined) {
      return this.unavailableView(
        session.id,
        this.globalFailure,
        0,
        lifecycle,
        { kind: 'unknown', reason: 'storage-unavailable' },
      )
    }
    if (this.sessionsTable === undefined) {
      return this.unavailableView(
        session.id,
        'Charter storage is not ready',
        0,
        lifecycle,
        { kind: 'unknown', reason: 'initializing' },
      )
    }
    this.ensureLazy(session)
    const state = this.recordStateFor(session)
    if (state.kind === 'write-uncertain') {
      return this.unavailableView(
        session.id,
        'The last storage write outcome is uncertain. Restart the Host so it can reload the medium and recover this Session.',
        0,
        lifecycle,
        state,
      )
    }
    if (state.kind === 'absent-unconfirmed') {
      return this.unavailableView(
        session.id,
        'No Charter record was loaded. It may never have existed, or storage may be unable to read it. '
          + 'The plugin has not written to this location.',
        0,
        lifecycle,
        state,
      )
    }
    if (state.kind === 'invalid') {
      return this.unavailableView(
        session.id,
        `Stored charter is not structurally valid (${state.reason}); it is preserved for diagnosis and recovery.`,
        0,
        lifecycle,
        state,
      )
    }
    if (state.kind === 'lifecycle-mismatch') {
      return this.unavailableView(
        session.id,
        'Stored charter belongs to another Session lifecycle and will not be overwritten.',
        0,
        lifecycle,
        state,
      )
    }
    if (state.kind === 'unknown') {
      return state.reason === 'initializing'
        ? {
            status: 'initializing',
            sessionId: session.id,
            revision: 0,
            lifecycle,
            objective: null,
            items: [],
            promptText: '',
            promptDigest: '',
            limits,
            overBudget: false,
            recordState: state,
            capabilities,
          }
        : this.unavailableView(
            session.id,
            this.unavailable.get(session.id) ?? 'Charter storage is unavailable.',
            0,
            lifecycle,
            state,
          )
    }
    const record = this.recordFor(session)
    if (record === undefined) {
      return this.unavailableView(
        session.id,
        'Stored charter cannot be read by this version.',
        0,
        lifecycle,
        { kind: 'unknown', reason: 'storage-unavailable' },
      )
    }
    return {
      status: 'ready',
      sessionId: session.id,
      revision: record.current.revision,
      objective: record.current.objective ?? null,
      items: [...record.current.items],
      promptText: record.current.promptText,
      promptDigest: record.current.promptDigest,
      limits,
      overBudget: isRecordOverBudget(record, this.config),
      lifecycle,
      recordState: state,
      capabilities,
    }
  }

  promptText(session: Session): string {
    if (this.writeUncertain.has(session.id)) return ''
    const view = this.view(session)
    // Never inject a charter that exceeds the current budget configuration;
    // the UI exposes the over-budget state so the user can trim it down.
    return view.status === 'ready' && !view.overBudget ? view.promptText : ''
  }

  readForModel(session: Session, mode: 'standing' | 'all'): CharterToolView {
    if (this.writeUncertain.has(session.id)) {
      throw charterError('UNAVAILABLE', 'The last storage write outcome is uncertain; restart the Host before reading this Charter')
    }
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
    const emptyEnvelopeBytes = Buffer.byteLength(
      JSON.stringify({ revision: record.current.revision, objective, items: [], truncated: relevant.length }),
      'utf8',
    )
    // A profile may raise maxObjectiveBytes above the debug envelope. Never
    // return an unfittable envelope: omit the objective and report the
    // truncation explicitly.
    const objectiveTruncated = emptyEnvelopeBytes > maxEnvelopeBytes
    const boundedObjective = objectiveTruncated ? null : objective
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
        objective: boundedObjective,
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
      objective: boundedObjective,
      items: page,
      truncated: relevant.length - page.length,
      ...(objectiveTruncated ? { objectiveTruncated: true } : {}),
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
    if (this.writeUncertain.has(session.id)) {
      return unavailableResult(
        'UNAVAILABLE',
        'The last storage write outcome is uncertain; restart the Host before editing this Charter',
        this.view(session),
      )
    }
    this.ensureLazy(session)
    const state = this.recordStateFor(session)
    if (state.kind === 'absent-unconfirmed') {
      return unavailableResult(
        'INITIALIZATION_REQUIRED',
        'This Session has no confirmed Charter record; initialize it explicitly before editing',
        this.view(session),
      )
    }
    if (state.kind !== 'healthy') {
      return unavailableResult(
        'UNAVAILABLE',
        state.kind === 'invalid' && state.reason === 'future-schema'
          ? 'This Charter was written by a newer dsh-charter schema; upgrade the plugin before editing. Diagnostic export is available, but restore is disabled.'
          : state.kind === 'unknown' ? 'Charter is initializing' : 'This Charter record is not editable in its current state',
        this.view(session),
      )
    }

    try {
      return await this.runMutationQueue(session, async () => {
        if (this.ctx.sessions.get(session.id) !== session) {
          return unavailableResult('LIFECYCLE_MISMATCH', 'The Session lifecycle changed before this edit could run', this.view(session))
        }
        const table = this.requireTable()
        const current = this.recordFor(session)
        if (current === undefined) {
          return unavailableResult('UNAVAILABLE', 'Charter record is not readable', this.view(session))
        }
        if (!sameIdentity(current, session)) {
          return unavailableResult('LIFECYCLE_MISMATCH', 'Stored charter belongs to another Session lifecycle', this.view(session))
        }
        const ids = Object.fromEntries(clientRefsOf(request.ops).map(ref => [ref, itemId()]))
        const requestDigest = requestDigestOf(request, current.identity, actor)
        let produced = false
        try {
          const next = await table.update(session.id, stored => {
            const inspection = this.inspectionOf(session, stored)
            if (inspection.state.kind !== 'healthy' || inspection.record === undefined) {
              if (inspection.state.kind === 'absent-unconfirmed') {
                throw charterError('INITIALIZATION_REQUIRED', 'Charter record is absent-unconfirmed')
              }
              throw charterError('UNAVAILABLE', 'Stored charter cannot be edited in its current state')
            }
            const nextRecord = commitRecord({
              record: inspection.record,
              request,
              requestDigest,
              ids,
              actor,
              at: Date.now(),
              limits: this.config,
            })
            produced = true
            return nextRecord
          })
          if (this.ctx.sessions.get(session.id) !== session) {
            this.fenceWrite(session.id, 'edit')
            return unavailableResult('UNAVAILABLE', 'The Session lifecycle changed while the edit was being written; the Session is fenced', this.view(session))
          }
          this.recordStates.set(session.id, {
            kind: 'healthy',
            recordDigest: recordDigestOf(table.get(session.id)),
          })
          this.publish(session.id)
          return {
            ok: true,
            replayed: false,
            committedRevision: next.current.revision,
            ids,
            view: this.view(session),
          }
        } catch (error) {
          if (produced && !isKnownEditFailure(error)) {
            this.fenceWrite(session.id, 'edit')
            this.ctx.logger.error(`charter: edit write for ${session.id} has an uncertain outcome: ${describeError(error)}`)
            return unavailableResult(
              'UNAVAILABLE',
              'Charter persistence outcome is uncertain; the Session is fenced until restart',
              this.view(session),
            )
          }
          throw error
        }
      })
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
      if (error instanceof CharterError) return unavailableResult(error.code, error.message, this.view(session))
      if (error instanceof DomainError && (error.code === 'missing-key' || error.code === 'closed')) {
        return unavailableResult('UNAVAILABLE', 'Charter storage is unavailable for this Session', this.view(session))
      }
      this.ctx.logger.error(`charter: edit failed for ${request.sessionId}: ${describeError(error)}`)
      return unavailableResult('UNAVAILABLE', 'Charter persistence failed; no state was published', this.view(session))
    }
  }

  private maintenanceGate(actor: CharterActor):
    | { readonly ok: true }
    | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string } {
    const capability = this.recordMaintenanceCapability()
    if (!capability.recordMaintenance) {
      return {
        ok: false,
        code: 'RECOVERY_UNSUPPORTED',
        message: capability.recordMaintenanceReason === 'record-limit'
          ? 'The configured record budget leaves no room for a recovery archive'
          : 'Record maintenance requires DSH 0.2.1 or newer with owner/resource enforcement',
      }
    }
    if (actor.kind !== 'owner') {
      return { ok: false, code: 'FORBIDDEN', message: 'Only the owner may export, initialize, or restore a Charter record' }
    }
    return { ok: true }
  }

  /**
   * Replay success reports the receipt's ORIGINAL result revision (the version
   * the operation actually produced), not the current revision after a later
   * edit; the view stays the current authority.
   */
  private maintenanceResult(
    session: Session,
    replayed: boolean,
    replayedRevision?: number,
  ): CharterRecordOperationResult {
    const record = this.recordFor(session)
    return {
      ok: true,
      replayed,
      committedRevision: replayed && replayedRevision !== undefined
        ? replayedRevision
        : record?.current.revision ?? 0,
      view: this.view(session),
    }
  }

  private maintenanceReceipt(input: {
    readonly operationId: string
    readonly kind: 'initialize' | 'restore'
    readonly requestDigest: `sha256:${string}`
    readonly result: CharterRecord
    readonly sourceRecordDigest?: `sha256:${string}` | undefined
  }): CharterMaintenanceReceipt {
    return {
      operationId: input.operationId,
      kind: input.kind,
      requestDigest: input.requestDigest,
      resultRevision: input.result.current.revision,
      resultStateDigest: input.result.current.stateDigest as `sha256:${string}`,
      ...(input.sourceRecordDigest === undefined ? {} : { sourceRecordDigest: input.sourceRecordDigest }),
      at: Date.now(),
    }
  }

  /** Re-confirm the queued operation still targets the live Session object. */
  private queuedMaintenanceFailure(
    session: Session,
    lifecycle: string,
    expectedLifecycle: string,
  ): CharterRecordOperationResult | undefined {
    if (this.ctx.sessions.get(session.id) !== session) {
      return {
        ok: false,
        code: 'LIFECYCLE_MISMATCH',
        message: 'The Session lifecycle changed while the operation was queued',
      }
    }
    if (this.writeUncertain.has(session.id)) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'The last storage write outcome is uncertain; restart the Host',
      }
    }
    const actual = lifecycleFingerprint(identityOf(session))
    if (actual !== lifecycle || actual !== expectedLifecycle) {
      return {
        ok: false,
        code: 'LIFECYCLE_MISMATCH',
        message: 'The Session lifecycle changed while the operation was queued',
      }
    }
    return undefined
  }

  /** Export the complete raw record for one Session (owner-only). */
  exportRecord(sessionId: SessionIdType, actor: CharterActor = { kind: 'owner' }): CharterRecordExport {
    const gate = this.maintenanceGate(actor)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    const table = this.sessionsTable
    if (table === undefined) return { ok: false, code: 'UNAVAILABLE', message: 'Charter storage is not ready' }
    if (this.writeUncertain.has(sessionId)) {
      return { ok: false, code: 'UNAVAILABLE', message: 'The last storage write outcome is uncertain; restart the Host' }
    }
    const stored = table.get(sessionId)
    if (stored === undefined) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'No raw record exists (missing or unreadable; cannot be distinguished automatically)',
      }
    }
    const inspection = this.inspectionOf(session, stored)
    const health = inspection.state.kind === 'healthy'
      ? 'healthy'
      : inspection.state.kind === 'invalid'
        ? inspection.state.reason === 'consistency' ? 'consistency-invalid' : 'schema-invalid'
        : 'lifecycle-mismatch'
    let archive
    try {
      archive = buildRecordArchive({
        sessionId,
        lifecycle: lifecycleFingerprint(identityOf(session)),
        health,
        revision: inspection.record?.current.revision
          ?? (inspection.state.kind === 'invalid' ? (inspection.state.observedRevision ?? null) : null),
        record: stored,
        exportedAt: Date.now(),
      })
      assertArchiveAdmission(archive, this.config)
    } catch (error) {
      if (error instanceof CharterError) return { ok: false, code: error.code, message: error.message }
      throw error
    }
    const safe = String(sessionId).replace(/[^A-Za-z0-9._-]+/gu, '-')
    const revision = inspection.record?.current.revision ?? 0
    return {
      ok: true,
      filename: `dsh-charter-${safe}-r${revision}-${Date.now()}.json`,
      archive,
    }
  }

  /**
   * Explicit empty initialization: only for an absent key (an outer unreadable
   * document still appears absent, so the UI requires destructive confirmation).
   */
  async initializeRecord(
    untrusted: unknown,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterRecordOperationResult> {
    const parsed = charterInitializeRequestSchema.safeParse(untrusted)
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_ARGUMENT', message: 'Invalid initialize request' }
    }
    const request: CharterInitializeRequest = parsed.data
    const gate = this.maintenanceGate(actor)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    if (!this.admissionOpen) return { ok: false, code: 'UNAVAILABLE', message: 'Charter is closing' }
    const session = this.ctx.sessions.get(SessionId(request.sessionId))
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    if (this.writeUncertain.has(session.id)) {
      return { ok: false, code: 'UNAVAILABLE', message: 'The last storage write outcome is uncertain; restart the Host' }
    }
    const lifecycle = lifecycleFingerprint(identityOf(session))
    if (request.expectedLifecycle !== lifecycle) {
      return { ok: false, code: 'LIFECYCLE_MISMATCH', message: 'The Session lifecycle changed since preview' }
    }
    return this.runMutationQueue(session, async (): Promise<CharterRecordOperationResult> => {
      if (this.ctx.sessions.get(session.id) !== session) {
        return { ok: false, code: 'LIFECYCLE_MISMATCH', message: 'The Session lifecycle changed before initialize could run' }
      }
      const queuedFailure = this.queuedMaintenanceFailure(session, lifecycle, request.expectedLifecycle)
      if (queuedFailure !== undefined) return queuedFailure
      const table = this.requireTable()
      const stored = table.get(session.id)
      if (stored !== undefined) {
        const inspection = this.inspectionOf(session, stored)
        if (inspection.state.kind === 'healthy' && inspection.record !== undefined) {
          const receipt = inspection.record.recentMaintenance?.find(entry => entry.operationId === request.operationId)
          if (receipt !== undefined) {
            return receipt.requestDigest === this.initializeRequestDigest(request, lifecycle, actor)
              ? this.maintenanceResult(session, true, receipt.resultRevision)
              : { ok: false, code: 'OPERATION_ID_REUSED', message: 'This operation id names a different request' }
          }
          return { ok: false, code: 'RECORD_CONFLICT', message: 'A healthy Charter record already exists' }
        }
        return {
          ok: false,
          code: 'RECORD_CONFLICT',
          message: inspection.state.kind === 'invalid' && inspection.state.reason === 'future-schema'
            ? 'This Charter was written by a newer dsh-charter schema; upgrade the plugin. Diagnostic export is available, but restore is disabled.'
            : 'The target record changed; export or restore it instead',
        }
      }
      try {
        const empty = createEmptyRecord(identityOf(session), this.config)
        const requestDigest = this.initializeRequestDigest(request, lifecycle, actor)
        const receipt = this.maintenanceReceipt({
          operationId: request.operationId,
          kind: 'initialize',
          requestDigest,
          result: empty,
        })
        const next = appendMaintenanceReceipt(empty, receipt, this.config)
        assertRecoveryRecordAdmission(next, this.config)
        assertRecordConsistency(next, this.config)
        assertArchiveAdmission(buildRecordArchive({
          sessionId: session.id,
          lifecycle,
          health: 'healthy',
          revision: next.current.revision,
          record: next,
          exportedAt: Date.now(),
        }), this.config)
        await table.put(session.id, next)
        if (this.ctx.sessions.get(session.id) !== session) {
          this.fenceWrite(session.id, 'initialize')
          return {
            ok: false,
            code: 'UNAVAILABLE',
            message: 'The Session lifecycle changed while initialize was being written; the Session is fenced until restart',
            view: this.view(session),
          }
        }
        this.recordStates.set(session.id, { kind: 'healthy', recordDigest: recordDigestOf(next) })
        this.publish(session.id)
        return this.maintenanceResult(session, false)
      } catch (error) {
        if (error instanceof CharterError) return { ok: false, code: error.code, message: error.message }
        if (error instanceof DomainError && (error.code === 'closed' || error.code === 'missing-key')) {
          return { ok: false, code: 'UNAVAILABLE', message: 'Charter storage is unavailable' }
        }
        this.fenceWrite(session.id, 'initialize')
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: 'Charter write outcome is uncertain; the Session is fenced until restart',
          view: this.view(session),
        }
      }
    })
  }

  private initializeRequestDigest(
    request: CharterInitializeRequest,
    lifecycle: string,
    actor: CharterActor,
  ): `sha256:${string}` {
    return maintenanceRequestDigestOf({
      kind: 'initialize',
      sessionId: request.sessionId,
      lifecycle,
      actor,
      expectedTarget: { kind: 'absent-unconfirmed' },
    })
  }

  /**
   * Controlled restore: same Session, same lifecycle, non-healthy target only.
   */
  async restoreRecord(
    untrusted: unknown,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterRecordOperationResult> {
    const parsed = charterRestoreRequestSchema.safeParse(untrusted)
    if (!parsed.success) {
      return { ok: false, code: 'INVALID_ARGUMENT', message: 'Invalid restore request' }
    }
    const request: CharterRestoreRequest = parsed.data
    // Capability and owner are checked before any deep archive parsing.
    const gate = this.maintenanceGate(actor)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    if (!this.admissionOpen) return { ok: false, code: 'UNAVAILABLE', message: 'Charter is closing' }
    const session = this.ctx.sessions.get(SessionId(request.sessionId))
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    if (this.writeUncertain.has(session.id)) {
      return { ok: false, code: 'UNAVAILABLE', message: 'The last storage write outcome is uncertain; restart the Host' }
    }
    const lifecycle = lifecycleFingerprint(identityOf(session))
    if (request.expectedLifecycle !== lifecycle) {
      return { ok: false, code: 'LIFECYCLE_MISMATCH', message: 'The Session lifecycle changed since preview' }
    }
    try {
      assertRecoveryRequestAdmission(request, this.config)
    } catch (error) {
      if (error instanceof CharterError) return { ok: false, code: error.code, message: error.message }
      throw error
    }
    let archive
    try {
      archive = validateArchiveEnvelope(request.archive, { sessionId: request.sessionId }, this.config)
    } catch (error) {
      if (error instanceof CharterError) return { ok: false, code: error.code, message: error.message }
      throw error
    }
    const archived = charterRecordSchema.safeParse(archive.record)
    if (!archived.success) {
      return { ok: false, code: 'INVALID_ARCHIVE', message: 'Archive record does not match the record schema' }
    }
    try {
      assertRecordConsistency(archived.data, this.config)
      assertRestorableArchive(archive, archived.data, { sessionId: request.sessionId, lifecycle })
      if (!sameIdentity(archived.data, session)) {
        return { ok: false, code: 'INVALID_ARCHIVE', message: 'Archive belongs to another Session lifecycle' }
      }
      assertRecoveryRecordAdmission(archived.data, this.config)
    } catch (error) {
      if (error instanceof CharterError) return { ok: false, code: 'INVALID_ARCHIVE', message: error.message }
      throw error
    }
    return this.runMutationQueue(session, async (): Promise<CharterRecordOperationResult> => {
      if (this.ctx.sessions.get(session.id) !== session) {
        return { ok: false, code: 'LIFECYCLE_MISMATCH', message: 'The Session lifecycle changed before restore could run' }
      }
      const queuedFailure = this.queuedMaintenanceFailure(session, lifecycle, request.expectedLifecycle)
      if (queuedFailure !== undefined) return queuedFailure
      const table = this.requireTable()
      const stored = table.get(session.id)
      let targetState: CharterRecordState = stored === undefined
        ? { kind: 'absent-unconfirmed', source: 'unknown' }
        : this.inspectionOf(session, stored).state
      let targetDigest: `sha256:${string}` | undefined
      if (stored !== undefined) targetDigest = recordDigestOf(stored)
      // Existing records may confirm an earlier unknown outcome via receipt.
      if (stored !== undefined) {
        const inspection = this.inspectionOf(session, stored)
        if (inspection.record !== undefined) {
          const receipt = inspection.record.recentMaintenance?.find(entry => entry.operationId === request.operationId)
          if (receipt !== undefined) {
            const expected = this.restoreRequestDigest(request, lifecycle, actor, archive)
            return receipt.requestDigest === expected
              ? this.maintenanceResult(session, true, receipt.resultRevision)
              : { ok: false, code: 'OPERATION_ID_REUSED', message: 'This operation id names a different request' }
          }
        }
        if (inspection.state.kind === 'healthy') {
          return { ok: false, code: 'RECORD_CONFLICT', message: 'A healthy Charter record cannot be overwritten' }
        }
      }
      // Ambiguous evidence: the archive itself already contains this operation
      // id but the target has no replay receipt. Never import it blindly.
      const archivedReceipt = (archived.data.recentMaintenance ?? [])
        .find(entry => entry.operationId === request.operationId)
      if (archivedReceipt !== undefined) {
        return {
          ok: false,
          code: 'OPERATION_ID_REUSED',
          message: 'This operation id already exists inside the archive; refusing ambiguous evidence',
        }
      }
      const expected = request.expectedTarget
      const casOk = expected.kind === 'absent-unconfirmed'
        ? targetState.kind === 'absent-unconfirmed'
        : targetState.kind === 'invalid'
          && targetState.reason === expected.reason
          && targetState.recoverable
          && targetDigest === expected.recordDigest
      if (!casOk) {
        return { ok: false, code: 'RECORD_CONFLICT', message: 'The target record changed since preview' }
      }
      try {
        const requestDigest = this.restoreRequestDigest(request, lifecycle, actor, archive)
        const receipt = this.maintenanceReceipt({
          operationId: request.operationId,
          kind: 'restore',
          requestDigest,
          result: archived.data,
          sourceRecordDigest: archive.source.recordDigest as `sha256:${string}`,
        })
        const next = restoredRecord(archived.data, receipt, this.config)
        assertRecordConsistency(next, this.config)
        assertArchiveAdmission(buildRecordArchive({
          sessionId: session.id,
          lifecycle,
          health: 'healthy',
          revision: next.current.revision,
          record: next,
          exportedAt: Date.now(),
        }), this.config)
        await table.put(session.id, next)
        if (this.ctx.sessions.get(session.id) !== session) {
          this.fenceWrite(session.id, 'restore')
          return {
            ok: false,
            code: 'UNAVAILABLE',
            message: 'The Session lifecycle changed while restore was being written; the Session is fenced until restart',
            view: this.view(session),
          }
        }
        this.recordStates.set(session.id, { kind: 'healthy', recordDigest: recordDigestOf(next) })
        this.publish(session.id)
        return this.maintenanceResult(session, false)
      } catch (error) {
        if (error instanceof CharterError) return { ok: false, code: error.code, message: error.message }
        if (error instanceof DomainError && (error.code === 'closed' || error.code === 'missing-key')) {
          return { ok: false, code: 'UNAVAILABLE', message: 'Charter storage is unavailable' }
        }
        this.fenceWrite(session.id, 'restore')
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: 'Charter write outcome is uncertain; the Session is fenced until restart',
          view: this.view(session),
        }
      }
    })
  }

  private restoreRequestDigest(
    request: CharterRestoreRequest,
    lifecycle: string,
    actor: CharterActor,
    archive: { readonly source: { readonly recordDigest: string } },
  ): `sha256:${string}` {
    return maintenanceRequestDigestOf({
      kind: 'restore',
      sessionId: request.sessionId,
      lifecycle,
      actor,
      expectedTarget: request.expectedTarget,
      sourceRecordDigest: archive.source.recordDigest as `sha256:${string}`,
    })
  }

  subscribe(sessionId: SessionIdType, listener: CharterListener): () => void {
    let listeners = this.listeners.get(sessionId)
    if (listeners === undefined) {
      listeners = new Set()
      this.listeners.set(sessionId, listeners)
    }
    listeners.add(listener)
    return () => {
      // The subscription's Set may have been closed and replaced by a
      // same-id lifecycle while this generator was still unwinding. Never
      // delete the map entry unless it is still the Set this closure owns.
      const current = this.listeners.get(sessionId)
      if (current !== listeners) return
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(sessionId)
    }
  }

  /** Close existing watchers so no generator waits forever after a Session dies. */
  private closeListeners(sessionId: SessionIdType): void {
    const listeners = this.listeners.get(sessionId)
    if (listeners === undefined) return
    this.listeners.delete(sessionId)
    for (const listener of [...listeners]) {
      try {
        listener(null)
      } catch (error) {
        this.ctx.logger.warn(`charter: listener close for ${sessionId} failed: ${describeError(error)}`)
      }
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
