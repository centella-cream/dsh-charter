import type {
  CharterActor,
  ProposalBatch,
  CharterEditRequest,
  CharterInitializeRequest,
  CharterItem,
  CharterObjective,
  CharterRecordArchive,
  CharterRestoreRequest,
  CharterSnapshot,
} from '../core/schemas.js'
import type { CharterErrorCode } from '../core/errors.js'
import type { ItemQueryFailure, ItemQueryPage } from '../core/query.js'

export interface CharterViewLimits {
  readonly maxPromptBytes: number
  readonly maxObjectiveBytes: number
  readonly maxItemBytes: number
  readonly maxItems: number
  readonly maxPendingItems: number
  readonly maxOps: number
  /** One Session record including bounded history/mutation receipts. */
  readonly maxRecordBytes: number
  /** Bounded initialize/restore receipts kept in the record. */
  readonly maintenanceLimit?: number | undefined
  /** Complete recovery-archive budget (business admission, not transport). */
  readonly maxRecoveryBytes?: number | undefined
}

/** Host-derived record health. Never persisted in the record. */
export type CharterRecordState =
  | {
      readonly kind: 'healthy'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'absent-unconfirmed'
      readonly source: 'resume' | 'clear' | 'compact' | 'reattach' | 'unknown'
    }
  | {
      readonly kind: 'invalid'
      readonly reason: 'schema' | 'consistency'
      readonly recordDigest: `sha256:${string}`
      readonly observedRevision?: number | undefined
      readonly recoverable: boolean
    }
  | {
      readonly kind: 'invalid'
      readonly reason: 'future-schema'
      readonly recordDigest: `sha256:${string}`
      readonly observedRevision?: number | undefined
      readonly recoverable: false
    }
  | {
      readonly kind: 'lifecycle-mismatch'
      readonly recordDigest: `sha256:${string}`
    }
  | {
      readonly kind: 'unknown'
      readonly reason: 'initializing' | 'storage-unavailable' | 'legacy-host'
    }
  | {
      readonly kind: 'write-uncertain'
      readonly operation: 'startup' | 'edit' | 'initialize' | 'restore'
      readonly lastKnownRecordDigest?: `sha256:${string}` | undefined
    }

export interface CharterViewCapabilities {
  /** Record export/initialize/restore are available on this runtime. */
  readonly recordMaintenance: boolean
  readonly recordMaintenanceReason?: 'runtime' | 'record-limit' | 'legacy-host' | undefined
}

export interface CharterChangeRow {
  readonly mutationId: string
  readonly revision: number
  readonly baseRevision: number
  readonly actor: import('../core/schemas.js').CharterActor
  readonly at: number
  readonly changes: import('../core/schemas.js').CharterChange[]
}

export interface CharterChangeQueryRequest {
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly changeSetId?: string | undefined
  readonly operationKind?: import('../core/schemas.js').CharterChange['type'] | undefined
  readonly itemId?: string | undefined
  readonly proposalId?: string | undefined
}

export type CharterChangeQueryResult =
  | {
      readonly ok: true
      readonly revision: number
      readonly changes: readonly CharterChangeRow[]
      readonly filterDigest: string
      readonly nextCursor?: string
    }
  | {
      readonly ok: false
      readonly code: 'INVALID_CURSOR' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'STALE_REVISION'
      readonly message: string
    }

export interface CharterSummary {
  readonly sessionId: string
  readonly revision: number
  readonly objective: import('../core/schemas.js').CharterObjective | null
  readonly limits: CharterViewLimits
  readonly promptText: string
  readonly promptDigest: string
  readonly hasObjective: boolean
  readonly activeItems: number
  readonly pendingItems: number
  readonly historyItems: number
  readonly pendingBatches: number
  readonly promptBytes: number
  readonly overBudget: boolean
  readonly lifecycle?: string
  readonly recordState?: CharterRecordState
  readonly message?: string
  readonly status: 'ready' | 'initializing' | 'unavailable'
  readonly recordHealth: 'healthy' | 'invalid' | 'absent' | 'unknown' | 'write-uncertain'
  readonly capabilities: CharterViewCapabilities
}

export type CharterItemQueryRequest = import('../core/query.js').ItemQueryRequest
export type CharterItemQueryResult = ItemQueryPage | ItemQueryFailure

export interface CharterProposalBatchView {
  readonly id: string
  readonly source: import('../core/schemas.js').ProposalSource
  readonly sourceIntegrity: import('../core/source-integrity.js').SourceIntegrity
  readonly capturedAtRevision: number
  readonly candidates: readonly {
    readonly kind: 'item' | 'objective' | 'tombstone'
    readonly id: string
    readonly text?: string
    readonly review?: 'pending' | 'accepted' | 'rejected' | 'purged'
    readonly candidateKind?: 'item' | 'objective'
    readonly disposition?: 'accepted' | 'rejected' | 'purged'
    readonly atRevision?: number
  }[]
}

