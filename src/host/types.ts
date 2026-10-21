import type {
  CharterActor,
  CharterEditRequest,
  CharterItem,
  CharterObjective,
  CharterSnapshot,
} from '../core/schemas.js'
import type { CharterErrorCode } from '../core/errors.js'

export interface CharterViewLimits {
  readonly maxPromptBytes: number
  readonly maxObjectiveBytes: number
  readonly maxItemBytes: number
  readonly maxItems: number
  readonly maxPendingItems: number
  readonly maxOps: number
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
  readonly message?: string | undefined
}

export interface CharterBootstrapSource {
  readonly summarySeq: number
  readonly at: number
  readonly shadowedTokens?: number
}

export interface CharterBootstrapProposal {
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
  readonly id: string
  readonly kind: CharterItem['kind']
  readonly text: string
  readonly review: CharterItem['review']
  readonly lifecycle: CharterItem['lifecycle']
  readonly verification: CharterItem['verification']['state']
  readonly progress: string | null
}

export interface CharterToolView {
  readonly revision: number
  readonly objective: string | null
  readonly items: readonly CharterToolItem[]
}

export type CharterEditResult =
  | {
      readonly ok: true
      readonly replayed: boolean
      readonly committedRevision: number
      readonly ids: Readonly<Record<string, string>>
      readonly view: CharterView
    }
  | {
      readonly ok: false
      readonly code: CharterErrorCode
      readonly message: string
      readonly currentRevision?: number
      readonly view?: CharterView
    }

export interface CharterEditInput {
  readonly request: CharterEditRequest
  readonly actor: CharterActor
}

export type CharterListener = (view: CharterView) => void

export interface CharterReadOptions {
  readonly view: 'standing' | 'all'
}

export type CharterCommittedSnapshot = CharterSnapshot
