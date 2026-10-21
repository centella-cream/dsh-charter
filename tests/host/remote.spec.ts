import { describe, expect, it } from 'vitest'
import { charterRemoteContribution } from '../../src/remote/contribution.js'
import { charterEditRequestSchema, charterItemSchema } from '../../src/core/schemas.js'
import { charterBootstrapResultSchema, charterFrameSchema, charterViewSchema } from '../../src/remote/wire.js'

describe('charter Remote contract', () => {
  it('uses rc.2 create-based strict codecs and validates wire payloads', () => {
    expect(charterRemoteContribution.package).toBe('dsh-charter')
    expect(charterRemoteContribution.descriptors).toHaveLength(3)
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
})