export interface CharterProposalQueryRequest {
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly sourceKind?: 'manual' | 'message' | 'compaction-summary' | 'agent-tool' | 'fork' | 'legacy-unknown'
  readonly review?: 'pending' | 'accepted' | 'rejected'
  readonly batchId?: string
  readonly candidateKind?: 'item' | 'objective'
  readonly objectiveCursor?: string | undefined
}

export type CharterProposalQueryResult =
  | {
      readonly ok: true
      readonly revision: number
      readonly batches: readonly CharterProposalBatchView[]
      readonly objectiveProposals: import('../core/schemas.js').ObjectiveProposal[]
      readonly filterDigest: string
      readonly nextCursor?: string
      readonly nextObjectiveCursor?: string
    }
  | {
      readonly ok: false
      readonly code: 'NOT_FOUND' | 'UNAVAILABLE' | 'STALE_REVISION' | 'INVALID_CURSOR' | 'LIMIT_EXCEEDED'
      readonly message: string
    }

export interface CharterView {
  readonly status: 'ready' | 'initializing' | 'unavailable'
  readonly sessionId: string
  readonly revision: number
  readonly objective: CharterObjective | null
  readonly items: CharterItem[]
  readonly promptText: string
  readonly promptDigest: string
  readonly limits: CharterViewLimits
  /** The durable record is valid but exceeds the current budget configuration. */
  readonly overBudget: boolean
  /** Session lifecycle fingerprint; client drafts are bound to it. */
  readonly lifecycle?: string | undefined
  readonly message?: string | undefined
  /** Structured record health (defaults to unknown/legacy-host on old frames). */
  readonly recordState?: CharterRecordState | undefined
  readonly capabilities?: CharterViewCapabilities | undefined
  readonly proposalBatches?: Array<ProposalBatch & {
    /** View-level copy supplied by the client query plane; absent on raw Host frames. */
    readonly sourceIntegrity?: import('../core/source-registry.js').SourceIntegrity
  }> | undefined
  readonly objectiveProposals?: import('../core/schemas.js').ObjectiveProposal[] | undefined
}

/** Export/initialize/restore are maintenance operations, never model tools. */
export type CharterRecordOperationResult =
  | {
      readonly ok: true
      readonly replayed: boolean
      readonly committedRevision: number
      readonly view: CharterView
      readonly changeSet?: {
        readonly summaryDigest: string
        readonly promptChanged: boolean
        readonly metadataOnly: boolean
        readonly before: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
        readonly after: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
      }
    }
  | {
      readonly ok: false
      readonly code: CharterErrorCode
      readonly message: string
      readonly view?: CharterView
    }

export interface CharterRecordExportResult {
  readonly ok: true
  readonly filename: string
  readonly archive: CharterRecordArchive
}

export interface CharterRecordExportFailure {
  readonly ok: false
  readonly code: CharterErrorCode
  readonly message: string
}

export type CharterRecordExport = CharterRecordExportResult | CharterRecordExportFailure

export interface CharterMaintenanceInputs {
  readonly actor: CharterActor
}

export type { CharterInitializeRequest, CharterRestoreRequest }

export interface CharterBootstrapSource {
  readonly summarySeq: number
  readonly at: number
  readonly shadowedTokens?: number
}

export interface CharterBootstrapProposal {
  /** Host-issued handle binding the reviewed extraction to apply. */
  readonly draftHandle?: string
  readonly objective: string | null
  readonly invariants: string[]
  readonly deliverables: string[]
  readonly source: CharterBootstrapSource
}

export type CharterBootstrapResult =
  | { readonly available: true; readonly proposal: CharterBootstrapProposal }
  | {
      readonly available: false
      readonly reason: 'not-live' | 'no-summary' | 'unavailable'
      readonly message?: string
    }

