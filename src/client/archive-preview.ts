import { charterRecordArchiveSchema } from '../core/schemas.js'
import type { CharterRecordArchive } from '../core/schemas.js'

export interface ArchivePreviewExpectation {
  readonly sessionId: string
  readonly lifecycle: string | null
  readonly maxRecoveryBytes: number
}

export interface ArchivePreviewOk {
  readonly ok: true
  readonly archive: CharterRecordArchive
  readonly exportedAt: number
  readonly sourceSession: string
  readonly health: CharterRecordArchive['source']['health']
  readonly revision: number | null
  readonly lifecycle: string | null
  readonly digest: string
  readonly payloadDigestOk: boolean
  readonly recordDigestOk: boolean
}

export interface ArchivePreviewFailure {
  readonly ok: false
  readonly reason:
    | 'fileTooLarge'
    | 'invalidJson'
    | 'invalidArchive'
    | 'sessionMismatch'
    | 'lifecycleMismatch'
    | 'digestMismatch'
    | 'cryptoUnavailable'
}

export type ArchivePreviewResult = ArchivePreviewOk | ArchivePreviewFailure

function canonicalJson(value: unknown): string {
  return JSON.stringify(value)
}

async function sha256Text(value: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(value)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) return null
  try {
    const digest = await subtle.digest('SHA-256', bytes)
    return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return null
  }
}

/**
 * Client-side early preview ONLY: the Host repeats every check. It verifies the
 * envelope/digests with WebCrypto (no Node-only crypto in the browser bundle),
 * the Session/lifecycle identity, and the file size before restore is offered.
 */
export async function previewArchive(
  raw: unknown,
  expected: ArchivePreviewExpectation,
): Promise<ArchivePreviewResult> {
  let serialized: string
  try {
    serialized = canonicalJson(raw)
  } catch {
    return { ok: false, reason: 'invalidJson' }
  }
  if (new TextEncoder().encode(serialized).byteLength > expected.maxRecoveryBytes) {
    return { ok: false, reason: 'fileTooLarge' }
  }
  const parsed = charterRecordArchiveSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalidArchive' }
  const archive = parsed.data
  if (archive.source.sessionId !== expected.sessionId) {
    return { ok: false, reason: 'sessionMismatch' }
  }
  if (expected.lifecycle !== null && archive.source.lifecycle !== expected.lifecycle) {
    return { ok: false, reason: 'lifecycleMismatch' }
  }
  const { payloadDigest, ...body } = archive
  const actualPayload = await sha256Text(canonicalJson(body))
  if (actualPayload === null) return { ok: false, reason: 'cryptoUnavailable' }
  const actualRecord = await sha256Text(canonicalJson(archive.record))
  if (actualRecord === null) return { ok: false, reason: 'cryptoUnavailable' }
  const payloadDigestOk = payloadDigest === actualPayload
  const recordDigestOk = archive.source.recordDigest === actualRecord
  if (!payloadDigestOk || !recordDigestOk) return { ok: false, reason: 'digestMismatch' }
  return {
    ok: true,
    archive,
    exportedAt: archive.exportedAt,
    sourceSession: archive.source.sessionId,
    health: archive.source.health,
    revision: archive.source.revision,
    lifecycle: archive.source.lifecycle,
    digest: archive.source.recordDigest,
    payloadDigestOk,
    recordDigestOk,
  }
}
