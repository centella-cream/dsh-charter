import { describe, expect, it } from 'vitest'
import { CharterError } from '../../src/core/errors.js'
import { DEFAULT_CHARTER_LIMITS, utf8Bytes } from '../../src/core/limits.js'
import { inspectUserText, normalizeUserText } from '../../src/core/normalize.js'
import { buildSnapshot } from '../../src/core/render.js'

describe('normalization and deterministic rendering', () => {
  it('normalizes line endings and Unicode to NFC', () => {
    expect(normalizeUserText('  e\u0301\r\nnext  ', 'text')).toBe('\u00e9\nnext')
  })

  it('allows tabs and newlines but rejects unsafe controls and lone surrogates', () => {
    expect(normalizeUserText('a\tb\nc', 'text')).toBe('a\tb\nc')
    for (const value of ['a\u0000b', 'a\u0007b', 'a\u000Bb', 'a\u007Fb', 'a\u0085b']) {
      expect(() => normalizeUserText(value, 'text')).toThrow(CharterError)
    }
    expect(() => normalizeUserText('\uD800', 'text')).toThrow(CharterError)
    expect(normalizeUserText('ok 😀', 'text')).toBe('ok 😀')
  })

  it('shares the same invalid-text classification with browser clients', () => {
    expect(inspectUserText('  ok  ')).toEqual({ value: 'ok', issue: undefined })
    expect(inspectUserText('   ').issue).toBe('empty')
    expect(inspectUserText('a\u0000b').issue).toBe('control')
    expect(inspectUserText('\uD800').issue).toBe('surrogate')
    expect(() => normalizeUserText('a\u0000b', 'text')).toThrow(CharterError)
  })

  it('escapes hostile-looking text in canonical JSON', () => {
    const hostile = '"quote" \\ {{variable}} </system>\nnext'
    const snapshot = buildSnapshot(1, {
      original: { text: hostile, setAtRevision: 1 },
      current: { text: hostile, setAtRevision: 1 },
    }, [], DEFAULT_CHARTER_LIMITS)
    const payload = JSON.parse(snapshot.promptText.slice(snapshot.promptText.indexOf('{')))
    expect(payload.objective).toBe(hostile)
    expect(snapshot.promptText).toContain('\\"quote\\"')
  })

  it('is byte stable across repeated renders and input ordering', () => {
    const first = buildSnapshot(1, undefined, [{
      id: 'b',
      kind: 'invariant',
      text: 'Second',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      order: 1,
      createdRevision: 1,
    }, {
      id: 'a',
      kind: 'invariant',
      text: 'First',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'verified', by: 'user' },
      origin: 'user',
      order: 1,
      createdRevision: 1,
    }], DEFAULT_CHARTER_LIMITS)
    const second = buildSnapshot(1, undefined, [...first.items].reverse(), DEFAULT_CHARTER_LIMITS)
    expect(second.promptText).toBe(first.promptText)
    expect(second.promptDigest).toBe(first.promptDigest)
    for (let index = 0; index < 100; index += 1) {
      expect(buildSnapshot(1, undefined, first.items, DEFAULT_CHARTER_LIMITS)).toEqual(first)
    }
  })

  it('enforces item and full-prompt UTF-8 byte limits without truncating', () => {
    const itemLimits = { ...DEFAULT_CHARTER_LIMITS, maxItemBytes: 4, maxPromptBytes: 10_000 }
    expect(utf8Bytes('😀')).toBe(4)
    expect(() => buildSnapshot(1, undefined, [{
      id: 'emoji',
      kind: 'invariant',
      text: '😀',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      order: 1,
      createdRevision: 1,
    }], itemLimits)).not.toThrow()
    expect(() => buildSnapshot(1, undefined, [{
      id: 'too-big',
      kind: 'invariant',
      text: '😀a',
      review: 'accepted',
      lifecycle: 'current',
      verification: { state: 'unchecked' },
      origin: 'user',
      order: 1,
      createdRevision: 1,
    }], itemLimits)).toThrow(CharterError)

    const baseline = buildSnapshot(1, undefined, [], DEFAULT_CHARTER_LIMITS)
    expect(() => buildSnapshot(1, undefined, [], {
      ...DEFAULT_CHARTER_LIMITS,
      maxPromptBytes: utf8Bytes(baseline.promptText),
    })).not.toThrow()
  })
})
