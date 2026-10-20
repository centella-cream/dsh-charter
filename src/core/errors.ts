export type CharterErrorCode =
  | 'INVALID_ARGUMENT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LIFECYCLE_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'MUTATION_ID_REUSED'
  | 'INVALID_REFERENCE'
  | 'INVALID_TRANSITION'
  | 'IMMUTABLE_FIELD'
  | 'QUOTA_EXCEEDED'
  | 'CORRUPT_STATE'
  | 'UNAVAILABLE'

export class CharterError extends Error {
  readonly code: CharterErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: CharterErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CharterError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function charterError(
  code: CharterErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): CharterError {
  return new CharterError(code, message, details)
}
