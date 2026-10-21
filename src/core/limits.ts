export interface CharterLimits {
  readonly maxPromptBytes: number
  readonly maxObjectiveBytes: number
  readonly maxItemBytes: number
  readonly maxItems: number
  readonly maxPendingItems: number
  readonly maxOps: number
  readonly maxRecordBytes: number
  readonly historyLimit: number
  readonly maxHistoryBytes: number
  readonly mutationLimit: number
}

export const DEFAULT_CHARTER_LIMITS: CharterLimits = {
  maxPromptBytes: 8_192,
  maxObjectiveBytes: 4_096,
  maxItemBytes: 1_024,
  maxItems: 512,
  maxPendingItems: 512,
  maxOps: 1_024,
  maxRecordBytes: 1_024 * 1_024,
  historyLimit: 64,
  maxHistoryBytes: 128 * 1_024,
  mutationLimit: 128,
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}

/** Smallest prompt contribution that still leaves room for a minimal charter. */
export const MIN_PROMPT_BYTES = Math.max(512, Buffer.byteLength(
  'Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.\n'
  + '{"objective":null,"invariants":[],"deliverables":[]}',
  'utf8',
))
/** Smallest record budget that can hold identity metadata, digests and receipts. */
export const MIN_RECORD_BYTES = 16 * 1_024
/** Smallest history budget that can hold at least one receipt. */
export const MIN_HISTORY_BYTES = 2 * 1_024

/**
 * Clamp values that would make a Session ready but permanently uneditable.
 * The UI reports the effective limits, so the clamp is visible, and callers can
 * log the adjustment instead of silently accepting an unusable profile.
 */
export function clampCharterLimits(limits: CharterLimits): {
  readonly limits: CharterLimits
  readonly adjusted: readonly string[]
} {
  const adjusted: string[] = []
  const clamp = (field: keyof CharterLimits, value: number, minimum: number): number => {
    if (value >= minimum) return value
    adjusted.push(`${field}=${value} raised to ${minimum}`)
    return minimum
  }
  return {
    limits: {
      ...limits,
      maxPromptBytes: clamp('maxPromptBytes', limits.maxPromptBytes, MIN_PROMPT_BYTES),
      maxRecordBytes: clamp('maxRecordBytes', limits.maxRecordBytes, MIN_RECORD_BYTES),
      maxHistoryBytes: clamp('maxHistoryBytes', limits.maxHistoryBytes, MIN_HISTORY_BYTES),
    },
    adjusted,
  }
}
