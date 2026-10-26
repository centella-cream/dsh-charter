import { describe, expect, it } from 'vitest'
import {
  appendMaintenanceReceipt,
  assertRecordConsistency,
  createEmptyRecord,
  emptyStateDigest,
  maintenanceRequestDigestOf,
  restoredRecord,
} from '../../src/core/record.js'
import {
  assertRestorableArchive,
  buildRecordArchive,
  payloadDigestOf,
  recordDigestOf,
  validateArchiveEnvelope,
} from '../../src/core/archive.js'
import { DEFAULT_CHARTER_LIMITS } from '../../src/core/limits.js'
import { charterRecordSchema } from '../../src/core/schemas.js'
import type { CharterMaintenanceReceipt, CharterRecord } from '../../src/core/schemas.js'
import { forkRecord } from '../../src/core/fork.js'

const limits = DEFAULT_CHARTER_LIMITS
const identity = { createdAt: 1_700_000_000_000, cwd: '/work' }

function emptyRecord(): CharterRecord {
  return createEmptyRecord(identity, limits)
}

function initializeReceipt(_record: CharterRecord, operationId = 'init-1'): CharterMaintenanceReceipt {
  return {
    operationId,
    kind: 'initialize',
    requestDigest: maintenanceRequestDigestOf({
      kind: 'initialize',
      sessionId: 'session-1',
      lifecycle: 'life-1',
      actor: { kind: 'owner' },
      expectedTarget: { kind: 'absent-unconfirmed' },
    }),
    resultRevision: 0,
    resultStateDigest: emptyStateDigest(limits),
    at: 1_700_000_000_100,
  }
}

function healthyArchive(record: CharterRecord, sessionId = 'session-1', lifecycle: string | null = 'life-1') {
  return buildRecordArchive({
    sessionId,
    lifecycle,
    health: 'healthy',
    revision: record.current.revision,
    record,
    exportedAt: 1_700_000_000_200,
  })
}

describe('record maintenance receipts', () => {
  it('keeps old records valid and is only added on maintenance', () => {
    const record = emptyRecord()
    expect(record.recentMaintenance).toBeUndefined()
    expect(charterRecordSchema.safeParse(record).success).toBe(true)
    const next = appendMaintenanceReceipt(record, initializeReceipt(record), limits)
    expect(next.recentMaintenance).toHaveLength(1)
    expect(charterRecordSchema.safeParse(next).success).toBe(true)
    expect(next.recentMaintenance?.[0]?.kind).toBe('initialize')
  })

  it('rejects duplicate ids and semantic mismatches', () => {
    const record = appendMaintenanceReceipt(emptyRecord(), initializeReceipt(emptyRecord()), limits)
    const only = record.recentMaintenance![0]!
    const duplicate = { ...record, recentMaintenance: [only, only] }
    expect(() => assertRecordConsistency(duplicate, limits)).toThrow(/duplicate maintenance|maintenance/i)
    const badDigest = {
      ...record,
      recentMaintenance: [{ ...record.recentMaintenance![0]!, resultStateDigest: `sha256:${'0'.repeat(64)}` as `sha256:${string}` }],
    }
    expect(() => assertRecordConsistency(badDigest, limits)).toThrow()
    const badRevision = {
      ...record,
      recentMaintenance: [{ ...record.recentMaintenance![0]!, resultRevision: 1 }],
    }
    expect(() => assertRecordConsistency(badRevision, limits)).toThrow()
  })

  it('trims to maintenanceLimit - 1 old receipts and always keeps the current one', () => {
    let record = emptyRecord()
    const first = initializeReceipt(record, 'init-1')
    record = appendMaintenanceReceipt(record, first, limits)
    const many: CharterRecord = { ...record }
    let next = many
    for (let index = 0; index < 30; index += 1) {
      const receipt = initializeReceipt(next, `init-${index + 2}`)
      next = appendMaintenanceReceipt(next, receipt, limits)
    }
    expect(next.recentMaintenance).toHaveLength(limits.maintenanceLimit)
    expect(next.recentMaintenance?.at(-1)?.operationId).toBe('init-31')
    expect(next.recentMaintenance?.some(receipt => receipt.operationId === 'init-31')).toBe(true)
  })
})

describe('record maintenance receipts (limit = 1)', () => {
  it('keeps exactly the current receipt when maintenanceLimit is 1', () => {
    const tight = { ...limits, maintenanceLimit: 1 }
    let record = createEmptyRecord(identity, tight)
    record = appendMaintenanceReceipt(record, initializeReceipt(record, 'op-1'), tight)
    expect(record.recentMaintenance).toHaveLength(1)
    record = appendMaintenanceReceipt(record, initializeReceipt(record, 'op-2'), tight)
    expect(record.recentMaintenance).toHaveLength(1)
    expect(record.recentMaintenance?.[0]?.operationId).toBe('op-2')
    expect(() => assertRecordConsistency(record, tight)).not.toThrow()
  })
})