export interface CharterToolItem {
  /** Present only in the bounded `all` debugging view. */
  readonly id?: string
  readonly kind: CharterItem['kind']
  readonly text: string
  /** Present only in the bounded `all` debugging view. */
  readonly review?: CharterItem['review']
  /** Present only in the bounded `all` debugging view. */
  readonly lifecycle?: CharterItem['lifecycle']
  readonly verification: CharterItem['verification']['state']
  /** Present only in the bounded `all` debugging view. */
  readonly verificationBy?: 'user' | 'validator'
  /** Present only in the bounded `all` debugging view. */
  readonly verificationReason?: string
  readonly progress: string | null
  /** Present only in the bounded `all` debugging view. */
  readonly origin?: CharterItem['origin']
  /** Present only in the bounded `all` debugging view. */
  readonly order?: number
  /** Present only in the bounded `all` debugging view. */
  readonly createdRevision?: number
  /** Present only in the bounded `all` debugging view. */
  readonly supersedes?: string
  /** Present only in the bounded `all` debugging view. */
  readonly supersededBy?: string
  /** Dependency key in the bounded `all` debugging view. */
  readonly key?: string | null
  /** Prerequisite dependency keys in the bounded `all` debugging view. */
  readonly requires?: readonly string[]
}

export interface CharterToolView {
  readonly revision: number
  readonly objective: string | null
  readonly items: readonly CharterToolItem[]
  /** Number of historical items omitted from an `all` view (debug cap). */
  readonly truncated: number
  /** `all` only: the objective alone exceeds the tool-response envelope. */
  readonly objectiveTruncated?: boolean
  /** `all` only: opaque cursor for the next page. */
  readonly nextCursor?: string
}

export type CharterEditResult =
  | {
      readonly ok: true
      readonly replayed: boolean
      readonly committedRevision: number
      readonly ids: Readonly<Record<string, string>>
      readonly view: CharterView
      readonly changeSet?: {
        readonly summaryDigest: string
        readonly promptChanged: boolean
        readonly metadataOnly: boolean
        readonly before: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
        readonly after: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
      }
    }
  | {
      readonly ok: false
      readonly code: CharterErrorCode
      readonly message: string
      readonly currentRevision?: number
      readonly view?: CharterView
    }

export interface CharterMessageCandidate {
  readonly seq: number
  readonly role: 'user'
  readonly excerpt: string
  /** Full message text when available; bounded by the Host projection cap. */
  readonly text?: string
  /** True when the Host cap clipped the text field. */
  readonly truncated?: boolean
  readonly length: number
}

export interface CharterArchiveEntry {
  readonly key: string
  readonly revision: number
  readonly archivedAt: number
  readonly payloadDigest: string
  readonly recordDigest: string
  readonly lifecycle: string | null
}

export type CharterArchiveListResult =
  | { readonly ok: true; readonly archives: readonly CharterArchiveEntry[]; readonly limit: number }
  | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string }

export type CharterArchiveReadResult =
  | { readonly ok: true; readonly archive: import('../core/schemas.js').CharterRecordArchive }
  | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string }

export type CharterMessageListResult =
  | { readonly ok: true; readonly messages: readonly CharterMessageCandidate[] }
  | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string }

export interface CharterMessageProposalOptions {
  readonly seq?: number
  readonly kind?: 'invariant' | 'deliverable'
  /** Optional edited proposal text; overrides the selected message slice. */
  readonly text?: string
  readonly start?: number
  readonly end?: number
}

export type CharterSourceIntegrityResult =
  | {
      readonly ok: true
      readonly revision: number
      readonly items: readonly {
        readonly itemId: string
        readonly integrity: import('./validators.js').EvidenceIntegrity
      }[]
      readonly batches: readonly {
        readonly batchId: string
        readonly integrity: import('../core/source-registry.js').SourceIntegrity
      }[]
      readonly truncated?: boolean
    }
  | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string }

export interface CharterValidatorRequest {
  readonly itemId: string
  readonly validator: {
    readonly kind: 'workspace.path-exists' | 'workspace.file-digest' | 'workspace.file-contains'
    readonly path: string
    readonly expectedDigest?: string
    readonly contains?: string
  }
}

export type CharterValidatorRunResult =
  | { readonly ok: true; readonly revision: number; readonly results: readonly import('../core/schemas.js').CharterValidity[] }
  | { readonly ok: false; readonly code: CharterErrorCode; readonly message: string }

export type CharterChangeSetPreviewResult =
  | {
      readonly ok: true
      readonly previewDigest: string
      readonly before: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
      readonly after: { readonly revision: number; readonly promptBytes: number; readonly items: number; readonly pendingItems: number }
      readonly changes: readonly import('../core/schemas.js').CharterChange[]
      readonly promptChanged: boolean
      readonly metadataOnly: boolean
    }
  | {
      readonly ok: false
      readonly code: CharterErrorCode
      readonly message: string
    }

export interface CharterEditInput {
  readonly request: CharterEditRequest
  readonly actor: CharterActor
}

export type CharterListener = (view: CharterView | null) => void

export interface CharterReadOptions {
  readonly view: 'standing' | 'all'
}

export type CharterCommittedSnapshot = CharterSnapshot
