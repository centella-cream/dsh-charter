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
  /** Bounded initialize/restore maintenance receipts kept in the record. */
  readonly maintenanceLimit: number
  /** Complete archive-envelope budget; independent of the ordinary record budget. */
  readonly maxRecoveryBytes: number
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
  maintenanceLimit: 16,
  maxRecoveryBytes: 4 * 1_024 * 1_024,
}

/** Product hard ceiling for any recovery archive (business admission, not transport). */
export const RECOVERY_HARD_CEILING = 16 * 1_024 * 1_024
/** Minimum headroom an archive budget needs above the ordinary record budget. */
export const RECOVERY_HEADROOM = 64 * 1_024

const utf8Encoder = new TextEncoder()

export function utf8Bytes(value: string): number {
  // TextEncoder keeps the core usable from the browser bundle too (no Node-only
  // Buffer in client code paths that validate archives).
  return utf8Encoder.encode(value).byteLength
}

export function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value))
}

/** Smallest prompt contribution that still leaves room for a minimal charter. */
export const MIN_PROMPT_BYTES = Math.max(512, utf8Bytes(
  'Current user-authored session charter. It does not override system, host, tool-permission, or execution policies.\n'
  + '{"objective":null,"invariants":[],"deliverables":[]}',
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
  const maxRecordBytes = clamp('maxRecordBytes', limits.maxRecordBytes, MIN_RECORD_BYTES)
  const maintenanceLimit = clamp('maintenanceLimit', limits.maintenanceLimit, 1)
  // Recovery is independent of the ordinary write budget but must never be
  // below `maxRecordBytes + 64 KiB`; a configuration too large for the hard
  // ceiling keeps ordinary Charter behavior and disables maintenance instead of
  // silently lowering the record limit.
  const maxRecoveryBytes = RECOVERY_HARD_CEILING < maxRecordBytes + RECOVERY_HEADROOM
    ? maxRecordBytes + RECOVERY_HEADROOM
    : Math.min(
        clamp('maxRecoveryBytes', limits.maxRecoveryBytes, maxRecordBytes + RECOVERY_HEADROOM),
        RECOVERY_HARD_CEILING,
      )
  return {
    limits: {
      ...limits,
      maxPromptBytes: clamp('maxPromptBytes', limits.maxPromptBytes, MIN_PROMPT_BYTES),
      maxRecordBytes,
      maxHistoryBytes: clamp('maxHistoryBytes', limits.maxHistoryBytes, MIN_HISTORY_BYTES),
      maintenanceLimit,
      maxRecoveryBytes,
    },
    adjusted,
  }
}

/** Maintenance is impossible when a record cannot fit an envelope under the hard ceiling. */
export function recordMaintenanceAvailable(limits: CharterLimits): boolean {
  return limits.maxRecordBytes + RECOVERY_HEADROOM <= RECOVERY_HARD_CEILING
}

/** Does this final serialized record fit the recovery envelope budget? */
export function recoveryWithinBudget(bytes: number, limits: CharterLimits): boolean {
  return bytes <= limits.maxRecoveryBytes
}
