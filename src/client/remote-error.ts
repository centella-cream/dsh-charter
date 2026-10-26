export type RemoteFailureDisposition =
  | { readonly kind: 'known'; readonly code: string }
  | { readonly kind: 'unknown' }

/**
 * Remote failures documented to happen BEFORE business dispatch: the method is
 * definitely not executed, so the exact request must not be retained.
 */
const DEFINITE_NOT_EXECUTED = new Set([
  'gateway/bad-request',
  'gateway/arguments-invalid',
  'gateway/input-invalid',
  'remote-access/denied',
  'remote-access/forbidden',
  'remote/method-unavailable',
  'remote/service-unavailable',
  'remote/definition-unavailable',
  'gateway/method-unavailable',
  'gateway/service-unavailable',
  'gateway/definition-unavailable',
])

/**
 * Structural RemoteError identification: never `instanceof`, never message
 * text. Works across realm/module copies and keeps the browser factory bundle
 * free of an external protocol runtime import.
 */
function remoteCodeOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { isDSHRemoteError?: unknown; code?: unknown }
    if (candidate.isDSHRemoteError === true && typeof candidate.code === 'string') return candidate.code
  }
  return undefined
}

/**
 * Classify a thrown Remote failure for the client attempt state machine.
 *
 * - documented pre-dispatch failures are a KNOWN outcome (end the attempt);
 * - gateway/internal, gateway/cancelled, gateway/result-invalid, carrier loss
 *   and every unclassified rejection are POSSIBLY EXECUTED (retain the exact
 *   request for replay);
 * - never classify by message text or `instanceof`.
 */
export function classifyRemoteFailure(value: unknown): RemoteFailureDisposition {
  const code = remoteCodeOf(value)
  if (code === undefined) return { kind: 'unknown' }
  if (DEFINITE_NOT_EXECUTED.has(code)) return { kind: 'known', code }
  return { kind: 'unknown' }
}
