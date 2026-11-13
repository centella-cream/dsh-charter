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
import { queryItems, type ItemQueryRequest } from '../core/query.js'
import { changeSetPreviewDigest, planChangeSet, type PlannedChangeSet } from '../core/change-set.js'
import { sha256Json, sha256Text } from '../core/digest.js'
import { dependencyProjection } from '../core/dependencies.js'
import { buildStandingEnvelope, STANDING_TOOL_MAX_ITEMS, STANDING_TOOL_MAX_BYTES } from '../core/standing-envelope.js'
import { sourceIntegrity } from '../core/source-integrity.js'
import {
  agentProjectionDigest,
  compactionProjectionDigest,
  messageProjectionDigest,
  type SourceProjectionContext,
} from '../core/source-registry.js'
import { evaluateEvidenceIntegrity, evaluateValidators } from './validators.js'
import {
  CHARTER_RECORD_SCHEMA_VERSION,
  charterRecordSchema,
  charterRecordV1Schema,
  charterBootstrapApplyRequestSchema,
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
  legacyValidityFor,
  migrateRecordV1ToV2,
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
  CHARTER_ARCHIVE_CACHE_LIMIT,
  CHARTER_ARCHIVE_TOTAL_LIMIT,
  CHARTER_ARCHIVES_TABLE,
  CHARTER_DOMAIN_NAME,
  CHARTER_SESSIONS_TABLE,
  archiveCacheKey,
  charterArchivesDomainSpec,
  charterDomainSpec,
  type CharterArchiveCacheEntry,
} from './domain.js'
import { defineCharterProposeTool, defineCharterReadTool } from './tool.js'
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
  CharterSummary,
  CharterItemQueryResult,
  CharterProposalQueryResult,
  CharterChangeQueryResult,
  CharterChangeRow,
  CharterArchiveEntry,
  CharterArchiveListResult,
  CharterArchiveReadResult,
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
  maxProposalBatches: Schema.number().step(1).min(1).default(DEFAULT_CHARTER_CONFIG.maxProposalBatches ?? 64),
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

