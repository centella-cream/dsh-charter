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
