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
  readonly charterReadStanding: boolean | undefined
  readonly checkpointLeaksCharter: boolean | undefined
}

export interface CompactionEvaluation {
  readonly ok: boolean
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
}

export interface CharterReadEvidence {
  readonly callSeq: number | undefined
  readonly resultSeq: number | undefined
  readonly compactionSeq: number | undefined
  readonly runtimeSeq: number | undefined
  readonly argumentsView: string | undefined
  readonly isError: boolean | undefined
}

export function compactStandingItem(item: {
  readonly kind: string
  readonly text: string
  readonly verification?: string | { readonly state?: string; readonly by?: string; readonly reason?: string } | undefined
  readonly progress?: string | null | undefined
  readonly [key: string]: unknown
}): CompactStandingItem

export function charterReadArgumentsView(
  rawArguments: string | object | undefined | null,
): string | undefined

export function isValidCharterReadEvidence(evidence: CharterReadEvidence): boolean

export function postCompactionCharterReads<T extends { readonly seq: number }>(
  results: readonly T[],
  latestCompactionSeq: number | undefined,
): T[]

export function evaluateCompactionEvidence(evidence: CompactionEvidence): CompactionEvaluation