function stripClientContentModified(request: CharterEditRequest): CharterEditRequest {
  const stripItem = (item: import('../core/schemas.js').NewItemInput): import('../core/schemas.js').NewItemInput => {
    if (item.contentModified !== true) return item
    const { contentModified: _modified, ...rest } = item
    return rest as import('../core/schemas.js').NewItemInput
  }
  return {
    ...request,
    ops: request.ops.map(op => {
      if (op.type === 'item.add' || op.type === 'item.propose') {
        return { ...op, item: stripItem(op.item) }
      }
      if (op.type === 'item.supersede') {
        return { ...op, replacement: stripItem(op.replacement) }
      }
      return op
    }),
  }
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
  private archivesTable: KvTable<string, CharterArchiveCacheEntry> | undefined
  private archivesDomain: { close(): Promise<void> } | undefined
  /** Captures awaiting their durable put; visible to list/read immediately. */
  private readonly pendingArchives = new Map<string, CharterArchiveCacheEntry>()
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
    let parsed = charterRecordSchema.safeParse(stored)
    if (!parsed.success) {
      const legacy = charterRecordV1Schema.safeParse(stored)
      if (legacy.success) {
        parsed = { success: true, data: migrateRecordV1ToV2(legacy.data) }
      }
    }
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
    this.ctx.tools.register(defineCharterProposeTool(this))

    await Promise.all(this.ctx.agents.list().map(agent => this.initializeSessionSafely(agent.session, 'reattach')))
  }

  private async openDomain(): Promise<void> {
    try {
      const domain = await this.ctx.storageDomain.open(charterDomainSpec)
      const rawTable = domain.table(CHARTER_SESSIONS_TABLE) as unknown as KvTable<SessionIdType, unknown>
      this.sessionsTable = rawTable as unknown as KvTable<SessionIdType, CharterRecord>
      try {
        const archives = await this.ctx.storageDomain.open(charterArchivesDomainSpec)
        this.archivesDomain = archives
        this.archivesTable = archives.table(CHARTER_ARCHIVES_TABLE) as unknown as KvTable<string, CharterArchiveCacheEntry>
      } catch (error) {
        this.ctx.logger.warn(`charter: archive cache is unavailable: ${describeError(error)}`)
      }
      for (const [id, stored] of rawTable.entries()) {
        let parsed = charterRecordSchema.safeParse(stored)
        if (!parsed.success) {
          const legacy = charterRecordV1Schema.safeParse(stored)
          if (legacy.success) parsed = { success: true, data: migrateRecordV1ToV2(legacy.data) }
        }
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
        const archivesDomain = this.archivesDomain
        this.archivesTable = undefined
        this.archivesDomain = undefined
        await domain.close()
        await archivesDomain?.close()
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
      if (inspection.state.kind === 'healthy' && inspection.record !== undefined) {
        void this.captureArchive(session, inspection.record)
      }
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
        void this.captureArchive(session, record)
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
    const proposal = {
      ...extraction.draft,
      source: extraction.source,
    }
    return {
      available: true,
      proposal: {
        ...proposal,
        draftHandle: this.bootstrapDraftHandle(proposal),
      },
    }
  }

  private bootstrapDraftHandle(proposal: import('./types.js').CharterBootstrapProposal): string {
    return sha256Json({
      version: 1,
      source: proposal.source,
      draft: {
        objective: proposal.objective,
        invariants: proposal.invariants,
        deliverables: proposal.deliverables,
      },
    })
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
    let parsed = charterRecordSchema.safeParse(stored)
    if (!parsed.success) {
      const legacy = charterRecordV1Schema.safeParse(stored)
      if (legacy.success) parsed = { success: true, data: migrateRecordV1ToV2(legacy.data) }
    }
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
      items: parsed.data.current.items.map(item => ({ ...item, validity: legacyValidityFor(item) })),
      promptText: parsed.data.current.promptText,
      promptDigest: parsed.data.current.promptDigest,
      limits,
      overBudget: isRecordOverBudget(parsed.data, this.config),
      lifecycle: lifecycleFingerprint(parsed.data.identity),
      recordState: { kind: 'healthy', recordDigest: digest },
      capabilities,
      ...(parsed.data.proposalBatches === undefined ? {} : { proposalBatches: [...parsed.data.proposalBatches] }),
      ...(parsed.data.objectiveProposals === undefined ? {} : { objectiveProposals: [...parsed.data.objectiveProposals] }),
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
      items: record.current.items.map(item => ({ ...item, validity: legacyValidityFor(item) })),
      promptText: record.current.promptText,
      promptDigest: record.current.promptDigest,
      limits,
      overBudget: isRecordOverBudget(record, this.config),
      lifecycle,
      recordState: state,
      capabilities,
      ...(record.proposalBatches === undefined ? {} : { proposalBatches: [...record.proposalBatches] }),
      ...(record.objectiveProposals === undefined ? {} : { objectiveProposals: [...record.objectiveProposals] }),
    }
  }

  summaryById(sessionId: SessionIdType): CharterSummary {
    const view = this.viewById(sessionId)
    return {
      sessionId,
      revision: view.revision,
      objective: view.objective,
      limits: view.limits,
      promptText: view.promptText,
      promptDigest: view.promptDigest,
      hasObjective: view.objective !== null,
      activeItems: view.items.filter(item => item.review === 'accepted' && item.lifecycle === 'current').length,
      pendingItems: view.items.filter(item => item.review === 'pending').length
        + (view.objectiveProposals ?? []).filter(proposal => proposal.review === 'pending').length,
      historyItems: view.items.filter(item => item.review !== 'pending' && item.lifecycle !== 'current').length
        + view.items.filter(item => item.review === 'rejected').length,
      pendingBatches: (view.proposalBatches ?? []).filter(batch => {
        const pendingIds = new Set([
          ...view.items.filter(item => item.review === 'pending').map(item => item.id),
          ...(view.objectiveProposals ?? []).filter(proposal => proposal.review === 'pending').map(proposal => proposal.id),
        ])
        return batch.candidates.some(candidate => candidate.kind !== 'tombstone' && pendingIds.has(candidate.id))
      }).length,
      promptBytes: new TextEncoder().encode(view.promptText).byteLength,
      overBudget: view.overBudget,
      status: view.status,
      ...(view.lifecycle === undefined ? {} : { lifecycle: view.lifecycle }),
      ...(view.recordState === undefined ? {} : { recordState: view.recordState }),
      ...(view.message === undefined ? {} : { message: view.message }),
      recordHealth: view.recordState?.kind === 'healthy'
        ? 'healthy'
        : view.recordState?.kind === 'absent-unconfirmed'
          ? 'absent'
          : view.recordState?.kind === 'write-uncertain'
            ? 'write-uncertain'
            : view.recordState?.kind === 'invalid'
              ? 'invalid'
              : 'unknown',
      capabilities: view.capabilities ?? { recordMaintenance: false },
    }
  }

  queryChangesById(
    sessionId: SessionIdType,
    request: import('./types.js').CharterChangeQueryRequest = {},
  ): CharterChangeQueryResult {
    const limit = request.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, code: 'LIMIT_EXCEEDED', message: 'limit must be between 1 and 100' }
    }
    let record: CharterRecord | undefined
    const session = this.ctx.sessions.get(sessionId)
    if (session !== undefined) record = this.recordFor(session)
    else {
      const stored = this.sessionsTable?.get(sessionId)
      if (stored !== undefined) {
        const parsed = charterRecordSchema.safeParse(stored)
        if (parsed.success) record = parsed.data
        else {
          const legacy = charterRecordV1Schema.safeParse(stored)
          if (legacy.success) record = migrateRecordV1ToV2(legacy.data)
        }
      }
    }
    if (record === undefined) {
      return { ok: false, code: 'UNAVAILABLE', message: 'Charter record is not readable' }
    }
    const filterDigest = sha256Json({
      version: 1,
      queryKind: 'changes',
      changeSetId: request.changeSetId ?? null,
      operationKind: request.operationKind ?? null,
      itemId: request.itemId ?? null,
      proposalId: request.proposalId ?? null,
    })
    const matches = (receipt: CharterRecord['history'][number]): boolean => {
      if (request.changeSetId !== undefined && receipt.mutationId !== request.changeSetId) return false
      return receipt.changes.some(change => {
        if (request.operationKind !== undefined && change.type !== request.operationKind) return false
        if (request.itemId !== undefined && !('itemId' in change && change.itemId === request.itemId)) return false
        if (request.proposalId !== undefined
          && !('proposalId' in change && change.proposalId === request.proposalId)) return false
        return true
      })
    }
    let after = 0
    if (request.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')) as {
          readonly v?: unknown
          readonly kind?: unknown
          readonly revision?: unknown
          readonly after?: unknown
          readonly filterDigest?: unknown
        }
        if (parsed.v !== 1 || parsed.kind !== 'changes' || !Number.isSafeInteger(parsed.revision)
          || !Number.isSafeInteger(parsed.after)) {
          throw new Error('invalid cursor')
        }
        if (parsed.revision !== record.current.revision) {
          return { ok: false, code: 'STALE_REVISION', message: 'change cursor was created for another revision' }
        }
        if (parsed.filterDigest !== filterDigest) throw new Error('filter mismatch')
        after = parsed.after as number
      } catch {
        return { ok: false, code: 'INVALID_CURSOR', message: 'invalid change query cursor' }
      }
    }
    const candidates = record.history.filter(receipt => receipt.revision > after && matches(receipt))
    const maxResponseBytes = 256 * 1_024
    const rows: CharterChangeRow[] = []
    for (const receipt of candidates.slice(0, limit)) {
      const row: CharterChangeRow = {
        mutationId: receipt.mutationId,
        revision: receipt.revision,
        baseRevision: receipt.baseRevision,
        actor: receipt.actor,
        at: receipt.at,
        changes: [...receipt.changes],
      }
      const candidate = [...rows, row]
      if (Buffer.byteLength(JSON.stringify({ revision: record.current.revision, changes: candidate }), 'utf8') > maxResponseBytes) {
        if (rows.length === 0) {
          return { ok: false, code: 'LIMIT_EXCEEDED', message: 'one change receipt exceeds the query response byte cap' }
        }
        break
      }
      rows.push(row)
    }
    const last = rows[rows.length - 1]
    const hasMore = candidates.some(receipt => last === undefined || receipt.revision > last.revision)
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({
          v: 1,
          kind: 'changes',
          revision: record.current.revision,
          after: last!.revision,
          filterDigest,
        }), 'utf8').toString('base64url')
      : undefined
    return {
      ok: true,
      revision: record.current.revision,
      changes: rows,
      filterDigest,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

  private isQueryableView(view: CharterView): boolean {
    return view.status === 'ready'
      || (view.status === 'unavailable'
        && view.lifecycle !== undefined
        && view.recordState?.kind === 'healthy')
  }

  queryProposalsById(
    sessionId: SessionIdType,
    request: import('./types.js').CharterProposalQueryRequest = {},
  ): CharterProposalQueryResult {
    const limit = request.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
      return { ok: false, code: 'LIMIT_EXCEEDED', message: 'limit must be between 1 and 64' }
    }
    const view = this.viewById(sessionId)
    if (!this.isQueryableView(view)) {
      return { ok: false, code: 'UNAVAILABLE', message: 'Charter is not ready for proposal queries' }
    }
    const filterDigest = sha256Json({
      version: 1,
      queryKind: 'proposals',
      sourceKind: request.sourceKind ?? null,
      review: request.review ?? null,
      batchId: request.batchId ?? null,
      candidateKind: request.candidateKind ?? null,
    })
    const itemById = new Map(view.items.map(item => [item.id, item]))
    const objectiveById = new Map((view.objectiveProposals ?? []).map(proposal => [proposal.id, proposal]))
    const reviewOf = (candidate: import('./types.js').CharterProposalBatchView['candidates'][number]): string | undefined => {
      if (candidate.kind === 'tombstone') return candidate.disposition
      if (candidate.kind === 'item') return itemById.get(candidate.id)?.review
      return objectiveById.get(candidate.id)?.review
    }
    const candidateKindOf = (candidate: import('./types.js').CharterProposalBatchView['candidates'][number]): string =>
      candidate.kind === 'tombstone' ? candidate.candidateKind ?? 'item' : candidate.kind
    const filtered = (view.proposalBatches ?? []).filter(batch =>
      (request.sourceKind === undefined || batch.source.kind === request.sourceKind)
      && (request.batchId === undefined || batch.id === request.batchId)
      && (request.candidateKind === undefined
        || batch.candidates.some(candidate => candidateKindOf(candidate) === request.candidateKind))
      && (request.review === undefined
        || batch.candidates.some(candidate => reviewOf(candidate) === request.review)))
    let start = 0
    if (request.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')) as {
          readonly v?: unknown
          readonly revision?: unknown
          readonly offset?: unknown
          readonly filterDigest?: unknown
        }
        if (parsed.v !== 1 || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) {
          throw new Error('cursor shape')
        }
        if (parsed.revision !== view.revision) {
          return { ok: false, code: 'STALE_REVISION', message: 'proposal cursor was created for another revision' }
        }
        if (parsed.filterDigest !== filterDigest) {
          throw new Error('cursor filter')
        }
        start = parsed.offset as number
      } catch {
        return { ok: false, code: 'INVALID_CURSOR', message: 'invalid proposal query cursor' }
      }
    }
    const session = this.ctx.sessions.get(sessionId)
    const shared = this.sourceProjectionShared(session, filtered)
    const mapped = filtered.slice(start, start + limit).map(batch => ({
      id: batch.id,
      source: batch.source,
      sourceIntegrity: sourceIntegrity(batch.source, this.proposalSourceContext(view, batch, shared)),
      capturedAtRevision: batch.capturedAtRevision,
      candidates: batch.candidates.map(candidate => {
        if (candidate.kind === 'tombstone') {
          return {
            kind: candidate.kind,
            id: candidate.id,
            candidateKind: candidate.candidateKind,
            disposition: candidate.disposition,
            atRevision: candidate.atRevision,
          }
        }
        if (candidate.kind === 'item') {
          const item = itemById.get(candidate.id)
          return {
            kind: candidate.kind,
            id: candidate.id,
            ...(item === undefined ? {} : { text: item.text, review: item.review }),
          }
        }
        const proposal = objectiveById.get(candidate.id)
        return {
          kind: candidate.kind,
          id: candidate.id,
          ...(proposal === undefined ? {} : { text: proposal.text, review: proposal.review }),
        }
      }),
    }))
    const maxResponseBytes = 256 * 1_024
    const batches: import('./types.js').CharterProposalBatchView[] = []
    for (const batch of mapped) {
      const candidate = [...batches, batch]
      if (Buffer.byteLength(JSON.stringify({ revision: view.revision, batches: candidate }), 'utf8') > maxResponseBytes) {
        if (batches.length === 0) {
          return { ok: false, code: 'LIMIT_EXCEEDED', message: 'one proposal batch exceeds the query response byte cap' }
        }
        break
      }
      batches.push(batch)
    }
    const nextOffset = start + batches.length
    const nextCursor = nextOffset < filtered.length
      ? Buffer.from(JSON.stringify({
          v: 1,
          revision: view.revision,
          offset: nextOffset,
          filterDigest,
        }), 'utf8').toString('base64url')
      : undefined
    const allObjectives = (view.objectiveProposals ?? [])
      .filter(proposal => request.review === undefined || proposal.review === request.review)
    let objectiveStart = 0
    if (request.objectiveCursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(request.objectiveCursor, 'base64url').toString('utf8')) as {
          readonly v?: unknown
          readonly revision?: unknown
          readonly offset?: unknown
          readonly filterDigest?: unknown
        }
        if (parsed.v !== 1 || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) {
          throw new Error('cursor shape')
        }
        if (parsed.revision !== view.revision) {
          return { ok: false, code: 'STALE_REVISION', message: 'objective proposal cursor was created for another revision' }
        }
        if (parsed.filterDigest !== filterDigest) throw new Error('cursor filter')
        objectiveStart = parsed.offset as number
      } catch {
        return { ok: false, code: 'INVALID_CURSOR', message: 'invalid objective proposal cursor' }
      }
    }
    const objectivePage: typeof allObjectives = []
    for (const proposal of allObjectives.slice(objectiveStart, objectiveStart + limit)) {
      const candidate = [...objectivePage, proposal]
      if (Buffer.byteLength(JSON.stringify({ revision: view.revision, objectiveProposals: candidate }), 'utf8')
        > maxResponseBytes) {
        if (objectivePage.length === 0) {
          return { ok: false, code: 'LIMIT_EXCEEDED', message: 'one objective proposal exceeds the query response byte cap' }
        }
        break
      }
      objectivePage.push(proposal)
    }
    const objectiveNext = objectiveStart + objectivePage.length
    const nextObjectiveCursor = objectiveNext < allObjectives.length
      ? Buffer.from(JSON.stringify({
          v: 1,
          revision: view.revision,
          offset: objectiveNext,
          filterDigest,
        }), 'utf8').toString('base64url')
      : undefined
    return {
      ok: true,
      revision: view.revision,
      batches,
      objectiveProposals: objectivePage,
      filterDigest,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      ...(nextObjectiveCursor === undefined ? {} : { nextObjectiveCursor }),
    }
  }

  queryItemsById(sessionId: SessionIdType, request: ItemQueryRequest): CharterItemQueryResult {
    const view = this.viewById(sessionId)
    if (!this.isQueryableView(view) || view.lifecycle === undefined) {
      return { ok: false, code: 'UNAVAILABLE', message: 'Charter is not ready for query', revision: view.revision }
    }
    const sourceKindById = new Map<string, string>()
    const batchIdById = new Map<string, string>()
    for (const batch of view.proposalBatches ?? []) {
      for (const candidate of batch.candidates) {
        if (candidate.kind === 'item') {
          sourceKindById.set(candidate.id, batch.source.kind)
          batchIdById.set(candidate.id, batch.id)
        }
      }
    }
    const dependency = dependencyProjection(view.items)
    const executionById = new Map(dependency.map(row => [row.id, row.executionDisplay]))
    const prerequisiteById = new Map(dependency.map(row => [row.id, row.prerequisiteStatus]))
    return queryItems(
      view.revision,
      view.lifecycle,
      view.items,
      request,
      sourceKindById,
      batchIdById,
      executionById,
      prerequisiteById,
    )
  }

  promptText(session: Session): string {
    if (this.writeUncertain.has(session.id)) return ''
    const view = this.view(session)
    // Never inject a charter that exceeds the current budget configuration;
    // the UI exposes the over-budget state so the user can trim it down.
    return view.status === 'ready' && !view.overBudget ? view.promptText : ''
  }

  readForModel(
    session: Session,
    mode: 'standing' | 'all',
    options: { readonly cursor?: string; readonly limit?: number } = {},
  ): CharterToolView {
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
      // `standing` is the model's working set; use the same pure builder as the
      // Diagnostics envelope estimate so bytes and field order cannot drift.
      const standing = buildStandingEnvelope(record.current.items, record.current.revision, objective)
      if (standing.itemCount > STANDING_TOOL_MAX_ITEMS || standing.bytes > STANDING_TOOL_MAX_BYTES) {
        throw charterError(
          'LIMIT_EXCEEDED',
          `standing charter exceeds the ${STANDING_TOOL_MAX_ITEMS}-item/${STANDING_TOOL_MAX_BYTES}-byte tool envelope; `
          + 'no partial standing view is returned',
        )
      }
      return standing.view
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
    const dependencyRows = dependencyProjection(record.current.items)
    const dependencyById = new Map(dependencyRows.map(row => [row.id, row]))
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
      ...(item.kind === 'deliverable'
        ? {
            key: dependencyById.get(item.id)?.localKey ?? null,
            requires: dependencyById.get(item.id)?.requires ?? [],
          }
        : {}),
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
    const requestedLimit = options.limit ?? maxItems
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > maxItems) {
      throw charterError('LIMIT_EXCEEDED', `charter_read limit must be between 1 and ${maxItems}`)
    }
    let start = 0
    if (options.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as {
          readonly v?: unknown
          readonly offset?: unknown
          readonly revision?: unknown
        }
        if (parsed.v !== 1 || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) {
          throw new Error('cursor shape')
        }
        if (parsed.revision !== record.current.revision) {
          throw charterError('STALE_REVISION', 'charter_read cursor was created for another revision')
        }
        start = parsed.offset as number
      } catch (error) {
        if (error instanceof CharterError) throw error
        throw charterError('INVALID_CURSOR', 'invalid charter_read cursor')
      }
    }
    const page: CharterToolItem[] = []
    let cursorAfter = start
    for (const item of relevant.slice(start)) {
      const candidate = [...page, toToolItem(item)]
      if (candidate.length > requestedLimit || envelopeBytes(candidate) > maxEnvelopeBytes) break
      page.push(candidate.at(-1)!)
      cursorAfter += 1
    }
    if (page.length === 0 && start < relevant.length) {
      throw charterError('LIMIT_EXCEEDED', 'one charter item does not fit the charter_read envelope')
    }
    const nextCursor = cursorAfter < relevant.length
      ? Buffer.from(JSON.stringify({ v: 1, revision: record.current.revision, offset: cursorAfter }), 'utf8').toString('base64url')
      : undefined
    return {
      revision: record.current.revision,
      objective: boundedObjective,
      items: page,
      truncated: Math.max(0, relevant.length - (start + page.length)),
      ...(objectiveTruncated ? { objectiveTruncated: true } : {}),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

  /** Host-only source for a bootstrap apply; callers cannot provide provenance. */
  bootstrapProposalSource(sessionId: SessionIdType): import('../core/schemas.js').ProposalSource | undefined {
    const result = this.bootstrap(sessionId)
    if (!result.available) return undefined
    return {
      kind: 'compaction-summary',
      summarySeq: result.proposal.source.summarySeq,
      at: result.proposal.source.at,
      sessionId: sessionId as string,
      projectionVersion: 1,
      digest: compactionProjectionDigest({
        sessionId: sessionId as string,
        summarySeq: result.proposal.source.summarySeq,
        projectionVersion: 1,
      }, result.proposal),
    }
  }

  async applyBootstrap(
    request: unknown,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterEditResult> {
    const parsedRequest = charterBootstrapApplyRequestSchema.safeParse(request)
    if (!parsedRequest.success) {
      return unavailableResult('INVALID_ARGUMENT', 'invalid bootstrap apply request')
    }
    let normalized: CharterEditRequest
    try {
      normalized = normalizeEditRequest({
        sessionId: parsedRequest.data.sessionId,
        mutationId: parsedRequest.data.mutationId,
        baseRevision: parsedRequest.data.baseRevision,
        ops: parsedRequest.data.ops,
      })
    } catch (error) {
      return unavailableResult(error instanceof CharterError ? error.code : 'INVALID_ARGUMENT',
        error instanceof Error ? error.message : String(error))
    }
    const extraction = this.bootstrap(normalized.sessionId as SessionIdType)
    if (!extraction.available) {
      return unavailableResult('INVALID_ARGUMENT', 'No reviewable compaction draft is available for this Session')
    }
    if (parsedRequest.data.draftHandle !== this.bootstrapDraftHandle(extraction.proposal)) {
      return unavailableResult('INVALID_ARGUMENT', 'bootstrap draft handle does not match the current extraction')
    }
    const allowedKinds = new Map<string, Set<'invariant' | 'deliverable'>>()
    const addAllowed = (text: string, kind: 'invariant' | 'deliverable'): void => {
      const kinds = allowedKinds.get(text) ?? new Set()
      kinds.add(kind)
      allowedKinds.set(text, kinds)
    }
    for (const text of extraction.proposal.invariants) addAllowed(text, 'invariant')
    for (const text of extraction.proposal.deliverables) addAllowed(text, 'deliverable')
    const stripModified = (item: import('../core/schemas.js').NewItemInput): import('../core/schemas.js').NewItemInput => {
      const { contentModified: _modified, ...rest } = item
      return rest as import('../core/schemas.js').NewItemInput
    }
    const withModified = (
      item: import('../core/schemas.js').NewItemInput,
      modified: boolean,
    ): import('../core/schemas.js').NewItemInput => modified
      ? { ...stripModified(item), contentModified: true }
      : stripModified(item)
    const ops: import('../core/schemas.js').CharterOp[] = []
    for (const op of normalized.ops) {
      if (op.type === 'objective.propose') {
        return unavailableResult('INVALID_ARGUMENT', 'bootstrap apply cannot create objective proposals')
      }
      if (op.type === 'objective.initialize') {
        if (extraction.proposal.objective === null || op.text !== extraction.proposal.objective) {
          return unavailableResult('INVALID_ARGUMENT', 'bootstrap objective.initialize must match the reviewed extraction')
        }
        ops.push(op)
        continue
      }
      if (op.type === 'objective.redirect') {
        return unavailableResult('INVALID_ARGUMENT', 'bootstrap apply cannot redirect an objective')
      }
      if (op.type === 'item.add') {
        const activeRef = /^bootstrap-(inv|del)-(\d+)$/u.exec(op.item.clientRef)
        if (activeRef === null) {
          return unavailableResult('INVALID_ARGUMENT', 'bootstrap active item must reference the reviewed extraction')
        }
        const expectedKind = activeRef[1] === 'inv' ? 'invariant' : 'deliverable'
        const index = Number(activeRef[2])
        const candidates = expectedKind === 'invariant'
          ? extraction.proposal.invariants
          : extraction.proposal.deliverables
        if (op.item.kind !== expectedKind || !Number.isSafeInteger(index) || index < 0 || index >= candidates.length) {
          return unavailableResult('INVALID_ARGUMENT', 'bootstrap active candidate reference is invalid')
        }
        ops.push({ ...op, item: withModified(op.item, op.item.text !== candidates[index]) })
        continue
      }
      if (op.type !== 'item.propose') {
        ops.push(op.type === 'item.supersede'
          ? { ...op, replacement: stripModified(op.replacement) }
          : op)
        continue
      }
      const candidateRef = /^bootstrap-(inv|del)-(\d+)$/u.exec(op.item.clientRef)
      if (candidateRef !== null) {
        const expectedKind = candidateRef[1] === 'inv' ? 'invariant' : 'deliverable'
        const index = Number(candidateRef[2])
        const candidates = expectedKind === 'invariant'
          ? extraction.proposal.invariants
          : extraction.proposal.deliverables
        if (op.item.kind !== expectedKind || !Number.isSafeInteger(index) || index < 0 || index >= candidates.length) {
          return unavailableResult('INVALID_ARGUMENT', 'bootstrap proposal candidate reference is invalid')
        }
        // The reviewed candidate may be edited; provenance remains the extraction.
        ops.push({ ...op, item: withModified(op.item, op.item.text !== candidates[index]) })
        continue
      }
      const kinds = allowedKinds.get(op.item.text)
      if (kinds === undefined || !kinds.has(op.item.kind)) {
        return unavailableResult(
          'INVALID_ARGUMENT',
          'bootstrap proposal does not match the reviewed extraction',
        )
      }
      ops.push({ ...op, item: stripModified(op.item) })
    }
    const sourceDigest = compactionProjectionDigest({
      sessionId: normalized.sessionId,
      summarySeq: extraction.proposal.source.summarySeq,
      projectionVersion: 1,
    }, extraction.proposal)
    const applyRequest = { ...normalized, ops }
    return this.edit(applyRequest, actor, {
      kind: 'compaction-summary',
      summarySeq: extraction.proposal.source.summarySeq,
      at: extraction.proposal.source.at,
      sessionId: normalized.sessionId,
      projectionVersion: 1,
      digest: compactionProjectionDigest({
        sessionId: normalized.sessionId,
        summarySeq: extraction.proposal.source.summarySeq,
        projectionVersion: 1,
      }, extraction.proposal),
    }, { allowContentModified: true, dedupeSourceDigest: sourceDigest })
  }

  previewChangeSet(
    untrustedRequest: unknown,
    actor: CharterActor = { kind: 'owner' },
  ): import('./types.js').CharterChangeSetPreviewResult {
    let request: CharterEditRequest
    try {
      request = normalizeEditRequest(untrustedRequest)
    } catch (error) {
      return { ok: false, code: error instanceof CharterError ? error.code : 'INVALID_ARGUMENT', message: describeError(error) }
    }
    try {
      assertEditAuthorized(actor, request.ops)
    } catch (error) {
      return { ok: false, code: error instanceof CharterError ? error.code : 'FORBIDDEN', message: describeError(error) }
    }
    const session = this.ctx.sessions.get(SessionId(request.sessionId))
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    this.ensureLazy(session)
    const record = this.recordFor(session)
    if (record === undefined) return { ok: false, code: 'UNAVAILABLE', message: 'Charter record is not readable' }
    if (request.baseRevision !== record.current.revision) {
      return { ok: false, code: 'REVISION_CONFLICT', message: `current revision is ${record.current.revision}` }
    }
    try {
      const ids = Object.fromEntries(clientRefsOf(request.ops).map(ref => [ref, ref]))
      const planned = planChangeSet({
        snapshot: record.current,
        ops: request.ops,
        ids,
        nextRevision: record.current.revision + 1,
        limits: this.config,
        ...(record.objectiveProposals === undefined ? {} : { objectiveProposals: record.objectiveProposals }),
      })
      return {
        ok: true,
        previewDigest: changeSetPreviewDigest(request, record.current.stateDigest),
        before: planned.before,
        after: planned.after,
        changes: [...planned.changes],
        promptChanged: planned.promptChanged,
        metadataOnly: planned.metadataOnly,
        dependencyConflicts: planned.dependencyConflicts,
      }
    } catch (error) {
      return { ok: false, code: error instanceof CharterError ? error.code : 'INVALID_CHANGE_SET', message: describeError(error) }
    }
  }

  private dedupeBootstrapRequest(
    record: CharterRecord,
    request: CharterEditRequest,
    sourceDigest: string,
  ): CharterEditRequest {
    const batchItemIds = new Set((record.proposalBatches ?? [])
      .filter(batch => batch.source.kind === 'compaction-summary' && batch.source.digest === sourceDigest)
      .flatMap(batch => batch.candidates.flatMap(candidate =>
        candidate.kind === 'item' ? [candidate.id] : [])))
    const existingKeys = new Set(record.current.items
      .filter(item => batchItemIds.has(item.id))
      .map(item => `${item.kind}:${item.text}`))
    const ops = request.ops.filter(op =>
      (op.type !== 'item.propose' && op.type !== 'item.add')
      || !existingKeys.has(`${op.item.kind}:${op.item.text}`))
    return ops.length === request.ops.length ? request : { ...request, ops }
  }

  private sourceProjectionShared(
    session: Session | undefined,
    batches: readonly NonNullable<CharterView['proposalBatches']>[number][],
  ): {
    readonly events?: SourceProjectionContext['events']
    readonly bootstrap?: import('./types.js').CharterBootstrapResult
  } {
    if (session === undefined) return {}
    return {
      ...(batches.some(batch => batch.source.kind === 'message')
        ? {
            events: readSessionEvents(session).map(event => ({
              seq: event.seq,
              type: event.type,
              data: event.data,
            })),
          }
        : {}),
      ...(batches.some(batch => batch.source.kind === 'compaction-summary')
        ? { bootstrap: this.bootstrap(session.id) }
        : {}),
    }
  }

  private proposalSourceContext(
    view: CharterView,
    batch: NonNullable<CharterView['proposalBatches']>[number],
    shared: ReturnType<CharterService['sourceProjectionShared']>,
  ): SourceProjectionContext {
    const candidates = batch.candidates.flatMap(candidate => {
      if (candidate.kind === 'tombstone') return []
      const item = view.items.find(entry => entry.id === candidate.id)
      const proposal = (view.objectiveProposals ?? []).find(entry => entry.id === candidate.id)
      const text = item?.text ?? proposal?.text
      if (text === undefined) return []
      return [{
        kind: candidate.kind === 'item' ? 'item' as const : 'objective' as const,
        text,
      }]
    })
    return {
      ...(shared.events === undefined ? {} : { events: shared.events }),
      candidates,
      ...(batch.source.kind === 'compaction-summary' && shared.bootstrap?.available
        && shared.bootstrap.proposal.source.summarySeq === batch.source.summarySeq
        ? { compaction: shared.bootstrap.proposal }
        : {}),
    }
  }

  async sourceIntegrityById(
    sessionId: SessionIdType,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<import('./types.js').CharterSourceIntegrityResult> {
    if (actor.kind !== 'owner' && actor.kind !== 'user') {
      return { ok: false, code: 'FORBIDDEN', message: 'source integrity requires a human actor' }
    }
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    this.ensureLazy(session)
    const view = this.view(session)
    if (view.status !== 'ready') return { ok: false, code: 'UNAVAILABLE', message: 'Charter is not readable' }
    const items: { itemId: string; integrity: import('./validators.js').EvidenceIntegrity }[] = []
    let evidenceChecks = 0
    let truncated = false
    const integrityDeadline = Date.now() + 5_000
    for (const item of view.items) {
      if (item.evidence === undefined || item.evidence.length === 0) continue
      if (evidenceChecks >= 16 || Date.now() > integrityDeadline) {
        truncated = true
        break
      }
      let integrity: import('./validators.js').EvidenceIntegrity = 'not-applicable'
      const evidenceToCheck = item.evidence.slice(0, 4)
      if (item.evidence.length > evidenceToCheck.length) truncated = true
      for (const evidence of evidenceToCheck) {
        if (evidenceChecks >= 16) {
          truncated = true
          break
        }
        evidenceChecks += 1
        const next = await evaluateEvidenceIntegrity({ root: identityOf(session).cwd, evidence })
        integrity = next !== 'intact' ? next : integrity === 'not-applicable' ? 'intact' : integrity
      }
      items.push({ itemId: item.id, integrity })
    }
    const shared = this.sourceProjectionShared(session, view.proposalBatches ?? [])
    const batches = (view.proposalBatches ?? []).map(batch => ({
      batchId: batch.id,
      integrity: sourceIntegrity(batch.source, this.proposalSourceContext(view, batch, shared)),
    }))
    return { ok: true, revision: view.revision, items, batches, ...(truncated ? { truncated: true } : {}) }
  }

  async runValidators(
    sessionId: SessionIdType,
    requests: readonly import('./types.js').CharterValidatorRequest[],
    actor: CharterActor = { kind: 'owner' },
  ): Promise<import('./types.js').CharterValidatorRunResult> {
    if (actor.kind !== 'owner') {
      return { ok: false, code: 'FORBIDDEN', message: 'validators require an owner actor' }
    }
    if (requests.length === 0 || requests.length > 32) {
      return { ok: false, code: 'INVALID_ARGUMENT', message: 'validator run needs between 1 and 32 requests' }
    }
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    this.ensureLazy(session)
    const view = this.view(session)
    if (view.status !== 'ready') {
      return { ok: false, code: 'UNAVAILABLE', message: 'Charter is not editable in its current state' }
    }
    const itemById = new Map(view.items.map(item => [item.id, item]))
    for (const request of requests) {
      const item = itemById.get(request.itemId)
      if (item === undefined || item.review !== 'accepted' || item.lifecycle !== 'current') {
        return { ok: false, code: 'INVALID_TRANSITION', message: `item ${request.itemId} is not an active accepted item` }
      }
      if (request.validator.kind === 'workspace.file-digest'
        && (request.validator.expectedDigest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(request.validator.expectedDigest))) {
        return { ok: false, code: 'INVALID_ARGUMENT', message: 'file-digest requires a sha256 digest' }
      }
      if (request.validator.kind === 'workspace.file-contains' && (request.validator.contains ?? '').length === 0) {
        return { ok: false, code: 'INVALID_ARGUMENT', message: 'file-contains requires a non-empty search string' }
      }
    }
    let evaluations: readonly import('./validators.js').ValidatorEvaluation[]
    try {
      evaluations = await evaluateValidators({
        root: identityOf(session).cwd,
        revision: view.revision,
        requests,
        itemText: itemId => itemById.get(itemId)?.text,
      })
    } catch (error) {
      return { ok: false, code: 'INVALID_ARGUMENT', message: describeError(error) }
    }
    const mutationId = `validators-${sha256Json({ version: 1, sessionId: sessionId as string, baseRevision: view.revision, requests }).slice(7, 39)}`
    const edit = await this.edit({
      sessionId: session.id,
      mutationId,
      baseRevision: view.revision,
      ops: evaluations.map(evaluation => ({
        type: 'item.validity.set' as const,
        itemId: evaluation.itemId,
        validity: evaluation.validity,
        ...(evaluation.evidence === undefined ? {} : { evidence: [evaluation.evidence] }),
      })),
    }, { kind: 'host' })
    if (!edit.ok) return { ok: false, code: edit.code, message: edit.message ?? 'validator write failed' }
    return { ok: true, revision: edit.committedRevision, results: evaluations.map(evaluation => evaluation.validity) }
  }

  messageCandidates(sessionId: SessionIdType): import('./types.js').CharterMessageListResult {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    const messages: import('./types.js').CharterMessageCandidate[] = []
    for (const event of readSessionEvents(session)) {
      if (event.type !== 'user/message') continue
      const data = event.data as { source?: { kind?: string }; content?: readonly { type?: string; text?: string }[] }
      if (data.source?.kind !== 'user') continue
      const text = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
        .trim()
      if (text.length === 0) continue
      const messageProjectionLimit = 8_192
      const clipped = text.length > messageProjectionLimit
      messages.push({
        seq: event.seq,
        role: 'user',
        excerpt: text.length > 160 ? `${text.slice(0, 157)}...` : text,
        text: clipped ? text.slice(0, messageProjectionLimit) : text,
        ...(clipped ? { truncated: true } : {}),
        length: text.length,
      })
    }
    return { ok: true, messages: messages.slice(-20) }
  }

  async proposeFromLatestMessage(
    session: Session,
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterEditResult> {
    return this.proposeFromMessage(session, {}, actor)
  }

  async proposeFromMessage(
    session: Session,
    options: import('./types.js').CharterMessageProposalOptions = {},
    actor: CharterActor = { kind: 'owner' },
  ): Promise<CharterEditResult> {
    const events = readSessionEvents(session)
    let selected: { seq: number; text: string; leading: number } | undefined
    for (const event of events) {
      if (event.type !== 'user/message') continue
      if (options.seq !== undefined && event.seq !== options.seq) continue
      const data = event.data as { source?: { kind?: string }; content?: readonly { type?: string; text?: string }[] }
      if (data.source?.kind !== 'user') continue
      const raw = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      const text = raw.trim()
      if (text.length > 0) selected = { seq: event.seq, text, leading: raw.indexOf(text) }
    }
    if (selected === undefined) {
      return unavailableResult('NOT_FOUND', 'No matching user message is available to save as a proposal')
    }
    const start = options.start ?? 0
    const end = options.end ?? selected.text.length
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end < start || end > selected.text.length) {
      return unavailableResult('INVALID_ARGUMENT', 'message selection is outside the selected message')
    }
    const selectedText = selected.text.slice(start, end).trim()
    const override = options.text === undefined ? undefined : options.text.trim()
    const text = override ?? selectedText
    if (text.length === 0) return unavailableResult('INVALID_ARGUMENT', 'message selection is empty')
    const edited = override !== undefined && override !== selectedText
    const view = this.view(session)
    if (view.status !== 'ready') {
      return unavailableResult('UNAVAILABLE', 'Charter is not editable in its current state')
    }
    const selection = start === 0 && end === selected.text.length
      ? undefined
      : { start: selected.leading + start, end: selected.leading + end }
    const manualActor = actor.kind === 'owner' ? 'owner' as const : actor.kind === 'user' ? 'user' as const : undefined
    if (edited && manualActor === undefined) {
      return unavailableResult('FORBIDDEN', 'Only the owner or a user may create an edited proposal')
    }
    const source = edited
      ? { kind: 'manual' as const, actor: manualActor as 'owner' | 'user', at: Date.now() }
      : {
          kind: 'message' as const,
          sessionId: session.id as string,
          sessionCreatedAt: identityOf(session).createdAt,
          projectionVersion: 1,
          digest: messageProjectionDigest({
            sessionId: session.id as string,
            sessionCreatedAt: identityOf(session).createdAt,
            seqs: [selected.seq],
            role: 'user',
            ...(selection === undefined ? {} : { selection }),
          }, [text]),
          seqs: [selected.seq],
          role: 'user' as const,
          ...(selection === undefined ? {} : { selection }),
          at: Date.now(),
        }
    const kind = options.kind ?? 'invariant'
    const mutationId = `message-proposal-${sha256Text(`${session.id}:${selected.seq}:${kind}:${text}:${JSON.stringify(selection ?? null)}`).slice(7, 39)}`
    const existing = this.recordFor(session)?.recentMutations.find(receipt => receipt.mutationId === mutationId)
    if (existing !== undefined) {
      return { ok: true, replayed: true, committedRevision: existing.committedRevision, ids: {}, view: this.view(session) }
    }
    return this.edit({
      sessionId: session.id,
      mutationId,
      baseRevision: view.revision,
      ops: [{
        type: 'item.propose',
        item: kind === 'invariant'
          ? {
              clientRef: 'message-proposal',
              kind: 'invariant',
              text,
              order: view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1,
            }
          : {
              clientRef: 'message-proposal',
              kind: 'deliverable',
              text,
              order: view.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1,
              progress: 'not-started',
            },
      }],
    }, actor, source)
  }

  async proposeFromAgent(
    session: Session,
    items: readonly {
      readonly kind: 'invariant' | 'deliverable'
      readonly text: string
      readonly requires?: readonly string[]
    }[],
    toolCallId?: string,
  ): Promise<{ readonly ok: boolean; readonly message?: string; readonly revision?: number }> {
    if (items.length === 0) return { ok: false, message: 'at least one proposal is required' }
    if (items.length > 16) return { ok: false, message: 'charter_propose accepts at most 16 items' }
    const view = this.view(session)
    if (view.status !== 'ready') return { ok: false, message: 'Charter is not editable in its current state' }
    const nextOrder = view.items.length === 0 ? 0 : Math.max(...view.items.map(item => item.order)) + 1
    const activeDeliverableIds = new Set(view.items
      .filter(item => item.kind === 'deliverable' && item.review === 'accepted' && item.lifecycle === 'current')
      .map(item => item.id))
    const unknownRequires = items.flatMap(input => input.requires ?? [])
      .filter(id => !activeDeliverableIds.has(id))
    if (unknownRequires.length > 0) {
      return { ok: false, message: `charter_propose requires must reference current active deliverables: ${[...new Set(unknownRequires)].join(', ')}` }
    }
    const ops: import('../core/schemas.js').CharterOp[] = items.map((input, index) => ({
      type: 'item.propose',
      item: input.kind === 'invariant'
        ? {
            clientRef: `proposal-${index}`,
            kind: 'invariant',
            text: input.text,
            order: nextOrder + index,
          }
        : {
            clientRef: `proposal-${index}`,
            kind: 'deliverable',
            text: input.text,
            order: nextOrder + index,
            progress: 'not-started',
            ...(input.requires === undefined ? {} : {
              proposedRequires: [...new Set(input.requires)].sort(),
            }),
          },
    }))
    if (toolCallId === undefined || toolCallId.length === 0) {
      return { ok: false, message: 'charter_propose requires a real tool call identity' }
    }
    const callId = toolCallId
    const mutationId = `propose-${sha256Text(callId).slice(7, 39)}`
    const existing = this.recordFor(session)?.recentMutations.find(receipt => receipt.mutationId === mutationId)
    if (existing !== undefined) return { ok: true, revision: existing.committedRevision }
    const result = await this.edit({
      sessionId: session.id,
      mutationId,
      baseRevision: view.revision,
      ops,
    }, { kind: 'agent-tool' }, {
      kind: 'agent-tool',
      toolCallId: callId,
      projectionVersion: 1,
      at: Date.now(),
      digest: agentProjectionDigest(callId, items.map(item => ({
        kind: 'item' as const,
        text: item.text,
      }))),
    })
    return result.ok
      ? { ok: true, revision: result.committedRevision }
      : { ok: false, message: result.message }
  }

  async edit(
    untrustedRequest: unknown,
    actor: CharterActor = { kind: 'owner' },
    proposalSource?: import('../core/schemas.js').ProposalSource,
    options: { readonly allowContentModified?: boolean; readonly dedupeSourceDigest?: string } = {},
  ): Promise<CharterEditResult> {
    let request: CharterEditRequest
    try {
      request = normalizeEditRequest(untrustedRequest)
    } catch (error) {
      if (error instanceof CharterError) return unavailableResult(error.code, error.message)
      return unavailableResult('INVALID_ARGUMENT', describeError(error))
    }
    if (options.allowContentModified !== true) request = stripClientContentModified(request)
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
        let produced = false
        let deduped = false
        let changeSet: PlannedChangeSet | undefined
        try {
          const next = await table.update(session.id, stored => {
            const inspection = this.inspectionOf(session, stored)
            if (inspection.state.kind !== 'healthy' || inspection.record === undefined) {
              if (inspection.state.kind === 'absent-unconfirmed') {
                throw charterError('INITIALIZATION_REQUIRED', 'Charter record is absent-unconfirmed')
              }
              throw charterError('UNAVAILABLE', 'Stored charter cannot be edited in its current state')
            }
            if (request.previewDigest !== undefined
              && request.previewDigest !== changeSetPreviewDigest(request, inspection.record.current.stateDigest)) {
              throw charterError('PREVIEW_MISMATCH', 'the reviewed Change Set no longer matches the current snapshot')
            }
            const sourceOrigin = proposalSource?.kind === 'agent-tool'
              ? 'agent'
              : proposalSource?.kind === 'fork'
                ? 'fork'
                : 'user'
            const withOrigin: CharterEditRequest = {
              ...request,
              ops: request.ops.map(op => {
                if (op.type === 'item.propose' || op.type === 'item.add') {
                  return { ...op, item: { ...op.item, origin: sourceOrigin } }
                }
                if (op.type === 'item.supersede') {
                  return { ...op, replacement: { ...op.replacement, origin: sourceOrigin } }
                }
                return op
              }),
            }
            const effectiveRequest = options.dedupeSourceDigest === undefined
              ? withOrigin
              : this.dedupeBootstrapRequest(inspection.record, withOrigin, options.dedupeSourceDigest)
            if (effectiveRequest.ops.length === 0) {
              deduped = true
              return inspection.record
            }
            changeSet = planChangeSet({
              snapshot: inspection.record.current,
              ops: effectiveRequest.ops,
              ids,
              nextRevision: inspection.record.current.revision + 1,
              limits: this.config,
              ...(inspection.record.objectiveProposals === undefined
                ? {}
                : { objectiveProposals: inspection.record.objectiveProposals }),
            })
            const nextRecord = commitRecord({
              record: inspection.record,
              request: effectiveRequest,
              requestDigest: requestDigestOf(effectiveRequest, current.identity, actor),
              ids,
              actor,
              at: Date.now(),
              limits: this.config,
              ...(proposalSource === undefined ? {} : { proposalSource }),
            })
            produced = true
            return nextRecord
          })
          if (deduped) {
            this.publish(session.id)
            return {
              ok: true,
              replayed: true,
              committedRevision: this.recordFor(session)?.current.revision ?? 0,
              ids: {},
              view: this.view(session),
            }
          }
          if (this.ctx.sessions.get(session.id) !== session) {
            this.fenceWrite(session.id, 'edit')
            return unavailableResult('UNAVAILABLE', 'The Session lifecycle changed while the edit was being written; the Session is fenced', this.view(session))
          }
          this.recordStates.set(session.id, {
            kind: 'healthy',
            recordDigest: recordDigestOf(table.get(session.id)),
          })
          this.publish(session.id)
          void this.captureArchive(session, next)
          return {
            ok: true,
            replayed: false,
            committedRevision: next.current.revision,
            ids,
            view: this.view(session),
            ...(changeSet === undefined ? {} : {
              changeSet: {
                summaryDigest: changeSet.summaryDigest,
                promptChanged: changeSet.promptChanged,
                metadataOnly: changeSet.metadataOnly,
                before: changeSet.before,
                after: changeSet.after,
              },
            }),
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

  /**
   * Bounded cache policy: at most five snapshots per Session and at most
   * `CHARTER_ARCHIVE_TOTAL_LIMIT` across all Sessions. Oldest snapshots are
   * evicted first; this is a derivative cache, never the authoritative record.
   */
  private async pruneArchiveCache(): Promise<void> {
    const table = this.archivesTable
    if (table === undefined) return
    const combined = new Map<string, CharterArchiveCacheEntry>([
      ...[...table.entries()],
      ...[...this.pendingArchives.entries()],
    ])
    const ordered = [...combined.entries()].sort((left, right) =>
      (right[1].archivedAt - left[1].archivedAt) || (right[1].revision - left[1].revision))
    const perSession = new Map<string, number>()
    let total = 0
    for (const [key, entry] of ordered) {
      const count = perSession.get(entry.sessionId) ?? 0
      if (count >= CHARTER_ARCHIVE_CACHE_LIMIT || total >= CHARTER_ARCHIVE_TOTAL_LIMIT) {
        if (this.pendingArchives.get(key) === entry) this.pendingArchives.delete(key)
        else await table.delete(key)
        continue
      }
      perSession.set(entry.sessionId, count + 1)
      total += 1
    }
  }

  /**
   * Best-effort bounded archive cache. It stores the exact record envelope at
   * each successful revision so recovery does not depend on a downloaded file.
   */
  private async captureArchive(session: Session, record: CharterRecord): Promise<void> {
    const table = this.archivesTable
    if (table === undefined) return
    if (!this.recordMaintenanceCapability().recordMaintenance) return
    try {
      const archive = buildRecordArchive({
        sessionId: session.id,
        lifecycle: lifecycleFingerprint(identityOf(session)),
        health: 'healthy',
        revision: record.current.revision,
        record,
        exportedAt: Date.now(),
      })
      assertArchiveAdmission(archive, this.config)
      const key = archiveCacheKey(session.id, record.current.revision)
      const entry: CharterArchiveCacheEntry = {
        key,
        sessionId: session.id,
        revision: record.current.revision,
        archivedAt: archive.exportedAt,
        archive,
      }
      this.pendingArchives.set(key, entry)
      try {
        await this.pruneArchiveCache()
        if (this.pendingArchives.get(key) !== entry) return
        await table.put(key, entry)
        await this.pruneArchiveCache()
      } finally {
        this.pendingArchives.delete(key)
      }
    } catch (error) {
      this.ctx.logger.warn(`charter: could not cache archive for ${session.id}: ${describeError(error)}`)
    }
  }

  listArchives(sessionId: SessionIdType, actor: CharterActor): CharterArchiveListResult {
    const gate = this.maintenanceGate(actor)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    if (this.ctx.sessions.get(sessionId) === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    }
    const table = this.archivesTable
    if (table === undefined) {
      return { ok: false, code: 'UNAVAILABLE', message: 'The archive cache is unavailable' }
    }
    const prefix = `${sessionId}--r`
    const combined = new Map<string, CharterArchiveCacheEntry>([
      ...[...table.entries()].filter(([key]) => key.startsWith(prefix)),
      ...[...this.pendingArchives.entries()].filter(([key]) => key.startsWith(prefix)),
    ])
    const archives: CharterArchiveEntry[] = [...combined.values()]
      .map(entry => ({
        key: entry.key,
        revision: entry.revision,
        archivedAt: entry.archivedAt,
        payloadDigest: entry.archive.payloadDigest,
        recordDigest: entry.archive.source.recordDigest,
        lifecycle: entry.archive.source.lifecycle,
      }))
      .sort((left, right) => (right.archivedAt - left.archivedAt) || (right.revision - left.revision))
    return { ok: true, archives: archives.slice(0, CHARTER_ARCHIVE_CACHE_LIMIT), limit: CHARTER_ARCHIVE_CACHE_LIMIT }
  }

  readArchive(sessionId: SessionIdType, key: string, actor: CharterActor): CharterArchiveReadResult {
    const gate = this.maintenanceGate(actor)
    if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
    if (this.ctx.sessions.get(sessionId) === undefined) {
      return { ok: false, code: 'NOT_FOUND', message: 'The Session is not live' }
    }
    const table = this.archivesTable
    if (table === undefined) {
      return { ok: false, code: 'UNAVAILABLE', message: 'The archive cache is unavailable' }
    }
    if (!key.startsWith(`${sessionId}--r`)) {
      return { ok: false, code: 'NOT_FOUND', message: 'The archive does not belong to this Session' }
    }
    const entry = table.get(key) ?? this.pendingArchives.get(key)
    if (entry === undefined) return { ok: false, code: 'NOT_FOUND', message: 'The archive is no longer cached' }
    return { ok: true, archive: entry.archive }
  }

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
    if (inspection.state.kind === 'healthy' && inspection.record !== undefined) {
      void this.captureArchive(session, inspection.record)
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
        await this.captureArchive(session, next)
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
    let legacyV1: import('../core/schemas.js').CharterRecordV1 | undefined
    let archived = charterRecordSchema.safeParse(archive.record)
    if (!archived.success) {
      const legacy = charterRecordV1Schema.safeParse(archive.record)
      if (legacy.success) {
        legacyV1 = legacy.data
        archived = { success: true, data: migrateRecordV1ToV2(legacy.data) }
      }
    }
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
        const next = legacyV1 === undefined
          ? restoredRecord(archived.data, receipt, this.config)
          : appendMaintenanceReceipt(legacyV1 as unknown as CharterRecord, receipt, this.config)
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
        await this.captureArchive(session, next)
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
