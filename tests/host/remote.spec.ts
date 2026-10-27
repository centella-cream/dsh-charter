import { describe, expect, it } from 'vitest'
import { charterRemoteContribution } from '../../src/remote/contribution.js'
import { charterEditRequestSchema, charterItemSchema } from '../../src/core/schemas.js'
import {
  charterBootstrapResultSchema,
  charterFrameSchema,
  charterInitializeRequestWireSchema,
  charterRecordExportSchema,
  charterRecordOperationResultSchema,
  charterRestoreRequestWireSchema,
  charterViewSchema,
} from '../../src/remote/wire.js'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

describe('charter Remote contract', () => {
  it('uses rc.3 create-based strict codecs and validates six wire methods', () => {
    expect(charterRemoteContribution.package).toBe('dsh-charter')
    expect(charterRemoteContribution.descriptors).toHaveLength(6)
    expect(charterRemoteContribution.descriptors.map(descriptor => descriptor.method))
      .toEqual(['watch', 'bootstrap', 'edit', 'exportRecord', 'initializeRecord', 'restoreRecord'])
    for (const descriptor of charterRemoteContribution.descriptors) {
      expect(descriptor.result.mode).toBe('strict')
      if (descriptor.result.mode === 'strict') expect(typeof descriptor.result.create).toBe('function')
      expect(descriptor.id).toContain('dsh-charter#charter/')
    }
    const edit = charterRemoteContribution.descriptors.find(item => item.method === 'edit')
    const bootstrap = charterRemoteContribution.descriptors.find(item => item.method === 'bootstrap')
    expect(bootstrap?.parameters[0]?.name).toBe('sessionId')
    const parameter = edit?.parameters[0]
    expect(parameter?.codec.mode).toBe('strict')
    if (parameter?.codec.mode === 'strict') {
      const codec = parameter.codec
      expect(() => codec.create().parse({})).toThrow()
      expect(codec.create().parse({
        sessionId: 's1',
        mutationId: 'm1',
        baseRevision: 0,
        ops: [{
          type: 'item.add',
          item: { clientRef: 'c1', kind: 'invariant', text: 'Run tests', order: 0 },
        }],
      })).toEqual(expect.objectContaining({ sessionId: 's1' }))
    }
    expect(charterEditRequestSchema.safeParse({
      sessionId: 's1',
      mutationId: 'm1',
      baseRevision: 0,
      ops: [{
        type: 'item.add',
        item: { clientRef: 'c1', kind: 'invariant', text: 'Run tests', order: 0 },
      }],
    }).success).toBe(true)
    expect(charterItemSchema.safeParse({
      id: 'i1',
      kind: 'invariant',
      text: 'Run tests',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      order: 0,
      createdRevision: 1,
    }).success).toBe(true)
  })

  it('reads a view emitted by a Host that predates the storage-limit fields', () => {
    const parsed = charterFrameSchema.safeParse({
      type: 'snapshot',
      value: {
        status: 'ready',
        sessionId: 's1',
        revision: 1,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: {
          maxPromptBytes: 8_192,
          maxObjectiveBytes: 4_096,
          maxItemBytes: 1_024,
          maxOps: 64,
          maxActiveInvariants: 24,
          maxActiveDeliverables: 16,
        },
      },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.value.limits.maxItems).toBe(512)
      expect(parsed.data.value.limits.maxPendingItems).toBe(512)
    }
  })

  it('accepts a Host view with proposals disabled', () => {
    const parsed = charterFrameSchema.safeParse({
      type: 'snapshot',
      value: {
        status: 'ready',
        sessionId: 's1',
        revision: 1,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: {
          maxPromptBytes: 8_192,
          maxObjectiveBytes: 4_096,
          maxItemBytes: 1_024,
          maxItems: 512,
          maxPendingItems: 0,
          maxOps: 1024,
        },
      },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.value.limits.maxPendingItems).toBe(0)
    expect(charterViewSchema.safeParse({
      status: 'ready',
      sessionId: 's1',
      revision: 0,
      objective: null,
      items: [],
      promptText: '',
      promptDigest: '',
      limits: {
        maxPromptBytes: 8_192,
        maxObjectiveBytes: 4_096,
        maxItemBytes: 1_024,
        maxItems: 512,
        maxPendingItems: -1,
        maxOps: 1024,
      },
    }).success).toBe(false)
  })

  it('keeps frame schema strict and discriminated', () => {
    expect(charterFrameSchema.safeParse({
      type: 'snapshot',
      value: {
        status: 'ready',
        sessionId: 's1',
        revision: 1,
        objective: null,
        items: [],
        promptText: '',
        promptDigest: '',
        limits: {
          maxPromptBytes: 8_192,
          maxObjectiveBytes: 4_096,
          maxItemBytes: 1_024,
          maxItems: 512,
          maxPendingItems: 512,
          maxOps: 1024,
        },
      },
    }).success).toBe(true)
    expect(charterFrameSchema.safeParse({ type: 'unknown', value: {} }).success).toBe(false)
    expect(charterBootstrapResultSchema.safeParse({
      available: true,
      proposal: {
        objective: 'Ship it',
        invariants: ['Do not break the API'],
        deliverables: [],
        source: { summarySeq: 3, at: 4, shadowedTokens: 5 },
      },
    }).success).toBe(true)
    expect(charterBootstrapResultSchema.safeParse({ available: false, reason: 'no-summary' }).success).toBe(true)
  })

  it('describes Session resources, strict codecs, and the outer restore contract', () => {
    for (const descriptor of charterRemoteContribution.descriptors) {
      // Session resources are declared on the Host method decorators (checked by
      // the composition/remote service tests); every client descriptor carries
      // at least one strictly decoded parameter and a strict result codec.
      expect(descriptor.invocation.kind).toBe('direct')
      expect(descriptor.service).toBe('charterRemote')
      expect(descriptor.namespace).toBe('charter')
      expect(descriptor.parameters.length).toBeGreaterThan(0)
      expect(descriptor.parameters.every(parameter => (parameter.codec as { mode: string }).mode === 'strict')).toBe(true)
      expect(descriptor.result.mode).toBe('strict')
    }
    const restore = charterRemoteContribution.descriptors.find(item => item.method === 'restoreRecord')
    const parameter = restore?.parameters[0]
    expect(parameter?.codec.mode).toBe('strict')
    if (parameter?.codec.mode !== 'strict') throw new Error('expected strict restore codec')
    const schema = parameter.codec.create() as unknown as { safeParse: (value: unknown) => { success: boolean } }
    const outer = {
      sessionId: 's1',
      operationId: 'op-1',
      expectedLifecycle: 'life-1',
      expectedTarget: { kind: 'absent-unconfirmed' },
      archive: { format: 'dsh-charter-record', formatVersion: 1, record: {} },
    }
    expect(schema.safeParse(outer).success).toBe(true)
    expect(schema.safeParse({ ...outer, unexpected: true }).success).toBe(false)
    expect(schema.safeParse({ ...outer, archive: undefined }).success).toBe(false)
  })

  it('encodes future-schema record state as non-recoverable and rejects a recoverable form', async () => {
    const { charterRecordStateSchema } = await import('../../src/remote/wire.js')
    expect(charterRecordStateSchema.safeParse({
      kind: 'invalid',
      reason: 'future-schema',
      recordDigest: `sha256:${'a'.repeat(64)}`,
      recoverable: false,
    }).success).toBe(true)
    expect(charterRecordStateSchema.safeParse({
      kind: 'invalid',
      reason: 'future-schema',
      recordDigest: `sha256:${'a'.repeat(64)}`,
      recoverable: true,
    }).success).toBe(false)
  })

  it('round-trips new error codes and maintenance result/export codecs', () => {
    const view = {
      status: 'unavailable',
      sessionId: 's1',
      revision: 0,
      objective: null,
      items: [],
      promptText: '',
      promptDigest: 'sha256:' + '0'.repeat(64),
      limits: {
        maxPromptBytes: 8192,
        maxObjectiveBytes: 4096,
        maxItemBytes: 1024,
        maxItems: 512,
        maxPendingItems: 512,
        maxOps: 1024,
        maxRecordBytes: 1_048_576,
        maintenanceLimit: 16,
        maxRecoveryBytes: 4_194_304,
      },
      overBudget: false,
      recordState: { kind: 'absent-unconfirmed', source: 'resume' },
      capabilities: { recordMaintenance: true },
    }
    expect(charterViewSchema.safeParse(view).success).toBe(true)
    for (const code of ['INITIALIZATION_REQUIRED', 'INVALID_ARCHIVE', 'RECORD_CONFLICT', 'OPERATION_ID_REUSED', 'RECOVERY_UNSUPPORTED']) {
      expect(charterRecordOperationResultSchema.safeParse({ ok: false, code, message: 'x' }).success).toBe(true)
    }
    expect(charterRecordExportSchema.safeParse({
      ok: true,
      filename: 'a.json',
      archive: {
        format: 'dsh-charter-record',
        formatVersion: 1,
        exportedAt: 1,
        source: {
          domain: 'dsh_charter_v1',
          domainVersion: 1,
          sessionId: 's1',
          lifecycle: 'life-1',
          health: 'healthy',
          revision: 0,
          recordDigest: 'sha256:' + '0'.repeat(64),
        },
        record: {},
        payloadDigest: 'sha256:' + '0'.repeat(64),
      },
    }).success).toBe(true)
    expect(charterInitializeRequestWireSchema.safeParse({
      sessionId: 's1',
      operationId: 'op-1',
      expectedLifecycle: 'life-1',
    }).success).toBe(true)
    expect(charterRestoreRequestWireSchema.safeParse({
      sessionId: 's1',
      operationId: 'op-1',
      expectedLifecycle: 'life-1',
      expectedTarget: { kind: 'invalid', reason: 'schema', recordDigest: 'sha256:' + '0'.repeat(64) },
      archive: {},
    }).success).toBe(true)
  })

  it('classifies Remote failures by stable code, never message or instanceof', async () => {
    const { classifyRemoteFailure } = await import('../../src/client/remote-error.js')
    for (const code of ['gateway/bad-request', 'gateway/arguments-invalid', 'remote-access/denied'] as const) {
      expect(classifyRemoteFailure(new RemoteError(code as never, 'm', {} as never))).toEqual({ kind: 'known', code })
    }
    for (const code of ['gateway/internal', 'gateway/cancelled'] as const) {
      expect(classifyRemoteFailure(new RemoteError(code as never, 'm', {} as never))).toEqual({ kind: 'unknown' })
    }
    expect(classifyRemoteFailure(new Error('anything'))).toEqual({ kind: 'unknown' })
    // Structural marker works across copies without instanceof.
    expect(classifyRemoteFailure({ isDSHRemoteError: true, code: 'remote-access/denied' }))
      .toEqual({ kind: 'known', code: 'remote-access/denied' })
  })
})