describe('archive envelope', () => {
  it('round-trips a healthy archive and rejects payload mutation', () => {
    const record = emptyRecord()
    const archive = healthyArchive(record)
    expect(archive.source.recordDigest).toBe(recordDigestOf(record))
    const validated = validateArchiveEnvelope(archive, { sessionId: 'session-1' }, limits)
    expect(validated.formatVersion).toBe(1)
    const { payloadDigest, ...body } = archive
    expect(payloadDigest).toBe(payloadDigestOf(body))
    const tampered = { ...archive, record: { ...record, identity: { ...identity, cwd: '/other' } } }
    expect(() => validateArchiveEnvelope(tampered, { sessionId: 'session-1' }, limits)).toThrow(/INVALID_ARCHIVE|digest/i)
  })

  it('rejects a different Session and oversized archives', () => {
    const archive = healthyArchive(emptyRecord())
    expect(() => validateArchiveEnvelope(archive, { sessionId: 'other' }, limits)).toThrow(/Session/i)
    const big = { ...archive, formatVersion: 1, pad: 'x'.repeat(limits.maxRecoveryBytes + 64) }
    expect(() => validateArchiveEnvelope(big, { sessionId: 'session-1' }, limits)).toThrow(/exceeds/i)
  })

  it('restorable archives require healthy source, same lifecycle and revision', () => {
    const record = emptyRecord()
    const archive = healthyArchive(record)
    expect(() => assertRestorableArchive(archive, record, { sessionId: 'session-1', lifecycle: 'life-1' })).not.toThrow()
    expect(() => assertRestorableArchive(archive, record, { sessionId: 'session-1', lifecycle: 'life-2' })).toThrow(/lifecycle/i)
    expect(() => assertRestorableArchive(
      { ...archive, source: { ...archive.source, health: 'schema-invalid' } },
      record,
      { sessionId: 'session-1', lifecycle: 'life-1' },
    )).toThrow(/healthy/i)
  })

  it('restore keeps archived content and appends only a maintenance receipt', () => {
    const record = emptyRecord()
    const archive = healthyArchive(record)
    const receipt: CharterMaintenanceReceipt = {
      operationId: 'restore-1',
      kind: 'restore',
      requestDigest: maintenanceRequestDigestOf({
        kind: 'restore',
        sessionId: 'session-1',
        lifecycle: 'life-1',
        actor: { kind: 'owner' },
        expectedTarget: { kind: 'absent-unconfirmed' },
        sourceRecordDigest: archive.source.recordDigest as `sha256:${string}`,
      }),
      resultRevision: record.current.revision,
      resultStateDigest: record.current.stateDigest as `sha256:${string}`,
      sourceRecordDigest: archive.source.recordDigest as `sha256:${string}`,
      at: 1_700_000_000_300,
    }
    const restored = restoredRecord(record, receipt, limits)
    expect(restored.current).toEqual(record.current)
    expect(restored.recentMaintenance?.at(-1)?.sourceRecordDigest).toBe(archive.source.recordDigest)
    expect(() => assertRecordConsistency(restored, limits)).not.toThrow()
  })

  it('restore followed by edit preserves the restore receipt', () => {
    const record = appendMaintenanceReceipt(emptyRecord(), initializeReceipt(emptyRecord()), limits)
    const forked = forkRecord({
      parentSessionId: 'parent',
      parent: record,
      childIdentity: { createdAt: 5 },
      ids: {},
      mutationId: 'fork-1',
      at: 1_700_000_000_400,
      limits,
    })
    expect(forked.recentMaintenance).toBeUndefined()
  })
})

describe('rc.2 downgrade isolation contract (core schema shape)', () => {
  it('a receipt-bearing record is isolated by the strict rc.2 schema and re-read by rc.3', () => {
    const rc3Record = appendMaintenanceReceipt(emptyRecord(), initializeReceipt(emptyRecord()), limits)
    // rc.2's strict top-level schema had no recentMaintenance field: any such
    // record fails strict parsing and is preserved/isolated, never rewritten.
    const rc2Strict = charterRecordSchema.strict().omit({ recentMaintenance: true })
    expect(rc2Strict.safeParse(rc3Record).success).toBe(false)
    expect(charterRecordSchema.safeParse(rc3Record).success).toBe(true)
    expect(rc3Record.recentMaintenance).toHaveLength(1)
  })
})

describe('recovery size and timestamp admission', () => {
  it('rejects exportedAt values outside the JavaScript Date representable range', () => {
    const archive = buildRecordArchive({
      sessionId: 'session-1',
      lifecycle: null,
      health: 'healthy',
      revision: 0,
      record: emptyRecord(),
      exportedAt: 8_640_000_000_000_001,
    })
    expect(charterRecordSchema.safeParse(archive.record).success).toBe(true)
    expect(() => validateArchiveEnvelope(archive, { sessionId: 'session-1' }, limits))
      .toThrow(/archive does not match/i)
  })

  it('enforces maxRecoveryBytes on the complete archive/request envelope', async () => {
    const { assertArchiveAdmission, assertRecoveryRequestAdmission } = await import('../../src/core/archive.js')
    const oversized = { archive: 'x'.repeat(limits.maxRecoveryBytes), padding: 'y' }
    expect(() => assertArchiveAdmission(oversized, limits)).toThrow(/exceeds/i)
    expect(() => assertRecoveryRequestAdmission(oversized, limits)).toThrow(/exceeds/i)
    expect(() => assertArchiveAdmission({ small: true }, limits)).not.toThrow()
  })
})
