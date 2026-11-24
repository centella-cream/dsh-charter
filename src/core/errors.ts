export type CharterErrorCode =
  | 'INVALID_ARGUMENT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LIFECYCLE_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'MUTATION_ID_REUSED'
  | 'INVALID_REFERENCE'
  | 'INVALID_TRANSITION'
  | 'INVALID_CHANGE_SET'
  | 'STALE_REVISION'
  | 'PREVIEW_MISMATCH'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_CURSOR'
  | 'OUTCOME_UNKNOWN'
  | 'IMMUTABLE_FIELD'
  | 'QUOTA_EXCEEDED'
  | 'CORRUPT_STATE'
  | 'UNAVAILABLE'
  | 'INITIALIZATION_REQUIRED'
  | 'INVALID_ARCHIVE'
  | 'RECORD_CONFLICT'
  | 'OPERATION_ID_REUSED'
  | 'RECOVERY_UNSUPPORTED'
  | 'CALIBRATION_UNAVAILABLE'
  | 'CALIBRATION_DISABLED'
  | 'CALIBRATION_CONSENT_REQUIRED'
  | 'CALIBRATION_UNCONFIGURED'
  | 'CALIBRATION_EFFORT_UNSUPPORTED'
  | 'CALIBRATION_PROVIDER'
  | 'CALIBRATION_TIMEOUT'
  | 'CALIBRATION_CANCELLED'
  | 'CALIBRATION_MALFORMED'
  | 'CALIBRATION_SCHEMA'
  | 'CALIBRATION_TEXT'
  | 'CALIBRATION_PARAMS_CONFLICT'
  | 'CALIBRATION_RUN_EXPIRED'

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
