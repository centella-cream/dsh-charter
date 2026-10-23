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

export interface CompactionLifecycleEntry {
  readonly id: string
  readonly sortSeq: number
  readonly startSeq: number | undefined
  readonly startTime: number | undefined
  readonly summarySeq: number | undefined
  readonly endSeq: number | undefined
  readonly endTime: number | undefined
  readonly sourceCommandId: string | undefined
  readonly ok: boolean
  readonly error: string | undefined
}

export function messageText(content: unknown): string

export function sha256Text(value: string): string

export function readCompactionLifecycles(events: readonly { readonly type?: string; readonly seq: number; readonly data?: Record<string, unknown> }[]): {
  readonly compactions: readonly CompactionLifecycleEntry[]
  readonly successful: readonly CompactionLifecycleEntry[]
  readonly latestSuccessful: CompactionLifecycleEntry | undefined
}

export interface ResolvedCharterReadCall {
  readonly seq: number
  readonly callSeq: number | undefined
  readonly callId: string | undefined
  readonly resolution: string | undefined
  readonly authenticated: boolean
  readonly authError?: string
  readonly argumentsView: string | undefined
  readonly isError: boolean
  readonly invalid?: boolean
  readonly revision?: unknown
  readonly objective?: unknown
  readonly items?: readonly Record<string, unknown>[]
}

export function resolveCharterReadCalls(events: readonly object[]): {
  readonly calls: readonly Record<string, unknown>[]
  readonly results: readonly ResolvedCharterReadCall[]
}

export interface CompactionTranscriptReport {
  readonly status: 'blocked' | 'wait' | 'pass' | 'fail'
  readonly statusReason: string
  readonly exitCode: number
  readonly charter: {
    readonly revision: number
    readonly committedAt: number | null
    readonly promptText: string
    readonly bytes: number
    readonly promptDigest: string
    readonly objective: string | null
    readonly pending: number
  }
  readonly compactions: readonly {
    readonly id: string
    readonly seq: number | undefined
    readonly time: number | undefined
    readonly startSeq: number | undefined
    readonly startTime: number | undefined
    readonly summarySeq: number | undefined
    readonly endSeq: number | undefined
    readonly ok: boolean
    readonly error: string | undefined
    readonly sourceCommandId: string | undefined
  }[]
  readonly latestCompaction: {
    readonly id: string
    readonly startSeq: number | undefined
    readonly startTime: number | undefined
    readonly summarySeq: number | undefined
    readonly endSeq: number
    readonly endTime: number
  } | null
  readonly runtimeContexts: readonly {
    readonly seq: number
    readonly time: number
    readonly sectionNames: readonly string[]
    readonly charterText?: string
  }[]
  readonly checkpoints: readonly {
    readonly seq: number
    readonly time: number
    readonly compactionId: string | undefined
    readonly bytes: number
    readonly leaksCharter: boolean
  }[]
  readonly requests: number
  readonly charterReadTool: boolean
  readonly charterRead: ResolvedCharterReadCall | null
  readonly postCompactionCharterReads: number
  readonly authenticatedCharterReads: number
  readonly systemPromptClean: boolean | undefined
  readonly charterReadCalled: boolean
  readonly postCompactionActivity: number
  readonly noPostCompactionActivity: boolean
  readonly postCompactionExecutionWithoutSnapshot: boolean
  readonly verdicts: Record<string, boolean | undefined>
  readonly verification: CompactionEvaluation
  readonly verdictLines: readonly {
    readonly state: 'PASS' | 'FAIL' | 'WAIT'
    readonly label: string
    readonly detail?: string
  }[]
}

export function evaluateCompactionTranscript(input: {
  readonly events: readonly object[]
  readonly current: Record<string, unknown>
  readonly marker?: string
  readonly promptPrefix?: string
}): CompactionTranscriptReport

export interface TranscriptParseResult {
  readonly events: readonly Record<string, unknown>[]
  readonly errors: readonly { readonly line: number; readonly message: string }[]
  readonly tornTailLine: number | undefined
  readonly complete: boolean
}

export function parseTranscript(source: string): TranscriptParseResult
