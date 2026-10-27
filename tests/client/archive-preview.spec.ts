import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewArchive } from '../../src/client/archive-preview.js'
import { buildRecordArchive } from '../../src/core/archive.js'
import { createEmptyRecord } from '../../src/core/record.js'
import { DEFAULT_CHARTER_LIMITS } from '../../src/core/limits.js'

const sessionId = 'preview-session'
const identity = { createdAt: 1_700_000_000_000, cwd: '/work' }

function archive(lifecycle: string | null = null) {
  return buildRecordArchive({
    sessionId,
    lifecycle,
    health: 'healthy',
    revision: 0,
    record: createEmptyRecord(identity, DEFAULT_CHARTER_LIMITS),
    exportedAt: 1_700_000_000_001,
  })
}

const expectation = (maxRecoveryBytes = 4 * 1_024 * 1_024, lifecycle: string | null = null) => ({
  sessionId,
  lifecycle,
  maxRecoveryBytes,
})

afterEach(() => vi.unstubAllGlobals())

describe('rc.5 recovery archive preview', () => {
  it('round-trips a healthy archive', async () => {
    await expect(previewArchive(archive(), expectation())).resolves.toMatchObject({
      ok: true,
      sourceSession: sessionId,
      health: 'healthy',
    })
  })

  it('admits UTF-8 bytes, not JavaScript string length', async () => {
    const lifecycle = '中'.repeat(100)
    const value = archive(lifecycle)
    const serializedChars = JSON.stringify(value).length
    const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    expect(serializedBytes).toBeGreaterThan(serializedChars)
    const limit = serializedChars + 10
    await expect(previewArchive(value, expectation(limit, lifecycle))).resolves.toMatchObject({
      ok: false,
      reason: 'fileTooLarge',
    })
    await expect(previewArchive(value, expectation(serializedBytes, lifecycle))).resolves.toMatchObject({ ok: true })
  })

  it('fails closed with cryptoUnavailable when WebCrypto is missing', async () => {
    vi.stubGlobal('crypto', {})
    await expect(previewArchive(archive(), expectation())).resolves.toMatchObject({
      ok: false,
      reason: 'cryptoUnavailable',
    })
  })

  it('fails closed with cryptoUnavailable when subtle.digest rejects', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => { throw new Error('denied') } } })
    await expect(previewArchive(archive(), expectation())).resolves.toMatchObject({
      ok: false,
      reason: 'cryptoUnavailable',
    })
  })
})
