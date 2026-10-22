export interface CompactStandingItem {
  readonly kind: string
  readonly text: string
  readonly verification: string | undefined
  readonly progress: string | null
}

export interface CompactionEvidence {
  readonly charterReady: boolean | undefined
  readonly survivesCompaction: boolean | undefined
  readonly systemPromptClean: boolean | undefined
  readonly charterReadCalled: boolean
  readonly charterReadStanding: boolean | undefined
  readonly checkpointLeaksCharter: boolean | undefined
}

export interface CompactionEvaluation {
  readonly ok: boolean
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
}

export function compactStandingItem(item: {
  readonly kind: string
  readonly text: string
  readonly verification?: string | { readonly state?: string; readonly by?: string; readonly reason?: string } | undefined
  readonly progress?: string | null | undefined
  readonly [key: string]: unknown
}): CompactStandingItem

export function evaluateCompactionEvidence(evidence: CompactionEvidence): CompactionEvaluation
