import { charterError } from './errors.js'
import { jsonBytes, type CharterLimits } from './limits.js'
import { sha256Json } from './digest.js'
import {
  charterRecordArchiveSchema,
  type CharterRecord,
  type CharterRecordArchive,
  type CharterRecordArchiveSource,
  type MaintenanceKind,
} from './schemas.js'

/** Digest of the complete raw stored record (identity/current/history/receipts). */
export function recordDigestOf(value: unknown): `sha256:${string}` {
  return sha256Json(value)
}

function envelopeBody(envelope: Omit<CharterRecordArchive, 'payloadDigest'>): unknown {
  return {
    format: envelope.format,
    formatVersion: envelope.formatVersion,
    exportedAt: envelope.exportedAt,
    source: envelope.source,
    record: envelope.record,
  }
}

export function payloadDigestOf(envelope: Omit<CharterRecordArchive, 'payloadDigest'>): `sha256:${string}` {
  return sha256Json(envelopeBody(envelope))
}

export function withPayloadDigest(
  envelope: Omit<CharterRecordArchive, 'payloadDigest'>,
): CharterRecordArchive {
  return { ...envelope, payloadDigest: payloadDigestOf(envelope) }
}

export interface ArchiveBuildInput {
  readonly sessionId: string
  readonly lifecycle: string | null
  readonly health: CharterRecordArchiveSource['health']
  readonly revision: number | null
  readonly record: unknown
  readonly exportedAt: number
}

/** Build a complete, self-digesting archive envelope. */
export function buildRecordArchive(input: ArchiveBuildInput): CharterRecordArchive {
  const source: CharterRecordArchiveSource = {
    domain: 'dsh_charter_v1',
    domainVersion: 1,
    sessionId: input.sessionId,
    lifecycle: input.lifecycle,
    health: input.health,
    revision: input.revision,
    recordDigest: recordDigestOf(input.record),
  }
  return withPayloadDigest({
    format: 'dsh-charter-record',
    formatVersion: 1,
    exportedAt: input.exportedAt,
    source,
    record: input.record,
  })
}

/**
 * Strict archive validation shared by the Host (authoritative) and the client
 * preview (early feedback only). Does not parse the inner record; that needs
 * the live Session identity and is done by the Host's record inspection.
 */
export function validateArchiveEnvelope(
  value: unknown,
  expected: { readonly sessionId: string },
  limits: CharterLimits,
): CharterRecordArchive {
  if (jsonBytes(value) > limits.maxRecoveryBytes) {
    throw charterError('INVALID_ARCHIVE', `archive exceeds ${limits.maxRecoveryBytes} UTF-8 bytes`)
  }
  const parsed = charterRecordArchiveSchema.safeParse(value)
  if (!parsed.success) {
    throw charterError('INVALID_ARCHIVE', 'archive does not match the dsh-charter-record v1 schema')
  }
  const archive = parsed.data
  if (archive.format !== 'dsh-charter-record' || archive.formatVersion !== 1) {
    throw charterError('INVALID_ARCHIVE', 'unsupported archive format or version')
  }
  if (archive.source.sessionId !== expected.sessionId) {
    throw charterError('INVALID_ARCHIVE', 'archive belongs to a different Session')
  }
  const { payloadDigest, ...body } = archive
  if (payloadDigest !== payloadDigestOf(body)) {
    throw charterError('INVALID_ARCHIVE', 'archive payload digest does not match its content')
  }
  if (archive.source.recordDigest !== recordDigestOf(archive.record)) {
    throw charterError('INVALID_ARCHIVE', 'archive source digest does not match its record')
  }
  return archive
}

export interface RestorableArchive {
  readonly archive: CharterRecordArchive
  readonly record: CharterRecord
}

/**
 * Validate that an archive is restorable: source health must be healthy and the
 * record-derived revision/lifecycle must agree with the envelope.
 */
export function assertRestorableArchive(
  archive: CharterRecordArchive,
  record: CharterRecord,
  expected: { readonly sessionId: string; readonly lifecycle: string | null },
): void {
  if (archive.source.health !== 'healthy') {
    throw charterError('INVALID_ARCHIVE', 'only a healthy record archive can be restored')
  }
  if (archive.source.sessionId !== expected.sessionId) {
    throw charterError('INVALID_ARCHIVE', 'archive belongs to a different Session')
  }
  if ((archive.source.lifecycle ?? null) !== expected.lifecycle) {
    throw charterError('INVALID_ARCHIVE', 'archive lifecycle does not match the live Session lifecycle')
  }
  if (archive.source.revision !== record.current.revision) {
    throw charterError('INVALID_ARCHIVE', 'archive revision does not match its record')
  }
}

/** The deterministic empty-state digest for an initialize receipt. */
export function maintenanceSemanticCheck(receipt: {
  readonly kind: MaintenanceKind
  readonly resultRevision: number
  readonly resultStateDigest: string
  readonly sourceRecordDigest?: string | undefined
}, emptyStateDigest: string): void {
  if (receipt.kind === 'initialize') {
    if (receipt.resultRevision !== 0) {
      throw charterError('CORRUPT_STATE', 'initialize receipt must point at revision 0')
    }
    if (receipt.resultStateDigest !== emptyStateDigest) {
      throw charterError('CORRUPT_STATE', 'initialize receipt state digest is not the deterministic empty state')
    }
    if (receipt.sourceRecordDigest !== undefined) {
      throw charterError('CORRUPT_STATE', 'initialize receipt must not carry a source record digest')
    }
    return
  }
  if (receipt.sourceRecordDigest === undefined) {
    throw charterError('CORRUPT_STATE', 'restore receipt must carry a source record digest')
  }
}
